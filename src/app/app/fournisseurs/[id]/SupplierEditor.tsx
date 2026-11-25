"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, LinkButton, MoneyField, Notice, PercentField, TextArea } from "@/components/ui";
import { rateInput, type SupplierErrors, type SupplierForm } from "@/lib/suppliers/forms";
import { STALE_TARIFF_MONTHS } from "@/lib/suppliers/pricing";
import { deleteSupplier, saveBrandDiscounts, saveFamilyDiscounts, saveSupplier, setSupplierActive } from "../actions";

type Msg = { ok: boolean; text: string } | null;

export function SupplierEditor({
  id,
  initial,
  active,
  brands,
  families,
  offerCount,
  stale,
  lastUpdate,
}: {
  id: string | null;
  initial: SupplierForm;
  active: boolean;
  brands: { id: string; name: string; rate: number | null }[];
  families: { family: string; rate: number | null }[];
  offerCount: number;
  stale: boolean;
  lastUpdate: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<SupplierErrors>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Omit<SupplierForm, "tiers">) => (v: string) => {
    setForm({ ...form, [k]: v });
    setErrors({ ...errors, [k]: undefined });
  };

  return (
    <div className="space-y-6">
      {id && stale && (
        <Notice tone="danger">
          Tarif ancien : {lastUpdate ? `dernière mise à jour le ${new Date(lastUpdate).toLocaleDateString("fr-FR")}` : "aucun tarif importé"} (plus de {STALE_TARIFF_MONTHS} mois). Importez le nouveau tarif.
        </Notice>
      )}
      {id && (
        <div className="grid gap-3 sm:grid-cols-2">
          <LinkButton href="/app/catalogue/import?cible=materiel">Importer un tarif matériel</LinkButton>
          <LinkButton href="/app/catalogue/import?cible=accessoires" variant="secondary">
            Importer un tarif accessoires
          </LinkButton>
        </div>
      )}
      {id && (
        <p className="text-base text-slate-700">
          {offerCount} article{offerCount > 1 ? "s" : ""} au tarif de ce fournisseur.
        </p>
      )}

      <Card title="Coordonnées">
        <Field label="Nom" value={form.name} onChange={set("name")} error={errors.name} />
        <Field label="Agence" value={form.agency} onChange={set("agency")} placeholder="Ex. : agence de Mérignac" />
        <Field label="Contact" value={form.contact_name} onChange={set("contact_name")} placeholder="Nom de votre commercial" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Téléphone" type="tel" value={form.phone} onChange={set("phone")} />
          <Field label="E-mail" type="email" value={form.email} onChange={set("email")} error={errors.email} />
        </div>
      </Card>

      <Card title="Livraison et frais de port">
        <TextArea label="Conditions de livraison" value={form.delivery_terms} onChange={set("delivery_terms")} hint="Ex. : commande avant 16 h livrée le lendemain" />
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label="Frais de port HT" value={form.shipping_fee} onChange={set("shipping_fee")} error={errors.shipping_fee} hint="Sous le franco. 0 = port offert" />
          <MoneyField label="Franco de port HT" value={form.franco} onChange={set("franco")} error={errors.franco} hint="Vide = pas de franco" />
        </div>
        <div>
          <p className="text-base font-bold">Barème par paliers (facultatif)</p>
          <p className="text-sm text-slate-600">Ex. : 18,50 € dès 150 €, 10 € dès 300 €. Le franco reste prioritaire.</p>
          {form.tiers.map((t, i) => (
            <div key={i} className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <MoneyField
                label="À partir de"
                value={t.from}
                onChange={(v) =>
                  setForm({
                    ...form,
                    tiers: form.tiers.map((x, j) => (j === i ? { ...x, from: v } : x)),
                  })
                }
              />
              <MoneyField
                label="Frais"
                value={t.fee}
                onChange={(v) =>
                  setForm({
                    ...form,
                    tiers: form.tiers.map((x, j) => (j === i ? { ...x, fee: v } : x)),
                  })
                }
              />
              <button
                type="button"
                className="min-h-14 rounded-xl border-2 border-slate-400 px-4 font-bold"
                aria-label="Retirer ce palier"
                onClick={() =>
                  setForm({
                    ...form,
                    tiers: form.tiers.filter((_, j) => j !== i),
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
          {errors.tiers && <p className="mt-1 text-base font-bold text-danger">{errors.tiers}</p>}
          <button
            type="button"
            className="mt-2 text-base font-bold text-brand underline"
            onClick={() =>
              setForm({
                ...form,
                tiers: [...form.tiers, { from: "", fee: "" }],
              })
            }
          >
            + Ajouter un palier
          </button>
        </div>
      </Card>

      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <Button
        type="button"
        full
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveSupplier(id, form);
            setErrors(r.errors ?? {});
            setMsg({ ok: r.ok, text: r.message ?? "" });
            if (r.ok && !id && r.id) router.push(`/app/fournisseurs/${r.id}`);
            else if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>

      {id && (
        <DiscountCard
          title="Remises par marque"
          hint="Remise par défaut chez ce fournisseur. Une remise de famille ou de référence l'emporte."
          rows={brands.map((b) => ({ key: b.id, label: b.name, rate: b.rate }))}
          onSave={(entries) => saveBrandDiscounts(id, entries)}
        />
      )}
      {id && (
        <DiscountCard
          title="Remises par famille de remise"
          hint="Famille indiquée dans le tarif (ou la gamme). Plus précise que la marque ; une remise sur la référence l'emporte."
          rows={families.map((f) => ({
            key: f.family,
            label: f.family,
            rate: f.rate,
          }))}
          allowAdd
          onSave={(entries) => saveFamilyDiscounts(id, entries)}
        />
      )}

      {id && (
        <Card title="Gestion">
          <Button
            type="button"
            variant="secondary"
            full
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setSupplierActive(id, !active);
                setMsg({ ok: r.ok, text: r.message ?? "" });
                if (r.ok) router.refresh();
              })
            }
          >
            {active ? "Désactiver (ses tarifs ne sont plus utilisés)" : "Réactiver"}
          </Button>
          <button
            type="button"
            className="min-h-12 w-full text-base font-bold text-danger underline"
            disabled={pending}
            onClick={() => {
              if (!confirm("Supprimer ce fournisseur et tous ses tarifs ? Les articles restent au catalogue.")) return;
              start(async () => {
                const r = await deleteSupplier(id);
                if (r.ok) router.push("/app/fournisseurs");
                else setMsg({ ok: false, text: r.message ?? "" });
              });
            }}
          >
            Supprimer ce fournisseur
          </button>
        </Card>
      )}
    </div>
  );
}

function DiscountCard({
  title,
  hint,
  rows,
  allowAdd = false,
  onSave,
}: {
  title: string;
  hint: string;
  rows: { key: string; label: string; rate: number | null }[];
  allowAdd?: boolean;
  onSave: (entries: { key: string; rate: string }[]) => Promise<{
    ok: boolean;
    message?: string;
    errors?: Record<string, string>;
  }>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => rows.map((r) => ({ key: r.key, label: r.label, rate: rateInput(r.rate) })));
  const [bulk, setBulk] = useState("");
  const [newFamily, setNewFamily] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <Card title={title}>
      <p className="text-base text-slate-700">{hint} Vide = pas de remise à ce niveau.</p>
      {values.length === 0 && !allowAdd && <p className="text-base text-slate-600">Aucune marque dans les tarifs de ce fournisseur pour l&apos;instant.</p>}
      {values.length > 1 && (
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <PercentField label="Saisie en masse : même remise partout" value={bulk} onChange={setBulk} />
          <Button type="button" variant="secondary" onClick={() => setValues(values.map((v) => ({ ...v, rate: bulk })))}>
            Appliquer
          </Button>
        </div>
      )}
      {values.map((v, i) => (
        <PercentField key={v.key} label={v.label} value={v.rate} error={errors[v.key]} onChange={(r) => setValues(values.map((x, j) => (j === i ? { ...x, rate: r } : x)))} />
      ))}
      {allowAdd && (
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Ajouter une famille" value={newFamily} onChange={setNewFamily} placeholder="Ex. : MURAUX R32" />
          <Button
            type="button"
            variant="secondary"
            disabled={!newFamily.trim() || values.some((v) => v.key.toLowerCase() === newFamily.trim().toLowerCase())}
            onClick={() => {
              setValues([...values, { key: newFamily.trim(), label: newFamily.trim(), rate: "" }]);
              setNewFamily("");
            }}
          >
            Ajouter
          </Button>
        </div>
      )}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {values.length > 0 && (
        <Button
          type="button"
          full
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await onSave(values.map((v) => ({ key: v.key, rate: v.rate })));
              setErrors(r.errors ?? {});
              setMsg({ ok: r.ok, text: r.message ?? "" });
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? "Enregistrement…" : "Enregistrer les remises"}
        </Button>
      )}
    </Card>
  );
}
