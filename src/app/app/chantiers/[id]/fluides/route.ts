import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { loadQuote } from "@/lib/quote/load";
import { loadRuleContext } from "@/lib/plans/rules.server";
import { costAccess } from "@/lib/security/costs";
import { pdfResponse } from "@/lib/site/pdf.server";
import { FluidPdf } from "@/lib/site/SitePdfs";
import { buildFluidForm, type Values } from "@/lib/site/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fiche d'intervention fluides préremplie (données à reporter sur le CERFA 15497*04). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, company, companyId } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) return new Response("Chantier introuvable", { status: 404 });
  const rc = await loadRuleContext(supabase, db, companyId, q, company.placement_rules);
  if (!rc) return new Response("Aucun matériel choisi sur ce devis.", { status: 409 });
  const { data: job } = await supabase.from("site_jobs").select("commissioning").eq("quote_id", id).maybeSingle();
  const addr = (a: string | null, cp: string | null, city: string | null) => [a, [cp, city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const form = buildFluidForm({
    company: { name: company.legal_name, address: addr(company.address_line, company.postal_code, company.city), siret: company.siret, capacityNumber: company.fluid_capacity_number },
    client: { name: q.project.client.name, address: addr(q.project.site_address, q.project.site_postal_code, q.project.site_city) },
    equipment: rc.equipment,
    tech: rc.tech,
    values: ((job?.commissioning as Values | null) ?? {}) as Values,
  });
  const element = createElement(FluidPdf, { form, company: company.legal_name, quoteNumber: q.number }) as unknown as ReactElement<DocumentProps>;
  return pdfResponse(await renderToBuffer(element), `Fiche-fluides-${q.number}.pdf`);
}
