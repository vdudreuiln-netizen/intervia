"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, MoneyField, Notice, PercentField, Select } from "@/components/ui";
import { centsToInput, formatEuros, formatPercent, rateToInput } from "@/lib/format";
import { SupplierOffers, type OfferView } from "../../SupplierOffers";
import { catalogPrices } from "@/lib/pricing/engine";
import { PRODUCT_TYPE_LABELS } from "@/lib/catalog/import";
import { parseProductForm, type ProductForm, type ProductFormKey } from "@/lib/catalog/forms";
import { deleteProduct, saveProduct } from "../../actions";

interface BrandOpt {
  id: string;
  name: string;
  discount_rate: number;
  sale_coefficient: number;
}

interface SupplierPricing {
  suppliers: { id: string; name: string }[];
  offers: OfferView[];
  /** Remise famille / marque du fournisseur qui s'applique sans remise propre. */
  fallbackBySupplier: Record<string, number>;
  defaultSupplierId: string | null;
}

export function ProductEditor({ id, initial, brands, pricing }: { id: string | null; initial: ProductForm; brands: BrandOpt[]; pricing: SupplierPricing }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [supplierId, setSupplierId] = useState(pricing.defaultSupplierId ?? pricing.suppliers[0]?.id ?? "");
  const fallback = pricing.fallbackBySupplier[supplierId] ?? 0;
  const chooseSupplier = (sid: string) => {
    setSupplierId(sid);
    const o = pricing.offers.find((x) => x.supplierId === sid);
    setForm((f) => ({
      ...f,
      public_price: o?.publicPriceCents != null ? centsToInput(o.publicPriceCents) : f.public_price,
      discount: o ? rateToInput(o.discount) : "",
    }));
  };
  const [errors, setErrors] = useState<Partial<Record<ProductFormKey, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: ProductFormKey) => (v: string) => {
    setForm({ ...form, [k]: v });
    setErrors({ ...errors, [k]: undefined });
    setMsg(null);
  };

  const brand = brands.find((b) => b.id === form.brand_id);
  const parsed = parseProductForm(form);
  const preview =
    brand && parsed.values.public_price_cents > 0 && !parsed.errors.discount
      ? catalogPrices({
          kind: "material",
          publicPriceCents: parsed.values.public_price_cents,
          brandDiscount: fallback,
          productDiscount: parsed.values.discount_rate,
          brandCoefficient: brand.sale_coefficient,
        })
      : null;

  return (
    <div className="space-y-6">
      <Card title="Identification">
        <Select label="Marque" value={form.brand_id} onChange={set("brand_id")} error={errors.brand_id} options={brands.map((b) => ({ value: b.id, label: b.name }))} hint="Pas dans la liste ? Ajoutez-la dans l'onglet Marques." />
        <Field label="Gamme" value={form.range_name} onChange={set("range_name")} />
        <Field label="Référence" value={form.reference} onChange={set("reference")} error={errors.reference} autoCapitalize="characters" />
        <Select label="Type" value={form.type} onChange={set("type")} error={errors.type} options={Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
      </Card>
      {form.type !== "accessoire" && (
        <Card title="Caractéristiques">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Froid" value={form.cooling_kw} onChange={set("cooling_kw")} error={errors.cooling_kw} inputMode="decimal" suffix="kW" />
            <Field label="Chaud" value={form.heating_kw} onChange={set("heating_kw")} error={errors.heating_kw} inputMode="decimal" suffix="kW" />
          </div>
          <Field
            label="Diamètres des liaisons (liquide - gaz)"
            value={form.link_diameters}
            onChange={set("link_diameters")}
            error={errors.link_diameters}
            placeholder="1/4 - 3/8"
            hint="Selon la notice. Vide = règle par défaut selon la puissance."
          />
          {(form.type === "ue_mono" || form.type === "ue_multi") && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Longueur pré-chargée" value={form.precharged_length_m} onChange={set("precharged_length_m")} error={errors.precharged_length_m} inputMode="decimal" suffix="m" />
              <Field label="Complément de charge" value={form.extra_charge_g_per_m} onChange={set("extra_charge_g_per_m")} error={errors.extra_charge_g_per_m} inputMode="numeric" suffix="g/m" />
            </div>
          )}
          {form.type === "ue_multi" && (
            <>
              <Field label="Nombre de sorties max" value={form.max_outlets} onChange={set("max_outlets")} error={errors.max_outlets} inputMode="numeric" />
              <Field
                label="Puissance intérieure cumulée max"
                value={form.max_indoor_ratio}
                onChange={set("max_indoor_ratio")}
                error={errors.max_indoor_ratio}
                inputMode="numeric"
                suffix="%"
                placeholder="130"
                hint="Selon la documentation du fabricant (vide = 130 %)"
              />
            </>
          )}
        </Card>
      )}
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
            hint="Le prix et la remise ci-dessous sont ceux de ce fournisseur."
          />
        )}
        <MoneyField label="Prix public HT (tarif du fournisseur)" value={form.public_price} onChange={set("public_price")} error={errors.public_price} />
        <PercentField label="Remise propre à ce produit" value={form.discount} onChange={set("discount")} error={errors.discount} hint={`Laissez vide pour appliquer la remise de famille ou de marque de ce fournisseur (${formatPercent(fallback)})`} />
        {preview && (
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-100 p-4 text-base">
            <div>
              <span className="block text-slate-600">Prix d&apos;achat chez ce fournisseur</span>
              <strong className="text-xl">{formatEuros(preview.purchaseCents)}</strong>
            </div>
            <div>
              <span className="block text-slate-600">Prix de vente si ce prix public est la référence (× {brand!.sale_coefficient.toLocaleString("fr-FR")})</span>
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
              const r = await saveProduct(id, form, supplierId || null);
              setErrors((r.errors as typeof errors) ?? {});
              setMsg({ ok: r.ok, text: r.message ?? "" });
              if (r.ok) {
                if (!id && r.id) router.replace(`/app/catalogue/materiel/${r.id}`);
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
              if (!confirm("Supprimer ce produit du catalogue ? Les devis existants ne sont pas modifiés.")) return;
              start(async () => {
                const r = await deleteProduct(id);
                if (r.ok) router.push("/app/catalogue?onglet=materiel");
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
