"use server";

import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, getStripe, INVOICE_FOOTER } from "@/lib/billing/stripe";
import { loadBilling } from "@/lib/billing/load";
import { LAUNCH_OFFER, PLANS, priceIdFor, type Interval, type PlanId } from "@/lib/billing/plans";
import { stripeTrialEnd } from "@/lib/billing/sync";

type Result = { ok: false; message: string };

async function adminContext() {
  const ctx = await getCurrentCompany();
  if (ctx.role !== "admin") return { error: "Réservé aux administrateurs du compte." } as const;
  return ctx;
}

/** Ouvre le paiement Stripe pour une formule (prix figé côté Stripe). */
export async function startCheckout(plan: PlanId, interval: Interval, launch: boolean): Promise<Result> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, message: ctx.error! };
  const { supabase, company, user } = ctx;
  if (!(plan in PLANS) || (interval !== "month" && interval !== "year")) return { ok: false, message: "Formule inconnue." };
  const billing = await loadBilling(supabase);
  if (billing.row.stripe_subscription_id && ["active", "trialing", "past_due"].includes(billing.row.status)) {
    return { ok: false, message: "Vous avez déjà un abonnement : changez de formule ci-dessous ou via « Gérer mon abonnement »." };
  }
  if (billing.members > PLANS[plan].maxUsers) {
    return { ok: false, message: `Vous êtes ${billing.members} utilisateurs : la formule ${PLANS[plan].name} en accepte ${PLANS[plan].maxUsers}. Choisissez une formule plus grande ou retirez des membres.` };
  }
  if (launch) {
    if (plan !== LAUNCH_OFFER.plan || interval !== LAUNCH_OFFER.interval) return { ok: false, message: "L'offre de lancement concerne la formule Solo mensuelle." };
    const { data: left } = await supabase.rpc("launch_seats_left");
    if (!left || left <= 0) return { ok: false, message: "Les 50 places au tarif de lancement sont parties." };
  }
  const price = priceIdFor({ plan, interval, launch }, process.env);
  if (!price) return { ok: false, message: "Paiement indisponible (prix Stripe non configuré)." };

  const stripe = getStripe();
  const admin = createAdminClient();
  let customer = billing.row.stripe_customer_id;
  if (!customer) {
    const c = await stripe.customers.create({
      email: company.email ?? user.email ?? undefined,
      name: company.legal_name,
      metadata: { company_id: company.id },
      invoice_settings: { footer: INVOICE_FOOTER },
      preferred_locales: ["fr"],
    });
    customer = c.id;
    await admin.from("subscriptions").update({ stripe_customer_id: customer }).eq("company_id", company.id);
  }
  const trialEnd = billing.row.status === "trialing" ? stripeTrialEnd(billing.row.trial_ends_at, new Date()) : null;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: company.id,
    line_items: [{ price, quantity: 1 }],
    locale: "fr",
    metadata: { company_id: company.id, launch: String(launch) },
    subscription_data: { metadata: { company_id: company.id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    success_url: `${appUrl()}/app/abonnement?merci=1`,
    cancel_url: `${appUrl()}/app/abonnement`,
  });
  if (!session.url) return { ok: false, message: "Paiement indisponible. Réessayez." };
  redirect(session.url);
}

/** Portail client Stripe : carte bancaire, factures, résiliation. */
export async function openBillingPortal(): Promise<Result> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, message: ctx.error! };
  const billing = await loadBilling(ctx.supabase);
  if (!billing.row.stripe_customer_id) return { ok: false, message: "Aucun abonnement pour l'instant." };
  const portal = await getStripe().billingPortal.sessions.create({ customer: billing.row.stripe_customer_id, return_url: `${appUrl()}/app/abonnement`, locale: "fr" });
  redirect(portal.url);
}

/** Passage à une autre formule (ex. limite d'utilisateurs atteinte), au prorata. */
export async function changePlan(plan: PlanId, interval: Interval): Promise<{ ok: boolean; message: string }> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, message: ctx.error! };
  const billing = await loadBilling(ctx.supabase);
  const subId = billing.row.stripe_subscription_id;
  if (!subId) return { ok: false, message: "Aucun abonnement actif : choisissez d'abord une formule." };
  if (billing.members + billing.pendingInvites > PLANS[plan].maxUsers) return { ok: false, message: `La formule ${PLANS[plan].name} accepte ${PLANS[plan].maxUsers} utilisateur(s).` };
  const price = priceIdFor({ plan, interval, launch: false }, process.env);
  if (!price) return { ok: false, message: "Prix Stripe non configuré." };
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subId);
  const item = sub.items.data[0];
  if (!item) return { ok: false, message: "Abonnement Stripe invalide." };
  await stripe.subscriptions.update(subId, { items: [{ id: item.id, price }], proration_behavior: "create_prorations", cancel_at_period_end: false });
  // la base est mise à jour par le webhook customer.subscription.updated
  return { ok: true, message: `Formule ${PLANS[plan].name} activée : la différence est calculée au prorata sur votre prochaine facture.` };
}
