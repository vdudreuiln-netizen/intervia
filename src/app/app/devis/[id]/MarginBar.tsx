"use client";

import { formatEuros } from "@/lib/format";
import type { QuoteResult } from "@/lib/pricing/engine";

/** Bandeau « Ma marge » (version compacte, le panneau complet arrive à l'étape suivante). */
export function MarginBar({ result, vatRegime, showMargin = true }: { result: QuoteResult | null; vatRegime: "franchise" | "assujetti"; showMargin?: boolean }) {
  if (!result) return null;
  const alert = showMargin && result.alerts.length > 0;
  const perDay = result.margin.marginPerDayCents;
  return (
    <div className={`sticky bottom-16 z-10 -mx-4 border-t-4 px-4 py-3 ${alert ? "border-danger bg-danger-light" : "border-ok bg-ok-light"}`} role="status" aria-live="polite">
      <div className={`mx-auto grid max-w-3xl gap-2 text-center ${showMargin ? "grid-cols-3" : "grid-cols-1"}`}>
        <div>
          <span className="block text-xs font-bold uppercase text-slate-700">{vatRegime === "franchise" ? "Prix client HT" : "Prix client TTC"}</span>
          <strong className="text-lg">{formatEuros(result.totalTtcCents, { decimals: false })}</strong>
        </div>
        {showMargin && (<>
        <div>
          <span className="block text-xs font-bold uppercase text-slate-700">Ma marge nette</span>
          <strong className={`text-lg ${result.margin.netMarginCents < 0 ? "text-danger" : ""}`}>{formatEuros(result.margin.netMarginCents, { decimals: false })}</strong>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase text-slate-700">Par jour</span>
          <strong className={`text-lg ${alert ? "text-danger" : "text-ok"}`}>{perDay === null ? "—" : formatEuros(perDay, { decimals: false })}</strong>
        </div>
        </>)}
      </div>
      {alert && <p className="mx-auto mt-1 max-w-3xl text-center text-sm font-bold text-danger">⚠ {result.alerts[0]!.message}</p>}
    </div>
  );
}
