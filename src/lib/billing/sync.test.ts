import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { patchFromStripe, stripeTrialEnd, type StripeSubscriptionLike } from "./sync";

const env = { STRIPE_PRICE_EQUIPE_YEARLY: "price_eq_y", STRIPE_PRICE_LAUNCH: "price_launch" };
const sub = (over: Partial<StripeSubscriptionLike>): StripeSubscriptionLike => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  trial_end: null,
  metadata: { company_id: "c1" },
  items: { data: [{ current_period_end: 1798761600, price: { id: "price_eq_y" } }] },
  ...over,
});

describe("synchronisation Stripe → abonnement", () => {
  it("formule, périodicité, fin de période (sur la ligne d'abonnement)", () => {
    expect(patchFromStripe(sub({}), env)).toEqual({
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      status: "active",
      plan: "equipe",
      billing_interval: "year",
      current_period_end: "2027-01-01T00:00:00.000Z",
      cancel_at_period_end: false,
      launchPrice: false,
    });
  });
  it("prix de lancement reconnu", () => {
    expect(patchFromStripe(sub({ items: { data: [{ current_period_end: 1798761600, price: { id: "price_launch" } }] } }), env)).toMatchObject({ plan: "solo", billing_interval: "month", launchPrice: true });
  });
  it("paiement initial en cours : le statut d'essai n'est pas écrasé", () => {
    expect("status" in patchFromStripe(sub({ status: "incomplete" }), env)).toBe(false);
  });
  it("abonné pendant l'essai : fin d'essai reportée", () => {
    expect(patchFromStripe(sub({ status: "trialing", trial_end: 1795000000 }), env).trial_ends_at).toBe(new Date(1795000000 * 1000).toISOString());
  });
  it("résiliation programmée", () => {
    expect(patchFromStripe(sub({ cancel_at_period_end: true }), env).cancel_at_period_end).toBe(true);
  });
  it("fin d'essai reportée seulement si plus de 48 h restantes", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    expect(stripeTrialEnd("2026-11-20T12:00:00Z", now)).toBe(Math.floor(new Date("2026-11-20T12:00:00Z").getTime() / 1000));
    expect(stripeTrialEnd("2026-11-15T12:00:00Z", now)).toBeNull();
  });
});

describe("signature des webhooks Stripe", () => {
  it("accepte un événement signé, refuse une signature fausse", () => {
    const stripe = new Stripe("sk_test_dummy");
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.updated", data: { object: {} } });
    const secret = "whsec_test";
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).id).toBe("evt_1");
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_autre")).toThrow();
  });
});
