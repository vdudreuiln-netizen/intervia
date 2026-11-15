import { describe, expect, it } from "vitest";
import { accessState, seatCheck, type SubscriptionRow } from "./access";
import { allPriceRefs, euros, launchSeatsLeft, monthlyEquivalentCents, nextPlan, planForUsers, priceEnvName, priceIdFor, resolvePriceId, yearlySavingCents } from "./plans";

describe("formules", () => {
  it("annuel = 2 mois offerts, affiché en équivalent mensuel", () => {
    expect(monthlyEquivalentCents(49000)).toBe(4083);
    const e = (c: number) => euros(c).replace(/\s/g, " ");
    expect(e(monthlyEquivalentCents(49000))).toBe("40,83 €");
    expect(e(monthlyEquivalentCents(89000))).toBe("74,17 €");
    expect(e(monthlyEquivalentCents(179000))).toBe("149,17 €");
    expect(yearlySavingCents("solo")).toBe(9800); // 2 × 49 €
    expect(euros(4900).replace(/\s/g, " ")).toBe("49 €");
  });
  it("formule selon le nombre d'utilisateurs", () => {
    expect(planForUsers(1)).toBe("solo");
    expect(planForUsers(2)).toBe("equipe");
    expect(planForUsers(4)).toBe("entreprise");
    expect(planForUsers(11)).toBeNull();
    expect(nextPlan("solo")).toBe("equipe");
    expect(nextPlan("entreprise")).toBeNull();
  });
  it("places au tarif de lancement", () => {
    expect(launchSeatsLeft(0)).toBe(50);
    expect(launchSeatsLeft(47)).toBe(3);
    expect(launchSeatsLeft(55)).toBe(0);
  });
  it("prix Stripe : 7 prix (6 + lancement), aller-retour id ↔ formule", () => {
    expect(allPriceRefs()).toHaveLength(7);
    expect(priceEnvName({ plan: "equipe", interval: "year", launch: false })).toBe("STRIPE_PRICE_EQUIPE_YEARLY");
    const env = { STRIPE_PRICE_SOLO_MONTHLY: "price_s_m", STRIPE_PRICE_LAUNCH: "price_launch" };
    expect(priceIdFor({ plan: "solo", interval: "month", launch: true }, env)).toBe("price_launch");
    expect(resolvePriceId("price_launch", env)).toEqual({ plan: "solo", interval: "month", launch: true });
    expect(resolvePriceId("price_s_m", env)).toEqual({ plan: "solo", interval: "month", launch: false });
    expect(resolvePriceId("inconnu", env)).toBeNull();
  });
});

const now = new Date("2026-11-14T12:00:00Z");
const sub = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  status: "trialing",
  trial_ends_at: "2026-11-20T12:00:00Z",
  plan: null,
  interval: null,
  current_period_end: null,
  cancel_at_period_end: false,
  launch_offer: false,
  stripe_subscription_id: null,
  ...over,
});

describe("accès", () => {
  it("essai en cours : tout est permis, jours restants, équipe testable jusqu'à 10", () => {
    const a = accessState(sub({}), now);
    expect(a).toMatchObject({ mode: "trial", canWrite: true, trialDaysLeft: 6, maxUsers: 10 });
  });
  it("fin d'essai sans abonnement : lecture seule", () => {
    const a = accessState(sub({ trial_ends_at: "2026-11-13T12:00:00Z" }), now);
    expect(a).toMatchObject({ mode: "read_only", canWrite: false });
    expect(a.message).toContain("consultables");
  });
  it("abonné : limite de la formule", () => {
    expect(accessState(sub({ status: "active", plan: "equipe" }), now)).toMatchObject({ mode: "active", canWrite: true, maxUsers: 3 });
  });
  it("paiement en échec : délai de grâce, message", () => {
    expect(accessState(sub({ status: "past_due", plan: "solo" }), now)).toMatchObject({ mode: "past_due", canWrite: true });
  });
  it("résilié ou impayé : lecture seule", () => {
    expect(accessState(sub({ status: "canceled", plan: "solo" }), now).canWrite).toBe(false);
    expect(accessState(sub({ status: "unpaid", plan: "solo" }), now).canWrite).toBe(false);
  });
  it("abonné pendant l'essai : 1er paiement à la fin de l'essai, limite de sa formule", () => {
    const a = accessState(sub({ plan: "solo", stripe_subscription_id: "sub_1" }), now);
    expect(a.maxUsers).toBe(1);
    expect(a.message).toContain("premier paiement");
  });
});

describe("limite d'utilisateurs", () => {
  it("Solo complet : proposer la formule Équipe", () => {
    const r = seatCheck(accessState(sub({ status: "active", plan: "solo" }), now), 1);
    expect(r).toMatchObject({ ok: false, upgradeTo: "equipe" });
    expect(r.message).toContain("Équipe");
  });
  it("Équipe : 3 utilisateurs, puis Entreprise", () => {
    const a = accessState(sub({ status: "active", plan: "equipe" }), now);
    expect(seatCheck(a, 2).ok).toBe(true);
    expect(seatCheck(a, 3).upgradeTo).toBe("entreprise");
  });
  it("Entreprise pleine : pas de formule au-dessus", () => {
    expect(seatCheck(accessState(sub({ status: "active", plan: "entreprise" }), now), 10)).toMatchObject({ ok: false, upgradeTo: null });
  });
  it("lecture seule : aucune invitation", () => {
    expect(seatCheck(accessState(sub({ status: "canceled" }), now), 0).ok).toBe(false);
  });
});
