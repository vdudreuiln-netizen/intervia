import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { loadQuote } from "@/lib/quote/load";
import { loadRuleContext } from "@/lib/plans/rules.server";
import { equipmentTags } from "@/lib/plans/layout";
import { costAccess } from "@/lib/security/costs";
import { clientParty, companyParty, frDate, pdfResponse, storedImage } from "@/lib/site/pdf.server";
import { ReceptionPdf, type PdfImg } from "@/lib/site/SitePdfs";
import type { Reception } from "@/lib/site/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: Record<string, string> = { avant: "Avant", apres: "Après", passage: "Passage de mur", etiquette: "Étiquette", autre: "Photo" };

/** Procès-verbal de réception signé, avec les photos du chantier. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, company, companyId } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) return new Response("Chantier introuvable", { status: 404 });
  const { data: job } = await supabase.from("site_jobs").select("reception").eq("quote_id", id).maybeSingle();
  const r = job?.reception as Reception | null;
  if (!r) return new Response("La réception n'est pas encore signée.", { status: 409 });
  const rc = await loadRuleContext(supabase, db, companyId, q, company.placement_rules);
  const works: string[] = [];
  if (rc) {
    const tags = equipmentTags(rc.equipment);
    const room = new Map(q.rooms.map((x) => [x.id, x.name]));
    for (const s of rc.equipment.systems) {
      works.push(`${tags.outdoor.get(s.key)} : unité extérieure ${s.outdoor.brandName} ${s.outdoor.reference}`);
      for (const i of s.indoors) works.push(`${tags.indoor.get(i.key)} : unité intérieure ${i.product.brandName} ${i.product.reference} – ${i.roomIds.map((x) => room.get(x) ?? "").join(", ")}`);
    }
  }
  works.push("Liaisons frigorifiques, évacuation des condensats, alimentation électrique, mise en service et essais.");
  const { data: rows } = await supabase.from("site_photos").select("path, kind, caption").eq("quote_id", id).order("created_at").limit(12);
  const photos: { image: PdfImg; caption: string }[] = [];
  for (const p of rows ?? []) {
    const image = await storedImage(supabase, "chantier", p.path);
    if (image) photos.push({ image, caption: [KINDS[p.kind] ?? "Photo", p.caption].filter(Boolean).join(" – ") });
  }
  const element = createElement(ReceptionPdf, {
    company: companyParty(company),
    client: clientParty(q),
    quoteNumber: q.number,
    works,
    reserves: r.reserves,
    signerName: r.signerName,
    signedAt: frDate(r.signedAt),
    signature: r.signaturePath ? await storedImage(supabase, "chantier", r.signaturePath) : null,
    photos,
  }) as unknown as ReactElement<DocumentProps>;
  return pdfResponse(await renderToBuffer(element), `PV-reception-${q.number}.pdf`);
}
