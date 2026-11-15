import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_VAT_RATE, roundCents } from "@/lib/pricing/engine";
import { loadQuoteLines, type QuoteLineRow } from "@/lib/quote/load";
import { itemNetPrices, loadSupplierBook, type SupplierBook } from "./load";
import { francoGap, supplierScenarios, type ChoiceLine, type SupplierPlan, type SupplierScenarios } from "./pricing";

/**
 * Choix des fournisseurs d'un devis, côté serveur (données de coûts).
 * `db` = client du membre autorisé ou client service, TOUJOURS filtré par entreprise.
 */

/** Ligne « Livraison du matériel » (frais de port refacturés) : repérée par cette clé. */
export const DELIVERY_KEY = "livraison";

export interface QuoteSupplierSettings {
  forcedSupplierId: string | null;
  shippingRebill: boolean;
  shippingCents: number;
}

export async function loadQuoteSupplierSettings(db: SupabaseClient, companyId: string, quoteId: string): Promise<QuoteSupplierSettings> {
  const { data } = await db.from("quote_financials").select("forced_supplier_id, shipping_rebill, shipping_cents").eq("company_id", companyId).eq("quote_id", quoteId).maybeSingle();
  return {
    forcedSupplierId: data?.forced_supplier_id ?? null,
    shippingRebill: Boolean(data?.shipping_rebill),
    shippingCents: Number(data?.shipping_cents ?? 0),
  };
}

/** Frais de port à déduire de la marge (0 s'ils sont refacturés au client). */
export const internalShipping = (s: QuoteSupplierSettings) => (s.shippingRebill ? 0 : s.shippingCents);

function choiceLines(lines: QuoteLineRow[], sb: SupplierBook): ChoiceLine[] {
  return lines
    .filter((l) => l.wizardKey !== DELIVERY_KEY && (l.productId || l.accessoryId))
    .map((l) => ({
      key: l.id,
      quantity: l.quantity,
      offers: itemNetPrices(sb, {
        productId: l.productId,
        accessoryId: l.accessoryId,
      }).map((n) => ({ supplierId: n.supplierId, netCents: n.netCents })),
      forcedSupplierId: l.supplierForced ? l.supplierId : null,
    }));
}

const summary = (p: SupplierPlan) => ({
  materialCents: p.materialCents,
  shippingCents: p.shippingCents,
  totalCents: p.totalCents,
  suppliers: p.orders.length,
});

export interface PlanResult {
  scenarios: SupplierScenarios;
  settings: QuoteSupplierSettings;
  sb: SupplierBook;
  lines: QuoteLineRow[];
  choice: ChoiceLine[];
}

/** Calcul du choix des fournisseurs SANS rien enregistrer (affichage). */
export async function computeSupplierPlan(db: SupabaseClient, companyId: string, quoteId: string): Promise<PlanResult & { outdated: boolean }> {
  const settings = await loadQuoteSupplierSettings(db, companyId, quoteId);
  const lines = await loadQuoteLines(db, companyId, quoteId);
  const productIds = [...new Set(lines.flatMap((l) => (l.productId ? [l.productId] : [])))];
  const accessoryIds = [...new Set(lines.flatMap((l) => (l.accessoryId ? [l.accessoryId] : [])))];
  const sb = await loadSupplierBook(db, companyId, {
    productIds,
    accessoryIds,
  });
  const choice = choiceLines(lines, sb);
  const scenarios = supplierScenarios(choice, sb.suppliers, settings.forcedSupplierId);
  const plan = scenarios.retained;
  const outdated =
    choice.some((c) => {
      const l = lines.find((x) => x.id === c.key)!;
      if (c.offers.length === 0) return l.supplierId !== null;
      return plan.assignment[c.key] !== l.supplierId || plan.unitNetCents[c.key] !== l.unitPurchaseCents;
    }) || plan.shippingCents !== settings.shippingCents;
  return {
    scenarios,
    settings: { ...settings, shippingCents: plan.shippingCents },
    sb,
    lines,
    choice,
    outdated,
  };
}

