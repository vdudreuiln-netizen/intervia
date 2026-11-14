"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice } from "@/components/ui";
import { PricingTable } from "@/components/PricingTable";
import { PLANS, PLAN_ORDER, euros, priceCents, type Interval, type PlanId } from "@/lib/billing/plans";
import { changePlan, openBillingPortal, startCheckout } from "./actions";

interface Props {
  status: string;
  message: string | null;
  hasSubscription: boolean;
  hasCustomer: boolean;
  plan: PlanId | null;
  interval: Interval | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  launchOffer: boolean;
  members: number;
  seatsLeft: number;
}

export function BillingPanel(p: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-6">
      {p.message && <Notice tone={p.status === "past_due" || !p.hasSubscription ? "danger" : "info"}>{p.message}</Notice>}
      {p.hasSubscription && p.plan && (
        <Card title={`Formule ${PLANS[p.plan].name}${p.launchOffer ? " — tarif de lancement" : ""}`}>
          <p className="text-lg">
            {p.launchOffer ? "29 €/mois, à vie" : `${euros(priceCents(p.plan, p.interval ?? "month"))}/${p.interval === "year" ? "an" : "mois"}`} · {p.members} utilisateur(s) sur {PLANS[p.plan].maxUsers}
          </p>
          {p.periodEnd && (
            <p className="text-base text-slate-700">
              {p.cancelAtPeriodEnd ? "Fin de l'abonnement le " : "Prochaine échéance le "}
              {new Date(p.periodEnd).toLocaleDateString("fr-FR")}
            </p>
          )}
          <h3 className="pt-2 text-lg font-bold">Changer de formule</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {PLAN_ORDER.filter((id) => id !== p.plan).map((id) => (
              <Button
                key={id}
                type="button"
                variant="secondary"
                disabled={pending || PLANS[id].maxUsers < p.members}
                onClick={() =>
                  (!p.launchOffer || confirm("Vous perdrez définitivement le tarif de lancement à 29 €/mois. Continuer ?")) &&
                  start(async () => {
                    const r = await changePlan(id, p.interval ?? "month");
                    setMsg({ ok: r.ok, text: r.message });
                    if (r.ok) setTimeout(() => router.refresh(), 2500);
                  })
                }
              >
                {PLANS[id].name}
              </Button>
            ))}
          </div>
        </Card>
      )}
      {p.hasCustomer && (
        <Button type="button" full variant={p.hasSubscription ? "secondary" : "primary"} disabled={pending} onClick={() => start(async () => { const r = await openBillingPortal(); if (r) setMsg({ ok: false, text: r.message }); })}>
          Gérer mon abonnement (carte, factures, résiliation)
        </Button>
      )}
      {!p.hasSubscription && <PricingTable seatsLeft={p.seatsLeft} minUsers={p.members} onChoose={(plan, iv, launch) => startCheckout(plan, iv, launch)} />}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
    </div>
  );
}
