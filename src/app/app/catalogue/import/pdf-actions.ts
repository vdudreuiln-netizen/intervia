"use server";

import { PDFDocument } from "pdf-lib";
import { adminOnlyError } from "@/lib/billing/guard";
import { getCurrentCompany } from "@/lib/company/current";
import { createAdminClient } from "@/lib/supabase/admin";
import { ExtractedRowSchema, PAGES_PER_CHUNK, type ExtractedRow } from "@/lib/suppliers/pdf-tariff";
import { ExtractionError, extractTariffRows, pdfImportEnabled } from "@/lib/suppliers/pdf-tariff.server";

const HASH = /^[0-9a-f]{64}$/;
const PAGES_KEY = /^\d+(-\d+)?(,\d+(-\d+)?)*$/;
const MAX_BYTES = 4_400_000;

export interface PdfStatus {
  enabled: boolean;
  used: number;
  quota: number;
  /** Lots déjà analysés pour ce fichier (gratuits). */
  cached: string[];
}

/** Quota du mois et lots déjà analysés (mémoire), avant de lancer l'analyse. */
export async function pdfImportStatus(fileHash: string, chunkKeys: string[]): Promise<PdfStatus | { ok: false; message: string }> {
  {
    const g = await adminOnlyError();
    if (g) return g;
  }
  const { supabase, company } = await getCurrentCompany();
  const { data: q } = await supabase.rpc("ai_quota_status", { p_kind: "tarif_pdf" }).maybeSingle<{ used: number; quota: number }>();
  let cached: string[] = [];
  if (HASH.test(fileHash)) {
    const keys = chunkKeys.filter((k) => PAGES_KEY.test(k)).slice(0, 500);
    if (keys.length) {
      const { data } = await supabase.from("pdf_tariff_extractions").select("pages").eq("company_id", company.id).eq("file_hash", fileHash).in("pages", keys);
      cached = (data ?? []).map((d) => d.pages as string);
    }
  }
  return {
    enabled: pdfImportEnabled(),
    used: Number(q?.used ?? 0),
    quota: Number(q?.quota ?? 0),
    cached,
  };
}

export type ChunkResult = { ok: true; rows: ExtractedRow[]; cached: boolean } | { ok: false; message: string; quotaExceeded?: boolean };

/**
 * Analyse d'un lot de pages (PDF reconstitué dans le navigateur avec les seules
 * pages choisies). Une page analysée = une unité de quota, sauf si ce lot du
 * même fichier a déjà été analysé (mémoire, gratuit).
 */
export async function extractPdfChunk(form: FormData): Promise<ChunkResult> {
  {
    const g = await adminOnlyError();
    if (g) return g;
  }
  const { supabase, company } = await getCurrentCompany();
  const fileHash = String(form.get("fileHash") ?? "");
  const pages = String(form.get("pages") ?? "");
  const file = form.get("file");
  if (!HASH.test(fileHash) || !PAGES_KEY.test(pages) || !(file instanceof Blob)) return { ok: false, message: "Envoi invalide. Rechargez la page." };
  if (file.size > MAX_BYTES)
    return {
      ok: false,
      message: "Ces pages sont trop lourdes pour être envoyées ensemble. Choisissez moins de pages.",
    };

  // 1. Mémoire : même fichier, mêmes pages → pas de nouvelle analyse
  const { data: memo } = await supabase.from("pdf_tariff_extractions").select("rows").eq("company_id", company.id).eq("file_hash", fileHash).eq("pages", pages).maybeSingle();
  if (memo) {
    const parsed = ExtractedRowSchema.array().safeParse(memo.rows);
    if (parsed.success) return { ok: true, rows: parsed.data, cached: true };
  }

  // 2. Le lot reçu doit contenir exactement les pages annoncées (on ne fait pas confiance au navigateur)
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pageCount: number;
  try {
    pageCount = (
      await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      })
    ).getPageCount();
  } catch {
    return {
      ok: false,
      message: "Ce PDF n'a pas pu être lu (protégé ou abîmé).",
    };
  }
  const announced = pages.split(",").reduce((n, part) => {
    const [a, b] = part.split("-").map(Number);
    return n + ((b ?? a!) - a! + 1);
  }, 0);
  if (pageCount !== announced || pageCount > PAGES_PER_CHUNK) return { ok: false, message: "Envoi invalide. Rechargez la page." };

  // 3. Quota (serveur uniquement), rendu en cas d'échec technique
  const admin = createAdminClient();
  const { error: qErr } = await admin.rpc("consume_ai_quota", {
    p_company: company.id,
    p_kind: "tarif_pdf",
    p_units: pageCount,
  });
  if (qErr) {
    if (qErr.message.includes("QUOTA_DEPASSE"))
      return {
        ok: false,
        quotaExceeded: true,
        message: "Quota mensuel de pages PDF atteint. Importez le tarif Excel / CSV du fournisseur (gratuit et illimité), ou passez à une formule supérieure.",
      };
    return {
      ok: false,
      message: "Vérification du quota impossible. Réessayez.",
    };
  }

  let rows: ExtractedRow[];
  try {
    rows = await extractTariffRows(bytes);
  } catch (e) {
    const err = e instanceof ExtractionError ? e : new ExtractionError(String(e), "Analyse impossible pour le moment. Réessayez dans quelques minutes.");
    if (err.refund)
      await admin.rpc("refund_ai_quota", {
        p_company: company.id,
        p_kind: "tarif_pdf",
        p_units: pageCount,
      });
    console.error("Import PDF :", err.message);
    return { ok: false, message: err.userMessage };
  }

  await supabase.from("pdf_tariff_extractions").upsert(
    {
      company_id: company.id,
      file_hash: fileHash,
      pages,
      page_count: pageCount,
      rows,
    },
    { onConflict: "company_id,file_hash,pages" },
  );
  return { ok: true, rows, cached: false };
}
