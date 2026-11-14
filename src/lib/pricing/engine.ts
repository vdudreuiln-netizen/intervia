/**
 * ClimDevis — moteur de prix et de marge.
 *
 * TOUS les calculs d'argent du produit passent par ce module (et uniquement
 * lui) : remises fournisseur, prix d'achat, frais de déplacement, totaux HT /
 * TVA / TTC, charges, marge nette, alertes et arrondi psychologique.
 *
 * Conventions :
 *  - tous les montants sont des ENTIERS en centimes d'euro (pas de flottants
 *    sur l'argent) ; les quantités peuvent être décimales (7,5 m de liaison) ;
 *  - les taux sont des décimaux (0.2 = 20 %, 0.212 = 21,2 %) ;
 *  - la TVA est calculée par taux sur le total HT de chaque taux (pratique
 *    comptable française), pas ligne par ligne.
 */

export type LineKind = "material" | "accessory" | "labor" | "travel" | "other";
export type VatRegime = "franchise" | "assujetti";

export interface QuoteLineInput {
  id: string;
  kind: LineKind;
  designation: string;
  quantity: number;
  unit: string; // "u", "m", "jour", "forfait", "kg"…
  /** Coût unitaire HT pour l'artisan (prix d'achat remisé ; 0 pour sa propre MO). */
  unitPurchaseCents: number;
  /** Prix de vente unitaire HT. */
  unitSaleCents: number;
  /** Taux de TVA de la ligne (ignoré en franchise en base). */
  vatRate: number;
}

export interface PricingSettings {
  vatRegime: VatRegime;
  /** Charges sociales en % du CA HT de main d'œuvre / prestations (ex. 0.212). */
  laborChargesRate: number;
  /** Charges sociales en % du CA HT de matériel (ex. 0.123). */
  materialChargesRate: number;
  /** Objectif de marge nette par jour de chantier (centimes). 0 = pas d'objectif. */
  targetMarginPerDayCents: number;
}

/** Remise commerciale globale : montant HT en centimes, ou pourcentage (0.05 = 5 %). */
export interface QuoteDiscount {
  kind: "amount" | "percent";
  value: number;
}

export interface QuoteInput {
  lines: QuoteLineInput[];
  /** Nombre de jours de chantier (sert à la marge par jour). */
  laborDays: number;
  settings: PricingSettings;
  discount?: QuoteDiscount | null;
}

export interface PricedLine extends QuoteLineInput {
  totalSaleCents: number;
  /** Part de la remise commerciale imputée à la ligne (au prorata). */
  discountCents: number;
  /** Vente HT après remise. */
  netSaleCents: number;
  totalPurchaseCents: number;
  /** Charges sociales imputables à la ligne. */
  chargesCents: number;
  /** Vente après remise − achat − charges. */
  contributionCents: number;
  /** Vendue sous son coût de revient (achat + charges) ? */
  belowCost: boolean;
}

export interface VatBreakdown {
  rate: number;
  baseCents: number;
  vatCents: number;
}

export type AlertCode = "line_below_cost" | "margin_below_target" | "negative_margin";

export interface QuoteAlert {
  code: AlertCode;
  message: string;
  lineId?: string;
}

export interface MarginPanel {
  /** Remise commerciale accordée (HT). */
  discountCents: number;
  purchaseCostCents: number; // coût d'achat matériel + accessoires (+ coût réel éventuel des autres lignes)
  materialSaleCents: number; // vente HT matériel + accessoires
  laborSaleCents: number;
  travelSaleCents: number;
  otherSaleCents: number;
  laborChargesCents: number;
  materialChargesCents: number;
  netMarginCents: number;
  netMarginRate: number; // marge nette / CA HT
  marginPerDayCents: number | null; // null si 0 jour
  targetMarginPerDayCents: number;
}

export interface QuoteResult {
  lines: PricedLine[];
  /** Total HT avant remise commerciale. */
  grossHtCents: number;
  /** Remise commerciale HT (0 si aucune). */
  discountCents: number;
  /** Total HT après remise. */
  totalHtCents: number;
  vat: VatBreakdown[];
  totalVatCents: number;
  totalTtcCents: number;
  /** Mention à imprimer sur le PDF en franchise en base. */
  vatMention: string | null;
  margin: MarginPanel;
  alerts: QuoteAlert[];
}

