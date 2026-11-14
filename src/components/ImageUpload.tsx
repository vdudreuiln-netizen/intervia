"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ASSETS_BUCKET } from "@/lib/supabase/env";

const MAX_BYTES = 2 * 1024 * 1024;
// PNG ou JPG uniquement : le moteur PDF ne lit pas le WebP
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

/** Envoi d'une image (logo, tampon) dans le dossier privé de l'entreprise. */
export function ImageUpload({
  label,
  hint,
  companyId,
  kind,
  path,
  initialPreview,
  onChange,
}: {
  label: string;
  hint: string;
  companyId: string;
  kind: "logo" | "tampon";
  path: string;
  initialPreview: string | null;
  onChange: (path: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(path ? initialPreview : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const ext = TYPES[file.type];
    if (!ext) return setError("Format accepté : PNG ou JPG.");
    if (file.size > MAX_BYTES) return setError("Image trop lourde : 2 Mo maximum.");
    setBusy(true);
    try {
      const supabase = createClient();
      const newPath = `${companyId}/${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(ASSETS_BUCKET).upload(newPath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data } = await supabase.storage.from(ASSETS_BUCKET).createSignedUrl(newPath, 3600);
      setPreview(data?.signedUrl ?? null);
      onChange(newPath);
    } catch {
      setError("L'envoi a échoué. Vérifiez votre connexion et réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-1 text-base font-bold text-slate-900">{label}</p>
      <p className="mb-2 text-sm text-slate-600">{hint}</p>
      {preview ? (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={label} className="h-24 w-auto max-w-[60%] rounded-lg border-2 border-slate-300 bg-white object-contain p-1" />
          <button
            type="button"
            className="min-h-12 rounded-xl border-2 border-slate-400 px-4 text-base font-bold"
            onClick={() => {
              setPreview(null);
              onChange("");
            }}
          >
            Retirer
          </button>
        </div>
      ) : (
        <label className="flex min-h-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-brand bg-brand-light px-4 text-center text-lg font-bold text-brand">
          {busy ? "Envoi en cours…" : "📷 Choisir ou prendre une photo"}
          <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      )}
      {error && <p role="alert" className="mt-1 text-base font-bold text-danger">{error}</p>}
    </div>
  );
}
