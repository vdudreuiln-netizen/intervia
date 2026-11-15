"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { registerPlan } from "./actions";

const MAX_SIDE = 2400;
const MAX_BYTES = 3_500_000;

/** Image (canvas) → JPEG, réduite si besoin. */
async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const b = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
    if (b && b.size <= MAX_BYTES) return b;
  }
  throw new Error("Image trop lourde même compressée.");
}

function fit(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { w, h } = fit(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return c;
}

async function pdfPageCount(file: File): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return doc.numPages;
}

async function pdfPageToCanvas(file: File, pageNumber: number): Promise<HTMLCanvasElement> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
  const c = document.createElement("canvas");
  c.width = Math.round(viewport.width);
  c.height = Math.round(viewport.height);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
  return c;
}

export function PlanUpload({ quoteId, companyId, level, levelLabel }: { quoteId: string; companyId: string; level: number; levelLabel: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPdf = file ? file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") : false;

  async function choose(f: File) {
    setError(null);
    setFile(f);
    setPages(0);
    if (f.size > 40_000_000) return setError("Fichier trop lourd (40 Mo maximum).");
    if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
      try {
        setPages(await pdfPageCount(f));
      } catch {
        setError("Ce PDF n'a pas pu être ouvert (protégé ou abîmé).");
      }
    }
  }

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = isPdf ? await pdfPageToCanvas(file, Math.min(Math.max(1, Number(page) || 1), pages || 1)) : await imageFileToCanvas(file);
      const blob = await canvasToJpeg(canvas);
      const path = `${companyId}/${quoteId}/niveau${level}-${Date.now()}.jpg`;
      const { error: upErr } = await createClient().storage.from("plans").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw new Error("Envoi du plan impossible. Vérifiez votre connexion.");
      const r = await registerPlan(quoteId, level, { path, width: canvas.width, height: canvas.height, sourceName: file.name, sourceKind: isPdf ? "pdf" : "image" });
      if (!r.ok) throw new Error(r.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Plan – ${levelLabel}`}>
      <p className="text-base text-slate-700">PDF d&apos;architecte, plan d&apos;agence immobilière, photo d&apos;un plan papier ou croquis à main levée. Un plan par niveau.</p>
      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand bg-brand-light px-4 text-center text-lg font-bold text-brand">
        {file ? `✔ ${file.name}` : "📐 Choisir le plan (PDF, photo, image)"}
        <span className="text-base font-normal">Sur téléphone : vous pouvez prendre la photo directement</span>
        <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
      </label>
      {isPdf && pages > 1 && <Field label={`Page du plan (1 à ${pages})`} inputMode="numeric" value={page} onChange={setPage} hint="Si le PDF contient plusieurs niveaux, importez chaque page dans son niveau." />}
      <p className="text-sm text-slate-600">Photo : prenez le plan bien à plat, de face, sans reflet, tout le plan dans le cadre.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="button" full disabled={!file || busy || (isPdf && pages === 0)} onClick={send}>
        {busy ? "Préparation du plan…" : "Importer ce plan"}
      </Button>
    </Card>
  );
}
