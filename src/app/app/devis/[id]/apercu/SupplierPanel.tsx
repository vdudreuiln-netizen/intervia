"use client";

import { useState } from "react";
import { Button, Card, Notice, Select } from "@/components/ui";
import { formatEuros } from "@/lib/format";
import type { QuoteSupplierView } from "@/lib/suppliers/quote";
import { refreshQuoteSuppliers, setLineSupplier, setQuoteSupplier, setShippingRebill } from "../../actions";

type Run = (fn: () => Promise<{ ok: boolean; message?: string }>, success?: string) => void;

const AUTO = "__auto__";

/** Fournisseur retenu par ligne, écarts, « tout chez X », comparatif port compris. Membres autorisés seulement. */
export function SupplierPanel({ quoteId, view, pending, run }: { quoteId: string; view: QuoteSupplierView; pending: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  if (view.lines.length === 0) return null;
  const retained = view.scenarios.find((s) => s.retained) ?? view.scenarios[0]!;
  const best = Math.min(...view.scenarios.map((s) => s.totalCents));
  const names = new Map(view.suppliers.map((s) => [s.id, s]));
  return (
    <Card title="Fournisseurs">
      {view.outdated && (
        <Notice tone="danger">
          Des tarifs ou remises ont changé depuis le calcul de ce devis.{" "}
          <button type="button" className="font-bold underline" disabled={pending} onClick={() => run(() => refreshQuoteSuppliers(quoteId), "Fournisseurs et prix d'achat recalculés ✔")}>
            Recalculer
          </button>
        </Notice>
      )}
      <Select
        label="Choix des fournisseurs"
        value={view.forcedSupplierId ?? AUTO}
        onChange={(v) => run(() => setQuoteSupplier(quoteId, v === AUTO ? null : v), "Choix des fournisseurs mis à jour ✔")}
        options={[
          {
            value: AUTO,
            label: "Automatique : le moins cher au total, port compris",
          },
          ...view.suppliers.map((s) => ({
            value: s.id,
            label: `Tout chez ${s.name}`,
          })),
        ]}
        hint="Le prix client ne change pas : seuls le prix d'achat et la marge changent."
      />

      <ul className="divide-y-2 divide-slate-200">
        {view.orders.map((o) => (
          <li key={o.supplierId} className="py-2 text-base">
            <p className="font-bold">
              {o.name} {names.get(o.supplierId)?.stale && <span className="ml-1 rounded bg-danger-light px-2 text-sm text-danger">tarif de plus de 6 mois</span>}
            </p>
            <p>
              Commande {formatEuros(o.subtotalCents)} HT · port {o.shippingCents ? formatEuros(o.shippingCents) : "offert"}
              {o.francoGapCents !== null && o.shippingCents > 0 && <span className="text-slate-600"> (franco dans {formatEuros(o.francoGapCents)})</span>}
            </p>
          </li>
        ))}
      </ul>

      {(view.shippingCents > 0 || view.shippingRebill) && (
        <label className="flex items-start gap-3 text-base">
          <input
            type="checkbox"
            className="mt-1 h-6 w-6"
            checked={view.shippingRebill}
            disabled={pending}
            onChange={(e) => run(() => setShippingRebill(quoteId, e.target.checked), e.target.checked ? "Ligne « Livraison du matériel » ajoutée ✔" : "Frais de port repassés en coût interne ✔")}
          />
          <span>
            Refacturer les frais de port au client ({formatEuros(view.shippingCents)} HT)
            <span className="block text-sm text-slate-600">Sinon, ils restent un coût interne, déduit de votre marge (« Frais de port »).</span>
          </span>
        </label>
      )}

      <div>
        <p className="text-base font-bold">Comparatif (achat HT + port)</p>
        <ul className="mt-2 space-y-2">
          {view.scenarios.map((s) => (
            <li key={s.key} className={`rounded-xl border-2 p-3 text-base ${s.retained ? "border-brand bg-brand-light" : "border-slate-300"}`}>
              <p className="font-bold">
                {s.label} {s.retained && "· retenu"}
              </p>
              <p>
                {formatEuros(s.totalCents)} <span className="text-slate-600">(dont port {formatEuros(s.shippingCents)})</span>
                {s.totalCents > best && <span className="font-bold text-danger"> +{formatEuros(s.totalCents - best)}</span>}
              </p>
              {s.missing > 0 && <p className="text-sm text-slate-600">{s.missing} article(s) absent(s) chez ce fournisseur : pris au moins cher ailleurs.</p>}
            </li>
          ))}
        </ul>
        {retained.totalCents > best && <p className="mt-2 text-sm text-slate-600">Le choix retenu coûte {formatEuros(retained.totalCents - best)} de plus que le moins cher.</p>}
      </div>

      <Button type="button" variant="secondary" full onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Masquer le détail par ligne" : "Détail par ligne et fournisseur imposé"}
      </Button>
      {open && (
        <ul className="divide-y-2 divide-slate-200">
          {view.lines.map((l) => {
            const current = l.offers.find((o) => o.supplierId === l.retainedId);
            return (
              <li key={l.lineId} className="space-y-2 py-3">
                <p className="font-bold">{l.designation}</p>
                <p className="text-base">
                  Retenu : <strong>{current?.name ?? "—"}</strong> {current && `· ${formatEuros(current.unitNetCents)} HT l'unité`}
                  {l.forced && <span className="ml-1 rounded bg-slate-200 px-2 text-sm">imposé</span>}
                </p>
                {l.offers.length > 1 && (
                  <ul className="text-sm text-slate-700">
                    {l.offers
                      .filter((o) => o.supplierId !== l.retainedId)
                      .map((o) => (
                        <li key={o.supplierId}>
                          {o.name} : {formatEuros(o.unitNetCents)} ({o.gapCents >= 0 ? "+" : ""}
                          {formatEuros(o.gapCents)} sur la ligne)
                        </li>
                      ))}
                  </ul>
                )}
                <Select
                  label="Fournisseur de cette ligne"
                  value={l.forced && l.retainedId ? l.retainedId : AUTO}
                  onChange={(v) => run(() => setLineSupplier(quoteId, l.lineId, v === AUTO ? null : v))}
                  options={[
                    { value: AUTO, label: "Automatique" },
                    ...l.offers.map((o) => ({
                      value: o.supplierId,
                      label: `${o.name} – ${formatEuros(o.unitNetCents)}`,
                    })),
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
