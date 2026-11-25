import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { costAccess } from "@/lib/security/costs";
import { PurchaseOrderPdf, type StoredPurchaseOrder } from "@/lib/suppliers/PurchaseOrderPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PDF d'un bon de commande fournisseur (membres autorisés à voir les prix d'achat). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; supplierId: string }> }) {
  const { id, supplierId } = await params;
  if (!UUID.test(id) || !UUID.test(supplierId)) return new Response("Introuvable", { status: 404 });
  const { db, companyId, company, restricted } = await costAccess();
  if (restricted) return new Response("Réservé aux membres autorisés", { status: 403 });
  const { data } = await db.from("purchase_orders").select("content").eq("company_id", companyId).eq("quote_id", id).eq("supplier_id", supplierId).maybeSingle();
  if (!data) return new Response("Bon de commande introuvable", { status: 404 });
  const order = data.content as StoredPurchaseOrder;
  const element = createElement(PurchaseOrderPdf, {
    order,
    company: {
      name: company.legal_name,
      address: [company.address_line, [company.postal_code, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      phone: company.phone,
      email: company.email,
      siret: company.siret,
    },
  }) as unknown as ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(element);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${order.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
