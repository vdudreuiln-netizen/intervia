"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Choice, Field, LinkButton, MoneyField, Notice, Select } from "@/components/ui";
import { centsToInput, decimalToInput, formatEuros, formatPercent, parseDecimal, parseEuros, parsePercent } from "@/lib/format";
import { computeQuote, maxDiscount, type PricingSettings, type QuoteAlert, type QuoteDiscount, type PricedLine } from "@/lib/pricing/engine";
import type { FreeLineForm } from "@/lib/quote/edits";
import type { QuoteLineRow } from "@/lib/quote/load";
import { addFreeLine, deleteLine, dismissPriceNotices, roundQuote, setDiscount, setQuoteCoefficients, updateLine, type DocumentOptions } from "../../actions";
import type { WizardState } from "@/lib/quote/types";
import { DocumentPanel, SharePanel } from "./DocumentPanel";
import { MarginPanel } from "./MarginPanel";
import { MarginBar } from "../MarginBar";
import { SupplierPanel } from "./SupplierPanel";
import { OrdersPanel } from "./OrdersPanel";
import type { QuoteSupplierView } from "@/lib/suppliers/quote";
import type { PurchaseOrderSummary } from "../../actions";

interface Props {
  quoteId: string;
  rows: QuoteLineRow[];
  laborDays: number;
  discount: QuoteDiscount | null;
  settings: PricingSettings;
  coefficients: { material: number | null; accessory: number | null; companyAccessory: number };
  number: string;
  status: "brouillon" | "envoye" | "accepte" | "refuse";
  warnings: string[];
  documentOptions: DocumentOptions;
  companyDepositRate: number;
  priceNotices?: WizardState["priceNotices"];
  showMargin: boolean;
  /** Technicien sans accès aux marges : alertes et lignes sous le coût calculées par le serveur. */
  serverAlerts?: QuoteAlert[] | null;
  belowCostIds?: string[] | null;
  /** Frais de port non refacturés (déduits de la marge). */
  shippingCostCents?: number;
  /** Fournisseurs et bons de commande : membres autorisés seulement. */
  supplierView?: QuoteSupplierView | null;
  purchaseOrders?: PurchaseOrderSummary[] | null;
  hasSiteAddress?: boolean;
  datasheets?: { productId: string; name: string }[];
  hasAnnexes?: boolean;
}

const VAT_OPTIONS = [
  { value: "0.055", label: "TVA 5,5 %" },
  { value: "0.1", label: "TVA 10 %" },
  { value: "0.2", label: "TVA 20 %" },
];

