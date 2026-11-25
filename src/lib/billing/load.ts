import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessState, type Access, type SubscriptionRow } from "./access";

export interface BillingInfo {
  row: SubscriptionRow & { stripe_customer_id: string | null };
  access: Access;
  members: number;
  pendingInvites: number;
}

export async function loadBilling(supabase: SupabaseClient, now = new Date()): Promise<BillingInfo> {
  const [{ data: s }, { count: members }, { count: pending }] = await Promise.all([
    supabase.from("subscriptions").select("status, trial_ends_at, plan, billing_interval, current_period_end, cancel_at_period_end, launch_offer, stripe_subscription_id, stripe_customer_id").maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("invitations").select("id", { count: "exact", head: true }).is("accepted_at", null).gt("expires_at", now.toISOString()),
  ]);
  const row = {
    status: s?.status ?? "expired",
    trial_ends_at: s?.trial_ends_at ?? now.toISOString(),
    plan: s?.plan ?? null,
    interval: s?.billing_interval ?? null,
    current_period_end: s?.current_period_end ?? null,
    cancel_at_period_end: s?.cancel_at_period_end ?? false,
    launch_offer: s?.launch_offer ?? false,
    stripe_subscription_id: s?.stripe_subscription_id ?? null,
    stripe_customer_id: s?.stripe_customer_id ?? null,
  };
  return { row, access: accessState(row, now), members: members ?? 1, pendingInvites: pending ?? 0 };
}
