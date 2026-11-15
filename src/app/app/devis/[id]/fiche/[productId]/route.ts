import { costAccess } from "@/lib/security/costs";
import { loadDatasheets } from "@/lib/plans/annex.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fiche technique fabricant d'un produit présent dans le devis. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; productId: string }> }) {
  const { id, productId } = await params;
  const { supabase, db, companyId } = await costAccess();
  const sheet = (await loadDatasheets(db, companyId, id)).find((s) => s.productId === productId);
  if (!sheet) return new Response("Fiche technique introuvable", { status: 404 });
  const { data } = await supabase.storage.from("datasheets").download(sheet.path);
  if (!data) return new Response("Fiche technique introuvable", { status: 404 });
  return new Response(new Uint8Array(await data.arrayBuffer()), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${sheet.name.replace(/[^\w .()-]/g, "_")}"`,
      "cache-control": "private, no-store",
    },
  });
}
