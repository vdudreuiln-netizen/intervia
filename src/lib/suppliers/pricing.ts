/**
 * Multi-fournisseurs : prix nets, prix public de référence, frais de port et
 * choix du fournisseur de chaque ligne. Module PUR (aucun accès réseau / base).
 *
 * Règles validées :
 *  - prix public de RÉFÉRENCE unique par article (même prix client quel que soit
 *    le fournisseur retenu) : celui du fournisseur « de référence » de la marque,
 *    à défaut le plus ÉLEVÉ des prix publics connus ;
 *  - prix NET d'achat par fournisseur : prix net donné par le tarif, sinon prix
 *    public du fournisseur × (1 − remise), la remise la plus précise l'emportant :
 *    référence > famille de remise > marque ;
 *  - frais de port par fournisseur : « X € sous un franco de Y € HT », avec
 *    barème par paliers optionnel ;
 *  - choix par défaut : la combinaison la moins chère AU TOTAL, port compris ;
 *    on peut forcer un fournisseur par ligne ou pour tout le devis (« tout chez X »).
 */
import { roundCents } from "@/lib/pricing/engine";

// ---------------------------------------------------------------------------
// Remises et prix nets
// ---------------------------------------------------------------------------

export interface SupplierOffer {
  supplierId: string;
  /** Prix public HT du tarif de ce fournisseur. */
  publicPriceCents: number | null;
  /** Prix net HT donné directement par le tarif (prioritaire s'il existe). */
  netPriceCents: number | null;
  /** Remise propre à cette référence chez ce fournisseur (niveau « référence »). */
  discount: number | null;
  /** Famille de remise (ou gamme à défaut) indiquée par le tarif. */
  family: string | null;
}

/** Remises par fournisseur : par marque et par famille (clé normalisée par familyKey). */
export interface DiscountBook {
  brand: Record<string, Record<string, number>>;
  family: Record<string, Record<string, number>>;
}

export type DiscountLevel = "net" | "reference" | "famille" | "marque" | "aucune";

export const DISCOUNT_LEVEL_LABELS: Record<DiscountLevel, string> = {
  net: "Prix net du tarif",
  reference: "Remise sur la référence",
  famille: "Remise de la famille",
  marque: "Remise de la marque",
  aucune: "Aucune remise",
};

