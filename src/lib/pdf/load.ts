import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeQuote } from "@/lib/pricing/engine";
import type { CurrentCompany } from "@/lib/company/current";
import { ASSETS_BUCKET } from "@/lib/supabase/env";
import { loadQuote, loadQuoteLines } from "@/lib/quote/load";
import { buildQuoteDocument, type QuoteDocument } from "./document";
import type { PdfImage } from "./QuotePdf";

async function image(supabase: SupabaseClient, path: string | null): Promise<PdfImage> {
  if (!path) return null;
  const format = path.endsWith(".png") ? "png" : path.endsWith(".jpg") || path.endsWith(".jpeg") ? "jpg" : null;
  if (!format) return null; // WebP (anciens envois) : non supporté par le moteur PDF
  const { data } = await supabase.storage.from(ASSETS_BUCKET).download(path);
  return data ? { data: Buffer.from(await data.arrayBuffer()), format } : null;
}

/** Assemble le document imprimable d'un devis (sans aucune donnée de marge). */
/** `costDb` : lecteur des coûts filtré par entreprise (src/lib/security/costs.ts). Le document final ne contient aucun coût. */
export async function loadQuoteDocument(supabase: SupabaseClient, costDb: SupabaseClient, company: CurrentCompany, quoteId: string): Promise<{ doc: QuoteDocument; logo: PdfImage; stamp: PdfImage } | null> {
  const q = await loadQuote(supabase, quoteId);
  if (!q) return null;
  const lines = await loadQuoteLines(costDb, company.id, quoteId);
  const result = computeQuote({
    lines,
    laborDays: q.laborDays,
    discount: q.discount,
    settings: { vatRegime: q.vatRegime, laborChargesRate: company.labor_charges_rate, materialChargesRate: company.material_charges_rate, targetMarginPerDayCents: 0 },
  });
  const c = q.project.client;
  const p = q.project;
  const doc = buildQuoteDocument(
    { ...company, vat_regime: q.vatRegime },
    {
      number: q.number,
      issueDate: q.document.issueDate,
      validityDays: q.document.validityDays,
      presentation: q.document.presentation,
      signedOffPremises: q.document.signedOffPremises,
      earlyStart: q.document.earlyStart,
      urgentRepair: q.document.urgentRepair,
      depositRate: q.document.depositRate ?? Number(company.deposit_rate),
      schedule: q.document.schedule,
      discount: q.discount,
      client: { name: c.name, address: c.address_line, postalCode: c.postal_code, city: c.city, phone: c.phone, email: c.email },
      site: { address: p.site_address, postalCode: p.site_postal_code, city: p.site_city },
    },
    lines.map((l) => ({ ...l })),
    result,
  );
  const [logo, stamp] = await Promise.all([image(supabase, company.logo_path), image(supabase, company.stamp_path)]);
  return { doc, logo, stamp };
}
