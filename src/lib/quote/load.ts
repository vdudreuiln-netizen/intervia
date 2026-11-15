import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/catalog/queries";
import { withDefaults, type Coefficients } from "@/lib/sizing/coefficients";
import type { CurrentCompany } from "@/lib/company/current";
import type { QuoteDiscount, QuoteLineInput } from "@/lib/pricing/engine";
import type { CompanyPricing, SiteInfo } from "./context";
import type { RoomValues } from "./rooms";
import type { AutoRole, CatAccessory, CatProduct, WizardState } from "./types";
import { itemNetPrices, loadSupplierBook } from "@/lib/suppliers/load";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Catalogue AVEC coûts : `db` = client normal (membre autorisé) ou client service (serveur seulement), filtré par entreprise. */
export async function loadWizardCatalog(supabase: SupabaseClient, companyId: string): Promise<{ products: CatProduct[]; accessories: CatAccessory[] }> {
  type RawP = Record<string, unknown> & {
    brands: { name: string; discount_rate: number; sale_coefficient: number };
  };
  const [products, accessories, sb] = await Promise.all([
    fetchAll<RawP>(
      (from, to) =>
        supabase
          .from("products")
          .select(
            "id, brand_id, reference, range_name, type, cooling_kw, heating_kw, max_outlets, max_indoor_ratio, link_diameters, precharged_length_m, extra_charge_g_per_m, public_price_cents, discount_rate, brands(name, discount_rate, sale_coefficient)",
          )
          .eq("company_id", companyId)
          .eq("active", true)
          .neq("type", "accessoire")
          .range(from, to) as never,
    ),
    fetchAll<Record<string, unknown>>(
      (from, to) =>
        supabase
          .from("accessories")
          .select("id, auto_role, category, name, diameter, unit, public_price_cents, purchase_price_cents, floor_purchase_cents, discount_rate")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("created_at")
          .range(from, to) as never,
    ),
    loadSupplierBook(supabase, companyId),
  ]);
  // Prix d'achat = fournisseur le moins cher ; le choix définitif (port compris) est fait sur le devis.
  const cheapest = (item: { productId?: string; accessoryId?: string }) => itemNetPrices(sb, item)[0]?.netCents ?? null;
  return {
    products: products.map((p) => ({
      id: p.id as string,
      brandId: p.brand_id as string,
      brandName: p.brands.name,
      reference: p.reference as string,
      rangeName: (p.range_name as string | null) ?? null,
      type: p.type as CatProduct["type"],
      coolingKw: num(p.cooling_kw),
      heatingKw: num(p.heating_kw),
      maxOutlets: num(p.max_outlets),
      maxIndoorRatio: num(p.max_indoor_ratio),
      linkDiameters: (p.link_diameters as string | null) ?? null,
      prechargedLengthM: num(p.precharged_length_m),
      extraChargeGPerM: num(p.extra_charge_g_per_m),
      publicPriceCents: Number(p.public_price_cents),
      brandDiscount: Number(p.brands.discount_rate),
      productDiscount: num(p.discount_rate),
      brandCoefficient: Number(p.brands.sale_coefficient),
      netPurchaseCents: cheapest({ productId: p.id as string }),
    })),
    accessories: accessories.map((a) => ({
      id: a.id as string,
      role: (a.auto_role as AutoRole | null) ?? null,
      category: a.category as string,
      name: a.name as string,
      diameter: (a.diameter as string | null) ?? null,
      unit: a.unit as string,
      publicPriceCents: num(a.public_price_cents),
      purchasePriceCents: num(a.purchase_price_cents),
      discount: Number(a.discount_rate),
      netPurchaseCents: cheapest({ accessoryId: a.id as string }),
      floorPurchaseCents: num(a.floor_purchase_cents),
    })),
  };
}

export async function loadCoefficients(supabase: SupabaseClient): Promise<Coefficients> {
  const { data } = await supabase.from("settings_coefficients").select("sizing, labor_days").maybeSingle();
  return withDefaults(data ? { sizing: data.sizing, laborDays: data.labor_days } : null);
}

export function companyPricing(c: CurrentCompany): CompanyPricing {
  return {
    vat_regime: c.vat_regime,
    default_vat_rate: c.default_vat_rate,
    labor_charges_rate: c.labor_charges_rate,
    material_charges_rate: c.material_charges_rate,
    daily_labor_rate_cents: Number(c.daily_labor_rate_cents),
    target_margin_per_day_cents: Number(c.target_margin_per_day_cents),
    accessory_sale_coefficient: c.accessory_sale_coefficient,
    accessory_purchase_coefficient: c.accessory_purchase_coefficient,
    travel_price_per_km_cents: Number(c.travel_price_per_km_cents),
    travel_minimum_fee_cents: Number(c.travel_minimum_fee_cents),
    travel_min_daily_with_parking_cents: Number(c.travel_min_daily_with_parking_cents),
    parking_per_day_cents: Number(c.parking_per_day_cents),
    preferred_brand_id: c.preferred_brand_id,
    commissioning_price_cents: Number(c.commissioning_price_cents),
    fluid_form_price_cents: Number(c.fluid_form_price_cents),
    fluid_form_policy: c.fluid_form_policy,
    default_electric_length_m: c.default_electric_length_m,
  };
}

