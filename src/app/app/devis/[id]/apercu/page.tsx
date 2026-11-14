import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { formatEuros, formatPercent } from "@/lib/format";
import { computeQuote } from "@/lib/pricing/engine";
import { Card, LinkButton, Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Devis créé" };

/** Récapitulatif du devis généré (le panneau « Ma marge » complet et le PDF viennent aux étapes suivantes). */
export default async function QuotePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, company } = await getCurrentCompany();
  const { data: q } = await supabase.from("quotes").select("id, number, labor_days, vat_regime, projects(clients(name))").eq("id", id).maybeSingle();
  if (!q) notFound();
  const { data: rows } = await supabase.from("quote_lines").select("*").eq("quote_id", id).order("position");
  const result = computeQuote({
    laborDays: Number(q.labor_days),
    settings: { vatRegime: q.vat_regime, laborChargesRate: company.labor_charges_rate, materialChargesRate: company.material_charges_rate, targetMarginPerDayCents: Number(company.target_margin_per_day_cents) },
    lines: (rows ?? []).map((r) => ({ id: r.id, kind: r.kind, designation: r.designation, quantity: Number(r.quantity), unit: r.unit, unitPurchaseCents: Number(r.unit_purchase_cents), unitSaleCents: Number(r.unit_sale_cents), vatRate: Number(r.vat_rate) })),
  });
  const client = (q.projects as unknown as { clients: { name: string } }).clients.name;
  const m = result.margin;

  return (
    <div className="space-y-6">
      <Link href="/app" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Mes devis
      </Link>
      <h1 className="text-3xl font-extrabold">
        {q.number} · {client}
      </h1>
      <Notice tone="ok">Devis créé. Le PDF et l&apos;arrondi aux seuils psychologiques arrivent aux étapes suivantes du développement.</Notice>
      {result.alerts.map((a) => (
        <Notice key={a.message} tone="danger">
          ⚠ {a.message}
        </Notice>
      ))}
      <Card title="Lignes">
        <ul className="divide-y-2 divide-slate-200">
          {result.lines.map((l) => (
            <li key={l.id} className={`flex justify-between gap-3 py-2 text-base ${l.belowCost ? "font-bold text-danger" : ""}`}>
              <span>
                {l.designation}
                <span className="block text-sm text-slate-600">
                  {l.quantity.toLocaleString("fr-FR")} {l.unit} × {formatEuros(l.unitSaleCents)}
                </span>
              </span>
              <span className="shrink-0 font-bold">{formatEuros(l.totalSaleCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t-4 border-slate-300 pt-3 text-lg">
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
      </Card>
      <Card title="Ma marge (jamais sur le PDF)">
        <dl className="grid grid-cols-2 gap-3 text-base">
          <div>
            <dt className="text-slate-600">Coût d&apos;achat</dt>
            <dd className="text-lg font-bold">{formatEuros(m.purchaseCostCents)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Charges (MO + matériel)</dt>
            <dd className="text-lg font-bold">{formatEuros(m.laborChargesCents + m.materialChargesCents)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Marge nette</dt>
            <dd className="text-lg font-bold">{formatEuros(m.netMarginCents)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Par jour ({Number(q.labor_days).toLocaleString("fr-FR")} j)</dt>
            <dd className={`text-lg font-bold ${result.alerts.length ? "text-danger" : "text-ok"}`}>{m.marginPerDayCents === null ? "—" : formatEuros(m.marginPerDayCents)}</dd>
          </div>
        </dl>
      </Card>
      <LinkButton href={`/app/devis/${id}?etape=4`} variant="secondary" full>
        Modifier le devis
      </LinkButton>
    </div>
  );
}