export function familyKey(family: string): string {
  return family.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function resolveDiscount(offer: SupplierOffer, brandId: string | null, book: DiscountBook): { rate: number; level: DiscountLevel } {
  if (offer.discount !== null && offer.discount !== undefined) return { rate: offer.discount, level: "reference" };
  if (offer.family) {
    const f = book.family[offer.supplierId]?.[familyKey(offer.family)];
    if (f !== undefined) return { rate: f, level: "famille" };
  }
  if (brandId) {
    const b = book.brand[offer.supplierId]?.[brandId];
    if (b !== undefined) return { rate: b, level: "marque" };
  }
  return { rate: 0, level: "aucune" };
}

export interface NetPrice {
  supplierId: string;
  netCents: number;
  level: DiscountLevel;
  rate: number;
}

/** Prix net d'achat chez un fournisseur, ou null si le tarif ne permet pas de le calculer. */
export function netPurchase(offer: SupplierOffer, brandId: string | null, book: DiscountBook): NetPrice | null {
  if (offer.netPriceCents !== null && offer.netPriceCents !== undefined && offer.netPriceCents >= 0) {
    const rate = offer.publicPriceCents ? 1 - offer.netPriceCents / offer.publicPriceCents : 0;
    return {
      supplierId: offer.supplierId,
      netCents: offer.netPriceCents,
      level: "net",
      rate,
    };
  }
  if (offer.publicPriceCents === null || offer.publicPriceCents === undefined) return null;
  const { rate, level } = resolveDiscount(offer, brandId, book);
  if (rate < 0 || rate >= 1) throw new RangeError(`Remise invalide : ${rate}`);
  return {
    supplierId: offer.supplierId,
    netCents: roundCents(offer.publicPriceCents * (1 - rate)),
    level,
    rate,
  };
}

/** Prix nets de tous les fournisseurs d'un article, du moins cher au plus cher. */
export function rankOffers(offers: SupplierOffer[], brandId: string | null, book: DiscountBook): NetPrice[] {
  return offers
    .map((o) => netPurchase(o, brandId, book))
    .filter((n): n is NetPrice => n !== null)
    .sort((a, b) => a.netCents - b.netCents || a.supplierId.localeCompare(b.supplierId));
}

/** Prix public de référence : fournisseur de référence de la marque, sinon le plus élevé. */
export function referencePublicPrice(offers: SupplierOffer[], referenceSupplierId: string | null): { cents: number; supplierId: string } | null {
  const priced = offers.filter((o) => o.publicPriceCents !== null && o.publicPriceCents !== undefined) as (SupplierOffer & { publicPriceCents: number })[];
  if (priced.length === 0) return null;
  const ref = referenceSupplierId ? priced.find((o) => o.supplierId === referenceSupplierId) : undefined;
  const pick = ref ?? priced.reduce((a, b) => (b.publicPriceCents > a.publicPriceCents ? b : a));
  return { cents: pick.publicPriceCents, supplierId: pick.supplierId };
}

// ---------------------------------------------------------------------------
// Frais de port
// ---------------------------------------------------------------------------

export interface ShippingTier {
  /** À partir de ce montant de commande HT… */
  fromCents: number;
  /** …ces frais de port HT. */
  feeCents: number;
}

export interface ShippingRule {
  /** Frais de port HT sous le franco (0 = toujours offert). */
  feeCents: number;
  /** Franco de port HT (null = pas de franco). */
  francoCents: number | null;
  /** Barème optionnel (remplace `feeCents` dès le premier palier atteint). */
  tiers: ShippingTier[];
}

export const FREE_SHIPPING: ShippingRule = {
  feeCents: 0,
  francoCents: null,
  tiers: [],
};

export function shippingCost(rule: ShippingRule, orderCents: number): number {
  if (orderCents <= 0) return 0;
  if (rule.francoCents !== null && orderCents >= rule.francoCents) return 0;
  const tier = [...rule.tiers].sort((a, b) => b.fromCents - a.fromCents).find((t) => orderCents >= t.fromCents);
  return Math.max(0, tier ? tier.feeCents : rule.feeCents);
}

/** Montant manquant pour atteindre le franco (null si pas de franco ou déjà atteint). */
export function francoGap(rule: ShippingRule, orderCents: number): number | null {
  if (rule.francoCents === null || orderCents <= 0 || orderCents >= rule.francoCents) return null;
  return rule.francoCents - orderCents;
}

export function validateShippingRule(rule: ShippingRule): string | null {
  if (!Number.isInteger(rule.feeCents) || rule.feeCents < 0) return "Frais de port invalides.";
  if (rule.francoCents !== null && (!Number.isInteger(rule.francoCents) || rule.francoCents <= 0)) return "Franco invalide.";
  const seen = new Set<number>();
  for (const t of rule.tiers) {
    if (!Number.isInteger(t.fromCents) || t.fromCents < 0 || !Number.isInteger(t.feeCents) || t.feeCents < 0) return "Palier de frais de port invalide.";
    if (seen.has(t.fromCents)) return "Deux paliers ont le même montant de départ.";
    seen.add(t.fromCents);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Choix des fournisseurs d'un devis
// ---------------------------------------------------------------------------

export interface ChoiceLine {
  key: string;
  quantity: number;
  /** Prix nets disponibles (n'importe quel ordre). Vide = article sans fournisseur. */
  offers: { supplierId: string; netCents: number }[];
  /** Fournisseur imposé par l'artisan pour cette ligne. */
  forcedSupplierId?: string | null;
}

export interface SupplierInfo {
  id: string;
  name: string;
  shipping: ShippingRule;
}

export interface SupplierOrder {
  supplierId: string;
  subtotalCents: number;
  shippingCents: number;
  lineKeys: string[];
}

export interface SupplierPlan {
  /** Fournisseur retenu par ligne (null = aucun tarif fournisseur). */
  assignment: Record<string, string | null>;
  /** Prix net unitaire retenu par ligne. */
  unitNetCents: Record<string, number>;
  materialCents: number;
  shippingCents: number;
  totalCents: number;
  orders: SupplierOrder[];
}

const lineTotal = (l: ChoiceLine, net: number) => roundCents(l.quantity * net);

export function evaluatePlan(lines: ChoiceLine[], assignment: Record<string, string | null>, suppliers: SupplierInfo[]): SupplierPlan {
  const bySupplier = new Map<string, SupplierOrder>();
  const unitNetCents: Record<string, number> = {};
  let materialCents = 0;
  for (const l of lines) {
    const sid = assignment[l.key] ?? null;
    if (!sid) continue;
    const offer = l.offers.find((o) => o.supplierId === sid);
    if (!offer) throw new Error(`Fournisseur ${sid} sans tarif pour la ligne ${l.key}`);
    unitNetCents[l.key] = offer.netCents;
    const t = lineTotal(l, offer.netCents);
    materialCents += t;
    const o = bySupplier.get(sid) ?? {
      supplierId: sid,
      subtotalCents: 0,
      shippingCents: 0,
      lineKeys: [],
    };
    o.subtotalCents += t;
    o.lineKeys.push(l.key);
    bySupplier.set(sid, o);
  }
  const rules = new Map(suppliers.map((s) => [s.id, s.shipping]));
  const orders = [...bySupplier.values()]
    .map((o) => ({
      ...o,
      shippingCents: shippingCost(rules.get(o.supplierId) ?? FREE_SHIPPING, o.subtotalCents),
    }))
    .sort((a, b) => a.supplierId.localeCompare(b.supplierId));
  const shippingCents = orders.reduce((a, o) => a + o.shippingCents, 0);
  const full: Record<string, string | null> = {};
  for (const l of lines) full[l.key] = assignment[l.key] ?? null;
  return {
    assignment: full,
    unitNetCents,
    materialCents,
    shippingCents,
    totalCents: materialCents + shippingCents,
    orders,
  };
}

function cheapest(l: ChoiceLine, allowed?: Set<string>): string | null {
  let best: { supplierId: string; netCents: number } | null = null;
  for (const o of l.offers) {
    if (allowed && !allowed.has(o.supplierId)) continue;
    if (!best || o.netCents < best.netCents || (o.netCents === best.netCents && o.supplierId < best.supplierId)) best = o;
  }
  return best?.supplierId ?? null;
}

const forcedOf = (l: ChoiceLine) => (l.forcedSupplierId && l.offers.some((o) => o.supplierId === l.forcedSupplierId) ? l.forcedSupplierId : null);

/** Meilleur prix net ligne par ligne, sans tenir compte du port (lignes forcées respectées). */
export function perLinePlan(lines: ChoiceLine[], suppliers: SupplierInfo[]): SupplierPlan {
  const a: Record<string, string | null> = {};
  for (const l of lines) a[l.key] = forcedOf(l) ?? cheapest(l);
  return evaluatePlan(lines, a, suppliers);
}

/** Tout chez un fournisseur ; les articles qu'il n'a pas vont au moins cher ailleurs (listés dans `missing`). */
export function allAtPlan(lines: ChoiceLine[], suppliers: SupplierInfo[], supplierId: string): SupplierPlan & { missing: string[] } {
  const a: Record<string, string | null> = {};
  const missing: string[] = [];
  for (const l of lines) {
    const forced = forcedOf(l);
    if (forced) a[l.key] = forced;
    else if (l.offers.some((o) => o.supplierId === supplierId)) a[l.key] = supplierId;
    else {
      a[l.key] = cheapest(l);
      if (l.offers.length > 0) missing.push(l.key);
    }
  }
  return { ...evaluatePlan(lines, a, suppliers), missing };
}

const MAX_EXHAUSTIVE_SUPPLIERS = 10;

/**
 * Combinaison la moins chère au total (prix nets + frais de port).
 * Pour chaque sous-ensemble de fournisseurs : chaque ligne au moins cher du
 * sous-ensemble, puis amélioration locale (déplacer une ligne chez un autre
 * fournisseur si cela fait baisser le total, par ex. pour atteindre un franco).
 * À total égal : le moins de fournisseurs, puis l'ordre alphabétique des identifiants.
 */
export function optimalPlan(lines: ChoiceLine[], suppliers: SupplierInfo[]): SupplierPlan {
  const free = lines.filter((l) => !forcedOf(l) && l.offers.length > 0);
  const fixed: Record<string, string | null> = {};
  for (const l of lines) if (!free.includes(l)) fixed[l.key] = forcedOf(l);

  const ids = [...new Set(free.flatMap((l) => l.offers.map((o) => o.supplierId)))].sort();
  if (ids.length === 0) return evaluatePlan(lines, fixed, suppliers);
  if (ids.length > MAX_EXHAUSTIVE_SUPPLIERS) return improve(lines, perLinePlan(lines, suppliers).assignment, free, new Set(ids), suppliers);

  let best: SupplierPlan | null = null;
  let bestCount = Infinity;
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const subset = new Set(ids.filter((_, i) => mask & (1 << i)));
    if (!free.every((l) => l.offers.some((o) => subset.has(o.supplierId)))) continue;
    const a: Record<string, string | null> = { ...fixed };
    for (const l of free) a[l.key] = cheapest(l, subset);
    const plan = improve(lines, a, free, subset, suppliers);
    const count = new Set(Object.values(plan.assignment).filter(Boolean)).size;
    if (!best || plan.totalCents < best.totalCents || (plan.totalCents === best.totalCents && count < bestCount)) {
      best = plan;
      bestCount = count;
    }
  }
  return best ?? perLinePlan(lines, suppliers);
}

function improve(lines: ChoiceLine[], start: Record<string, string | null>, free: ChoiceLine[], allowed: Set<string>, suppliers: SupplierInfo[]): SupplierPlan {
  let a = { ...start };
  let plan = evaluatePlan(lines, a, suppliers);
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (const l of free) {
      for (const o of l.offers) {
        if (!allowed.has(o.supplierId) || o.supplierId === a[l.key]) continue;
        const trial = { ...a, [l.key]: o.supplierId };
        const p = evaluatePlan(lines, trial, suppliers);
        if (p.totalCents < plan.totalCents) {
          a = trial;
          plan = p;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return plan;
}

export interface SupplierScenarios {
  /** Combinaison retenue (optimale, ou « tout chez X » si l'artisan l'a imposé). */
  retained: SupplierPlan;
  retainedMode: "optimal" | "all_at";
  optimal: SupplierPlan;
  perLine: SupplierPlan;
  allAt: { supplierId: string; plan: SupplierPlan; missing: string[] }[];
}

/** Comparatif complet + plan retenu. `forceAllAt` = fournisseur imposé pour tout le devis. */
export function supplierScenarios(lines: ChoiceLine[], suppliers: SupplierInfo[], forceAllAt?: string | null): SupplierScenarios {
  const optimal = optimalPlan(lines, suppliers);
  const perLine = perLinePlan(lines, suppliers);
  const present = new Set(lines.flatMap((l) => l.offers.map((o) => o.supplierId)));
  const allAt = suppliers
    .filter((s) => present.has(s.id))
    .map((s) => {
      const { missing, ...plan } = allAtPlan(lines, suppliers, s.id);
      return { supplierId: s.id, plan, missing };
    })
    .sort((a, b) => a.plan.totalCents - b.plan.totalCents);
  const forced = forceAllAt ? allAt.find((x) => x.supplierId === forceAllAt) : undefined;
  return {
    retained: forced ? forced.plan : optimal,
    retainedMode: forced ? "all_at" : "optimal",
    optimal,
    perLine,
    allAt,
  };
}

// ---------------------------------------------------------------------------
// Tarif ancien
// ---------------------------------------------------------------------------

export const STALE_TARIFF_MONTHS = 6;

/** Vrai si le dernier tarif d'un fournisseur date de plus de 6 mois (ou n'a jamais été mis à jour). */
export function isTariffStale(lastUpdate: string | Date | null, now: Date = new Date(), months = STALE_TARIFF_MONTHS): boolean {
  if (!lastUpdate) return true;
  const d = typeof lastUpdate === "string" ? new Date(lastUpdate) : lastUpdate;
  if (Number.isNaN(d.getTime())) return true;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - months);
  return d < limit;
}
