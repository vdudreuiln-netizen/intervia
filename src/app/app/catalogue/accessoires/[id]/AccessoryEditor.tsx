"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, MoneyField, Notice, PercentField, Select } from "@/components/ui";
import { formatEuros } from "@/lib/format";
import { catalogPrices } from "@/lib/pricing/engine";
import { ACCESSORY_CATEGORIES, ACCESSORY_UNITS, parseAccessoryForm, type AccessoryForm, type AccessoryFormKey } from "@/lib/catalog/forms";
import { deleteAccessory, saveAccessory } from "../../actions";

export function AccessoryEditor({ id, initial, coefficient }: { id: string | null; initial: AccessoryForm; coefficient: number }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<AccessoryFormKey, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: AccessoryFormKey) => (v: string) => {
    setForm({ ...form, [k]: v });
    setErrors({ ...errors, [k]: undefined });
    setMsg(null);
  };
  const parsed = parseAccessoryForm(form);
  const preview =
    parsed.values.public_price_cents > 0 && !parsed.errors.discount
      ? catalogPrices({ kind: "accessory", publicPriceCents: parsed.values.public_price_cents, discount: parsed.values.discount_rate, companyCoefficient: coefficient })
      : null;
  const per = form.unit === "m" ? " / m" : form.unit === "kg" ? " / kg" : "";

  return (
    <div className="space-y-6">
      <Card title="Accessoire">
        <Select label="Catégorie" value={form.category} onChange={set("category")} error={errors.category} options={Object.entries(ACCESSORY_CATEGORIES).map(([value, label]) => ({ value, label }))} />
        <Field label="Désignation" value={form.name} onChange={set("name")} error={errors.name} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Diamètre / taille" value={form.diameter} onChange={set("diameter")} placeholder="1/4 - 3/8" />
          <Select label="Prix" value={form.unit} onChange={set("unit")} error={errors.unit} options={Object.entries(ACCESSORY_UNITS).map(([value, label]) => ({ value, label }))} />
        </div>
        <Field label="Référence fournisseur" value={form.reference} onChange={set("reference")} hint="Permet de mettre à jour le prix lors d'un import de tarif" />
      </Card>
      <Card title="Prix">
        <MoneyField label={`Prix public HT${per}`} value={form.public_price} onChange={set("public_price")} error={errors.public_price} />
        <PercentField label="Remise fournisseur" value={form.discount} onChange={set("discount")} error={errors.discount} />
        {preview && (
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-100 p-4 text-base">
            <div>
              <span className="block text-slate-600">Prix d&apos;achat{per}</span>
              <strong className="text-xl">{formatEuros(preview.purchaseCents)}</strong>
            </div>
            <div>
              <span className="block text-slate-600">Vente (achat × {coefficient.toLocaleString("fr-FR")}){per}</span>
              <strong className="text-xl">{formatEuros(preview.saleCents)}</strong>
            </div>
          </div>
        )}
      </Card>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          full
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveAccessory(id, form);
              setErrors((r.errors as typeof errors) ?? {});
              setMsg({ ok: r.ok, text: r.message ?? "" });
              if (r.ok) {
                if (!id && r.id) router.replace(`/app/catalogue/accessoires/${r.id}`);
                else router.refresh();
              }
            })
          }
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {id && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              if (!confirm("Supprimer cet accessoire ?")) return;
              start(async () => {
                const r = await deleteAccessory(id);
                if (r.ok) router.push("/app/catalogue?onglet=accessoires");
                else setMsg({ ok: false, text: r.message ?? "" });
              });
            }}
          >
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}
