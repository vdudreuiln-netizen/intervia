import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { loadQuote } from "@/lib/quote/load";
import { costAccess } from "@/lib/security/costs";
import { pricingSettingsOf } from "@/lib/site/load.server";
import { clientParty, companyParty, frDate, pdfResponse } from "@/lib/site/pdf.server";
import { AmendmentPdf } from "@/lib/site/SitePdfs";
import { buildAmendment, type DevLine } from "@/lib/site/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Avenant au devis : seuls les prix de VENTE des écarts retenus y figurent. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const number = Number.parseInt(n, 10);
  if (!(number >= 1 && number <= 99)) return new Response("Avenant introuvable", { status: 404 });
  const { supabase, db, company, companyId } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) return new Response("Chantier introuvable", { status: 404 });
  const { data: am } = await supabase.from("quote_amendments").select("created_at").eq("quote_id", id).eq("number", number).maybeSingle();
  if (!am) return new Response("Avenant introuvable", { status: 404 });
  const { data: devs } = await supabase.from("site_deviations").select("id, description, decided_at").eq("quote_id", id).eq("amendment_number", number).order("created_at");
  if (!devs?.length) return new Response("Avenant introuvable", { status: 404 });
  const { data: costs } = await db.from("site_deviation_costs").select("deviation_id, lines").eq("company_id", companyId).in("deviation_id", devs.map((d) => d.id));
  const linesOf = new Map((costs ?? []).map((c) => [c.deviation_id as string, (c.lines as DevLine[]) ?? []]));
  // Le client ne voit jamais le coût d'achat
  const items = devs.map((d) => ({ description: d.description as string, lines: (linesOf.get(d.id) ?? []).map((l) => ({ ...l, unitPurchaseCents: 0 })) }));
  if (items.every((i) => i.lines.length === 0)) return new Response("Chiffrez d'abord les écarts de cet avenant.", { status: 409 });
  const { data: tot } = await supabase.from("quotes").select("total_ttc_cents").eq("id", id).single();
  const total = Number(tot?.total_ttc_cents ?? 0);
  const { data: prior } = await supabase.from("quote_amendments").select("total_ttc_cents").eq("quote_id", id).eq("status", "accepte").lt("number", number);
  const priorTtc = (prior ?? []).reduce((s, a) => s + Number(a.total_ttc_cents), 0);
  const amendment = buildAmendment(number, items, pricingSettingsOf(company, q.vatRegime), total + priorTtc);
  const element = createElement(AmendmentPdf, { amendment, company: companyParty(company), client: clientParty(q), quoteNumber: q.number, date: frDate(am.created_at), quoteTotalTtcCents: total, priorAmendmentsTtcCents: priorTtc }) as unknown as ReactElement<DocumentProps>;
  return pdfResponse(await renderToBuffer(element), `Avenant-${number}-${q.number}.pdf`);
}
