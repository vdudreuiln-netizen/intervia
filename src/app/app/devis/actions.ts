"use server";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { isSameCommune } from "@/lib/geo/adresse";
import { roadDistance } from "@/lib/geo/route";
import { computeQuote } from "@/lib/pricing/engine";
import { parseClientSite, type ClientSiteErrors, type ClientSiteForm } from "@/lib/quote/client";
import { calcContext } from "@/lib/quote/context";
import { fromSelection } from "@/lib/quote/equipment";
import { buildLines, enabledLines, proposeDays } from "@/lib/quote/lines";
import { companyPricing, loadCoefficients, loadQuote, loadWizardCatalog, siteInfo } from "@/lib/quote/load";
import { parseRooms, toRoomNeeds, type RoomForm } from "@/lib/quote/rooms";
import { EMPTY_METRE, type WizardState } from "@/lib/quote/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAIL = "Enregistrement impossible. Réessayez.";

// ---------------------------------------------------------------------------
// Étape 1 : client et chantier
// ---------------------------------------------------------------------------

export async function saveClientSite(quoteId: string | null, form: ClientSiteForm): Promise<{ ok: boolean; errors?: ClientSiteErrors; message?: string; id?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseClientSite(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };
  const { client, site } = parsed.values;

  if (quoteId) {
    const q = await loadQuote(supabase, quoteId);
    if (!q) return { ok: false, message: "Devis introuvable." };
    const a = await supabase.from("clients").update(client).eq("id", q.project.client.id);
    const b = await supabase.from("projects").update(site).eq("id", q.project.id);
    if (a.error || b.error) return { ok: false, message: FAIL };
    revalidatePath(`/app/devis/${quoteId}`);
    return { ok: true, id: quoteId };
  }

  const { data: c, error: e1 } = await supabase.from("clients").insert({ ...client, company_id: company.id }).select("id").single();
  if (e1) return { ok: false, message: FAIL };
  const { data: p, error: e2 } = await supabase.from("projects").insert({ ...site, company_id: company.id, client_id: c.id }).select("id").single();
  if (e2) return { ok: false, message: FAIL };
  const { data: q, error: e3 } = await supabase
    .from("quotes")
    .insert({ company_id: company.id, project_id: p.id, vat_regime: company.vat_regime, validity_days: company.quote_validity_days, payment_terms: company.payment_terms })
    .select("id")
    .single();
  if (e3) return { ok: false, message: FAIL };
  revalidatePath("/app");
  return { ok: true, id: q.id };
}

/** Distance routière depuis l'adresse de l'entreprise + détection « même commune ». */
export async function computeDistance(site: { lat: number; lng: number; citycode: string; postcode: string; city: string }): Promise<{ ok: boolean; oneWayKm?: number; source?: "route" | "estimation"; sameCommune?: boolean; message?: string }> {
  const { company } = await getCurrentCompany();
  const sameCommune = isSameCommune(
    { citycode: company.base_citycode, postcode: company.base_postal_code, city: company.base_city },
    { citycode: site.citycode, postcode: site.postcode, city: site.city },
  );
  if (sameCommune) return { ok: true, oneWayKm: 0, source: "route", sameCommune };
  if (company.base_lat === null || company.base_lng === null) {
    return { ok: false, sameCommune, message: "Adresse de départ non localisée (Paramètres › Déplacements) : saisissez la distance à la main." };
  }
  const d = await roadDistance({ lat: Number(company.base_lat), lng: Number(company.base_lng) }, { lat: site.lat, lng: site.lng });
  return { ok: true, oneWayKm: d.oneWayKm, source: d.source, sameCommune };
}

// ---------------------------------------------------------------------------
// Étapes 2 et 3 : pièces et dimensionnement
// ---------------------------------------------------------------------------

