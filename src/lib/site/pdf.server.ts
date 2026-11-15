import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentCompany } from "@/lib/company/current";
import type { QuoteRecord } from "@/lib/quote/load";
import type { PdfImg, PdfParty } from "./SitePdfs";

export const companyParty = (c: CurrentCompany): PdfParty => ({
  name: c.legal_name,
  lines: [[c.address_line, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), c.phone ? `Tél. ${c.phone}` : "", c.siret ? `SIRET ${c.siret}` : ""].filter(Boolean),
});

export const clientParty = (q: QuoteRecord): PdfParty => ({
  name: q.project.client.name,
  lines: [[q.project.site_address, [q.project.site_postal_code, q.project.site_city].filter(Boolean).join(" ")].filter(Boolean).join(", "), q.project.client.phone ?? ""].filter(Boolean),
});

export async function storedImage(supabase: SupabaseClient, bucket: string, path: string): Promise<PdfImg | null> {
  const { data } = await supabase.storage.from(bucket).download(path);
  if (!data) return null;
  return { data: Buffer.from(await data.arrayBuffer()), format: path.endsWith(".png") ? "png" : "jpg" };
}

export const pdfResponse = (pdf: Buffer, filename: string) =>
  new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, no-store" } });

export const frDate = (iso: string | Date) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
