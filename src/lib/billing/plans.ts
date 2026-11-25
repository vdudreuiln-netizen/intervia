/**
 * Formules ClimDevis (sans engagement). Montants en centimes, franchise de TVA
 * de l'éditeur : prix nets (« TVA non applicable, art. 293 B du CGI »).
 */

export type PlanId = "solo" | "equipe" | "entreprise";
export type Interval = "month" | "year";

export interface Plan {
  id: PlanId;
  name: string;
  maxUsers: number;
  monthCents: number;
  yearCents: number;
}

export const PLANS: Record<PlanId, Plan> = {
  solo: { id: "solo", name: "Solo", maxUsers: 1, monthCents: 4900, yearCents: 49000 },
  equipe: { id: "equipe", name: "Équipe", maxUsers: 3, monthCents: 8900, yearCents: 89000 },
  entreprise: { id: "entreprise", name: "Entreprise", maxUsers: 10, monthCents: 17900, yearCents: 179000 },
};
export const PLAN_ORDER: PlanId[] = ["solo", "equipe", "entreprise"];

/** Offre de lancement : Solo à 29 €/mois à vie pour les 50 premiers abonnés (prix Stripe dédié). */
export const LAUNCH_OFFER = { plan: "solo" as PlanId, interval: "month" as Interval, monthCents: 2900, seats: 50 };

export const TRIAL_DAYS = 14;
/** Pendant l'essai, l'équipe peut être testée jusqu'à la plus grande formule. */
export const TRIAL_MAX_USERS = PLANS.entreprise.maxUsers;

/** Équivalent mensuel d'un tarif annuel, au centime : 490 € → 40,83 €. */
export function monthlyEquivalentCents(yearCents: number): number {
  return Math.round(yearCents / 12);
}

export function priceCents(plan: PlanId, interval: Interval): number {
  return interval === "month" ? PLANS[plan].monthCents : PLANS[plan].yearCents;
}

/** Économie de l'annuel par rapport à 12 mensualités (2 mois offerts). */
export function yearlySavingCents(plan: PlanId): number {
  return PLANS[plan].monthCents * 12 - PLANS[plan].yearCents;
}

/** Plus petite formule qui accepte `users` utilisateurs (null au-delà de 10). */
export function planForUsers(users: number): PlanId | null {
  return PLAN_ORDER.find((p) => PLANS[p].maxUsers >= users) ?? null;
}

export function nextPlan(plan: PlanId): PlanId | null {
  return PLAN_ORDER[PLAN_ORDER.indexOf(plan) + 1] ?? null;
}

export function launchSeatsLeft(claimed: number): number {
  return Math.max(0, LAUNCH_OFFER.seats - claimed);
}

// ---------------------------------------------------------------------------
// Correspondance avec les prix Stripe (identifiants fournis par l'environnement)
// ---------------------------------------------------------------------------

export interface PriceRef {
  plan: PlanId;
  interval: Interval;
  launch: boolean;
}

/** Nom de la variable d'environnement qui contient l'id du prix Stripe. */
export function priceEnvName(ref: PriceRef): string {
  return ref.launch ? "STRIPE_PRICE_LAUNCH" : `STRIPE_PRICE_${ref.plan.toUpperCase()}_${ref.interval === "month" ? "MONTHLY" : "YEARLY"}`;
}

export function allPriceRefs(): PriceRef[] {
  return [
    ...PLAN_ORDER.flatMap((plan) => (["month", "year"] as Interval[]).map((interval) => ({ plan, interval, launch: false }))),
    { plan: LAUNCH_OFFER.plan, interval: LAUNCH_OFFER.interval, launch: true },
  ];
}

export function priceIdFor(ref: PriceRef, env: Record<string, string | undefined>): string | null {
  return env[priceEnvName(ref)] ?? null;
}

/** Retrouve formule / périodicité / lancement à partir d'un id de prix Stripe. */
export function resolvePriceId(priceId: string, env: Record<string, string | undefined>): PriceRef | null {
  return allPriceRefs().find((r) => env[priceEnvName(r)] === priceId) ?? null;
}

export function euros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
