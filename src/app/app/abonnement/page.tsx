import type { Metadata } from "next";
import { getCurrentCompany } from "@/lib/company/current";
import { loadBilling } from "@/lib/billing/load";
import { BillingPanel } from "./BillingPanel";
import { Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Abonnement" };

export default async function AbonnementPage({ searchParams }: { searchParams: Promise<{ merci?: string }> }) {
  const { merci } = await searchParams;
  const { supabase, role } = await getCurrentCompany();
  const billing = await loadBilling(supabase);
  const { data: seats } = await supabase.rpc("launch_seats_left");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Abonnement</h1>
      {merci && <Notice tone="ok">Merci ! Votre abonnement s&apos;active dans quelques secondes (actualisez la page si besoin).</Notice>}
      {role !== "admin" ? (
        <Notice>{billing.access.message ?? "Abonnement actif."} Seul un administrateur du compte gère l&apos;abonnement.</Notice>
      ) : (
        <BillingPanel
          status={billing.row.status}
          message={billing.access.message}
          hasSubscription={!!billing.row.stripe_subscription_id && ["active", "trialing", "past_due"].includes(billing.row.status)}
          hasCustomer={!!billing.row.stripe_customer_id}
          plan={billing.row.plan}
          interval={billing.row.interval}
          periodEnd={billing.row.current_period_end}
          cancelAtPeriodEnd={billing.row.cancel_at_period_end}
          launchOffer={billing.row.launch_offer}
          members={billing.members}
          seatsLeft={typeof seats === "number" ? seats : 0}
        />
      )}
    </div>
  );
}
