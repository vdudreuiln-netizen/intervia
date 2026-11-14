"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decimalToInput, formatEuros, parseDecimal } from "@/lib/format";
import { computeQuote } from "@/lib/pricing/engine";
import type { Coefficients } from "@/lib/sizing/coefficients";
import { calcContext, type CompanyPricing, type SiteInfo } from "@/lib/quote/context";
import { buildLines, enabledLines, linkLength, proposeDays } from "@/lib/quote/lines";
import { EMPTY_METRE, type CatAccessory, type Equipment, type RoomNeed, type WizardState } from "@/lib/quote/types";
import { finalizeQuote, saveWizard } from "../../actions";
import { MarginBar } from "../MarginBar";

interface Props {
  quoteId: string;
  company: CompanyPricing;
  site: SiteInfo;
  coefs: Coefficients;
  rooms: RoomNeed[];
  equipment: Equipment;
  accessories: CatAccessory[];
  wizard: WizardState;
  /** Le devis contient des retouches faites dans l'éditeur. */
  hasEdits?: boolean;
}

const j = (n: number) => `${n.toLocaleString("fr-FR")} j`;

export function LaborStep({ quoteId, company, site, coefs, rooms, equipment, accessories, wizard, hasEdits = false }: Props) {
  const router = useRouter();
  const metre = wizard.metre ?? EMPTY_METRE;
  const proposed = proposeDays(equipment, metre, coefs.laborDays);
  const [daysText, setDaysText] = useState(wizard.laborDays != null ? decimalToInput(wizard.laborDays) : "");
  const forced = parseDecimal(daysText);
  const days = forced !== null && forced > 0 && forced <= 60 ? forced : proposed;
  const ctx = useMemo(() => calcContext(company, site, coefs, wizard), [company, site, coefs, wizard]);
  const travel = ctx.travelFor(days);
  const result = useMemo(() => {
    const built = buildLines(equipment, rooms, metre, accessories, ctx.lineSettings, days, travel);
    return computeQuote({ lines: enabledLines(built.lines), laborDays: days, settings: ctx.pricing });
  }, [equipment, rooms, metre, accessories, ctx, days, travel]);
  const [msg, setMsg] = useState<string | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [pending, start] = useTransition();
  const create = (mode: "keep" | "recalc") =>
    start(async () => {
      const s = await saveWizard(quoteId, { laborDays: daysText.trim() === "" ? null : days });
      if (!s.ok) return setMsg(s.message ?? null);
      const r = await finalizeQuote(quoteId, mode);
      setMsg(r.ok ? null : r.message ?? null);
      if (r.ok) router.push(`/app/devis/${quoteId}/apercu`);
    });

  const p = coefs.laborDays;
  const indoors = equipment.systems.flatMap((s) => s.indoors);
  const links = indoors.reduce((a, i) => a + linkLength(metre, i.key), 0);
  const extraM = Math.max(0, links - indoors.length * p.includedLinkMetersPerIndoor);
  const typeOf = (t: string) => ({ ui_murale: "mural", ui_console: "console", ui_cassette: "cassette", ui_gainable: "gainable" })[t] as keyof typeof p.perIndoorUnit;
  const detail = [
    `${equipment.systems.length} unité(s) extérieure(s) × ${j(p.perOutdoorUnit)}`,
    ...indoors.map((i) => `${i.product.reference} × ${j(p.perIndoorUnit[typeOf(i.product.type)] ?? 0.5)}`),
    extraM > 0 ? `${extraM.toLocaleString("fr-FR")} m de liaison au-delà des ${indoors.length * p.includedLinkMetersPerIndoor} m inclus × ${j(p.perExtraLinkMeter)}` : null,
    metre.toggles["zonage"] ? `Zonage : ${indoors.filter((i) => i.product.type === "ui_gainable").reduce((a, i) => a + i.roomIds.length, 0)} pièce(s) × ${j(p.zoningPerRoom)}` : null,
    `Mise en service × ${j(p.commissioning)}`,
    `Arrondi au ${j(p.roundTo)} supérieur`,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <Card title="Jours de chantier">
        <p className="text-4xl font-extrabold text-brand">{j(days)}</p>
        <details className="rounded-xl bg-slate-100 p-3 text-base">
          <summary className="cursor-pointer font-bold">Proposition : {j(proposed)} — détail</summary>
          <ul className="mt-2 list-disc pl-5">
            {detail.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
        <Field label="Nombre de jours (si différent)" value={daysText} onChange={setDaysText} inputMode="decimal" suffix="j" placeholder={decimalToInput(proposed)} hint={`Prix de la journée : ${formatEuros(company.daily_labor_rate_cents)} HT`} />
        {daysText && (
          <button type="button" className="text-lg font-bold text-brand underline" onClick={() => setDaysText("")}>
            Revenir à la proposition ({j(proposed)})
          </button>
        )}
      </Card>
      <Card title="Déplacement">
        {travel?.applies ? (
          <p className="text-lg">
            <strong>{formatEuros(travel.totalCents)}</strong> — {travel.designation.toLowerCase()} : {travel.detail}
          </p>
        ) : (
          <p className="text-lg">{site.same_commune ? "Chantier dans votre commune : pas de frais de déplacement." : "Pas de frais de déplacement."}</p>
        )}
      </Card>
      {msg && <Notice tone="danger">{msg}</Notice>}
      {askMode ? (
        <Card title="Vous avez retouché ce devis">
          <p className="text-base">Prix modifiés, lignes supprimées ou ajoutées à la main : que faire en relançant l&apos;assistant ?</p>
          <Button type="button" full disabled={pending} onClick={() => create("keep")}>
            {pending ? "Mise à jour…" : "Conserver mes retouches (recommandé)"}
          </Button>
          <Button type="button" variant="secondary" full disabled={pending} onClick={() => confirm("Toutes vos retouches et lignes ajoutées à la main seront effacées. Continuer ?") && create("recalc")}>
            Tout recalculer
          </Button>
        </Card>
      ) : (
        <Button type="button" full disabled={pending} onClick={() => (hasEdits ? setAskMode(true) : create("keep"))}>
          {pending ? "Création du devis…" : "Créer le devis"}
        </Button>
      )}
      <MarginBar result={result} vatRegime={company.vat_regime} />
    </div>
  );
}
