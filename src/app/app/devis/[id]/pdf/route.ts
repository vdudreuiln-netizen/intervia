import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { costAccess } from "@/lib/security/costs";
import { loadQuoteDocument } from "@/lib/pdf/load";
import { QuotePdf } from "@/lib/pdf/QuotePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF du devis, généré à la demande (jamais mis en cache : il reflète les dernières retouches). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, company } = await costAccess();
  const data = await loadQuoteDocument(supabase, db, company, id);
  if (!data) return new Response("Devis introuvable", { status: 404 });
  const element = createElement(QuotePdf, data) as unknown as ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(element);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Devis-${data.doc.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
