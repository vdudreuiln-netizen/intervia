/**
 * Nettoyage des données envoyées au navigateur d'un technicien qui n'a pas
 * accès aux marges : aucun prix d'achat, aucune remise, aucune marge.
 * Les prix de vente et les alertes (calculés côté serveur) sont conservés.
 */
import { catalogPrices, type QuoteResult } from "@/lib/pricing/engine";
import type { LineSettings } from "./lines";
import type { ConfigProposal, PricedOption } from "./options";
import type { CatAccessory, CatProduct, Equipment } from "./types";

/** Produit sans coût : remises neutralisées (le prix de vente = prix public × coefficient n'en dépend pas). */
export function sanitizeProduct(p: CatProduct): CatProduct {
  return { ...p, brandDiscount: 0, productDiscount: null, costHidden: true };
}

/** Accessoire sans coût : prix de vente figé côté serveur (coefficients du devis compris). */
export function sanitizeAccessory(a: CatAccessory, s: LineSettings): CatAccessory {
  const sale = catalogPrices({
    kind: "accessory",
    publicPriceCents: a.publicPriceCents,
    purchasePriceCents: a.purchasePriceCents,
    discount: a.discount,
    companyCoefficient: s.companyAccessoryCoefficient,
    purchaseCoefficient: s.accessoryPurchaseCoefficient,
    quoteCoefficient: s.accessoryCoefficient,
  }).saleCents;
  return { id: a.id, role: a.role, category: a.category, name: a.name, diameter: a.diameter, unit: a.unit, publicPriceCents: null, purchasePriceCents: null, discount: 0, fixedSaleCents: sale };
}

/** Résultat de calcul sans aucun coût ni marge (alertes et prix de vente conservés). */
export function sanitizeResult(r: QuoteResult): QuoteResult {
  return {
    ...r,
    lines: r.lines.map((l) => ({ ...l, unitPurchaseCents: 0, totalPurchaseCents: 0, chargesCents: 0, contributionCents: 0 })),
    margin: {
      ...r.margin,
      purchaseCostCents: 0,
      laborChargesCents: 0,
      materialChargesCents: 0,
      netMarginCents: 0,
      netMarginRate: 0,
      marginPerDayCents: null,
      targetMarginPerDayCents: 0,
    },
  };
}

function sanitizeEquipment(e: Equipment): Equipment {
  return {
    ...e,
    systems: e.systems.map((s) => ({ ...s, outdoor: sanitizeProduct(s.outdoor), indoors: s.indoors.map((i) => ({ ...i, product: sanitizeProduct(i.product) })) })),
  };
}

function sanitizeOption(o: PricedOption): PricedOption {
  return { ...o, equipment: sanitizeEquipment(o.equipment), result: sanitizeResult(o.result) };
}

export function sanitizeProposals(ps: ConfigProposal[]): ConfigProposal[] {
  return ps.map((p) => ({ ...p, options: p.options.map(sanitizeOption), excluded: p.excluded.map(sanitizeOption) }));
}
