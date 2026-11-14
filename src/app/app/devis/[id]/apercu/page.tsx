import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { costAccess } from "@/lib/security/costs";
import { computeQuote } from "@/lib/pricing/engine";
import { loadQuote, loadQuoteLines } from "@/lib/quote/load";
import { LinkButton } from "@/components/ui";
import { QuoteEditor } from "./QuoteEditor";
import { documentWarnings } from "@/lib/pdf/document";

export const metadata: Metadata = { title: "Devis" };

/** Le devis après l'assistant : retouches, remise, arrondi, panneau « Ma marge ». */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, companyId, company, canSeeMargins, restricted } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) notFound();
  const fullRows = await loadQuoteLines(db, companyId, id);
  const settings = { vatRegime: q.vatRegime, laborChargesRate: company.labor_charges_rate, materialChargesRate: company.material_charges_rate, targetMarginPerDayCents: Number(company.target_margin_per_day_cents) };
  // Technicien sans accès aux marges : alertes calculées ici, lignes envoyées SANS prix d'achat.
  const server = restricted ? computeQuote({ lines: fullRows, laborDays: q.laborDays, discount: q.discount, settings }) : null;
  const rows = restricted ? fullRows.map((r) => ({ ...r, unitPurchaseCents: 0 })) : fullRows;

  return (
    <div className="space-y-6">
      <Link href="/app" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Mes devis
      </Link>
      <h1 className="text-3xl font-extrabold">
        {q.number} · {q.project.client.name}
      </h1>
      {rows.length === 0 ? (
        <LinkButton href={`/app/devis/${id}`} full>
          Continuer le chiffrage
        </LinkButton>
      ) : (
        <QuoteEditor
          quoteId={id}
          rows={rows}
          laborDays={q.laborDays}
          discount={q.discount}
          settings={restricted ? { ...settings, laborChargesRate: 0, materialChargesRate: 0, targetMarginPerDayCents: 0 } : settings}
          serverAlerts={server?.alerts ?? null}
          belowCostIds={server ? server.lines.filter((l) => l.belowCost).map((l) => l.id) : null}
          coefficients={{ material: q.wizard.materialCoefficient ?? null, accessory: q.wizard.accessoryCoefficient ?? null, companyAccessory: company.accessory_sale_coefficient }}
          number={q.number}
          status={q.status as "brouillon"}
          warnings={documentWarnings(company)}
          documentOptions={{
            presentation: q.document.presentation,
            signedOffPremises: q.document.signedOffPremises,
            earlyStart: q.document.earlyStart,
            urgentRepair: q.document.urgentRepair,
            depositRate: q.document.depositRate,
            schedule: q.document.schedule,
          }}
          companyDepositRate={company.deposit_rate}
          priceNotices={q.wizard.priceNotices}
          showMargin={canSeeMargins}
        />
      )}
    </div>
  );
}
