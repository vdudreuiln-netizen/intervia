import { formatEuros, formatPercent } from "@/lib/format";
import type { PriceHistoryItem } from "@/lib/catalog/queries";
import { Card } from "@/components/ui";

export function PriceHistory({ items }: { items: PriceHistoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card title="Historique des prix">
      <ul className="divide-y-2 divide-slate-200">
        {items.map((h, i) => {
          const change = h.old_public_price_cents ? (h.new_public_price_cents - h.old_public_price_cents) / h.old_public_price_cents : null;
          return (
            <li key={i} className="py-3 text-base">
              <p className="font-bold">
                {new Date(h.changed_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
                <span className="font-normal text-slate-600"> · {h.from_import ? "import de tarif" : "saisie"}</span>
              </p>
              <p>
                {h.old_public_price_cents !== null && h.old_public_price_cents !== h.new_public_price_cents ? (
                  <>
                    {formatEuros(h.old_public_price_cents)} → <strong>{formatEuros(h.new_public_price_cents)}</strong>
                    {change !== null && <span className={change > 0 ? "font-bold text-danger" : "font-bold text-ok"}> ({change > 0 ? "+" : ""}{formatPercent(change)})</span>}
                  </>
                ) : (
                  <>Prix public : {formatEuros(h.new_public_price_cents)}</>
                )}
              </p>
              {h.old_discount_rate !== h.new_discount_rate && h.old_public_price_cents !== null && (
                <p className="text-slate-700">
                  Remise : {h.old_discount_rate === null ? "celle de la marque" : formatPercent(h.old_discount_rate)} → {h.new_discount_rate === null ? "celle de la marque" : formatPercent(h.new_discount_rate)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
