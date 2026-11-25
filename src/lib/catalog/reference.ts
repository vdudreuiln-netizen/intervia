/**
 * Catalogues et remises (PUR, testé) :
 *  - catalogue commun : publication possible seulement avec l'accord écrit de la
 *    marque ; comparaison d'un nouveau tarif avec le tarif en vigueur ;
 *  - prix net = prix public fabricant × (1 − remise), même chez un distributeur
 *    dont on n'a pas importé le tarif (remise marque / famille du tableau) ;
 *  - distributeur le moins cher par référence ;
 *  - alertes : tarif de plus de N mois (12 par défaut, réglable par compte).
 */
import { familyKey, isTariffStale, netPurchase, STALE_TARIFF_MONTHS, type DiscountBook, type DiscountLevel, type SupplierOffer } from "@/lib/suppliers/pricing";

// ---------------------------------------------------------------------------
// Accord des marques
// ---------------------------------------------------------------------------

export type AgreementStatus = "aucun" | "demande" | "obtenu" | "refuse";

export const AGREEMENT_LABELS: Record<AgreementStatus, string> = {
  aucun: "Pas d'accord",
  demande: "Accord demandé",
  obtenu: "Accord obtenu",
  refuse: "Accord refusé",
};

export interface RefBrandAgreement {
  name: string;
  status: AgreementStatus;
  date: string | null;
  proofPath: string | null;
}