export const FRANCHISE_MENTION = "TVA non applicable, art. 293 B du CGI";

/** Taux proposés aux entreprises assujetties (10 % par défaut en rénovation). */
export const ALLOWED_VAT_RATES: readonly number[] = [0.055, 0.1, 0.2];
export const DEFAULT_VAT_RATE = 0.1;

/** Arrondi au centime le plus proche (demi vers l'infini, symétrique). */
export function roundCents(value: number): number {
  const r = Math.round(Math.abs(value) + Number.EPSILON * Math.abs(value));
  return value < 0 ? -r : r;
}

// ---------------------------------------------------------------------------
// Remises et prix d'achat
// ---------------------------------------------------------------------------

/** Remise applicable : la remise produit (si renseignée) écrase la remise marque. */
export function effectiveDiscount(
  brandDiscount: number | null | undefined,
  productDiscount: number | null | undefined,
): number {
  const d = productDiscount ?? brandDiscount ?? 0;
  if (d < 0 || d >= 1) throw new RangeError(`Remise invalide : ${d} (attendu entre 0 et 1 exclu)`);
  return d;
}

/** Prix d'achat = prix public × (1 − remise), arrondi au centime. */
export function purchasePriceCents(publicPriceCents: number, discount: number): number {
  return roundCents(publicPriceCents * (1 - discount));
}

// ---------------------------------------------------------------------------
// Prix de vente du matériel
// ---------------------------------------------------------------------------

/**
 * Prix de vente unitaire HT du matériel = prix public × coefficient de vente.
 * 1,00 = prix public ; 1,10 = prix public + 10 %.
 * Le coefficient du devis (s'il est renseigné) remplace celui de la marque.
 */
export function effectiveSaleCoefficient(
  brandCoefficient: number | null | undefined,
  quoteCoefficient: number | null | undefined,
): number {
  const c = quoteCoefficient ?? brandCoefficient ?? 1;
  if (!(c > 0) || c > 5) throw new RangeError(`Coefficient de vente invalide : ${c}`);
  return c;
}

export function materialSalePriceCents(publicPriceCents: number, coefficient: number): number {
  return roundCents(publicPriceCents * coefficient);
}

/** Accessoires : prix de vente ≥ prix public × 1,30 et ≥ prix d'achat × 2,00. */
export const DEFAULT_ACCESSORY_COEFFICIENT = 1.3;
export const DEFAULT_ACCESSORY_PURCHASE_COEFFICIENT = 2;

export interface CatalogPrices {
  discount: number;
  purchaseCents: number;
  saleCents: number;
}

/**
 * Prix d'un article du catalogue, tels qu'ils seront repris dans un devis.
 *  - matériel    : achat = public × (1 − remise) ; vente = PUBLIC × coefficient (marque ou devis)
 *  - accessoire  : achat = public × (1 − remise), ou prix d'achat saisi s'il n'y a pas de prix public ;
 *                  vente = le plus élevé de (PUBLIC × coefficient accessoires) et (ACHAT × coefficient sur achat).
 *                  Sans prix public : ACHAT × coefficient sur achat.
 */
export function catalogPrices(
  item: { kind: "material"; publicPriceCents: number; brandDiscount: number | null; productDiscount: number | null; brandCoefficient: number | null; quoteCoefficient?: number | null }
    | {
        kind: "accessory";
        publicPriceCents: number | null;
        /** Prix d'achat saisi directement (accessoire sans prix public). */
        purchasePriceCents?: number | null;
        discount: number | null;
        companyCoefficient: number | null;
        purchaseCoefficient?: number | null;
        quoteCoefficient?: number | null;
      },
): CatalogPrices {
  if (item.kind === "material") {
    const discount = effectiveDiscount(item.brandDiscount, item.productDiscount);
    const purchaseCents = purchasePriceCents(item.publicPriceCents, discount);
    const coef = effectiveSaleCoefficient(item.brandCoefficient, item.quoteCoefficient);
    return { discount, purchaseCents, saleCents: materialSalePriceCents(item.publicPriceCents, coef) };
  }
  const purchaseCoef = effectiveSaleCoefficient(item.purchaseCoefficient ?? DEFAULT_ACCESSORY_PURCHASE_COEFFICIENT, null);
  if (item.publicPriceCents === null) {
    const purchaseCents = Math.max(0, item.purchasePriceCents ?? 0);
    return { discount: 0, purchaseCents, saleCents: roundCents(purchaseCents * purchaseCoef) };
  }
  const discount = effectiveDiscount(null, item.discount);
  const purchaseCents = purchasePriceCents(item.publicPriceCents, discount);
  const coef = effectiveSaleCoefficient(item.companyCoefficient ?? DEFAULT_ACCESSORY_COEFFICIENT, item.quoteCoefficient);
  return { discount, purchaseCents, saleCents: Math.max(materialSalePriceCents(item.publicPriceCents, coef), roundCents(purchaseCents * purchaseCoef)) };
}

