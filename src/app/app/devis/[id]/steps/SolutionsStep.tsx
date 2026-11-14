"use client";

import { useMemo, useState, useTransition } from "react";
import type { ConfigKind } from "@/lib/quote/types";
import { useRouter } from "next/navigation";
import { Button, Card, Notice, Select } from "@/components/ui";
import { formatEuros } from "@/lib/format";
import { PRODUCT_TYPE_LABELS } from "@/lib/catalog/import";
import { checkMultiSplit } from "@/lib/sizing/sizing";
import type { Coefficients } from "@/lib/sizing/coefficients";
import { calcContext, proposalInput, type CompanyPricing, type SiteInfo } from "@/lib/quote/context";
import { fromSelection, toSelection } from "@/lib/quote/equipment";
import { priceEquipment, proposeConfigurations, type PricedOption } from "@/lib/quote/options";
import { CONFIG_LABELS, OPTION_HINTS, OPTION_LABELS, type CatAccessory, type CatProduct, type Equipment, type RoomNeed, type WizardState } from "@/lib/quote/types";
import { saveWizard } from "../../actions";
import { MarginBar } from "../MarginBar";

interface Props {
  quoteId: string;
  company: CompanyPricing;
  site: SiteInfo;
  coefs: Coefficients;
  rooms: RoomNeed[];
  products: CatProduct[];
  accessories: CatAccessory[];
  wizard: WizardState;
}

const kw = (n: number | null) => (n ? `${n.toLocaleString("fr-FR")} kW` : "");
const sameEquipment = (a: Equipment | null, b: Equipment) => !!a && JSON.stringify(toSelection(a)) === JSON.stringify(toSelection(b));

