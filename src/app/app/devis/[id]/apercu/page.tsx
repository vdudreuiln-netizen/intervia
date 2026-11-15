import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { costAccess } from "@/lib/security/costs";
import { computeQuote } from "@/lib/pricing/engine";
import { loadQuote, loadQuoteLines } from "@/lib/quote/load";
import { LinkButton } from "@/components/ui";
import { QuoteEditor } from "./QuoteEditor";
import { documentWarnings } from "@/lib/pdf/document";
import { loadDatasheets } from "@/lib/plans/annex.server";
import { buildSupplierView, computeSupplierPlan, internalShipping, loadQuoteSupplierSettings } from "@/lib/suppliers/quote";

export const metadata: Metadata = { title: "Devis" };

/** Le devis après l'assistant : retouches, remise, arrondi, panneau « Ma marge ». */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, companyId, company, canSeeMargins, restricted } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) notFound();
  const fullRows = await loadQuoteLines(db, companyId, id);
  const settings = {
    vatRegime: q.vatRegime,
    laborChargesRate: company.labor_charges_rate,
    materialChargesRate: company.material_charges_rate,
    targetMarginPerDayCents: Number(company.target_margin_per_day_cents),
  };
  const supplierSettings = await loadQuoteSupplierSettings(db, companyId, id);
  // Annexes : cahier des charges dès qu'une solution est choisie ; fiches techniques des produits du devis
  const datasheets = (await loadDatasheets(db, companyId, id)).map((d) => ({ productId: d.productId, name: d.name }));
  const hasAnnexes = Boolean(q.wizard.selection);
  const shippingCostCents = internalShipping(supplierSettings);
  // Technicien sans accès aux marges : alertes calculées ici, lignes envoyées SANS prix d'achat ni fournisseur.
  const server = restricted
    ? computeQuote({
        lines: fullRows,
        laborDays: q.laborDays,
        discount: q.discount,
        settings,
        shippingCostCents,
      })
    : null;
  const rows = restricted
    ? fullRows.map((r) => ({
        ...r,
        unitPurchaseCents: 0,
        supplierId: null,
        supplierForced: false,
      }))
    : fullRows;
  // Fournisseurs (lecture seule ici : rien n'est enregistré à l'affichage)
  const supplierView = !restricted && fullRows.length ? buildSupplierView(await computeSupplierPlan(db, companyId, id)) : null;
  let purchaseOrders:
    | {
        supplierId: string;
        supplierName: string;
        number: string;
        totalCents: number;
        generatedAt: string;
      }[]
    | null = null;
  if (!restricted && q.status === "accepte") {
    const { data } = await db.from("purchase_orders").select("supplier_id, number, total_cents, generated_at, suppliers(name)").eq("company_id", companyId).eq("quote_id", id).order("number");
    purchaseOrders = (data ?? []).map((o) => ({
      supplierId: o.supplier_id,
      supplierName: (o.suppliers as unknown as { name: string } | null)?.name ?? "",
      number: o.number,
      totalCents: Number(o.total_cents),
      generatedAt: o.generated_at,
    }));
  }

  return (
    <div className="space-y-6">
      <Link href="/app" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Mes devis
      </Link>
      <h1 className="text-3xl font-extrabold">
        {q.number} · {q.project.client.name}
      </h1>
      {q.status === "accepte" && (
        <LinkButton href={`/app/chantiers/${id}`} full>
          🛠️ Ouvrir le chantier (pose, photos, écarts, réception)
        </LinkButton>
      )}
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
          shippingCostCents={restricted ? 0 : shippingCostCents}
          supplierView={supplierView}
          purchaseOrders={purchaseOrders}
          hasSiteAddress={Boolean(q.project.site_address)}
          datasheets={datasheets}
          hasAnnexes={hasAnnexes}
        />
      )}
    </div>
  );
}
