"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Field, Notice } from "@/components/ui";
import type { ImportTarget } from "@/lib/catalog/import";
import { MAX_CHUNK_BYTES, PAGES_PER_CHUNK, checkPdfQuota, chunkPages, formatPages, parsePageSelection, reviewWarnings, type ReviewRow } from "@/lib/suppliers/pdf-tariff";
import { extractPdfChunk, pdfImportStatus, type PdfStatus } from "./pdf-actions";

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type PdfLib = typeof import("pdf-lib");

/** Construit un PDF ne contenant que `pages` (numéros 1…n) ; redécoupe si trop lourd. */
async function buildChunks(lib: PdfLib, source: import("pdf-lib").PDFDocument, pages: number[]): Promise<{ pages: number[]; bytes: Uint8Array }[]> {
  const doc = await lib.PDFDocument.create();
  const copied = await doc.copyPages(
    source,
    pages.map((p) => p - 1),
  );
  copied.forEach((p) => doc.addPage(p));
  const bytes = await doc.save();
  if (bytes.byteLength <= MAX_CHUNK_BYTES || pages.length === 1) return [{ pages, bytes }];
  const mid = Math.ceil(pages.length / 2);
  return [...(await buildChunks(lib, source, pages.slice(0, mid))), ...(await buildChunks(lib, source, pages.slice(mid)))];
}

