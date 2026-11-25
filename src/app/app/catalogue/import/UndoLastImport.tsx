"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice } from "@/components/ui";
import { undoLastImport, type LastImport } from "./actions";

/** « Annuler le dernier import » : retour aux prix et articles d'avant (devis émis inchangés). */
export function UndoLastImport({ last }: { last: LastImport }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const date = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "?");
  return (
    <Card title="Dernier import">
      <p className="text-base">
        <strong>{last.filename ?? "Fichier"}</strong>
        {last.supplier ? ` · ${last.supplier}` : ""} · importé le {new Date(last.createdAt).toLocaleDateString("fr-FR")} · tarif du {date(last.tariffDate)} · {last.priceKind === "net" ? "prix nets" : "prix publics"} · {last.created} création(s), {last.updated} mise(s) à jour
      </p>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <Button
        type="button"
        variant="secondary"
        full
        disabled={pending}
        onClick={() => {
          if (!confirm("Annuler ce dernier import ? Les prix et les articles reviennent à leur état d'avant. Les devis déjà émis ne changent pas.")) return;
          start(async () => {
            const r = await undoLastImport();
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) router.refresh();
          });
        }}
      >
        {pending ? "Annulation…" : "↶ Annuler le dernier import"}
      </Button>
    </Card>
  );
}
