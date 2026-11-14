import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { loadQuote, loadQuoteLines } from "@/lib/quote/load";
import { LinkButton } from "@/components/ui";
import { QuoteEditor } from "./QuoteEditor";
import { documentWarnings } from "@/lib/pdf/document";

export const metadata: Metadata = { title: "Devis" };

/** Le devis après l'assistant : retouches, remise, arrondi, panneau « Ma marge ». */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, id);
  if (!q) notFound();
  const rows = await loadQuoteLines(supabase, id);

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
          settings={{ vatRegime: q.vatRegime, laborChargesRate: company.labor_charges_rate, materialChargesRate: company.material_charges_rate, targetMarginPerDayCents: Number(company.target_margin_per_day_cents) }}
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
        />
      )}
    </div>
  );
}