// ---------------------------------------------------------------------------
// Frais de déplacement et stationnement
// ---------------------------------------------------------------------------

export interface TravelSettings {
  /** Prix facturé par km parcouru (aller + retour comptés). */
  pricePerKmCents: number;
  /** Minimum facturé par aller-retour (sans stationnement). */
  minimumFeeCents: number;
  /** Minimum par jour « déplacement + stationnement » quand le stationnement est activé. */
  minimumDailyWithParkingCents: number;
}

export interface TravelInput {
  /** Distance base → chantier, aller simple, en km. */
  oneWayKm: number;
  /** Chantier dans la commune de l'artisan : pas de frais de déplacement. */
  sameCommune: boolean;
  /** Nombre d'allers-retours = jours de chantier (un demi-jour compte pour un). */
  trips: number;
  /** Stationnement payant, activé chantier par chantier (montant par jour). */
  parking: { enabled: boolean; perDayCents: number };
}

export interface TravelFee {
  applies: boolean;
  roundTripKm: number;
  /** Déplacement facturé par jour (minimum appliqué), hors stationnement. */
  perTripCents: number;
  /** Total facturé par jour, stationnement et minimum journalier compris. */
  perDayCents: number;
  days: number;
  totalCents: number;
  designation: string;
  detail: string;
}

export function computeTravelFee(input: TravelInput, s: TravelSettings): TravelFee {
  const days = Math.max(0, Math.ceil(input.trips - 1e-9));
  const parking = input.parking.enabled ? Math.max(0, input.parking.perDayCents) : 0;
  const euros = (c: number) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

  if (input.sameCommune) {
    // Pas de déplacement dans la commune ; le stationnement payant reste facturable.
    const totalCents = parking * days;
    return {
      applies: totalCents > 0, roundTripKm: 0, perTripCents: 0, perDayCents: parking, days, totalCents,
      designation: "Stationnement",
      detail: totalCents > 0 ? `${days} j × ${euros(parking)}` : "Chantier dans la commune : pas de frais de déplacement",
    };
  }

  const roundTripKm = Math.round(input.oneWayKm * 2 * 10) / 10;
  const perTripCents = Math.max(s.minimumFeeCents, roundCents(roundTripKm * s.pricePerKmCents));
  const perDayCents = parking > 0 ? Math.max(perTripCents + parking, s.minimumDailyWithParkingCents) : perTripCents;
  const totalCents = perDayCents * days;
  const km = roundTripKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return {
    applies: totalCents > 0, roundTripKm, perTripCents, perDayCents, days, totalCents,
    designation: parking > 0 ? "Déplacement et stationnement" : "Frais de déplacement",
    detail: `${days} j × ${euros(perDayCents)} (${km} km aller-retour${parking > 0 ? ` + stationnement ${euros(parking)}/j` : ""})`,
  };
}

// ---------------------------------------------------------------------------
// Calcul complet d'un devis
// ---------------------------------------------------------------------------

function isMaterial(kind: LineKind): boolean {
  return kind === "material" || kind === "accessory";
}

/** Montant de la remise HT, borné entre 0 et le total. */
export function discountAmountCents(grossHtCents: number, d: QuoteDiscount | null | undefined): number {
  if (!d || !(d.value > 0)) return 0;
  const raw = d.kind === "percent" ? roundCents(grossHtCents * Math.min(d.value, 1)) : Math.round(d.value);
  return Math.max(0, Math.min(raw, grossHtCents));
}