/**
 * Recalcule le fournisseur retenu de chaque ligne et son prix d'achat net,
 * les frais de port, la ligne « Livraison du matériel » si refacturée, et
 * enregistre le comparatif. Le prix de VENTE des lignes ne change jamais ici.
 */
export async function applySupplierPlan(db: SupabaseClient, companyId: string, quoteId: string, vatRegime: "franchise" | "assujetti", defaultVatRate: number): Promise<PlanResult> {
  const computed = await computeSupplierPlan(db, companyId, quoteId);
  const { scenarios, sb, choice } = computed;
  const settings = await loadQuoteSupplierSettings(db, companyId, quoteId);
  let lines = computed.lines;
  const plan = scenarios.retained;

  for (const l of lines) {
    if (l.wizardKey === DELIVERY_KEY) continue;
    const sid = plan.assignment[l.id] ?? null;
    const net = plan.unitNetCents[l.id];
    const priced = choice.some((c) => c.key === l.id && c.offers.length > 0);
    if (!priced) {
      if (l.supplierId !== null) await db.from("quote_lines").update({ supplier_id: null, supplier_forced: false }).eq("company_id", companyId).eq("id", l.id);
      continue;
    }
    const forcedStill = l.supplierForced && sid === l.supplierId;
    if (sid !== l.supplierId || (net !== undefined && net !== l.unitPurchaseCents) || l.supplierForced !== forcedStill) {
      await db
        .from("quote_lines")
        .update({
          supplier_id: sid,
          unit_purchase_cents: net ?? l.unitPurchaseCents,
          supplier_forced: forcedStill,
        })
        .eq("company_id", companyId)
        .eq("id", l.id);
    }
  }

  // Frais de port refacturés : une ligne au prix coûtant
  const delivery = lines.find((l) => l.wizardKey === DELIVERY_KEY);
  const shipping = plan.shippingCents;
  if (settings.shippingRebill && shipping > 0) {
    const row = {
      unit_purchase_cents: shipping,
      unit_sale_cents: shipping,
      quantity: 1,
    };
    if (delivery) {
      if (delivery.unitPurchaseCents !== shipping || delivery.unitSaleCents !== shipping) await db.from("quote_lines").update(row).eq("company_id", companyId).eq("id", delivery.id);
    } else {
      await db.from("quote_lines").insert({
        ...row,
        company_id: companyId,
        quote_id: quoteId,
        position: lines.length,
        kind: "other",
        origin: "manual",
        wizard_key: DELIVERY_KEY,
        designation: "Livraison du matériel",
        unit: "forfait",
        vat_rate: vatRegime === "franchise" ? 0 : defaultVatRate || DEFAULT_VAT_RATE,
      });
    }
  } else if (delivery) {
    await db.from("quote_lines").delete().eq("company_id", companyId).eq("id", delivery.id);
  }

  const names = new Map(sb.suppliers.map((s) => [s.id, s.name]));
  const comparison = {
    retainedMode: scenarios.retainedMode,
    optimal: summary(scenarios.optimal),
    perLine: summary(scenarios.perLine),
    allAt: scenarios.allAt.map((a) => ({
      supplierId: a.supplierId,
      name: names.get(a.supplierId) ?? "",
      ...summary(a.plan),
      missing: a.missing.length,
    })),
  };
  await db.from("quote_financials").upsert({
    quote_id: quoteId,
    company_id: companyId,
    shipping_cents: shipping,
    supplier_comparison: comparison,
    updated_at: new Date().toISOString(),
  });

  lines = await loadQuoteLines(db, companyId, quoteId);
  return {
    scenarios,
    settings: { ...settings, shippingCents: shipping },
    sb,
    lines,
    choice,
  };
}

