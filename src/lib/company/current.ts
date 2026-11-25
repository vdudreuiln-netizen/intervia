import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "./settings";
import { seedDemoQuote } from "@/lib/demo/seed";

export interface CurrentCompany extends CompanyRow {
  id: string;
  onboarding_done: boolean;
  technicians_see_margins: boolean;
  placement_rules: Record<string, unknown>;
  fluid_capacity_number: string | null;
  country: string;
  leak_detector_id: string | null;
  leak_detector_checked_on: string | null;
  tariff_alert_months: number;
}

const COLUMNS =
  "id, onboarding_done, legal_name, siret, address_line, postal_code, city, phone, email, logo_path, stamp_path, " +
  "insurer_name, insurance_policy, insurance_coverage, bank_holder, iban, bic, vat_regime, vat_number, default_vat_rate, " +
  "labor_charges_rate, material_charges_rate, daily_labor_rate_cents, accessory_sale_coefficient, target_margin_per_day_cents, quote_validity_days, payment_terms, " +
  "base_address, base_postal_code, base_city, base_citycode, base_lat, base_lng, travel_price_per_km_cents, travel_minimum_fee_cents, " +
  "parking_per_day_cents, travel_min_daily_with_parking_cents, technicians_see_margins, mediator_name, mediator_address, mediator_website, deposit_rate, follow_up_days, preferred_brand_id, commissioning_price_cents, fluid_form_price_cents, fluid_form_policy, default_electric_length_m, placement_rules, fluid_capacity_number, country, leak_detector_id, leak_detector_checked_on, tariff_alert_months";

/**
 * Utilisateur connecté + son entreprise. Crée l'entreprise au premier passage
 * (essai 14 jours, coefficients par défaut, catalogue exemple).
 * Mis en cache pour la durée d'une requête.
 */
export const getCurrentCompany = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/connexion");

  let { data: company } = await supabase.from("companies").select(COLUMNS).maybeSingle<CurrentCompany>();
  let createdNow = false;
  if (!company) {
    // Invité par un collègue : on rejoint son entreprise au lieu d'en créer une.
    const invitation = user.user_metadata?.invitation_token as string | undefined;
    const joined = invitation ? !(await supabase.rpc("accept_invitation", { p_token: invitation })).error : false;
    if (!joined) {
      const legalName = (user.user_metadata?.legal_name as string | undefined) ?? "";
      const { error } = await supabase.rpc("create_company_for_current_user", { p_legal_name: legalName });
      if (error) throw new Error(`Création de l'entreprise impossible : ${error.message}`);
      createdNow = true;
    }
    ({ data: company } = await supabase.from("companies").select(COLUMNS).single<CurrentCompany>());
  }
  if (!company) throw new Error("Entreprise introuvable");
  // PostgREST renvoie les numeric en nombre ; on s'en assure pour les taux.
  company.default_vat_rate = Number(company.default_vat_rate);
  company.labor_charges_rate = Number(company.labor_charges_rate);
  company.material_charges_rate = Number(company.material_charges_rate);
  company.accessory_sale_coefficient = Number(company.accessory_sale_coefficient);
  // Colonne protégée en base : servie seulement aux membres autorisés (sinon 0, cf. costAccess).
  const { data: apc } = await supabase.rpc("company_accessory_purchase_coefficient");
  company.accessory_purchase_coefficient = apc === null || apc === undefined ? 0 : Number(apc);
  company.default_electric_length_m = Number(company.default_electric_length_m);
  company.deposit_rate = Number(company.deposit_rate);
  // Nouvel inscrit : un devis de démonstration déjà rempli
  if (createdNow) await seedDemoQuote(supabase, company);
  const { data: profile } = await supabase.from("profiles").select("access_role, role, full_name").eq("id", user.id).single();
  const role = (profile?.access_role ?? "technicien") as "admin" | "technicien";
  return {
    supabase,
    user,
    company,
    role,
    isOwner: profile?.role === "owner",
    /** Les techniciens ne voient les marges et prix d'achat que si l'administrateur l'autorise. */
    canSeeMargins: role === "admin" || company.technicians_see_margins,
  };
});