/** Répartit `amount` au prorata des montants (méthode du plus fort reste, au centime près). */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) * amount) / total);
  const out = exact.map(Math.floor);
  let rest = amount - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i]! += 1;
    rest--;
  }
  return out;
}

export function computeQuote(input: QuoteInput): QuoteResult {
  const { settings } = input;
  const franchise = settings.vatRegime === "franchise";

  const base = input.lines.map((l) => {
    if (l.quantity < 0) throw new RangeError(`Quantité négative sur « ${l.designation} »`);
    if (!franchise && !ALLOWED_VAT_RATES.includes(l.vatRate)) {
      throw new RangeError(`Taux de TVA non autorisé sur « ${l.designation} » : ${l.vatRate}`);
    }
    return { l, totalSaleCents: roundCents(l.quantity * l.unitSaleCents), totalPurchaseCents: roundCents(l.quantity * l.unitPurchaseCents) };
  });
  const grossHtCents = base.reduce((a, b) => a + b.totalSaleCents, 0);
  const discountCents = discountAmountCents(grossHtCents, input.discount);
  const shares = allocate(discountCents, base.map((b) => b.totalSaleCents));

  const lines: PricedLine[] = base.map(({ l, totalSaleCents, totalPurchaseCents }, i) => {
    const lineDiscount = shares[i]!;
    const netSaleCents = totalSaleCents - lineDiscount;
    const rate = isMaterial(l.kind) ? settings.materialChargesRate : settings.laborChargesRate;
    const chargesCents = roundCents(Math.max(0, netSaleCents) * rate);
    const contributionCents = netSaleCents - totalPurchaseCents - chargesCents;
    const belowCost = l.quantity > 0 && contributionCents < 0;
    return { ...l, vatRate: franchise ? 0 : l.vatRate, totalSaleCents, discountCents: lineDiscount, netSaleCents, totalPurchaseCents, chargesCents, contributionCents, belowCost };
  });

  const sum = (pred: (l: PricedLine) => boolean, f: (l: PricedLine) => number) =>
    lines.filter(pred).reduce((acc, l) => acc + f(l), 0);

  const totalHtCents = grossHtCents - discountCents;

  // TVA par taux, sur le total HT (après remise) de chaque taux.
  const byRate = new Map<number, number>();
  if (!franchise) {
    for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.netSaleCents);
  }
  const vat: VatBreakdown[] = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, baseCents]) => ({ rate, baseCents, vatCents: roundCents(baseCents * rate) }));
  const totalVatCents = vat.reduce((a, v) => a + v.vatCents, 0);

  const materialSaleCents = sum((l) => isMaterial(l.kind), (l) => l.totalSaleCents);
  const laborSaleCents = sum((l) => l.kind === "labor", (l) => l.totalSaleCents);
  const travelSaleCents = sum((l) => l.kind === "travel", (l) => l.totalSaleCents);
  const otherSaleCents = sum((l) => l.kind === "other", (l) => l.totalSaleCents);
  const purchaseCostCents = sum(() => true, (l) => l.totalPurchaseCents);
  const materialChargesCents = sum((l) => isMaterial(l.kind), (l) => l.chargesCents);
  const laborChargesCents = sum((l) => !isMaterial(l.kind), (l) => l.chargesCents);
  const netMarginCents = totalHtCents - purchaseCostCents - materialChargesCents - laborChargesCents;
  const marginPerDayCents = input.laborDays > 0 ? roundCents(netMarginCents / input.laborDays) : null;

  const alerts: QuoteAlert[] = [];
  for (const l of lines) {
    if (l.belowCost) {
      alerts.push({
        code: "line_below_cost",
        lineId: l.id,
        message: l.discountCents > 0 && l.totalSaleCents - l.totalPurchaseCents - roundCents(l.totalSaleCents * (isMaterial(l.kind) ? settings.materialChargesRate : settings.laborChargesRate)) >= 0
          ? `Avec la remise, « ${l.designation} » passe sous son coût de revient (achat + charges).`
          : `« ${l.designation} » est vendu sous son coût de revient (achat + charges).`,
      });
    }
  }
  if (netMarginCents < 0) {
    alerts.push({ code: "negative_margin", message: "La marge nette du devis est négative : vous perdez de l'argent." });
  }
  if (settings.targetMarginPerDayCents > 0 && marginPerDayCents !== null && marginPerDayCents < settings.targetMarginPerDayCents) {
    alerts.push({ code: "margin_below_target", message: "La marge nette par jour est sous votre objectif." });
  }

  return {
    lines,
    grossHtCents,
    discountCents,
    totalHtCents,
    vat,
    totalVatCents,
    totalTtcCents: totalHtCents + totalVatCents,
    vatMention: franchise ? FRANCHISE_MENTION : null,
    margin: {
      discountCents,
      purchaseCostCents,
      materialSaleCents,
      laborSaleCents,
      travelSaleCents,
      otherSaleCents,
      laborChargesCents,
      materialChargesCents,
      netMarginCents,
      netMarginRate: totalHtCents > 0 ? netMarginCents / totalHtCents : 0,
      marginPerDayCents,
      targetMarginPerDayCents: settings.targetMarginPerDayCents,
    },
    alerts,
  };
}

