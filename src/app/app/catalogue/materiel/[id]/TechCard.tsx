"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { saveProductTech, type ProductTechForm } from "../../actions";

const SIDES: [keyof ProductTechForm["clearances"], string][] = [
  ["top", "Dessus / plafond"],
  ["left", "Côté gauche"],
  ["right", "Côté droit"],
  ["bottom", "Dessous / sol"],
  ["front", "Devant"],
  ["rear", "Derrière"],
];

/** Données de la notice utilisées par les règles d'implantation et la fiche fluides. */
export function TechCard({ productId, initial, outdoor }: { productId: string; initial: ProductTechForm; outdoor: boolean }) {
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <Card title="Données de pose (notice du fabricant)">
      <p className="text-base text-slate-700">Servent aux contrôles d&apos;implantation : surface minimale de la pièce (R32), longueur et dénivelé des liaisons, dégagements. Vide = règle non vérifiée, signalée en orange.</p>
      {outdoor && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Fluide" value={f.refrigerant} onChange={(v) => setF({ ...f, refrigerant: v })} options={["R32", "R410A", "R290", "R454B", "autre"].map((v) => ({ value: v, label: v }))} placeholder="Non renseigné" />
          <Field label="Charge usine" inputMode="decimal" suffix="kg" value={f.factoryChargeKg} onChange={(v) => setF({ ...f, factoryChargeKg: v })} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Longueur max de liaison" inputMode="decimal" suffix="m" value={f.maxLinkM} onChange={(v) => setF({ ...f, maxLinkM: v })} />
        <Field label="Dénivelé max" inputMode="decimal" suffix="m" value={f.maxHeightDiffM} onChange={(v) => setF({ ...f, maxHeightDiffM: v })} />
      </div>
      <p className="text-base font-bold">Dégagements minimaux</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SIDES.map(([k, label]) => (
          <Field key={k} label={label} inputMode="numeric" suffix="cm" value={f.clearances[k]} onChange={(v) => setF({ ...f, clearances: { ...f.clearances, [k]: v } })} />
        ))}
      </div>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <Button
        type="button"
        full
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await saveProductTech(productId, f);
            setMsg({ ok: r.ok, text: r.message ?? "" });
          })
        }
      >
        {busy ? "Enregistrement…" : "Enregistrer les données de pose"}
      </Button>
    </Card>
  );
}
