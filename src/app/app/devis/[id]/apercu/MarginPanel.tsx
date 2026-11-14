import { formatEuros, formatPercent } from "@/lib/format";
import type { QuoteResult } from "@/lib/pricing/engine";

/** Panneau « Ma marge » : visible par l'artisan seulement, jamais sur le PDF. */
export function MarginPanel({ result, laborDays, maxDiscount }: { result: QuoteResult; laborDays: number; maxDiscount: { cents: number; rate: number } }) {
  const m = result.margin;
  const alert = result.alerts.length > 0;
  const target = m.targetMarginPerDayCents;
  const perDay = m.marginPerDayCents ?? 0;
  const ratio = target > 0 ? Math.max(0, Math.min(1, perDay / target)) : 1;
  const purchaseMaterial = result.lines.filter((l) => l.kind === "material" || l.kind === "accessory").reduce((a, l) => a + l.totalPurchaseCents, 0);
  const row = (label: string, value: number, opts: { negative?: boolean; strong?: boolean } = {}) => (
    <div className={`flex justify-between gap-3 py-1 ${opts.strong ? "text-lg font-extrabold" : "text-base"}`}>
      <dt>{label}</dt>
      <dd className={`shrink-0 ${opts.strong ? "" : "font-semibold"}`}>
        {opts.negative && value > 0 ? "− " : ""}
        {formatEuros(value)}
      </dd>
    </div>
  );
  const remaining = Math.max(0, maxDiscount.cents - result.discountCents);

  return (
    <section aria-labelledby="ma-marge" className={`rounded-2xl border-4 bg-white p-4 ${alert ? "border-danger" : "border-ok"}`}>
      <h2 id="ma-marge" className="flex items-center justify-between text-xl font-extrabold">
        Ma marge
        <span className="text-sm font-bold text-slate-600">jamais sur le PDF</span>
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-100 p-3">
          <p className="text-sm font-bold text-slate-700">Marge nette</p>
          <p className={`text-2xl font-extrabold ${m.netMarginCents < 0 ? "text-danger" : ""}`}>{formatEuros(m.netMarginCents, { decimals: false })}</p>
          <p className="text-sm text-slate-700">{formatPercent(m.netMarginRate)} du HT</p>
        </div>
        <div className={`rounded-xl p-3 ${alert ? "bg-danger-light" : "bg-ok-light"}`}>
          <p className="text-sm font-bold text-slate-700">Par jour ({laborDays.toLocaleString("fr-FR")} j)</p>
          <p className={`text-2xl font-extrabold ${alert ? "text-danger" : "text-ok"}`}>{m.marginPerDayCents === null ? "—" : formatEuros(m.marginPerDayCents, { decimals: false })}</p>
          {target > 0 && <p className="text-sm text-slate-700">objectif {formatEuros(target, { decimals: false })}</p>}
        </div>
      </div>
      {target > 0 && (
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-200" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={perDay} aria-label="Marge par jour par rapport à l'objectif">
          <div className={`h-full ${ratio >= 1 ? "bg-ok" : "bg-danger"}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
      <dl className="mt-4 divide-y divide-slate-200">
        {row("Coût d'achat du matériel", purchaseMaterial)}
        {row("Vente matériel et accessoires", m.materialSaleCents)}
        {row("Vente main d'œuvre", m.laborSaleCents)}
        {m.otherSaleCents > 0 && row("Autres prestations", m.otherSaleCents)}
        {row("Frais de déplacement", m.travelSaleCents)}
        {m.discountCents > 0 && row("Remise commerciale", m.discountCents, { negative: true })}
        {row("Charges sur la main d'œuvre", m.laborChargesCents, { negative: true })}
        {row("Charges sur le matériel", m.materialChargesCents, { negative: true })}
        {m.purchaseCostCents > purchaseMaterial && row("Autres coûts", m.purchaseCostCents - purchaseMaterial, { negative: true })}
        {row("Marge nette", m.netMarginCents, { strong: true })}
      </dl>
      <p className="mt-3 rounded-xl bg-brand-light p-3 text-base text-brand-dark">
        {maxDiscount.cents === 0 ? (
          <>Aucune remise possible sans passer en alerte.</>
        ) : remaining > 0 ? (
          <>
            Remise encore possible avant alerte : <strong>{formatEuros(remaining, { decimals: false })} HT</strong> (maximum total {formatEuros(maxDiscount.cents, { decimals: false })}, soit {formatPercent(maxDiscount.rate)}).
          </>
        ) : (
          <>Remise maximale atteinte ({formatEuros(maxDiscount.cents, { decimals: false })} HT).</>
        )}
      </p>
    </section>
  );
}
