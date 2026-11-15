"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, LinkButton, Notice } from "@/components/ui";
import { decimalToInput, formatEuros, parseDecimal } from "@/lib/format";
import { computeQuote } from "@/lib/pricing/engine";
import type { Coefficients } from "@/lib/sizing/coefficients";
import { calcContext, type CompanyPricing, type SiteInfo } from "@/lib/quote/context";
import { buildLines, DEFAULT_DUCT_M_PER_ROOM, enabledLines, linkLength, proposeDays, type BuiltLine } from "@/lib/quote/lines";
import { EMPTY_METRE, type CatAccessory, type Equipment, type Metre, type RoomNeed, type WizardState } from "@/lib/quote/types";
import { saveWizard } from "../../actions";
import { MarginBar } from "../MarginBar";
import { Check } from "./ClientStep";

interface Props {
  quoteId: string;
  company: CompanyPricing;
  site: SiteInfo;
  coefs: Coefficients;
  rooms: RoomNeed[];
  equipment: Equipment;
  accessories: CatAccessory[];
  wizard: WizardState;
  showMargin?: boolean;
}

const UNIT: Record<string, string> = { m: "m", kg: "kg", u: "u", forfait: "forf.", jour: "j" };

export function MetreStep({ quoteId, company, site, coefs, rooms, equipment, accessories, wizard, showMargin = true }: Props) {
  const router = useRouter();
  const [metre, setMetre] = useState<Metre>(wizard.metre ?? EMPTY_METRE);
  const [text, setText] = useState<Record<string, string>>({}); // saisies en cours (virgule…)
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const ctx = useMemo(() => calcContext(company, site, coefs, wizard), [company, site, coefs, wizard]);

  const build = (m: Metre) => {
    const days = wizard.laborDays ?? proposeDays(equipment, m, coefs.laborDays);
    const built = buildLines(equipment, rooms, m, accessories, ctx.lineSettings, days, ctx.travelFor(days));
    return { built, result: computeQuote({ lines: enabledLines(built.lines), laborDays: days, settings: ctx.pricing }) };
  };
  const { built, result } = useMemo(() => build(metre), [metre]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasGainable = equipment.systems.some((s) => s.indoors.some((i) => i.product.type === "ui_gainable"));
  const zoningCost = useMemo(() => {
    if (!hasGainable) return 0;
    const on = build({ ...metre, toggles: { ...metre.toggles, zonage: true } }).result.totalTtcCents;
    const off = build({ ...metre, toggles: { ...metre.toggles, zonage: false } }).result.totalTtcCents;
    return on - off;
  }, [metre, hasGainable]); // eslint-disable-line react-hooks/exhaustive-deps

  const numberInput = (id: string, value: number, onValue: (n: number) => void) => ({
    value: text[id] ?? decimalToInput(value),
    onChange: (v: string) => {
      setText({ ...text, [id]: v });
      const n = parseDecimal(v);
      if (n !== null && n >= 0 && n <= 999) onValue(n);
    },
  });
  const toggle = (l: BuiltLine, on: boolean) => {
    const toggles = { ...metre.toggles, [l.key]: on };
    if (on && l.radioGroup) for (const other of built.lines) if (other.radioGroup === l.radioGroup && other.key !== l.key) toggles[other.key] = false;
    setMetre({ ...metre, toggles });
  };

  const groups = [...new Set(built.lines.map((l) => l.group))];
  const lengthFor = (group: string) => {
    const sys = equipment.systems.find((s, si) => (equipment.systems.length > 1 ? `Unité extérieure ${si + 1}` : "Unité extérieure") === group);
    const ind = equipment.systems.flatMap((s) => s.indoors).find((i) => built.lines.some((l) => l.group === group && l.key === `eq:${i.key}`));
    return { sys, ind };
  };

  return (
    <div className="space-y-6">
      <Card title="Métré depuis le plan">
        <p className="text-base text-slate-700">Placez les unités et tracez liaisons, condensats, gaines et alimentation sur le plan : les longueurs sont reportées ici.</p>
        <LinkButton href={`/app/devis/${quoteId}/plan?mode=implantation`} variant="secondary" full>
          📐 Implanter sur le plan
        </LinkButton>
      </Card>
      {built.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}
      {hasGainable && (
        <Card title="Option zonage (gainable)">
          <Check
            label={`Zonage : registres motorisés + thermostat par pièce${zoningCost > 0 ? ` (+ ${formatEuros(zoningCost, { decimals: false })} ${company.vat_regime === "franchise" ? "HT" : "TTC"})` : ""}`}
            hint="Chaque pièce réglée à sa température. Temps de pose ajouté automatiquement."
            checked={metre.toggles["zonage"] ?? false}
            onChange={(v) => setMetre({ ...metre, toggles: { ...metre.toggles, zonage: v } })}
          />
        </Card>
      )}
      {groups
        .filter((g) => g !== "Main d'œuvre et déplacement")
        .map((g) => {
          const { sys, ind } = lengthFor(g);
          const isGainable = ind?.product.type === "ui_gainable";
          return (
            <Card key={g} title={g}>
              {ind && !g.endsWith("zonage") && (
                <Field label="Longueur de liaison frigorifique" {...numberInput(`link-${ind.key}`, linkLength(metre, ind.key), (n) => setMetre({ ...metre, linkM: { ...metre.linkM, [ind.key]: n }, qty: Object.fromEntries(Object.entries(metre.qty).filter(([k]) => !k.endsWith(`:${ind.key}`))) }))} inputMode="decimal" suffix="m" hint="Goulotte, condensats et câble de liaison suivent cette longueur" />
              )}
              {isGainable && ind && !g.endsWith("zonage") && (
                <Field label="Gaine par pièce" {...numberInput(`duct-${ind.key}`, metre.ductMPerRoom[ind.key] ?? DEFAULT_DUCT_M_PER_ROOM, (n) => setMetre({ ...metre, ductMPerRoom: { ...metre.ductMPerRoom, [ind.key]: n } }))} inputMode="decimal" suffix="m" />
              )}
              {sys && (
                <Field label="Ligne électrique (tableau → unité extérieure)" {...numberInput(`elec-${sys.key}`, metre.electricM[sys.key] ?? company.default_electric_length_m, (n) => setMetre({ ...metre, electricM: { ...metre.electricM, [sys.key]: n } }))} inputMode="decimal" suffix="m" />
              )}
              <ul className="divide-y-2 divide-slate-200">
                {built.lines
                  .filter((l) => l.group === g)
                  .map((l) => (
                    <li key={l.key} className={`flex items-start gap-3 py-3 ${l.enabled ? "" : "opacity-60"}`}>
                      {l.optional ? (
                        <input
                          type={l.radioGroup ? "radio" : "checkbox"}
                          name={l.radioGroup}
                          checked={l.enabled}
                          onChange={(e) => toggle(l, e.target.checked)}
                          aria-label={l.designation}
                          className="mt-1 h-7 w-7 shrink-0 accent-brand"
                        />
                      ) : (
                        <span className="mt-1 w-7 shrink-0 text-center text-lg text-ok" aria-hidden>
                          ✓
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold">{l.designation}</p>
                        <p className="text-sm text-slate-600">
                          {formatEuros(l.unitSaleCents)} / {UNIT[l.unit] ?? l.unit}
                        </p>
                      </div>
                      {l.qtyEditable && l.enabled && l.kind !== "material" ? (
                        <label className="w-24 shrink-0 text-right">
                          <span className="sr-only">Quantité</span>
                          <input
                            inputMode="decimal"
                            className="min-h-12 w-full rounded-lg border-2 border-slate-400 px-2 text-right text-lg"
                            {...(() => {
                              const p = numberInput(`qty-${l.key}`, l.quantity, (n) => setMetre({ ...metre, qty: { ...metre.qty, [l.key]: n } }));
                              return { value: p.value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => p.onChange(e.target.value) };
                            })()}
                          />
                          <span className="text-sm text-slate-600">{UNIT[l.unit] ?? l.unit}</span>
                        </label>
                      ) : (
                        <span className="w-24 shrink-0 text-right text-base font-bold">
                          {l.quantity.toLocaleString("fr-FR")} {UNIT[l.unit] ?? l.unit}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </Card>
          );
        })}
      {msg && <Notice tone="danger">{msg}</Notice>}
      <Button
        type="button"
        full
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveWizard(quoteId, { metre });
            setMsg(r.ok ? null : r.message ?? null);
            if (r.ok) {
              router.push(`/app/devis/${quoteId}?etape=6`);
              router.refresh();
            }
          })
        }
      >
        {pending ? "Enregistrement…" : "Suivant : la main d'œuvre"}
      </Button>
      <MarginBar result={result} vatRegime={company.vat_regime} showMargin={showMargin} />
    </div>
  );
}
