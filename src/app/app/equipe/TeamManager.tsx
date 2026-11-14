"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Choice, Field, Notice } from "@/components/ui";
import { PLANS, euros, priceCents, type Interval, type PlanId } from "@/lib/billing/plans";
import { changePlan } from "../abonnement/actions";
import { Check } from "../devis/[id]/steps/ClientStep";
import { inviteMember, removeMember, revokeInvitation, setMarginVisibility, setMemberRole } from "./actions";

type Role = "admin" | "technicien";
const ROLE_LABELS: Record<Role, string> = { admin: "Administrateur", technicien: "Technicien" };

interface Props {
  me: string;
  members: { id: string; email: string; name: string; role: Role; owner: boolean }[];
  invites: { id: string; email: string; role: Role; expired: boolean; token: string }[];
  seats: { used: number; max: number; ok: boolean; message: string | null; upgradeTo: PlanId | null };
  planInterval: Interval;
  launchOffer: boolean;
  marginsVisible: boolean;
  appUrl: string;
}

export function TeamManager({ me, members, invites, seats, planInterval, launchOffer, marginsVisible, appUrl }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("technicien");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [upgrade, setUpgrade] = useState<PlanId | null>(seats.ok ? null : seats.upgradeTo);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string; link?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message, link: r.link });
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-6">
      <Card title={`Membres (${seats.used} / ${seats.max})`}>
        <ul className="divide-y-2 divide-slate-200">
          {members.map((m) => (
            <li key={m.id} className="py-3">
              <p className="text-lg font-bold">{m.name || m.email}</p>
              <p className="text-base text-slate-700">
                {m.email} · {ROLE_LABELS[m.role]}
                {m.owner && " · titulaire du compte"}
              </p>
              {!m.owner && m.id !== me && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => setMemberRole(m.id, m.role === "admin" ? "technicien" : "admin"))}>
                    Passer {m.role === "admin" ? "technicien" : "administrateur"}
                  </Button>
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => confirm(`Retirer ${m.email} de l'équipe ?`) && run(() => removeMember(m.id))}>
                    Retirer
                  </Button>
                </div>
              )}
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="py-3">
              <p className="text-lg font-bold">{i.email}</p>
              <p className="text-base text-slate-700">
                {ROLE_LABELS[i.role]} · {i.expired ? "invitation expirée" : "invitation en attente"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(`${appUrl}/invitation/${i.token}`).then(() => setMsg({ ok: true, text: "Lien copié." }))}>
                  Copier le lien
                </Button>
                <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => revokeInvitation(i.id))}>
                  Annuler
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {upgrade ? (
        <Card title="Limite d'utilisateurs atteinte">
          <p className="text-lg">{seats.message}</p>
          <p className="text-base">
            Formule {PLANS[upgrade].name} : jusqu&apos;à {PLANS[upgrade].maxUsers} utilisateurs, {euros(priceCents(upgrade, planInterval))}/{planInterval === "month" ? "mois" : "an"}. La différence est calculée au prorata.
          </p>
          {launchOffer && <Notice tone="danger">Attention : vous perdrez le tarif de lancement à 29 €/mois en changeant de formule.</Notice>}
          <Button type="button" full disabled={pending} onClick={() => (!launchOffer || confirm("Abandonner définitivement le tarif de lancement ?")) && run(() => changePlan(upgrade, planInterval))}>
            Passer à la formule {PLANS[upgrade].name}
          </Button>
        </Card>
      ) : (
        <Card title="Inviter un collègue">
          <Field label="E-mail" value={email} onChange={setEmail} type="email" inputMode="email" />
          <Choice
            label="Rôle"
            value={role}
            onChange={setRole}
            options={[
              { value: "technicien", label: "Technicien", hint: "Crée et modifie des devis. Voit les marges seulement si vous l'autorisez." },
              { value: "admin", label: "Administrateur", hint: "Paramètres, catalogue, abonnement, toutes les marges" },
            ]}
          />
          <Button
            type="button"
            full
            disabled={pending || !email.trim()}
            onClick={() =>
              start(async () => {
                const r = await inviteMember(email, role);
                setMsg({ ok: r.ok, text: r.message, link: r.link });
                if (r.upgradeTo) setUpgrade(r.upgradeTo);
                if (r.ok) {
                  setEmail("");
                  router.refresh();
                }
              })
            }
          >
            Envoyer l&apos;invitation
          </Button>
        </Card>
      )}

      <Card title="Ce que voient les techniciens">
        <Check
          label="Les techniciens voient les marges et les prix d'achat"
          hint="Sinon, ils voient les prix de vente et les alertes, sans les montants de marge"
          checked={marginsVisible}
          onChange={(v) => run(() => setMarginVisibility(v))}
        />
      </Card>

      {msg && (
        <Notice tone={msg.ok ? "ok" : "danger"}>
          {msg.text}
          {msg.link && (
            <>
              <br />
              <code className="break-all text-sm">{msg.link}</code>
            </>
          )}
        </Notice>
      )}
    </div>
  );
}
