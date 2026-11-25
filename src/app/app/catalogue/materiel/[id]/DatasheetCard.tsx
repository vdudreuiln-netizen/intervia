"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { setDatasheet } from "../../actions";

const MAX = 15_000_000;

/** Fiche technique fabricant : stockée une fois par produit, jointe aux devis qui le contiennent. */
export function DatasheetCard({ productId, companyId, current }: { productId: string; companyId: string; current: { name: string; url: string | null } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(f: File) {
    setMsg(null);
    if (!(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) return setMsg({ ok: false, text: "Choisissez un fichier PDF." });
    if (f.size > MAX) return setMsg({ ok: false, text: "PDF trop lourd (15 Mo maximum)." });
    setBusy(true);
    try {
      const path = `${companyId}/${productId}-${Date.now()}.pdf`;
      const { error } = await createClient().storage.from("datasheets").upload(path, f, { contentType: "application/pdf" });
      if (error) throw new Error("Envoi impossible. Vérifiez votre connexion.");
      const r = await setDatasheet(productId, { path, name: f.name });
      setMsg({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Envoi impossible." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fiche technique fabricant (PDF)">
      <p className="text-base text-slate-700">Jointe automatiquement, en fichier séparé, aux devis qui contiennent ce produit (ou fusionnée dans le « dossier complet »).</p>
      {current && (
        <p className="text-base">
          Actuelle :{" "}
          {current.url ? (
            <a href={current.url} target="_blank" rel="noopener" className="font-bold text-brand underline">
              {current.name}
            </a>
          ) : (
            <strong>{current.name}</strong>
          )}
        </p>
      )}
      <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-brand bg-brand-light px-4 text-center text-lg font-bold text-brand">
        {busy ? "Envoi…" : current ? "Remplacer la fiche technique" : "Ajouter la fiche technique"}
        <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {current && (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await setDatasheet(productId, null);
            setMsg({ ok: r.ok, text: r.message ?? "" });
            setBusy(false);
            if (r.ok) router.refresh();
          }}
        >
          Retirer
        </Button>
      )}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
    </Card>
  );
}
