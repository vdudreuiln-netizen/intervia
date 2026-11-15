import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing/stripe";
import { patchFromStripe, type StripeSubscriptionLike } from "@/lib/billing/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook Stripe : seule source de vérité de l'abonnement en base.
 * Signature vérifiée sur le corps brut ; écriture avec la clé service.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return new Response("Configuration ou signature manquante", { status: 400 });
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return new Response("Signature invalide", { status: 400 });
  }

  const admin = createAdminClient();
  const sync = async (sub: Stripe.Subscription, launchRequested = false) => {
    const patch = patchFromStripe(sub as unknown as StripeSubscriptionLike, process.env);
    const { launchPrice, ...row } = patch;
    let companyId = sub.metadata?.company_id;
    if (!companyId) {
      const { data } = await admin.from("subscriptions").select("company_id").eq("stripe_customer_id", row.stripe_customer_id).maybeSingle();
      companyId = data?.company_id;
    }
    if (!companyId) return;
    await admin.from("subscriptions").update({ ...row, updated_at: new Date().toISOString() }).eq("company_id", companyId);
    if (launchPrice || launchRequested) {
      const { data: claimed } = await admin.rpc("claim_launch_seat", { p_company_id: companyId });
      if (!claimed) console.warn(`Offre de lancement épuisée au moment du paiement (entreprise ${companyId}) : prix honoré.`);
    }
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription" && typeof session.subscription === "string") {
        await sync(await stripe.subscriptions.retrieve(session.subscription), session.metadata?.launch === "true");
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await sync(event.data.object);
      break;
    default:
      break;
  }
  return Response.json({ received: true });
}