// ---------------------------------------------------------------------------
// Vue « Fournisseurs » de l'éditeur (membres autorisés seulement)
// ---------------------------------------------------------------------------

export interface SupplierLineView {
  lineId: string;
  designation: string;
  quantity: number;
  retainedId: string | null;
  forced: boolean;
  offers: {
    supplierId: string;
    name: string;
    unitNetCents: number;
    gapCents: number;
  }[];
}

export interface SupplierScenarioView {
  key: string;
  label: string;
  materialCents: number;
  shippingCents: number;
  totalCents: number;
  missing: number;
  retained: boolean;
}

export interface QuoteSupplierView {
  suppliers: { id: string; name: string; stale: boolean }[];
  lines: SupplierLineView[];
  scenarios: SupplierScenarioView[];
  orders: {
    supplierId: string;
    name: string;
    subtotalCents: number;
    shippingCents: number;
    francoGapCents: number | null;
  }[];
  forcedSupplierId: string | null;
  shippingRebill: boolean;
  shippingCents: number;
  /** Tarifs ou remises changés depuis le dernier calcul du devis. */
  outdated: boolean;
}

export function buildSupplierView(r: PlanResult & { outdated?: boolean }): QuoteSupplierView {
  const names = new Map(r.sb.suppliers.map((s) => [s.id, s.name]));
  const rules = new Map(r.sb.suppliers.map((s) => [s.id, s.shipping]));
  const plan = r.scenarios.retained;
  const lines: SupplierLineView[] = r.choice
    .filter((c) => c.offers.length > 0)
    .map((c) => {
      const l = r.lines.find((x) => x.id === c.key)!;
      const retained = plan.assignment[c.key] ?? null;
      const base = c.offers.find((o) => o.supplierId === retained)?.netCents ?? 0;
      return {
        lineId: c.key,
        designation: l.designation,
        quantity: l.quantity,
        retainedId: retained,
        forced: l.supplierForced,
        offers: [...c.offers]
          .sort((a, b) => a.netCents - b.netCents)
          .map((o) => ({
            supplierId: o.supplierId,
            name: names.get(o.supplierId) ?? "?",
            unitNetCents: o.netCents,
            gapCents: roundCents((o.netCents - base) * c.quantity),
          })),
      };
    });
  const sc = r.scenarios;
  const scenarios: SupplierScenarioView[] = [
    {
      key: "optimal",
      label: "Moins cher au total (port compris)",
      ...pick(sc.optimal),
      missing: 0,
      retained: sc.retainedMode === "optimal",
    },
    {
      key: "perLine",
      label: "Meilleur prix ligne par ligne",
      ...pick(sc.perLine),
      missing: 0,
      retained: false,
    },
    ...sc.allAt.map((a) => ({
      key: `all:${a.supplierId}`,
      label: `Tout chez ${names.get(a.supplierId) ?? "?"}`,
      ...pick(a.plan),
      missing: a.missing.length,
      retained: sc.retainedMode === "all_at" && r.settings.forcedSupplierId === a.supplierId,
    })),
  ];
  return {
    suppliers: r.sb.suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, stale: s.stale })),
    lines,
    scenarios,
    orders: plan.orders.map((o) => ({
      supplierId: o.supplierId,
      name: names.get(o.supplierId) ?? "?",
      subtotalCents: o.subtotalCents,
      shippingCents: o.shippingCents,
      francoGapCents: rules.get(o.supplierId) ? francoGap(rules.get(o.supplierId)!, o.subtotalCents) : null,
    })),
    forcedSupplierId: r.settings.forcedSupplierId,
    shippingRebill: r.settings.shippingRebill,
    shippingCents: r.settings.shippingCents,
    outdated: Boolean(r.outdated),
  };
}

const pick = (p: SupplierPlan) => ({
  materialCents: p.materialCents,
  shippingCents: p.shippingCents,
  totalCents: p.totalCents,
});
