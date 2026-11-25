import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { PDFDocument } from "pdf-lib";
import { costAccess } from "@/lib/security/costs";
import { loadQuoteDocument } from "@/lib/pdf/load";
import { QuotePdf } from "@/lib/pdf/QuotePdf";
import { loadQuote } from "@/lib/quote/load";
import { parseShareMode } from "@/lib/plans/annex";
import { loadAnnexData, loadDatasheets } from "@/lib/plans/annex.server";
import { buildClientSpec } from "@/lib/plans/spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF du devis, généré à la demande (jamais mis en cache : il reflète les dernières retouches).
 *  ?mode=seul     : le devis
 *  ?mode=annexes  : + plan d'implantation et cahier des charges client (défaut)
 *  ?mode=complet  : + fiches techniques fabricant fusionnées dans le même PDF
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mode = parseShareMode(new URL(req.url).searchParams.get("mode"));
  const { supabase, db, company, companyId } = await costAccess();
  const data = await loadQuoteDocument(supabase, db, company, id);
  if (!data) return new Response("Devis introuvable", { status: 404 });

  let annexes = null;
  if (mode !== "seul") {
    const q = await loadQuote(supabase, id);
    if (q) {
      const a = await loadAnnexData(supabase, db, companyId, q);
      annexes = { plans: a.plans, spec: a.spec ? buildClientSpec(a.spec) : null };
    }
  }
  const element = createElement(QuotePdf, { ...data, annexes }) as unknown as ReactElement<DocumentProps>;
  let pdf: Uint8Array = new Uint8Array(await renderToBuffer(element));

  let suffix = mode === "seul" ? "" : "-annexes";
  if (mode === "complet") {
    const sheets = await loadDatasheets(db, companyId, id);
    if (sheets.length) {
      const merged = await PDFDocument.load(pdf);
      for (const sh of sheets) {
        const { data: blob } = await supabase.storage.from("datasheets").download(sh.path);
        if (!blob) continue;
        try {
          const src = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true });
          for (const page of await merged.copyPages(src, src.getPageIndices())) merged.addPage(page);
        } catch {
          // fiche illisible : ignorée plutôt que de bloquer tout le dossier
        }
      }
      pdf = await merged.save();
    }
    suffix = "-dossier-complet";
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Devis-${data.doc.number}${suffix}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