export async function saveRooms(quoteId: string, forms: RoomForm[], gainableAccess: boolean): Promise<{ ok: boolean; errors?: Record<string, Record<string, string>>; message?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const coefs = await loadCoefficients(supabase);
  const parsed = parseRooms(forms, coefs.sizing);
  if (!parsed.ok) return { ok: false, errors: parsed.errors as Record<string, Record<string, string>>, message: forms.length === 0 ? "Ajoutez au moins une pièce." : "Certaines pièces sont à corriger." };

  const keep = parsed.values.filter((r) => UUID.test(r.id)).map((r) => r.id);
  const before = q.rooms.map((r) => r.id);
  const removed = before.filter((id) => !keep.includes(id));
  if (removed.length) {
    const { error } = await supabase.from("rooms").delete().in("id", removed);
    if (error) return { ok: false, message: FAIL };
  }
  for (const [i, r] of parsed.values.entries()) {
    const { id, ...row } = r;
    const data = { ...row, position: i, company_id: company.id, project_id: q.project.id };
    const res = UUID.test(id) && before.includes(id) ? await supabase.from("rooms").update(data).eq("id", id) : await supabase.from("rooms").insert(data);
    if (res.error) return { ok: false, message: FAIL };
  }
  await supabase.from("projects").update({ gainable_access: gainableAccess }).eq("id", q.project.id);

  // Pièces ajoutées / supprimées : la sélection de matériel n'est plus valable.
  const changed = removed.length > 0 || parsed.values.some((r) => !UUID.test(r.id));
  if (changed && q.wizard.selection) {
    await supabase.from("quotes").update({ wizard: { ...q.wizard, selection: undefined, metre: undefined } }).eq("id", quoteId);
  }
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Étapes 4 à 6 : état de l'assistant
// ---------------------------------------------------------------------------

export async function saveWizard(quoteId: string, patch: WizardState): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const wizard: WizardState = { ...q.wizard, ...patch };
  const { error } = await supabase.from("quotes").update({ wizard }).eq("id", quoteId);
  if (error) return { ok: false, message: FAIL };
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true };
}

/**
 * Génère les lignes du devis CÔTÉ SERVEUR à partir de l'état de l'assistant
 * et du catalogue en base (on ne fait jamais confiance aux prix envoyés par
 * le navigateur), puis enregistre lignes et totaux.
 */
export async function finalizeQuote(quoteId: string): Promise<{ ok: boolean; message?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  if (!q.wizard.selection) return { ok: false, message: "Choisissez d'abord une solution (étape 4)." };
  const [catalog, coefs] = await Promise.all([loadWizardCatalog(supabase), loadCoefficients(supabase)]);
  const equipment = fromSelection(q.wizard.selection, catalog.products);
  if (!equipment) return { ok: false, message: "Un produit choisi n'existe plus dans le catalogue : refaites le choix à l'étape 4." };

  const pricingCompany = companyPricing(company);
  const ctx = calcContext(pricingCompany, siteInfo(q), coefs, q.wizard);
  const metre = q.wizard.metre ?? EMPTY_METRE;
  const days = q.wizard.laborDays ?? proposeDays(equipment, metre, coefs.laborDays);
  const travel = ctx.travelFor(days);
  const built = buildLines(equipment, toRoomNeeds(q.rooms), metre, catalog.accessories, ctx.lineSettings, days, travel);
  const lines = enabledLines(built.lines);
  const result = computeQuote({ lines, laborDays: days, settings: ctx.pricing });

  const byKey = new Map(built.lines.map((l) => [l.key, l]));
  const rows = result.lines.map((l, i) => ({
    company_id: company.id,
    quote_id: quoteId,
    position: i,
    kind: l.kind,
    product_id: byKey.get(l.id)?.productId ?? null,
    accessory_id: byKey.get(l.id)?.accessoryId ?? null,
    designation: l.designation,
    quantity: l.quantity,
    unit: l.unit,
    unit_purchase_cents: l.unitPurchaseCents,
    unit_sale_cents: l.unitSaleCents,
    vat_rate: l.vatRate,
  }));
  const del = await supabase.from("quote_lines").delete().eq("quote_id", quoteId);
  if (del.error) return { ok: false, message: FAIL };
  const ins = await supabase.from("quote_lines").insert(rows);
  if (ins.error) return { ok: false, message: FAIL };
  const upd = await supabase
    .from("quotes")
    .update({
      labor_days: days,
      travel_trips: travel?.applies ? travel.days : 0,
      one_way_km: q.project.one_way_km,
      total_ht_cents: result.totalHtCents,
      total_ttc_cents: result.totalTtcCents,
      net_margin_cents: result.margin.netMarginCents,
    })
    .eq("id", quoteId);
  if (upd.error) return { ok: false, message: FAIL };
  revalidatePath("/app");
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true };
}
