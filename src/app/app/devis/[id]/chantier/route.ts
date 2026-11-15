import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { costAccess } from "@/lib/security/costs";
import { loadQuote } from "@/lib/quote/load";
import { loadAnnexData } from "@/lib/plans/annex.server";
import { buildSiteSpec } from "@/lib/plans/spec";
import { SitePdf } from "@/lib/plans/PlanPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dossier technique CHANTIER : PDF séparé, sans aucun prix ni marge (utilisable par tous les membres). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, company, companyId } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) return new Response("Devis introuvable", { status: 404 });
  const a = await loadAnnexData(supabase, db, companyId, q);
  if (!a.spec) return new Response("Choisissez d'abord une solution dans le devis.", { status: 409 });
  const element = createElement(SitePdf, {
    company: company.legal_name,
    quoteNumber: q.number,
    spec: buildSiteSpec(a.spec),
    plans: a.plans,
    generatedAt: new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }),
  }) as unknown as ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(element);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Chantier-${q.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
