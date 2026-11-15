"use client";

import { useState, useTransition } from "react";
import { LAUNCH_OFFER, monthlyEquivalentCents, PLAN_ORDER, PLANS, euros, yearlySavingCents, type Interval, type PlanId } from "@/lib/billing/plans";

export type ChooseHandler = (plan: PlanId, interval: Interval, launch: boolean) => Promise<{ ok: boolean; message: string } | void>;

/** Tableau des formules : public (lien d'inscription) ou dans l'application (paiement). */
export function PricingTable({ seatsLeft, onChoose, signupHref, current, minUsers = 1 }: { seatsLeft: number; onChoose?: ChooseHandler; signupHref?: string; current?: PlanId | null; minUsers?: number }) {
  const [interval, setInterval] = useState<Interval>("month");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const choose = (plan: PlanId, iv: Interval, launch: boolean) =>
    onChoose &&
    start(async () => {
      const r = await onChoose(plan, iv, launch);
      if (r && !r.ok) setMsg(r.message);
    });
  const cta = (label: string, plan: PlanId, iv: Interval, launch: boolean, disabled = false, primary = false) =>
    onChoose ? (
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() => choose(plan, iv, launch)}
        className={`mt-4 min-h-14 w-full rounded-xl text-lg font-bold disabled:opacity-50 ${primary ? "bg-brand text-white" : "border-2 border-brand bg-white text-brand"}`}
      >
        {pending ? "Redirection…" : label}
      </button>
    ) : (
      <a href={signupHref} className={`mt-4 flex min-h-14 w-full items-center justify-center rounded-xl text-lg font-bold ${primary ? "bg-brand text-white" : "border-2 border-brand bg-white text-brand"}`}>
        {label}
      </a>
    );

  return (
    <div className="space-y-5">
      <div className="mx-auto grid max-w-sm grid-cols-2 rounded-xl border-2 border-brand p-1" role="radiogroup" aria-label="Périodicité">
        {(["month", "year"] as Interval[]).map((iv) => (
          <button key={iv} type="button" role="radio" aria-checked={interval === iv} onClick={() => setInterval(iv)} className={`min-h-12 rounded-lg text-base font-bold ${interval === iv ? "bg-brand text-white" : "text-brand"}`}>
            {iv === "month" ? "Mensuel" : "Annuel (2 mois offerts)"}
          </button>
        ))}
      </div>

      {seatsLeft > 0 && (
        <section className="rounded-2xl border-4 border-amber-400 bg-amber-50 p-5">
          <p className="text-sm font-extrabold uppercase text-amber-800">Offre de lancement</p>
          <h2 className="mt-1 text-2xl font-extrabold">Solo à {euros(LAUNCH_OFFER.monthCents)}/mois, à vie</h2>
          <p className="mt-1 text-base">Au lieu de {euros(PLANS.solo.monthCents)}/mois. Votre prix reste bloqué, même si les tarifs changent.</p>
          <p className="mt-2 text-lg font-bold text-amber-900">Plus que {seatsLeft} place{seatsLeft > 1 ? "s" : ""} au tarif de lancement</p>
          {cta("Je profite de l'offre", "solo", "month", true, minUsers > 1, true)}
          {minUsers > 1 && <p className="mt-2 text-sm text-slate-700">Réservée à la formule Solo (1 utilisateur).</p>}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const yearly = interval === "year";
          const tooSmall = p.maxUsers < minUsers;
          return (
            <section key={id} className={`flex flex-col rounded-2xl border-2 bg-white p-5 ${current === id ? "border-brand" : "border-slate-300"}`}>
              <h2 className="text-2xl font-extrabold">{p.name}</h2>
              <p className="text-base text-slate-700">{p.maxUsers === 1 ? "1 utilisateur" : `Jusqu'à ${p.maxUsers} utilisateurs`}</p>
              <p className="mt-3 text-4xl font-extrabold">
                {euros(yearly ? monthlyEquivalentCents(p.yearCents) : p.monthCents)}
                <span className="text-lg font-bold text-slate-600">/mois</span>
              </p>
              <p className="text-sm text-slate-700">{yearly ? `facturés annuellement : ${euros(p.yearCents)}/an (${euros(yearlySavingCents(id))} d'économie)` : "sans engagement"}</p>
              <ul className="mt-3 space-y-1 text-base">
                <li>✔ Devis illimités</li>
                <li>✔ Catalogue multi-marques et import de tarifs</li>
                <li>✔ Marge en direct, PDF conformes</li>
                {p.maxUsers > 1 && <li>✔ Rôles administrateur / technicien</li>}
              </ul>
              <div className="mt-auto">
                {current === id ? (
                  <p className="mt-4 rounded-xl bg-brand-light p-3 text-center font-bold text-brand">Votre formule</p>
                ) : (
                  cta(onChoose ? `Choisir ${p.name}` : "Essai gratuit 14 jours", id, interval, false, tooSmall)
                )}
                {tooSmall && <p className="mt-2 text-sm text-slate-700">Vous êtes {minUsers} utilisateurs.</p>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="text-center text-sm text-slate-600">Prix nets. TVA non applicable, art. 293 B du CGI. Sans engagement : résiliable à tout moment, effet à la fin de la période payée.</p>
      {msg && <p role="alert" className="rounded-xl border-2 border-danger bg-danger-light p-4 font-bold text-danger">{msg}</p>}
    </div>
  );
}
