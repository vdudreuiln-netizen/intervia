import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeQuote } from "@/lib/pricing/engine";
import { DEFAULT_COEFFICIENTS } from "@/lib/sizing/coefficients";
import { sizeRoom, type RoomInput } from "@/lib/sizing/sizing";
import { calcContext } from "@/lib/quote/context";
import { buildEquipment, toSelection } from "@/lib/quote/equipment";
import { buildLines, enabledLines, proposeDays } from "@/lib/quote/lines";
import { companyPricing, loadWizardCatalog } from "@/lib/quote/load";
import { EMPTY_METRE, type RoomNeed } from "@/lib/quote/types";
import type { CurrentCompany } from "@/lib/company/current";

export const DEMO_NOTE = "Devis de démonstration : modifiez-le librement ou supprimez-le depuis « Mes devis ».";

const DEMO_ROOMS: (RoomInput & { level: number })[] = [
  { name: "Séjour", surfaceM2: 32, ceilingHeightM: 2.5, orientation: "S", insulation: "moyenne", largeGlazing: true, underRoof: false, level: 0 },
  { name: "Chambre parentale", surfaceM2: 14, ceilingHeightM: 2.5, orientation: "O", insulation: "moyenne", largeGlazing: false, underRoof: true, level: 0 },
  { name: "Chambre enfant", surfaceM2: 11, ceilingHeightM: 2.5, orientation: "E", insulation: "moyenne", largeGlazing: false, underRoof: true, level: 0 },
];

/**
 * Crée un devis exemple complet (client fictif, 3 pièces, multi-split du catalogue
 * exemple) pour qu'un nouvel inscrit comprenne l'outil en une minute.
 * Ne bloque jamais l'inscription : toute erreur est ignorée.
 */
export async function seedDemoQuote(supabase: SupabaseClient, company: CurrentCompany): Promise<void> {
  try {
    const catalog = await loadWizardCatalog(supabase, company.id);
    const brands = [...new Set(catalog.products.map((p) => p.brandId))];
    if (brands.length === 0) return;

    const { data: client } = await supabase
      .from("clients")
      .insert({ company_id: company.id, name: "M. et Mme Exemple (démonstration)", address_line: "1 rue de l'Exemple", postal_code: "00000", city: "Exempleville" })
      .select("id")
      .single();
    if (!client) return;
    const { data: project } = await supabase
      .from("projects")
      .insert({ company_id: company.id, client_id: client.id, site_address: "1 rue de l'Exemple", site_postal_code: "00000", site_city: "Exempleville", one_way_km: 15, same_commune: false })
      .select("id")
      .single();
    if (!project) return;

    const rooms: RoomNeed[] = [];
    for (const [i, r] of DEMO_ROOMS.entries()) {
      const need = sizeRoom(r, DEFAULT_COEFFICIENTS.sizing).watts;
      const { data } = await supabase
        .from("rooms")
        .insert({ company_id: company.id, project_id: project.id, position: i, name: r.name, surface_m2: r.surfaceM2, ceiling_height_m: r.ceilingHeightM, orientation: r.orientation, insulation: r.insulation, large_glazing: r.largeGlazing, under_roof: r.underRoof, level: r.level, indoor_type: "mural", need_watts: need })
        .select("id")
        .single();
      if (!data) return;
      rooms.push({ id: data.id, name: r.name, needW: need, level: r.level, indoorType: "mural" });
    }

    const opts = { sizing: DEFAULT_COEFFICIENTS.sizing, multiSimultaneity: DEFAULT_COEFFICIENTS.sizing.multiSimultaneity, gainableAccess: false };
    const built = brands.map((b) => buildEquipment("multi", b, rooms, catalog.products, opts)).find((r) => r.ok) ?? brands.map((b) => buildEquipment("mono", b, rooms, catalog.products, opts)).find((r) => r.ok);
    if (!built || !built.ok) return;
    const equipment = built.equipment;

    const wizard = { selection: toSelection(equipment), metre: EMPTY_METRE, laborDays: null };
    const pricing = companyPricing(company);
    const ctx = calcContext(pricing, { one_way_km: 15, same_commune: false, parking_enabled: false, parking_per_day_cents: null, gainable_access: false }, DEFAULT_COEFFICIENTS, wizard);
    const days = proposeDays(equipment, EMPTY_METRE, DEFAULT_COEFFICIENTS.laborDays);
    const lines = buildLines(equipment, rooms, EMPTY_METRE, catalog.accessories, ctx.lineSettings, days, ctx.travelFor(days));
    const enabled = enabledLines(lines.lines);
    const result = computeQuote({ lines: enabled, laborDays: days, settings: ctx.pricing });

    const { data: quote } = await supabase
      .from("quotes")
      .insert({
        company_id: company.id,
        project_id: project.id,
        vat_regime: company.vat_regime,
        validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms,
        wizard,
        labor_days: days,
        travel_trips: Math.ceil(days),
        one_way_km: 15,
        notes: DEMO_NOTE,
        total_ht_cents: result.totalHtCents,
        total_ttc_cents: result.totalTtcCents,
      })
      .select("id")
      .single();
    if (!quote) return;
    const byKey = new Map(lines.lines.map((l) => [l.key, l]));
    await supabase.from("quote_lines").insert(
      enabled.map((l, i) => ({
        company_id: company.id,
        quote_id: quote.id,
        position: i,
        kind: l.kind,
        origin: "wizard",
        wizard_key: l.id,
        product_id: byKey.get(l.id)?.productId ?? null,
        accessory_id: byKey.get(l.id)?.accessoryId ?? null,
        designation: l.designation,
        quantity: l.quantity,
        unit: l.unit,
        unit_purchase_cents: l.unitPurchaseCents,
        unit_sale_cents: l.unitSaleCents,
        vat_rate: ctx.pricing.vatRegime === "franchise" ? 0 : l.vatRate,
      })),
    );
    await supabase.from("quote_financials").insert({ quote_id: quote.id, company_id: company.id, net_margin_cents: result.margin.netMarginCents });
  } catch {
    // la démonstration est un bonus : jamais bloquante
  }
}