// ---------------------------------------------------------------------------
// Remise maximale possible avant alerte
// ---------------------------------------------------------------------------

/**
 * Plus grande remise commerciale (HT) qui ne déclenche aucune alerte : aucune
 * ligne sous son coût, marge positive, marge/jour ≥ objectif. 0 si le devis
 * est déjà en alerte sans remise. Recherche dichotomique (les alertes ne font
 * qu'augmenter avec la remise).
 */
export function maxDiscount(input: QuoteInput): { cents: number; rate: number } {
  const ok = (d: number) => computeQuote({ ...input, discount: { kind: "amount", value: d } }).alerts.length === 0;
  const gross = computeQuote({ ...input, discount: null }).grossHtCents;
  if (gross === 0 || !ok(0)) return { cents: 0, rate: 0 };
  let lo = 0;
  let hi = gross;
  if (ok(hi)) lo = hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return { cents: lo, rate: lo / gross };
}

// ---------------------------------------------------------------------------
// Arrondi aux seuils psychologiques
// ---------------------------------------------------------------------------

/**
 * Seuils psychologiques encadrant un montant TTC (en centimes, euros ronds) :
 *  - ≥ 1 000 € : prix finissant par 90 € (3 512 € → 3 490 € / 3 590 €)
 *  - <  1 000 € : prix finissant par 49 ou 99 € (512 € → 499 € / 549 €)
 */
export function psychologicalBounds(amountCents: number): { lower: number | null; upper: number } {
  // Seuils (en euros) : 49, 99, 149, …, 999 puis 1 090, 1 190, 1 290…
  const below1000 = (e: number) => e < 1000;
  // plus grand seuil ≤ montant
  let lower: number | null;
  const e = amountCents / 100;
  if (e >= 1090) lower = (Math.floor((e + 10) / 100) * 100 - 10) * 100;
  else if (e >= 999) lower = 999 * 100;
  else if (e >= 49) lower = (Math.floor((e + 1) / 50) * 50 - 1) * 100;
  else lower = null;
  // plus petit seuil > montant
  let upperEuros: number;
  if (below1000(e) && e < 999) upperEuros = Math.floor((e + 1) / 50) * 50 + 49;
  else if (e < 1090) upperEuros = 1090;
  else upperEuros = Math.floor((e + 10) / 100) * 100 + 90;
  return { lower, upper: upperEuros * 100 };
}

export function isPsychologicalPrice(amountCents: number): boolean {
  if (amountCents % 100 !== 0) return false;
  const e = amountCents / 100;
  return e >= 1000 ? e % 100 === 90 : e % 50 === 49;
}

export type RoundingOutcome = "rounded_down" | "rounded_up" | "unchanged";

export interface RoundingResult {
  outcome: RoundingOutcome;
  reason: string;
  lines: QuoteLineInput[];
  discount: QuoteDiscount | null;
  result: QuoteResult;
}

function violatesConstraints(r: QuoteResult): boolean {
  return r.alerts.length > 0;
}

/**
 * Plus petite valeur entière x de [lo, hi] telle que f(x) ≥ target (f croissante),
 * ou null. Sert à trouver un prix ou une remise qui donne un total exact.
 */
