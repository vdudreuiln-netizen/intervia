/**
 * Traduction d'un abonnement Stripe en ligne `subscriptions` (pur, testé).
 */
import { resolvePriceId, type Interval, type PlanId } from "./plans";

/** Sous-ensemble de Stripe.Subscription utilisé ici (API 2026 : fin de période sur la ligne). */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  cancel_at_period_end: boolean;
  trial_end: number | null;
  metadata: Record<string, string>;
  items: { data: { current_period_end: number; price: { id: string } }[] };
}

export interface SubscriptionPatch {
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status?: string;
  plan: PlanId | null;
  billing_interval: Interval | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_ends_at?: string;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();

export function patchFromStripe(sub: StripeSubscriptionLike, env: Record<string, string | undefined>): SubscriptionPatch & { launchPrice: boolean } {
  const item = sub.items.data[0];
  const ref = item ? resolvePriceId(item.price.id, env) : null;
  const patch: SubscriptionPatch & { launchPrice: boolean } = {
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    plan: ref?.plan ?? null,
    billing_interval: ref?.interval ?? null,
    current_period_end: item ? iso(item.current_period_end) : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    launchPrice: ref?.launch ?? false,
  };
  // Paiement initial pas encore abouti : on ne touche pas au statut (l'essai en cours reste valable).
  if (sub.status !== "incomplete" && sub.status !== "incomplete_expired") patch.status = sub.status;
  if (sub.status === "trialing" && sub.trial_end) patch.trial_ends_at = iso(sub.trial_end);
  return patch;
}

/** Fin d'essai à reporter sur l'abonnement Stripe (null si moins de 48 h : Stripe l'exige). */
export function stripeTrialEnd(trialEndsAt: string, now: Date): number | null {
  const t = new Date(trialEndsAt).getTime();
  return t - now.getTime() > 48 * 3600 * 1000 ? Math.floor(t / 1000) : null;
}
