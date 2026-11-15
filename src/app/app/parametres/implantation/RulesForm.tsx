"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decimalToInput, parseDecimal } from "@/lib/format";
import { RULES, type RuleId, type RuleSettings } from "@/lib/plans/rules";
import { savePlacementRules } from "./actions";

export function RulesForm({ initial, capacityNumber }: { initial: RuleSettings; capacityNumber: string }) {
  const [s, setS] = useState(initial);
  const [cap, setCap] = useState(capacityNumber);
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
        <Field label="N° d'attestation de capacité" value={cap} onChange={setCap} hint="Repris sur la fiche d'intervention fluides du mode chantier" />
      </Card>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <Button
        type="button"
        full
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await savePlacementRules({ ...s, heatDistanceM: parseDecimal(text.heat) ?? NaN, bedDistanceM: parseDecimal(text.bed) ?? NaN, condensateSlope: (parseDecimal(text.slope) ?? NaN) / 100, levelHeightM: parseDecimal(text.level) ?? NaN }, cap);
            setMsg({ ok: r.ok, text: r.message });
          })
        }
      >
        {busy ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </div>
  );
}