/** Le tarif d'une marque ne peut être publié dans le catalogue commun qu'avec un accord écrit (date + justificatif). */
export function canPublish(b: RefBrandAgreement): { ok: true } | { ok: false; reason: string } {
  if (b.status !== "obtenu") return { ok: false, reason: `${b.name} : accord écrit de la marque non obtenu (${AGREEMENT_LABELS[b.status].toLowerCase()}).` };
  if (!b.date) return { ok: false, reason: `${b.name} : date de l'accord manquante.` };
  if (!b.proofPath) return { ok: false, reason: `${b.name} : justificatif de l'accord manquant.` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Comparaison d'un nouveau tarif avec le tarif en vigueur
// ---------------------------------------------------------------------------

export const normalizeRef = (r: string) => r.trim().toUpperCase().replace(/\s+/g, " ");

export interface TariffRow {
  ref: string;
  publicPriceCents: number;
}

export interface TariffComparison {
  total: number;
  added: string[];
  removed: string[];
  increased: number;
  decreased: number;
  unchanged: number;
  /** Évolution moyenne des prix des références communes (0,035 = +3,5 %), null si aucune. */
  averageChange: number | null;
  /** Plus fortes variations, pour relecture avant publication. */
  outliers: { ref: string; fromCents: number; toCents: number; change: number }[];
}

/** Variation au-delà de laquelle une ligne est signalée à la relecture (erreur de saisie probable). */
export const OUTLIER_CHANGE = 0.25;

export function compareTariffs(current: TariffRow[], next: TariffRow[]): TariffComparison {
  const before = new Map(current.map((r) => [normalizeRef(r.ref), r.publicPriceCents]));
  const after = new Map(next.map((r) => [normalizeRef(r.ref), r.publicPriceCents]));
  let increased = 0;
  let decreased = 0;
  let unchanged = 0;
  const changes: number[] = [];
  const outliers: TariffComparison["outliers"] = [];
  for (const [ref, to] of after) {
    const from = before.get(ref);
    if (from === undefined) continue;
    if (to > from) increased++;
    else if (to < from) decreased++;
    else unchanged++;
    if (from > 0) {
      const change = to / from - 1;
      changes.push(change);
      if (Math.abs(change) >= OUTLIER_CHANGE) outliers.push({ ref, fromCents: from, toCents: to, change: Math.round(change * 1000) / 1000 });
    }
  }
  return {
    total: after.size,
    added: [...after.keys()].filter((r) => !before.has(r)).sort(),
    removed: [...before.keys()].filter((r) => !after.has(r)).sort(),
    increased,
    decreased,
    unchanged,
    averageChange: changes.length ? Math.round((changes.reduce((a, c) => a + c, 0) / changes.length) * 10000) / 10000 : null,
    outliers: outliers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// Prix nets depuis le prix public fabricant
// ---------------------------------------------------------------------------

export interface CatalogItem {
  /** Prix public fabricant HT (catalogue commun ou tarif personnel). */
  publicPriceCents: number;
  brandId: string | null;
  /** Famille de remise du tarif fabricant. */
  family: string | null;
}

export interface SupplierRef {
  id: string;
  name: string;
}

export interface NetOffer {
  supplierId: string;
  supplierName: string;
  netCents: number;
  rate: number;
  level: DiscountLevel;
  /** « tarif » : tarif importé du distributeur ; « remise » : prix public fabricant × remise du tableau. */
  source: "tarif" | "remise";
}

/** Le distributeur a-t-il une remise (famille ou marque) applicable à cet article ? */
function hasDiscount(book: DiscountBook, supplierId: string, item: CatalogItem): boolean {
  if (item.family && book.family[supplierId]?.[familyKey(item.family)] !== undefined) return true;
  return item.brandId !== null && book.brand[supplierId]?.[item.brandId] !== undefined;
}

/**
 * Prix nets chez chaque distributeur, du moins cher au plus cher :
 *  - tarif importé du distributeur s'il existe (prix net, ou son prix public × remise) ;
 *  - sinon, prix public fabricant × remise du tableau distributeur × marque (× famille),
 *    à condition qu'une remise soit saisie pour ce distributeur.
 */
export function netOffers(item: CatalogItem, offers: SupplierOffer[], suppliers: SupplierRef[], book: DiscountBook): NetOffer[] {
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const out: NetOffer[] = [];
  for (const s of suppliers) {
    const own = offers.find((o) => o.supplierId === s.id);
    const offer: SupplierOffer | null = own ? { ...own, family: own.family ?? item.family } : hasDiscount(book, s.id, item) ? { supplierId: s.id, publicPriceCents: item.publicPriceCents, netPriceCents: null, discount: null, family: item.family } : null;
    if (!offer) continue;
    const n = netPurchase(offer, item.brandId, book);
    if (n) out.push({ supplierId: s.id, supplierName: name.get(s.id) ?? "", netCents: n.netCents, rate: n.rate, level: n.level, source: own ? "tarif" : "remise" });
  }
  return out.sort((a, b) => a.netCents - b.netCents || a.supplierName.localeCompare(b.supplierName));
}

/** Distributeur le moins cher pour une référence (null si aucun prix net calculable). */
export function cheapest(item: CatalogItem, offers: SupplierOffer[], suppliers: SupplierRef[], book: DiscountBook): NetOffer | null {
  return netOffers(item, offers, suppliers, book)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Alertes de tarif
// ---------------------------------------------------------------------------

export interface DatedTariff {
  label: string;
  /** Date d'effet du tarif (AAAA-MM-JJ), null si inconnue. */
  tariffDate: string | null;
}

/** Âge d'un tarif en mois entiers (null si date inconnue ou invalide). */
export function tariffAgeMonths(tariffDate: string | null, now: Date = new Date()): number | null {
  if (!tariffDate) return null;
  const d = new Date(tariffDate);
  if (Number.isNaN(d.getTime())) return null;
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m--;
  return Math.max(0, m);
}

/** Seuil du compte, borné (1 à 60 mois), 12 par défaut. */
export function alertMonths(setting: number | null | undefined): number {
  return typeof setting === "number" && Number.isInteger(setting) && setting >= 1 && setting <= 60 ? setting : STALE_TARIFF_MONTHS;
}

export function staleTariffs(items: DatedTariff[], months: number, now: Date = new Date()): { label: string; message: string }[] {
  return items
    .filter((t) => isTariffStale(t.tariffDate, now, months))
    .map((t) => {
      const age = tariffAgeMonths(t.tariffDate, now);
      return {
        label: t.label,
        message: t.tariffDate
          ? `${t.label} : tarif du ${t.tariffDate.split("-").reverse().join("/")} (${age} mois), plus de ${months} mois : importez le nouveau tarif.`
          : `${t.label} : date du tarif inconnue, vérifiez les prix.`,
      };
    });
}

/** Marques utilisées par le compte pour lesquelles un tarif commun plus récent que le leur est publié. */
export function newerTariffsAvailable(used: { brandName: string; tariffDate: string | null; linked: boolean }[], published: { brandName: string; effectiveDate: string }[]): { brandName: string; effectiveDate: string }[] {
  const pub = new Map(published.map((p) => [p.brandName.trim().toLowerCase(), p]));
  return used.flatMap((u) => {
    const p = pub.get(u.brandName.trim().toLowerCase());
    if (!p || u.linked) return [];
    return !u.tariffDate || p.effectiveDate > u.tariffDate ? [p] : [];
  });
}

// ---------------------------------------------------------------------------
// Priorité des prix publics et affichage de la source
// ---------------------------------------------------------------------------

export type PriceSource = "commun" | "personnel" | "personnel_recent" | "manuel";

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  commun: "Tarif commun",
  personnel: "Tarif importé",
  personnel_recent: "Tarif importé plus récent que le tarif commun",
  manuel: "Saisi à la main",
};

export interface ResolvedPublicPrice {
  cents: number;
  source: PriceSource;
  date: string | null;
  /** Fournisseur dont vient le prix (tarif personnel ou saisie), null pour le tarif commun. */
  supplierId: string | null;
}

/**
 * Règle de priorité du prix PUBLIC (le prix net importé, lui, s'utilise tel quel) :
 *  1. tarif commun publié (catalogue ClimDevis, accord de la marque), SAUF si le
 *     tarif importé par l'artisan (ou sa saisie) a une date plus récente : alors
 *     le plus récent l'emporte (« Tarif importé plus récent que le tarif commun ») ;
 *  2. sinon tarif personnel importé ou prix saisi : le plus récent l'emporte.
 * La remise distributeur × marque s'applique ensuite (netOffers).
 */
export function resolvePublicPrice(common: { cents: number; date: string } | null, personal: { cents: number; supplierId: string; date: string | null; origin: "import" | "manuel" } | null): ResolvedPublicPrice | null {
  if (common && personal && personal.date && personal.date > common.date) {
    return { cents: personal.cents, source: personal.origin === "manuel" ? "manuel" : "personnel_recent", date: personal.date, supplierId: personal.supplierId };
  }
  if (common) return { cents: common.cents, source: "commun", date: common.date, supplierId: null };
  if (personal) return { cents: personal.cents, source: personal.origin === "manuel" ? "manuel" : "personnel", date: personal.date, supplierId: personal.supplierId };
  return null;
}

/** « Tarif importé du 01/03/2026 », « Saisi à la main le 12/11/2026 », « Tarif commun du 01/01/2027 ». */
export function priceSourceText(source: PriceSource | null | undefined, date: string | null | undefined): string {
  if (!source) return "Source inconnue";
  const d = date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10).split("-").reverse().join("/") : null;
  if (!d) return PRICE_SOURCE_LABELS[source];
  if (source === "personnel_recent") return `${PRICE_SOURCE_LABELS[source]} (tarif du ${d})`;
  return source === "manuel" ? `${PRICE_SOURCE_LABELS[source]} le ${d}` : `${PRICE_SOURCE_LABELS[source]} du ${d}`;
}