export interface QuoteRecord {
  id: string;
  number: string;
  status: string;
  wizard: WizardState;
  laborDays: number;
  discount: QuoteDiscount | null;
  vatRegime: "franchise" | "assujetti";
  document: {
    issueDate: string;
    validityDays: number;
    presentation: "particulier" | "detaille";
    signedOffPremises: boolean;
    earlyStart: boolean;
    urgentRepair: boolean;
    depositRate: number | null;
    schedule: { label: string; rate: number }[] | null;
    sentAt: string | null;
    decidedAt: string | null;
  };
  project: {
    id: string;
    site_address: string | null;
    site_postal_code: string | null;
    site_city: string | null;
    site_citycode: string | null;
    site_lat: number | null;
    site_lng: number | null;
    one_way_km: number | null;
    same_commune: boolean;
    parking_enabled: boolean;
    parking_per_day_cents: number | null;
    gainable_access: boolean;
    client: { id: string; name: string; email: string | null; phone: string | null; address_line: string | null; postal_code: string | null; city: string | null };
  };
  rooms: RoomValues[];
}

export async function loadQuote(supabase: SupabaseClient, id: string): Promise<QuoteRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: q } = await supabase
    .from("quotes")
    .select("id, number, status, wizard, labor_days, discount_kind, discount_value, vat_regime, issue_date, validity_days, presentation, signed_off_premises, early_start, urgent_repair, deposit_rate, payment_schedule, sent_at, decided_at, projects(id, site_address, site_postal_code, site_city, site_citycode, site_lat, site_lng, one_way_km, same_commune, parking_enabled, parking_per_day_cents, gainable_access, clients(id, name, email, phone, address_line, postal_code, city))")
    .eq("id", id)
    .maybeSingle();
  if (!q) return null;
  const p = q.projects as unknown as Record<string, unknown> & { clients: QuoteRecord["project"]["client"] };
  const { data: rooms } = await supabase.from("rooms").select("*").eq("project_id", p.id as string).order("position");
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    wizard: (q.wizard ?? {}) as WizardState,
    laborDays: Number(q.labor_days),
    discount: q.discount_kind ? { kind: q.discount_kind as QuoteDiscount["kind"], value: Number(q.discount_value) } : null,
    vatRegime: q.vat_regime,
    document: {
      issueDate: q.issue_date,
      validityDays: q.validity_days,
      presentation: q.presentation,
      signedOffPremises: q.signed_off_premises,
      earlyStart: q.early_start,
      urgentRepair: q.urgent_repair,
      depositRate: q.deposit_rate === null ? null : Number(q.deposit_rate),
      schedule: q.payment_schedule as { label: string; rate: number }[] | null,
      sentAt: q.sent_at,
      decidedAt: q.decided_at,
    },
    project: {
      id: p.id as string,
      site_address: (p.site_address as string | null) ?? null,
      site_postal_code: (p.site_postal_code as string | null) ?? null,
      site_city: (p.site_city as string | null) ?? null,
      site_citycode: (p.site_citycode as string | null) ?? null,
      site_lat: num(p.site_lat),
      site_lng: num(p.site_lng),
      one_way_km: num(p.one_way_km),
      same_commune: p.same_commune as boolean,
      parking_enabled: p.parking_enabled as boolean,
      parking_per_day_cents: num(p.parking_per_day_cents),
      gainable_access: p.gainable_access as boolean,
      client: p.clients,
    },
    rooms: (rooms ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      surface_m2: Number(r.surface_m2),
      ceiling_height_m: Number(r.ceiling_height_m),
      orientation: r.orientation,
      insulation: r.insulation,
      large_glazing: r.large_glazing,
      under_roof: r.under_roof,
      level: r.level,
      indoor_type: r.indoor_type,
      need_watts: r.need_watts ?? 0,
      need_override_watts: r.need_override_watts,
    })),
  };
}

export function siteInfo(q: QuoteRecord): SiteInfo {
  const p = q.project;
  return { one_way_km: p.one_way_km, same_commune: p.same_commune, parking_enabled: p.parking_enabled, parking_per_day_cents: p.parking_per_day_cents, gainable_access: p.gainable_access };
}

export interface QuoteLineRow extends QuoteLineInput {
  origin: "wizard" | "manual";
  wizardKey: string | null;
  productId: string | null;
  accessoryId: string | null;
  position: number;
  supplierId: string | null;
  supplierForced: boolean;
}

/** Lignes AVEC prix d'achat (voir loadWizardCatalog pour `supabase` / `companyId`). */
export async function loadQuoteLines(supabase: SupabaseClient, companyId: string, quoteId: string): Promise<QuoteLineRow[]> {
  const { data } = await supabase.from("quote_lines").select("*").eq("company_id", companyId).eq("quote_id", quoteId).order("position");
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    designation: r.designation,
    quantity: Number(r.quantity),
    unit: r.unit,
    unitPurchaseCents: Number(r.unit_purchase_cents),
    unitSaleCents: Number(r.unit_sale_cents),
    vatRate: Number(r.vat_rate),
    origin: r.origin,
    wizardKey: r.wizard_key,
    productId: r.product_id,
    accessoryId: r.accessory_id,
    position: r.position,
    supplierId: r.supplier_id ?? null,
    supplierForced: Boolean(r.supplier_forced),
  }));
}
