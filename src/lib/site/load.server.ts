import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentCompany } from "@/lib/company/current";
import { catalogPrices, type PricingSettings } from "@/lib/pricing/engine";
import { calcContext } from "@/lib/quote/context";
import { fromSelection } from "@/lib/quote/equipment";
import { buildLines } from "@/lib/quote/lines";
import { companyPricing, loadCoefficients, loadQuoteLines, loadWizardCatalog, siteInfo, type QuoteRecord } from "@/lib/quote/load";
import { toRoomNeeds } from "@/lib/quote/rooms";
import { EMPTY_METRE } from "@/lib/quote/types";
import { internalShipping, loadQuoteSupplierSettings } from "@/lib/suppliers/quote";
import { deviationCosts, diffLines, metreWithDeviation, type DeviationCosts, type DeviationInput, type DevLine } from "./site";

export const pricingSettingsOf = (company: CurrentCompany, vatRegime: "franchise" | "assujetti"): PricingSettings => ({
  vatRegime,
  laborChargesRate: company.labor_charges_rate,
  materialChargesRate: company.material_charges_rate,
  targetMarginPerDayCents: Number(company.target_margin_per_day_cents),
});

/**
 * Chiffre un écart avec les prix du devis (catalogue, coefficients du devis,
 * fournisseur le moins cher). `costDb` : lecteur des coûts filtré par
 * entreprise ; `company` doit porter le coefficient sur achat (costAccess()).
 * `manual` : prix saisis par l'administrateur pour un écart libre.
 */
export async function computeDeviation(
  supabase: SupabaseClient,
  costDb: SupabaseClient,
  company: CurrentCompany,
  q: QuoteRecord,
  dev: DeviationInput & { accessoryId: string | null; description: string },
  manual?: { saleCents: number; purchaseCents: number } | null,
): Promise<DeviationCosts> {
  const settings = pricingSettingsOf(company, q.vatRegime);
  const [catalog, coefs, baseLines, shipping] = await Promise.all([loadWizardCatalog(costDb, company.id), loadCoefficients(supabase), loadQuoteLines(costDb, company.id, q.id), loadQuoteSupplierSettings(costDb, company.id, q.id)]);
  const ctx = calcContext(companyPricing(company), siteInfo(q), coefs, q.wizard);
  let lines: DevLine[] = [];
  if (manual) {
    lines = [{ designation: dev.description, quantity: dev.quantity ?? 1, unit: "u", kind: "other", unitPurchaseCents: manual.purchaseCents, unitSaleCents: manual.saleCents, vatRate: ctx.lineSettings.vatRate }];
  } else if ((dev.kind === "longueur" || dev.kind === "pompe") && q.wizard.selection) {
    const eq = fromSelection(q.wizard.selection, catalog.products);
    if (eq) {
      const metre = q.wizard.metre ?? EMPTY_METRE;
      const rooms = toRoomNeeds(q.rooms);
      const travel = ctx.travelFor(q.laborDays);
      const before = buildLines(eq, rooms, metre, catalog.accessories, ctx.lineSettings, q.laborDays, travel).lines;
      const after = buildLines(eq, rooms, metreWithDeviation(metre, dev), catalog.accessories, ctx.lineSettings, q.laborDays, travel).lines;
      lines = diffLines(before, after);
    }
  } else if (dev.accessoryId) {
    const a = catalog.accessories.find((x) => x.id === dev.accessoryId);
    if (a) {
      const p = catalogPrices({
        kind: "accessory",
        publicPriceCents: a.publicPriceCents,
        purchasePriceCents: a.purchasePriceCents,
        discount: a.discount,
        companyCoefficient: ctx.lineSettings.companyAccessoryCoefficient,
        purchaseCoefficient: ctx.lineSettings.accessoryPurchaseCoefficient,
        quoteCoefficient: ctx.lineSettings.accessoryCoefficient,
        netPurchaseCents: a.netPurchaseCents,
        floorPurchaseCents: a.floorPurchaseCents,
      });
      lines = [{ designation: [a.name, a.diameter].filter(Boolean).join(" "), quantity: dev.quantity ?? 1, unit: a.unit, kind: "accessory", unitPurchaseCents: p.purchaseCents, unitSaleCents: p.saleCents, vatRate: ctx.lineSettings.vatRate }];
    }
  }
  return deviationCosts({ lines: baseLines, laborDays: q.laborDays, settings, shippingCostCents: internalShipping(shipping) }, lines);
}