function searchExact(lo: number, hi: number, f: (x: number) => number, target: number): number | null {
  if (f(hi) < target || f(lo) > target) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) >= target) hi = mid;
    else lo = mid + 1;
  }
  return f(lo) === target ? lo : null;
}

/**
 * Ajuste le devis pour que le TOTAL TTC (ce que voit le client ; HT en
 * franchise) tombe sur un seuil psychologique.
 *  - s'il y a une remise commerciale, c'est elle qui absorbe l'écart (convertie en montant) ;
 *  - sinon, la ligne de main d'œuvre la plus importante, convertie en forfait
 *    (elle n'a pas de coût d'achat) ; à défaut la ligne la plus chère.
 * Règle : seuil inférieur, sauf s'il crée une alerte (sous le coût, marge/jour
 * sous l'objectif…) : alors seuil supérieur. Jamais d'alerte nouvelle.
 */
export function roundToPsychologicalPrice(input: QuoteInput): RoundingResult {
  const current = computeQuote(input);
  const unchanged = (reason: string): RoundingResult => ({ outcome: "unchanged", reason, lines: input.lines, discount: input.discount ?? null, result: current });
  if (isPsychologicalPrice(current.totalTtcCents)) return unchanged("Le total est déjà sur un seuil psychologique.");

  const { lower, upper } = psychologicalBounds(current.totalTtcCents);
  const alreadyInAlert = violatesConstraints(current);
  const target = pickAdjustmentLine(input.lines);

  const viaDiscount = (targetTtc: number) => {
    if (current.discountCents <= 0) return null;
    const ttc = (d: number) => computeQuote({ ...input, discount: { kind: "amount", value: d } }).totalTtcCents;
    // TTC décroît avec la remise : on cherche sur −d
    const gross = current.grossHtCents;
    const neg = searchExact(-gross, 0, (x) => ttc(-x), targetTtc);
    if (neg === null) return null;
    const discount: QuoteDiscount = { kind: "amount", value: -neg };
    return { lines: input.lines, discount, result: computeQuote({ ...input, discount }) };
  };
  const viaLine = (targetTtc: number) => {
    if (!target) return null;
    const designation = target.quantity === 1 ? target.designation : `${target.designation} (forfait ${formatQty(target.quantity)} ${target.unit})`;
    const unitPurchase = roundCents(target.quantity * target.unitPurchaseCents);
    const withLine = (ht: number) =>
      input.lines.map((l) => (l.id === target.id ? { ...l, designation, quantity: 1, unit: "forfait", unitSaleCents: ht, unitPurchaseCents: unitPurchase } : l));
    const ht = searchExact(0, Math.max(current.grossHtCents * 3, 100000), (x) => computeQuote({ ...input, lines: withLine(x) }).totalTtcCents, targetTtc);
    if (ht === null) return null;
    const lines = withLine(ht);
    return { lines, discount: input.discount ?? null, result: computeQuote({ ...input, lines }) };
  };
  const attempt = (t: number) => viaDiscount(t) ?? viaLine(t);

  if (lower !== null && !alreadyInAlert) {
    const down = attempt(lower);
    if (down && !violatesConstraints(down.result)) return { outcome: "rounded_down", reason: "Arrondi au seuil inférieur.", ...down };
  }
  const up = attempt(upper);
  if (up) {
    const reason = alreadyInAlert
      ? "Devis déjà en alerte : arrondi au seuil supérieur uniquement."
      : "Le seuil inférieur ferait passer sous le coût ou sous l'objectif de marge : arrondi au seuil supérieur.";
    return { outcome: "rounded_up", reason, ...up };
  }
  return unchanged(target ? "Impossible d'atteindre un seuil exact." : "Aucune ligne ajustable.");
}

function pickAdjustmentLine(lines: QuoteLineInput[]): QuoteLineInput | undefined {
  const byTotal = (a: QuoteLineInput, b: QuoteLineInput) => b.quantity * b.unitSaleCents - a.quantity * a.unitSaleCents;
  const labor = lines.filter((l) => l.kind === "labor" && l.quantity > 0).sort(byTotal);
  if (labor[0]) return labor[0];
  return lines.filter((l) => l.kind !== "travel" && l.quantity > 0).sort(byTotal)[0];
}

function formatQty(q: number): string {
  return q.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}
