import { Card } from "@/components/ui";
import { formatEuros, formatPercent } from "@/lib/format";

export type { OfferView } from "@/lib/suppliers/views";
import type { OfferView } from "@/lib/suppliers/views";

/** Tarifs de l'article chez chaque fournisseur, du moins cher au plus cher. */
export function SupplierOffers({ offers }: { offers: OfferView[] }) {
  if (offers.length === 0) return null;
  const best = offers.find((o) => !o.probable && o.netCents !== null);
  return (
    <Card title="Prix chez vos fournisseurs">
      <ul className="divide-y-2 divide-slate-200">
        {offers.map((o) => (
          <li key={o.supplierId} className={`py-2 text-base ${o.probable ? "opacity-70" : ""}`}>
            <p className="font-bold">
              {o.supplierName}
              {best && o.supplierId === best.supplierId && <span className="ml-2 rounded bg-ok-light px-2 text-sm text-ok">le moins cher</span>}
              {o.isReference && <span className="ml-2 rounded bg-brand-light px-2 text-sm text-brand-dark">prix public de référence</span>}
              {o.probable && <span className="ml-2 rounded bg-slate-200 px-2 text-sm">correspondance à confirmer</span>}
            </p>
            <p>
              Public {o.publicPriceCents !== null ? formatEuros(o.publicPriceCents) : "—"} · net <strong>{o.netCents !== null ? formatEuros(o.netCents) : "—"}</strong>{" "}
              <span className="text-slate-600">
                ({o.levelLabel}
                {o.rate > 0 ? ` ${formatPercent(o.rate)}` : ""})
              </span>
              {o.supplierRef && <span className="text-slate-600"> · code {o.supplierRef}</span>}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