export function QuoteEditor({
  quoteId,
  rows,
  laborDays,
  discount,
  settings,
  coefficients,
  number,
  status,
  warnings,
  documentOptions,
  companyDepositRate,
  priceNotices,
  showMargin,
  serverAlerts,
  belowCostIds,
  shippingCostCents = 0,
  supplierView,
  purchaseOrders,
  hasSiteAddress = false,
  datasheets = [],
  hasAnnexes = false,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const input = {
    lines: rows,
    laborDays,
    discount,
    settings,
    shippingCostCents: showMargin ? shippingCostCents : 0,
  };
  const result = useMemo(() => computeQuote(input), [rows, laborDays, discount, settings, shippingCostCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = useMemo(() => (showMargin ? maxDiscount(input) : null), [rows, laborDays, settings, showMargin, shippingCostCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = serverAlerts ?? result.alerts;
  const belowCost = new Set(belowCostIds ?? result.lines.filter((l) => l.belowCost).map((l) => l.id));
  const assujetti = settings.vatRegime === "assujetti";

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success?: string) =>
    start(async () => {
      const r = await fn();
      setFlash(r.ok ? (success || r.message ? { ok: true, text: r.message ?? success! } : null) : { ok: false, text: r.message ?? "Erreur." });
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-6">
      {priceNotices && priceNotices.items.length > 0 && (
        <Card title={`Copie de ${priceNotices.sourceNumber} : prix à vérifier`}>
          <p className="text-base text-slate-700">Les prix ont été recalculés avec votre catalogue actuel. Vos retouches manuelles sont conservées.</p>
          <ul className="space-y-2 text-base">
            {priceNotices.items.map((n, i) => (
              <li key={i} className={n.kind === "override_kept" ? "font-semibold text-danger" : ""}>
                {n.kind === "updated" ? (
                  <>
                    {n.designation} : {formatEuros(n.fromCents ?? 0)} → <strong>{formatEuros(n.toCents ?? 0)}</strong>
                  </>
                ) : (
                  <>
                    ⚠ {n.designation} : le prix d&apos;achat a changé depuis le devis d&apos;origine ; votre prix retouché de {formatEuros(n.keptSaleCents ?? 0)} est conservé : vérifiez la marge de cette ligne.
                  </>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" full disabled={pending} onClick={() => run(() => dismissPriceNotices(quoteId))}>
            J&apos;ai vérifié
          </Button>
        </Card>
      )}
      {alerts.map((a) => (
        <Notice key={a.message} tone="danger">
          ⚠ {a.message}
        </Notice>
      ))}
      {showMargin && max && <MarginPanel result={result} laborDays={laborDays} maxDiscount={max} />}
      {showMargin && supplierView && <SupplierPanel quoteId={quoteId} view={supplierView} pending={pending} run={run} />}
      {flash && <Notice tone={flash.ok ? "ok" : "danger"}>{flash.text}</Notice>}

      <Card title="Lignes du devis">
        <ul className="divide-y-2 divide-slate-200">
          {result.lines.map((l) => (
            <LineItem key={l.id} line={{ ...l, belowCost: belowCost.has(l.id) }} row={rows.find((r) => r.id === l.id)!} assujetti={assujetti} pending={pending} run={run} quoteId={quoteId} showMargin={showMargin} />
          ))}
        </ul>
        <Totals result={result} />
      </Card>

      <Rounding pending={pending} onRound={() => run(() => roundQuote(quoteId))} />
      <DiscountForm discount={discount} max={max} grossHt={result.grossHtCents} pending={pending} onApply={(d) => run(() => setDiscount(quoteId, d), d ? "Remise appliquée ✔" : "Remise retirée ✔")} />
      <FreeLineFormCard assujetti={assujetti} pending={pending} onAdd={(f) => addFreeLine(quoteId, f)} onDone={() => router.refresh()} />
      {showMargin && <CoefficientsForm coefficients={coefficients} pending={pending} onApply={(m, a) => run(() => setQuoteCoefficients(quoteId, m, a), "Prix recalculés avec les coefficients du devis ✔ (vos retouches sont conservées)")} />}

      <DocumentPanel quoteId={quoteId} options={documentOptions} companyDepositRate={companyDepositRate} />
      <SharePanel quoteId={quoteId} number={number} status={status} warnings={warnings} datasheets={datasheets} hasAnnexes={hasAnnexes} />
      {showMargin && status === "accepte" && purchaseOrders && <OrdersPanel quoteId={quoteId} orders={purchaseOrders} hasSiteAddress={hasSiteAddress} />}

      <LinkButton href={`/app/devis/${quoteId}?etape=4`} variant="secondary" full>
        Relancer l&apos;assistant (solutions, métré…)
      </LinkButton>
      <MarginBar result={result} vatRegime={settings.vatRegime} showMargin={showMargin} />
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message?: string }>, success?: string) => void;

function LineItem({ line: l, row, assujetti, pending, run, quoteId, showMargin }: { line: PricedLine; row: QuoteLineRow; assujetti: boolean; pending: boolean; run: Run; quoteId: string; showMargin: boolean }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(centsToInput(l.unitSaleCents));
  const [vat, setVat] = useState(String(l.vatRate));
  const cents = parseEuros(price);
  return (
    <li className={`py-3 ${l.belowCost ? "-mx-2 rounded-lg bg-danger-light px-2" : ""}`}>
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-base font-semibold ${l.belowCost ? "text-danger" : ""}`}>
            {l.designation}
            {row.origin === "manual" && <span className="ml-2 rounded bg-amber-200 px-1.5 text-xs font-bold text-amber-900">ajoutée</span>}
          </p>
          <p className="text-sm text-slate-600">
            {l.quantity.toLocaleString("fr-FR")} {l.unit} × {formatEuros(l.unitSaleCents)}
            {assujetti && ` · TVA ${formatPercent(l.vatRate)}`}
            {showMargin && ` · achat ${formatEuros(l.unitPurchaseCents)}`}
          </p>
          {l.belowCost && <p className="text-sm font-bold text-danger">⚠ Sous le coût de revient</p>}
        </div>
        <p className="shrink-0 text-base font-bold">{formatEuros(l.totalSaleCents)}</p>
      </div>
      {editing ? (
        <div className="mt-3 space-y-3 rounded-xl bg-slate-100 p-3">
          <MoneyField label="Prix de vente unitaire HT" value={price} onChange={setPrice} error={cents === null ? "Prix invalide" : undefined} />
          {assujetti && <Select label="TVA de la ligne" value={vat} onChange={setVat} options={VAT_OPTIONS} />}
          <div className="flex gap-3">
            <Button type="button" disabled={pending || cents === null} onClick={() => run(() => updateLine(quoteId, l.id, { unitSaleCents: cents!, vatRate: Number(vat) }), "Ligne modifiée ✔")}>
              Enregistrer
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button type="button" className="min-h-12 rounded-xl border-2 border-brand px-4 text-base font-bold text-brand" onClick={() => setEditing(true)}>
            Modifier le prix
          </button>
          <button
            type="button"
            disabled={pending}
            className="min-h-12 rounded-xl border-2 border-slate-400 px-4 text-base font-bold text-slate-700"
            onClick={() => confirm(`Supprimer « ${l.designation} » ?`) && run(() => deleteLine(quoteId, l.id), "Ligne supprimée ✔")}
          >
            Supprimer
          </button>
        </div>
      )}
    </li>
  );
}

function Totals({ result }: { result: ReturnType<typeof computeQuote> }) {
  return (
    <dl className="space-y-1 border-t-4 border-slate-300 pt-3 text-lg">
      {result.discountCents > 0 && (
        <>
          <div className="flex justify-between">
            <dt>Total HT avant remise</dt>
            <dd>{formatEuros(result.grossHtCents)}</dd>
          </div>
          <div className="flex justify-between font-bold text-ok">
            <dt>Remise commerciale</dt>
            <dd>− {formatEuros(result.discountCents)}</dd>
          </div>
        </>
      )}
      <div className="flex justify-between">
        <dt>Total HT</dt>
        <dd className="font-bold">{formatEuros(result.totalHtCents)}</dd>
      </div>
      {result.vat.map((v) => (
        <div key={v.rate} className="flex justify-between text-base">
          <dt>TVA {formatPercent(v.rate)}</dt>
          <dd>{formatEuros(v.vatCents)}</dd>
        </div>
      ))}
      {result.vatMention ? (
        <p className="text-base italic">{result.vatMention}</p>
      ) : (
        <div className="flex justify-between text-xl">
          <dt className="font-bold">Total TTC</dt>
          <dd className="font-extrabold">{formatEuros(result.totalTtcCents)}</dd>
        </div>
      )}
    </dl>
  );
}

function Rounding({ pending, onRound }: { pending: boolean; onRound: () => void }) {
  return (
    <Card title="Prix psychologique">
      <p className="text-base text-slate-700">Ex. 3 512 € → 3 490 €. Jamais sous le coût ni sous votre objectif de marge : sinon, arrondi au seuil supérieur (3 590 €).</p>
      <Button type="button" full disabled={pending} onClick={onRound}>
        Arrondir aux seuils psychologiques
      </Button>
    </Card>
  );
}

function DiscountForm({ discount, max, grossHt, pending, onApply }: { discount: QuoteDiscount | null; max: { cents: number; rate: number } | null; grossHt: number; pending: boolean; onApply: (d: QuoteDiscount | null) => void }) {
  const [kind, setKind] = useState<QuoteDiscount["kind"]>(discount?.kind ?? "amount");
  const [value, setValue] = useState(discount ? (discount.kind === "amount" ? centsToInput(discount.value) : decimalToInput(Math.round(discount.value * 10000) / 100)) : "");
  const parsed = kind === "amount" ? parseEuros(value) : parsePercent(value);
  const asCents = parsed === null ? null : kind === "amount" ? parsed : Math.round(grossHt * parsed);
  const over = max !== null && asCents !== null && asCents > max.cents;
  return (
    <Card title="Remise commerciale">
      <p className="text-base text-slate-700">Affichée au client sur le PDF, sur une ligne « Remise commerciale ».</p>
      <Choice
        label="Type de remise"
        value={kind}
        onChange={setKind}
        options={[
          { value: "amount", label: "Montant en € HT" },
          { value: "percent", label: "Pourcentage du total HT" },
        ]}
      />
      <Field label={kind === "amount" ? "Remise" : "Remise"} value={value} onChange={setValue} inputMode="decimal" suffix={kind === "amount" ? "€" : "%"} error={value && parsed === null ? "Valeur invalide" : undefined} />
      {over && max && <Notice tone="danger">Au-delà de la remise maximale ({formatEuros(max.cents, { decimals: false })} HT, {formatPercent(max.rate)}) : le devis passera en alerte.</Notice>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" full disabled={pending || parsed === null || parsed <= 0} onClick={() => onApply({ kind, value: parsed! })}>
          Appliquer la remise
        </Button>
        {discount && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => onApply(null)}>
            Retirer
          </Button>
        )}
      </div>
    </Card>
  );
}

const EMPTY_FREE: FreeLineForm = { designation: "", kind: "other", quantity: "1", unit: "u", purchase: "", sale: "", vatRate: "10" };

function FreeLineFormCard({ assujetti, pending, onAdd, onDone }: { assujetti: boolean; pending: boolean; onAdd: (f: FreeLineForm) => Promise<{ ok: boolean; errors?: Partial<Record<keyof FreeLineForm, string>>; message?: string }>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY_FREE);
  const [errors, setErrors] = useState<Partial<Record<keyof FreeLineForm, string>>>({});
  const [busy, start] = useTransition();
  const set = (k: keyof FreeLineForm) => (v: string) => setF({ ...f, [k]: v });
  if (!open)
    return (
      <Button type="button" variant="secondary" full onClick={() => setOpen(true)}>
        + Ajouter une ligne libre
      </Button>
    );
  return (
    <Card title="Ligne libre">
      <Field label="Désignation" value={f.designation} onChange={set("designation")} error={errors.designation} placeholder="Carottage mur béton Ø 60…" />
      <Choice
        label="Type"
        value={f.kind}
        onChange={(v) => setF({ ...f, kind: v })}
        options={[
          { value: "other", label: "Prestation", hint: "Charges de la main d'œuvre" },
          { value: "material", label: "Fourniture", hint: "Charges du matériel" },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantité" value={f.quantity} onChange={set("quantity")} error={errors.quantity} inputMode="decimal" />
        <Field label="Unité" value={f.unit} onChange={set("unit")} placeholder="u, m, forfait…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="Prix d'achat HT" value={f.purchase} onChange={set("purchase")} error={errors.purchase} hint="0 si aucun coût" />
        <MoneyField label="Prix de vente HT" value={f.sale} onChange={set("sale")} error={errors.sale} />
      </div>
      {assujetti && <Select label="TVA" value={String(parsePercent(f.vatRate) ?? 0.1)} onChange={(v) => setF({ ...f, vatRate: decimalToInput(Number(v) * 100) })} options={VAT_OPTIONS} />}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          full
          disabled={busy || pending}
          onClick={() =>
            start(async () => {
              const r = await onAdd(f);
              setErrors(r.errors ?? {});
              if (r.ok) {
                setF(EMPTY_FREE);
                setOpen(false);
                onDone();
              }
            })
          }
        >
          Ajouter au devis
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </Card>
  );
}

function CoefficientsForm({ coefficients, pending, onApply }: { coefficients: Props["coefficients"]; pending: boolean; onApply: (m: number | null, a: number | null) => void }) {
  const [m, setM] = useState(decimalToInput(coefficients.material));
  const [a, setA] = useState(decimalToInput(coefficients.accessory));
  const pm = m.trim() === "" ? null : parseDecimal(m);
  const pa = a.trim() === "" ? null : parseDecimal(a);
  const bad = (v: number | null, s: string) => s.trim() !== "" && (v === null || v <= 0 || v > 5);
  return (
    <Card title="Coefficients de vente de ce devis">
      <p className="text-base text-slate-700">Vide = coefficients des marques et des paramètres. S&apos;appliquent au prix public.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Matériel" value={m} onChange={setM} inputMode="decimal" suffix="×" placeholder="marques" error={bad(pm, m) ? "0,01 à 5" : undefined} />
        <Field label="Accessoires" value={a} onChange={setA} inputMode="decimal" suffix="×" placeholder={decimalToInput(coefficients.companyAccessory)} error={bad(pa, a) ? "0,01 à 5" : undefined} />
      </div>
      <Button type="button" full disabled={pending || bad(pm, m) || bad(pa, a)} onClick={() => onApply(pm, pa)}>
        Recalculer les prix
      </Button>
    </Card>
  );
}