const PAGE_SIZE = 40;
const num = (s: string): number | null => {
  const t = s.replace(/\s/g, "").replace(",", ".").replace(/[€%]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const show = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

export function PdfImport({ file, target, onCancel, onValidated }: { file: File; target: ImportTarget; onCancel: () => void; onValidated: (rows: ReviewRow[], fileHash: string) => void }) {
  const [doc, setDoc] = useState<{
    lib: PdfLib;
    pdf: import("pdf-lib").PDFDocument;
    pageCount: number;
    hash: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  const [status, setStatus] = useState<PdfStatus | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [page, setPage] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await file.arrayBuffer();
        const lib = await import("pdf-lib");
        const pdf = await lib.PDFDocument.load(buf, { ignoreEncryption: true });
        const hash = await sha256(buf);
        if (!cancelled) setDoc({ lib, pdf, pageCount: pdf.getPageCount(), hash });
      } catch {
        if (!cancelled) setError("Ce PDF n'a pas pu être ouvert (protégé par mot de passe ou abîmé).");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const sel = useMemo(() => (doc ? parsePageSelection(selection, doc.pageCount) : null), [doc, selection]);
  const chunks = useMemo(() => (sel && "pages" in sel ? chunkPages(sel.pages) : []), [sel]);
  const chunkKeys = useMemo(() => chunks.map(formatPages), [chunks]);

  useEffect(() => {
    if (!doc || chunkKeys.length === 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const s = await pdfImportStatus(doc.hash, chunkKeys);
      if (!cancelled) {
        if ("ok" in s) setError(s.message);
        else setStatus(s);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [doc, chunkKeys]);

  const toAnalyse = chunks.filter((_, i) => !status?.cached.includes(chunkKeys[i]!)).reduce((n, c) => n + c.length, 0);
  const quota = status ? checkPdfQuota(toAnalyse, status.used, status.quota) : null;

  async function analyse() {
    if (!doc || !sel || !("pages" in sel)) return;
    setRunning(true);
    setError(null);
    const out: ReviewRow[] = [];
    setProgress({ done: 0, total: sel.pages.length });
    let done = 0;
    try {
      for (const c of chunks) {
        for (const part of await buildChunks(doc.lib, doc.pdf, c)) {
          const form = new FormData();
          form.set("fileHash", doc.hash);
          form.set("pages", formatPages(part.pages));
          form.set("file", new Blob([part.bytes as BlobPart], { type: "application/pdf" }), "pages.pdf");
          const r = await extractPdfChunk(form);
          if (!r.ok) {
            setError(r.message + (out.length ? " Les pages déjà analysées sont conservées : relancer ne les recompte pas." : ""));
            setRunning(false);
            setProgress(null);
            return;
          }
          for (const row of r.rows)
            out.push({
              ...row,
              sourcePage: part.pages[row.page - 1] ?? part.pages[0]!,
              keep: row.reference.trim() !== "" && (row.public_price_eur !== null || row.net_price_eur !== null),
            });
          done += part.pages.length;
          setProgress({ done, total: sel.pages.length });
        }
      }
      setRows(out);
      setPage(0);
    } catch {
      setError("L'envoi a échoué (connexion ?). Les pages déjà analysées sont conservées : relancer ne les recompte pas.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const update = (i: number, patch: Partial<ReviewRow>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // ----- Écran de validation --------------------------------------------------
  if (rows) {
    const kept = rows.filter((r) => r.keep).length;
    const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    return (
      <div className="space-y-6">
        <Card title="Vérifiez les lignes lues dans le PDF">
          <p className="text-base text-slate-700">
            {rows.length} ligne{rows.length > 1 ? "s" : ""} lue
            {rows.length > 1 ? "s" : ""} · <strong>{kept} à importer</strong>. Corrigez une référence ou un prix si besoin, décochez les lignes à ignorer. Rien n&apos;est enregistré avant le résumé final.
          </p>
          {rows.length === 0 && <Notice tone="danger">Aucune ligne de tarif trouvée sur ces pages. Essayez d&apos;autres pages.</Notice>}
          <ul className="space-y-3">
            {slice.map((r, k) => {
              const i = page * PAGE_SIZE + k;
              const w = reviewWarnings(r);
              return (
                <li key={i} className={`rounded-xl border-2 p-3 ${!r.keep ? "border-slate-200 bg-slate-50 opacity-70" : w.length ? "border-danger bg-danger-light" : "border-slate-300"}`}>
                  <label className="flex items-center gap-3 text-base font-bold">
                    <input type="checkbox" className="h-6 w-6" checked={r.keep} onChange={(e) => update(i, { keep: e.target.checked })} />
                    Page {r.sourcePage} {r.brand ? `· ${r.brand}` : ""}
                  </label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Field label="Référence" value={r.reference} onChange={(v) => update(i, { reference: v })} />
                    <Field label="Désignation" value={r.designation} onChange={(v) => update(i, { designation: v })} />
                    <Field label="Prix public HT" inputMode="decimal" suffix="€" value={show(r.public_price_eur)} onChange={(v) => update(i, { public_price_eur: num(v) })} />
                    <Field label="Prix net HT" inputMode="decimal" suffix="€" value={show(r.net_price_eur)} onChange={(v) => update(i, { net_price_eur: num(v) })} />
                    <Field label="Remise" inputMode="decimal" suffix="%" value={show(r.discount_percent)} onChange={(v) => update(i, { discount_percent: num(v) })} />
                    <Field label="Famille de remise" value={r.discount_family ?? ""} onChange={(v) => update(i, { discount_family: v || null })} />
                    {target === "materiel" && <Field label="Code fournisseur" value={r.supplier_ref ?? ""} onChange={(v) => update(i, { supplier_ref: v || null })} />}
                  </div>
                  {w.length > 0 && r.keep && <p className="mt-2 text-base font-bold text-danger">À vérifier : {w.join(", ")}</p>}
                </li>
              );
            })}
          </ul>
          {rows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Précédentes
              </Button>
              <span className="text-base">
                {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} / {rows.length}
              </span>
              <Button type="button" variant="secondary" disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(page + 1)}>
                Suivantes →
              </Button>
            </div>
          )}
        </Card>
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button type="button" variant="secondary" onClick={() => setRows(null)}>
            Changer de pages
          </Button>
          <Button type="button" full disabled={kept === 0} onClick={() => onValidated(rows, doc!.hash)}>
            Suivant : vérifier les colonnes
          </Button>
        </div>
      </div>
    );
  }

  // ----- Choix des pages et quota ----------------------------------------------
  return (
    <div className="space-y-6">
      <Card title="Tarif PDF : lecture automatique">
        <Notice>
          <strong>Le fournisseur a un tarif Excel ou CSV ?</strong> Préférez-le : l&apos;import est gratuit, illimité et sans risque d&apos;erreur de lecture.
        </Notice>
        {!doc && !error && <p className="text-lg">Ouverture du PDF…</p>}
        {doc && (
          <>
            <p className="text-lg">
              <strong>{file.name}</strong> · {doc.pageCount} page
              {doc.pageCount > 1 ? "s" : ""}
            </p>
            <Field
              label="Pages à analyser"
              value={selection}
              onChange={setSelection}
              placeholder={`Toutes (1-${doc.pageCount})`}
              hint="Exemple : 3-12, 15. Laissez vide pour tout le document. Choisissez seulement les pages de prix."
              error={sel && "error" in sel ? sel.error : undefined}
            />
            {status && !status.enabled && <Notice tone="danger">L&apos;import de tarif PDF n&apos;est pas encore activé sur ce compte. Importez le tarif Excel / CSV du fournisseur.</Notice>}
            {status && quota && sel && "pages" in sel && (
              <div className={`rounded-xl border-2 p-3 text-base ${quota.allowed ? "border-slate-300 bg-slate-50" : "border-danger bg-danger-light"}`}>
                <p>
                  Quota du mois : <strong>{status.used}</strong> / {status.quota} pages utilisées.
                </p>
                {sel.pages.length - toAnalyse > 0 && <p>{sel.pages.length - toAnalyse} page(s) déjà analysée(s) pour ce fichier : gratuites.</p>}
                <p className="mt-1 font-bold">{quota.message}</p>
                <p className="mt-1 text-sm text-slate-600">Analyse par lots de {PAGES_PER_CHUNK} pages, environ 20 à 60 secondes par lot.</p>
              </div>
            )}
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {progress && (
          <div>
            <p className="text-base font-bold">
              Lecture en cours : {progress.done} / {progress.total} pages…
            </p>
            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <div
                className="h-full bg-brand"
                style={{
                  width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </Card>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={running}>
          Précédent
        </Button>
        <Button type="button" full disabled={running || !doc || !status?.enabled || !quota?.allowed || !sel || "error" in sel} onClick={analyse}>
          {running ? "Lecture du PDF…" : toAnalyse === 0 && chunks.length ? "Reprendre l'analyse (déjà faite)" : `Analyser ${toAnalyse} page${toAnalyse > 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
