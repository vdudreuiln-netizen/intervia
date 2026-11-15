"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, MoneyField, Notice, PercentField, Select } from "@/components/ui";
import { centsToInput, formatEuros, rateToInput } from "@/lib/format";
import type { ItemPricing } from "@/lib/suppliers/views";
import { SupplierOffers } from "../../SupplierOffers";
import { catalogPrices } from "@/lib/pricing/engine";
import { ACCESSORY_CATEGORIES, ACCESSORY_UNITS, parseAccessoryForm, type AccessoryForm, type AccessoryFormKey } from "@/lib/catalog/forms";
import { AUTO_ROLE_LABELS } from "@/lib/quote/types";
import { deleteAccessory, saveAccessory } from "../../actions";

export function AccessoryEditor({ id, initial, coefficient, purchaseCoefficient, pricing }: { id: string | null; initial: AccessoryForm; coefficient: number; purchaseCoefficient: number; pricing: ItemPricing }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [supplierId, setSupplierId] = useState(pricing.defaultSupplierId ?? pricing.suppliers[0]?.id ?? "");
  const fallback = pricing.fallbackBySupplier[supplierId] ?? 0;
  const chooseSupplier = (sid: string) => {
    setSupplierId(sid);
    const o = pricing.offers.find((x) => x.supplierId === sid);
    if (o)
      setForm((f) => ({
        ...f,
        public_price: o.publicPriceCents !== null ? centsToInput(o.publicPriceCents) : "",
        discount: rateToInput(o.discount),
        purchase_price: o.publicPriceCents === null && o.netCents !== null ? centsToInput(o.netCents) : f.purchase_price,
      }));
  };
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
    (parsed.values.public_price_cents ?? 0) > 0 || (parsed.values.purchase_price_cents ?? 0) > 0
      ? catalogPrices({
          kind: "accessory",
          publicPriceCents: parsed.values.public_price_cents,
          purchasePriceCents: parsed.values.purchase_price_cents,
          discount: form.discount.trim() === "" ? fallback : parsed.values.discount_rate,
          companyCoefficient: coefficient,
          purchaseCoefficient,
        })
      : null;
  const per = form.unit === "m" ? " / m" : form.unit === "kg" ? " / kg" : "";

  return (
    <div className="space-y-6">
      <Card title="Accessoire">
        <Select label="Catégorie" value={form.category} onChange={set("category")} error={errors.category} options={Object.entries(ACCESSORY_CATEGORIES).map(([value, label]) => ({ value, label }))} />
        <Field label="Désignation" value={form.name} onChange={set("name")} error={errors.name} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Diamètre / taille" value={form.diameter} onChange={set("diameter")} error={errors.diameter} placeholder="1/4 - 3/8" />
          <Select label="Prix" value={form.unit} onChange={set("unit")} error={errors.unit} options={Object.entries(ACCESSORY_UNITS).map(([value, label]) => ({ value, label }))} />
        </div>
        <Select
          label="Ajout automatique aux devis"
          value={form.auto_role}
          onChange={set("auto_role")}
          error={errors.auto_role}
          options={Object.entries(AUTO_ROLE_LABELS).map(([value, label]) => ({ value, label }))}
          placeholder="Non (ajout manuel)"
          hint="Le premier accessoire de chaque rôle est ajouté automatiquement (décochable au métré)"
        />
        <Field label="Référence fournisseur" value={form.reference} onChange={set("reference")} hint="Permet de mettre à jour le prix lors d'un import de tarif" />
      </Card>
      <SupplierOffers offers={pricing.offers} />
      <Card title="Tarif chez un fournisseur">
        {pricing.suppliers.length === 0 ? (
          <Notice tone="danger">Créez d&apos;abord un fournisseur (menu Fournisseurs).</Notice>
        ) : (
          <Select
            label="Fournisseur"
            value={supplierId}
            onChange={chooseSupplier}
            options={pricing.suppliers.map((x) => ({
              value: x.id,
              label: x.name,
            }))}
            hint="Le prix et la remise ci-dessous sont ceux de ce fournisseur. Le prix de vente reste le même quel que soit le fournisseur."
          />
        )}
        <MoneyField label={`Prix public HT${per}`} value={form.public_price} onChange={set("public_price")} error={errors.public_price} />
        {form.public_price.trim() !== "" ? (
          <PercentField label="Remise propre à cet accessoire" value={form.discount} onChange={set("discount")} error={errors.discount} hint={`Vide = remise de famille de ce fournisseur (${(fallback * 100).toLocaleString("fr-FR")} %)`} />
        ) : (
          <MoneyField label={`Prix d'achat HT${per} (si pas de prix public)`} value={form.purchase_price} onChange={set("purchase_price")} hint={`Vendu prix d'achat × ${purchaseCoefficient.toLocaleString("fr-FR")}`} />
        )}
        {preview && (
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-100 p-4 text-base">
            <div>
              <span className="block text-slate-600">Prix d&apos;achat{per}</span>
              <strong className="text-xl">{formatEuros(preview.purchaseCents)}</strong>
            </div>
            <div>
              <span className="block text-slate-600">Prix de vente{per}</span>
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
              const r = await saveAccessory(id, form, supplierId || null);
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