export function SolutionsStep({ quoteId, company, site, coefs, rooms, products, accessories, wizard }: Props) {
  const router = useRouter();
  const ctx = useMemo(() => calcContext(company, site, coefs, wizard), [company, site, coefs, wizard]);
  const input = useMemo(() => proposalInput(ctx, company, coefs, rooms, products, accessories), [ctx, company, coefs, rooms, products, accessories]);
  const proposals = useMemo(() => proposeConfigurations(input), [input]);
  const [selected, setSelected] = useState<Equipment | null>(() => (wizard.selection ? fromSelection(wizard.selection, products) : null));
  const priced = useMemo(() => (selected ? priceEquipment(selected, input) : null), [selected, input]);
  const [msg, setMsg] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState<Partial<Record<ConfigKind, boolean>>>({});
  const [pending, start] = useTransition();
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-8">
      {proposals.map((p) => (
        <section key={p.kind} aria-labelledby={`cfg-${p.kind}`}>
          <h2 id={`cfg-${p.kind}`} className="mb-3 text-2xl font-extrabold">
            {CONFIG_LABELS[p.kind]}
          </h2>
          {p.unavailable ? (
            <p className="rounded-xl border-2 border-dashed border-slate-400 p-4 text-base text-slate-700">Non proposé : {p.unavailable}.</p>
          ) : (
            <>
              <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0">
                {p.options.map((o) => (
                  <OptionCard key={o.equipment.brandId} option={o} selected={sameEquipment(selected, o.equipment)} vatRegime={company.vat_regime} roomName={roomName} onChoose={() => setSelected(structuredClone(o.equipment))} />
                ))}
              </div>
              {p.premiumNote && <p className="mt-2 text-sm text-slate-600">{p.premiumNote}</p>}
              {p.excluded.length > 0 && (
                <p className="mt-2 text-sm text-slate-600">
                  {p.excluded.length} option(s) écartée(s) car sous l&apos;objectif.{" "}
                  <button type="button" className="font-bold text-brand underline" onClick={() => setShowExcluded({ ...showExcluded, [p.kind]: !showExcluded[p.kind] })}>
                    {showExcluded[p.kind] ? "Masquer" : "Voir"}
                  </button>
                </p>
              )}
              {showExcluded[p.kind] && (
                <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0">
                  {p.excluded.map((o) => (
                    <OptionCard key={o.equipment.brandId} option={o} selected={sameEquipment(selected, o.equipment)} vatRegime={company.vat_regime} roomName={roomName} onChoose={() => setSelected(structuredClone(o.equipment))} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      ))}

      {selected && priced && (
        <EquipmentEditor equipment={selected} products={products} roomName={roomName} warnings={priced.warnings} onChange={setSelected} />
      )}

      {msg && <Notice tone="danger">{msg}</Notice>}
      <Button
        type="button"
        full
        disabled={!selected || pending}
        onClick={() =>
          start(async () => {
            const changed = !wizard.selection || JSON.stringify(wizard.selection) !== JSON.stringify(toSelection(selected!));
            const r = await saveWizard(quoteId, changed ? { selection: toSelection(selected!), metre: undefined, laborDays: null } : {});
            setMsg(r.ok ? null : r.message ?? null);
            if (r.ok) {
              router.push(`/app/devis/${quoteId}?etape=5`);
              router.refresh();
            }
          })
        }
      >
        {pending ? "Enregistrement…" : selected ? "Suivant : le métré" : "Choisissez une solution"}
      </Button>
      <MarginBar result={priced?.result ?? null} vatRegime={company.vat_regime} />
    </div>
  );
}

function OptionCard({ option: o, selected, vatRegime, roomName, onChoose }: { option: PricedOption; selected: boolean; vatRegime: "franchise" | "assujetti"; roomName: Map<string, string>; onChoose: () => void }) {
  const alert = o.result.alerts.length > 0;
  const twoUnits = o.warnings.find((w) => w.startsWith("2 "));
  return (
    <article className={`flex w-[85%] shrink-0 snap-center flex-col rounded-2xl border-4 bg-white p-4 sm:w-auto ${selected ? "border-brand" : "border-slate-300"}`}>
      <div className="flex flex-wrap gap-1">
        {o.tags.length === 0 && <span className="rounded-full bg-slate-300 px-3 py-1 text-sm font-bold text-slate-800">Écartée</span>}
        {o.tags.map((t) => (
          <span key={t} className="rounded-full bg-brand px-3 py-1 text-sm font-bold text-white" title={OPTION_HINTS[t]}>
            {OPTION_LABELS[t]}
          </span>
        ))}
      </div>
      <p className="mt-1 text-sm text-slate-600">{o.tags.map((t) => OPTION_HINTS[t]).join(" · ")}</p>
      <h3 className="mt-2 text-xl font-extrabold">{o.equipment.brandName}</h3>
      {twoUnits && <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-base font-bold text-amber-900">⚠ {twoUnits}</p>}
      <ul className="mt-2 space-y-2 text-base">
        {o.equipment.systems.map((s) => (
          <li key={s.key}>
            <strong>
              {s.outdoor.reference} {kw(s.outdoor.coolingKw)}
            </strong>
            <ul className="ml-4 list-disc text-slate-700">
              {s.indoors.map((i) => (
                <li key={i.key}>
                  {PRODUCT_TYPE_LABELS[i.product.type].replace("Unité intérieure ", "")} {kw(i.product.coolingKw)} – {i.roomIds.map((id) => roomName.get(id)).join(", ")}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <dl className="mt-auto grid grid-cols-2 gap-2 pt-4 text-sm">
        <div className="col-span-2">
          <dt className="text-slate-600">{vatRegime === "franchise" ? "Prix client HT" : "Prix client TTC"}</dt>
          <dd className="text-2xl font-extrabold">{formatEuros(o.result.totalTtcCents, { decimals: false })}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Ma marge nette</dt>
          <dd className="text-lg font-bold">{formatEuros(o.result.margin.netMarginCents, { decimals: false })}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Par jour ({o.laborDays.toLocaleString("fr-FR")} j)</dt>
          <dd className={`text-lg font-bold ${alert ? "text-danger" : "text-ok"}`}>{o.result.margin.marginPerDayCents === null ? "—" : formatEuros(o.result.margin.marginPerDayCents, { decimals: false })}</dd>
        </div>
      </dl>
      {alert && <p className="mt-2 rounded-lg bg-danger-light px-3 py-2 text-sm font-bold text-danger">⚠ {o.result.alerts[0]!.message}</p>}
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={selected}
        className={`mt-4 min-h-14 rounded-xl text-lg font-bold ${selected ? "bg-brand text-white" : "border-2 border-brand bg-white text-brand"}`}
      >
        {selected ? "✓ Choisie" : "Choisir"}
      </button>
    </article>
  );
}

/** Modifier chaque appareil de la solution choisie, sans changer de marque. */
function EquipmentEditor({ equipment, products, roomName, warnings, onChange }: { equipment: Equipment; products: CatProduct[]; roomName: Map<string, string>; warnings: string[]; onChange: (e: Equipment) => void }) {
  const brandProducts = products.filter((p) => p.brandId === equipment.brandId);
  const options = (type: CatProduct["type"]) =>
    brandProducts
      .filter((p) => p.type === type)
      .sort((a, b) => (a.coolingKw ?? 0) - (b.coolingKw ?? 0))
      .map((p) => ({ value: p.id, label: `${p.reference} ${kw(p.coolingKw)}` }));
  const replace = (sysKey: string, unitKey: string | null, productId: string) => {
    const p = brandProducts.find((x) => x.id === productId);
    if (!p) return;
    const next = structuredClone(equipment);
    const sys = next.systems.find((s) => s.key === sysKey)!;
    if (unitKey === null) sys.outdoor = p;
    else sys.indoors.find((i) => i.key === unitKey)!.product = p;
    onChange(next);
  };
  const problems = equipment.systems.flatMap((s) =>
    s.outdoor.type === "ue_multi" && s.outdoor.coolingKw && s.outdoor.maxOutlets
      ? checkMultiSplit({ coolingKw: s.outdoor.coolingKw, maxOutlets: s.outdoor.maxOutlets, maxIndoorRatio: s.outdoor.maxIndoorRatio }, s.indoors.map((i) => i.product.coolingKw ?? 0)).problems
      : [],
  );

  return (
    <Card title={`Solution choisie : ${equipment.brandName}`}>
      <p className="text-base text-slate-700">Vous pouvez changer chaque appareil (même marque). Les prix et la marge se recalculent.</p>
      {equipment.systems.map((s, si) => (
        <div key={s.key} className="space-y-3 rounded-xl border-2 border-slate-200 p-3">
          <Select label={`Unité extérieure${equipment.systems.length > 1 ? ` ${si + 1}` : ""}`} value={s.outdoor.id} onChange={(v) => replace(s.key, null, v)} options={options(s.outdoor.type)} />
          {s.indoors.map((i) => (
            <Select key={i.key} label={i.roomIds.map((id) => roomName.get(id)).join(", ")} value={i.product.id} onChange={(v) => replace(s.key, i.key, v)} options={options(i.product.type)} />
          ))}
        </div>
      ))}
      {[...problems, ...warnings.filter((w) => !w.startsWith("2 "))].map((w) => (
        <Notice key={w} tone={problems.includes(w) ? "danger" : "info"}>
          {w}
        </Notice>
      ))}
    </Card>
  );
}
