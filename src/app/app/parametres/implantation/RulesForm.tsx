"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { decimalToInput, parseDecimal } from "@/lib/format";
import { RULES, type RuleId, type RuleSettings } from "@/lib/plans/rules";
import { savePlacementRules, type FluidSettings } from "./actions";

const COUNTRIES: Record<string, string> = { FR: "France (CERFA 15497*04)", BE: "Belgique", LU: "Luxembourg", CH: "Suisse", ES: "Espagne", DE: "Allemagne", AT: "Autriche", IT: "Italie", PT: "Portugal", NL: "Pays-Bas", IE: "Irlande", GB: "Royaume-Uni", autre: "Autre pays" };

export function RulesForm({ initial, fluid: initialFluid }: { initial: RuleSettings; fluid: FluidSettings }) {
  const [s, setS] = useState(initial);
  const [fluid, setFluid] = useState<FluidSettings>(initialFluid);
  const [text, setText] = useState({ heat: decimalToInput(initial.heatDistanceM), bed: decimalToInput(initial.bedDistanceM), slope: decimalToInput(initial.condensateSlope * 100), level: decimalToInput(initial.levelHeightM) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const toggle = (id: RuleId, on: boolean) => setS({ ...s, enabled: { ...s.enabled, [id]: on } });
  const group = (severity: "rouge" | "orange") =>
    RULES.filter((r) => r.severity === severity).map((r) => (
      <label key={r.id} className="flex items-start gap-3 text-base">
        <input type="checkbox" className="mt-1 h-6 w-6" checked={s.enabled[r.id] !== false} onChange={(e) => toggle(r.id, e.target.checked)} />
        {r.label}
      </label>
    ));
  return (
    <div className="space-y-6">
      <Card title="Règles impératives (alerte rouge)">{group("rouge")}</Card>
      <Card title="Préférences (avertissement orange)">{group("orange")}</Card>
      <Card title="Seuils">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Distance mini à une source de chaleur" inputMode="decimal" suffix="m" value={text.heat} onChange={(v) => setText({ ...text, heat: v })} />
          <Field label="« Au-dessus d'un lit » : rayon" inputMode="decimal" suffix="m" value={text.bed} onChange={(v) => setText({ ...text, bed: v })} />
          <Field label="Pente mini des condensats" inputMode="decimal" suffix="cm/m" value={text.slope} onChange={(v) => setText({ ...text, slope: v })} />
          <Field label="Hauteur d'un niveau (dénivelé)" inputMode="decimal" suffix="m" value={text.level} onChange={(v) => setText({ ...text, level: v })} />
        </div>
      </Card>
      <Card title="Fluides frigorigènes">
        <Select label="Pays d'exercice" value={fluid.country} onChange={(v) => setFluid({ ...fluid, country: v })} options={Object.entries(COUNTRIES).map(([value, label]) => ({ value, label }))} />
        <p className="text-sm text-slate-600">France : formulaire officiel CERFA 15497*04 pré-rempli. Autres pays : fiche d&apos;intervention générique avec les mêmes données (règlement (UE) 2024/573).</p>
        <Field label="N° d'attestation de capacité" value={fluid.capacityNumber} onChange={(v) => setFluid({ ...fluid, capacityNumber: v })} hint="Cadre [1] de la fiche. Sans ce numéro, la fiche signale qu'elle doit être signée par un opérateur attesté." />
        <Field label="Détecteur manuel de fuite (marque, modèle, n°)" value={fluid.leakDetectorId} onChange={(v) => setFluid({ ...fluid, leakDetectorId: v })} hint="Cadre [5]" />
        <Field label="Date du dernier contrôle du détecteur" type="date" value={fluid.leakDetectorCheckedOn} onChange={(v) => setFluid({ ...fluid, leakDetectorCheckedOn: v })} />
      </Card>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <Button
        type="button"
        full
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await savePlacementRules({ ...s, heatDistanceM: parseDecimal(text.heat) ?? NaN, bedDistanceM: parseDecimal(text.bed) ?? NaN, condensateSlope: (parseDecimal(text.slope) ?? NaN) / 100, levelHeightM: parseDecimal(text.level) ?? NaN }, fluid);
            setMsg({ ok: r.ok, text: r.message });
          })
        }
      >
        {busy ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </div>
  );
}
