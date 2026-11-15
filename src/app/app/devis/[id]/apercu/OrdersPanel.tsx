"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Choice, Field, Notice } from "@/components/ui";
import { formatEuros } from "@/lib/format";
import { generatePurchaseOrders, type PurchaseOrderSummary } from "../../actions";

/** Bons de commande fournisseur, une fois le devis accepté (prix nets : membres autorisés). */
export function OrdersPanel({ quoteId, orders, hasSiteAddress }: { quoteId: string; orders: PurchaseOrderSummary[]; hasSiteAddress: boolean }) {
  const router = useRouter();
  const [delivery, setDelivery] = useState<"depot" | "chantier">("depot");
  const [date, setDate] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function share(o: PurchaseOrderSummary) {
    setMsg(null);
    try {
      const res = await fetch(`/app/devis/${quoteId}/commande/${o.supplierId}`);
      if (!res.ok) throw new Error();
      const file = new File([await res.blob()], `${o.number}.pdf`, {
        type: "application/pdf",
      });
      if (navigator.canShare?.({ files: [file] }))
        await navigator.share({
          files: [file],
          title: `Bon de commande ${o.number}`,
        });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError")
        setMsg({
          ok: false,
          text: "Impossible de préparer le PDF. Vérifiez votre connexion.",
        });
    }
  }

  return (
    <Card title="Bons de commande fournisseurs">
      <p className="text-base text-slate-700">Un bon par fournisseur retenu : référence fournisseur et fabricant, quantité, prix net attendu. Référence chantier : nom du client et ville, sans aucun prix client.</p>
      <Choice
        label="Livraison"
        value={delivery}
        onChange={setDelivery}
        options={[
          {
            value: "depot",
            label: "Au dépôt",
            hint: "Adresse de départ de vos paramètres",
          },
          {
            value: "chantier",
            label: "Sur le chantier",
            hint: hasSiteAddress ? "Adresse du chantier du devis" : "Adresse du chantier non renseignée",
          },
        ]}
      />
      <Field label="Date de livraison souhaitée" type="date" value={date} onChange={setDate} hint="Facultatif" />
      <Button
        type="button"
        full
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await generatePurchaseOrders(quoteId, delivery, date || null);
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Préparation…" : orders.length ? "Régénérer les bons de commande" : "Générer les bons de commande"}
      </Button>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {orders.length > 0 && (
        <ul className="divide-y-2 divide-slate-200">
          {orders.map((o) => (
            <li key={o.supplierId} className="space-y-2 py-3">
              <p className="text-base">
                <strong>{o.supplierName}</strong> · {o.number} · {formatEuros(o.totalCents)} HT
                <span className="block text-sm text-slate-600">Généré le {new Date(o.generatedAt).toLocaleDateString("fr-FR")}</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a href={`/app/devis/${quoteId}/commande/${o.supplierId}`} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-brand bg-white px-4 text-base font-bold text-brand">
                  Voir le PDF
                </a>
                <Button type="button" onClick={() => share(o)}>
                  Partager
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
