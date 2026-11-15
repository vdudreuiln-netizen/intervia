"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Notice } from "@/components/ui";
import { COEF_FIELDS, coefficientsToForm, DEFAULT_COEFFICIENTS } from "@/lib/sizing/coefficients";
import { saveCoefficients } from "./actions";

export function CoefficientsForm({ initial }: { initial: Record<string, string> }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const groups = [...new Set(COEF_FIELDS.map((f) => f.group))];

  const submit = () =>
    start(async () => {
      const r = await saveCoefficients(form);
      setErrors(r.errors ?? {});
      setStatus({ ok: r.ok, text: r.message });
    });

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <Card key={g} title={g}>
          {COEF_FIELDS.filter((f) => f.group === g).map((f) => (
            <Field
              key={f.path}
              label={f.label}
              value={form[f.path] ?? ""}
              onChange={(v) => {
                setForm({ ...form, [f.path]: v });
                setStatus(null);
              }}
              error={errors[f.path]}
              inputMode="decimal"
              suffix={f.unit}
            />
          ))}
        </Card>
      ))}
      {status && <Notice tone={status.ok ? "ok" : "danger"}>{status.text}</Notice>}
      <div className="sticky bottom-20 flex flex-col gap-3 rounded-2xl bg-slate-100/95 py-2 sm:flex-row">
        <Button type="button" full onClick={submit} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setForm(coefficientsToForm(DEFAULT_COEFFICIENTS));
            setErrors({});
            setStatus({ ok: true, text: "Valeurs par défaut rétablies : pensez à enregistrer." });
          }}
        >
          Valeurs par défaut
        </Button>
      </div>
    </div>
  );
}
