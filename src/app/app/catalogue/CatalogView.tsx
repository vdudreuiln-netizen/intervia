"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState, useTransition } from "react";

const CatalogContext = createContext({ isAdmin: true, showMargin: true, alertMonths: STALE_TARIFF_MONTHS });
import { useRouter } from "next/navigation";
import { Button, Card, Field, LinkButton, Notice, PercentField } from "@/components/ui";
import { formatEuros, formatPercent } from "@/lib/format";
import { PRODUCT_TYPE_LABELS, type ProductType } from "@/lib/catalog/import";
import { ACCESSORY_CATEGORIES, ACCESSORY_UNITS, brandToForm, type BrandForm } from "@/lib/catalog/forms";
import type { AccessoryItem, BrandItem, ProductItem } from "@/lib/catalog/queries";
import { priceSourceText, type PriceSource } from "@/lib/catalog/reference";
import { isTariffStale, STALE_TARIFF_MONTHS } from "@/lib/suppliers/pricing";
import { deleteBrand, deleteExamples, saveBrand } from "./actions";

type Tab = "materiel" | "accessoires" | "marques";
const PAGE = 100;
const kw = (n: number | null) => (n === null ? "" : `${n.toLocaleString("fr-FR")} kW`);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function CatalogView({
  tab,
  brands,
  products,
  accessories,
  accessoryCoefficient,
  purchaseCoefficient,
  isAdmin = true,
  showMargin = true,
  alertMonths,
}: {
  tab: Tab;
  brands: BrandItem[];
  products: (ProductItem & WithSupplier)[];
  accessories: (AccessoryItem & WithSupplier)[];
  accessoryCoefficient: number;
  purchaseCoefficient: number;
  isAdmin?: boolean;
  /** Seuil « tarif ancien » du compte (12 mois par défaut). */
  alertMonths?: number;
  showMargin?: boolean;
}) {
  const hasExamples = brands.some((b) => b.is_example) || accessories.some((a) => a.is_example);
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "materiel", label: "Matériel", count: products.length },
    { id: "accessoires", label: "Accessoires", count: accessories.length },
    ...(isAdmin ? [{ id: "marques" as Tab, label: "Marques", count: brands.length }] : []),
  ];
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-extrabold">Catalogue</h1>
      <nav className={`grid gap-2 ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`} aria-label="Sections du catalogue">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/app/catalogue?onglet=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center rounded-xl border-2 text-base font-bold ${tab === t.id ? "border-brand bg-brand text-white" : "border-slate-400 bg-white text-slate-900"}`}
          >
            {t.label}
            <span className="text-sm font-semibold opacity-80">{t.count}</span>
          </Link>
        ))}
      </nav>
      {hasExamples && isAdmin && <ExamplesNotice />}
      {!isAdmin && <Notice>Catalogue en consultation : seuls les administrateurs le modifient.</Notice>}
      <CatalogContext.Provider value={{ isAdmin, showMargin, alertMonths: alertMonths ?? STALE_TARIFF_MONTHS }}>
        {tab === "materiel" && <ProductList products={products} />}
        {tab === "accessoires" && <AccessoryList accessories={accessories} coefficient={accessoryCoefficient} purchaseCoefficient={purchaseCoefficient} />}
        {tab === "marques" && isAdmin && <BrandList brands={brands} />}
      </CatalogContext.Provider>
    </div>
  );
}

function ExamplesNotice() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Notice>
      <p>Le catalogue contient des données d&apos;exemple (marques « Exemple – … », prix fictifs). Remplacez-les par vos tarifs.</p>
      <button
        type="button"
        disabled={pending}
        className="mt-3 min-h-12 w-full rounded-xl border-2 border-brand bg-white px-4 font-bold text-brand"
        onClick={() => {
          if (!confirm("Supprimer toutes les marques, produits et accessoires d'exemple ?")) return;
          start(async () => setMsg((await deleteExamples()).message ?? null));
        }}
      >
        {pending ? "Suppression…" : "Supprimer les exemples"}
      </button>
      {msg && <p className="mt-2">{msg}</p>}
    </Notice>
  );
}

function Actions({ addHref, addLabel, target }: { addHref: string; addLabel: string; target: "materiel" | "accessoires" }) {
  if (!useContext(CatalogContext).isAdmin) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <LinkButton href={`/app/catalogue/import?cible=${target}`}>Importer un tarif (Excel, CSV, PDF)</LinkButton>
      <LinkButton href={addHref} variant="secondary">
        {addLabel}
      </LinkButton>
    </div>
  );
}

function PriceRow({ purchase, sale, discount, discountNote, source, date }: { purchase: number; sale: number; discount: number; discountNote?: string; source?: PriceSource | null; date?: string | null }) {
  const { showMargin, alertMonths: months } = useContext(CatalogContext);
  const stale = date ? isTariffStale(date, new Date(), months) : false;
  const origin = (
    <p className={`mt-1 text-sm ${stale ? "font-bold text-amber-800" : "text-slate-600"}`}>
      Prix public : {priceSourceText(source, date)}
      {stale ? ` · plus de ${months} mois` : ""}
    </p>
  );
  if (!showMargin) {
    return (
      <>
        <p className="mt-2 text-sm">
          <span className="text-slate-600">Prix de vente HT </span>
          <span className="text-base font-bold">{formatEuros(sale)}</span>
        </p>
        {origin}
      </>
    );
  }
  return (
    <>
    {origin}
    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
      <div>
        <span className="block text-slate-600">Achat</span>
        <span className="text-base font-bold">{formatEuros(purchase)}</span>
      </div>
      <div>
        <span className="block text-slate-600">Vente</span>
        <span className="text-base font-bold">{formatEuros(sale)}</span>
      </div>
      <div>
        <span className="block text-slate-600">Remise{discountNote ? ` ${discountNote}` : ""}</span>
        <span className="text-base font-bold">{formatPercent(discount)}</span>
      </div>
    </div>
    </>
  );
}

type WithSupplier = { supplierCount?: number; bestSupplier?: string | null };
const supplierNote = (x: WithSupplier) => (x.bestSupplier ? `(${x.bestSupplier}${(x.supplierCount ?? 0) > 1 ? `, meilleur de ${x.supplierCount}` : ""})` : undefined);

function ProductList({ products }: { products: (ProductItem & WithSupplier)[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<ProductType | "">("");
  const [limit, setLimit] = useState(PAGE);
  const filtered = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return products.filter((p) => {
      if (type && p.type !== type) return false;
      const hay = norm(`${p.brand_name} ${p.range_name ?? ""} ${p.reference} ${PRODUCT_TYPE_LABELS[p.type]} ${p.cooling_kw ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
  }, [products, q, type]);
  const types = Object.keys(PRODUCT_TYPE_LABELS).filter((t) => products.some((p) => p.type === t)) as ProductType[];

  return (
    <div className="space-y-4">
      <Actions addHref="/app/catalogue/materiel/nouveau" addLabel="+ Ajouter un produit" target="materiel" />
      <Field label="Rechercher" value={q} onChange={setQ} placeholder="Marque, référence, 3,5…" type="search" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[["", "Tous"] as const, ...types.map((t) => [t, PRODUCT_TYPE_LABELS[t]] as const)].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            className={`min-h-12 shrink-0 rounded-full border-2 px-4 text-base font-bold ${type === value ? "border-brand bg-brand text-white" : "border-slate-400 bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-base text-slate-600">{filtered.length} produit(s)</p>
      <ul className="space-y-3">
        {filtered.slice(0, limit).map((p) => (
          <li key={p.id}>
            <CardLink href={`/app/catalogue/materiel/${p.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold">
                    {p.brand_name} {p.reference}
                  </p>
                  <p className="text-base text-slate-700">
                    {PRODUCT_TYPE_LABELS[p.type]}
                    {p.cooling_kw ? ` · ${kw(p.cooling_kw)}` : ""}
                    {p.type === "ue_multi" && p.max_outlets ? ` · ${p.max_outlets} sorties` : ""}
                  </p>
                </div>
                {p.is_example && <span className="rounded-md bg-amber-200 px-2 py-1 text-xs font-bold text-amber-900">EXEMPLE</span>}
              </div>
              <PriceRow purchase={p.prices.purchaseCents} sale={p.prices.saleCents} discount={p.prices.discount} discountNote={supplierNote(p) ?? (p.discount_rate === null ? "(marque)" : "(produit)")} source={p.price_source} date={p.price_date} />
            </CardLink>
          </li>
        ))}
      </ul>
      {filtered.length > limit && (
        <Button type="button" variant="secondary" full onClick={() => setLimit(limit + PAGE)}>
          Afficher plus
        </Button>
      )}
    </div>
  );
}

function AccessoryList({ accessories, coefficient, purchaseCoefficient }: { accessories: (AccessoryItem & WithSupplier)[]; coefficient: number; purchaseCoefficient: number }) {
  const [q, setQ] = useState("");
  const filtered = accessories.filter((a) => norm(`${a.name} ${a.diameter ?? ""} ${a.reference ?? ""} ${ACCESSORY_CATEGORIES[a.category] ?? a.category}`).includes(norm(q.trim())));
  const groups = [...new Set(filtered.map((a) => a.category))];
  return (
    <div className="space-y-4">
      <Actions addHref="/app/catalogue/accessoires/nouveau" addLabel="+ Ajouter un accessoire" target="accessoires" />
      <p className="text-base text-slate-700">
        Prix de vente = prix public × {coefficient.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}, et jamais moins que l&apos;achat ×{" "}
        {purchaseCoefficient.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
        })}{" "}
        (
        <Link href="/app/parametres" className="font-bold text-brand underline">
          modifier
        </Link>
        ).
      </p>
      <Field label="Rechercher" value={q} onChange={setQ} placeholder="Liaison, 3/8, pompe…" type="search" />
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-xl font-bold">{ACCESSORY_CATEGORIES[g] ?? g}</h2>
          <ul className="space-y-3">
            {filtered
              .filter((a) => a.category === g)
              .map((a) => (
                <li key={a.id}>
                  <CardLink href={`/app/catalogue/accessoires/${a.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-bold">
                        {a.name}
                        {a.diameter ? ` ${a.diameter}` : ""}
                        <span className="block text-base font-normal text-slate-700">
                          {a.reference ? `${a.reference} · ` : ""}prix {ACCESSORY_UNITS[a.unit] ?? a.unit}
                        </span>
                      </p>
                      {a.is_example && <span className="rounded-md bg-amber-200 px-2 py-1 text-xs font-bold text-amber-900">EXEMPLE</span>}
                    </div>
                    <PriceRow purchase={a.prices.purchaseCents} sale={a.prices.saleCents} discount={a.prices.discount} discountNote={supplierNote(a)} source={a.price_source} date={a.price_date} />
                  </CardLink>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BrandList({ brands }: { brands: BrandItem[] }) {
  return (
    <div className="space-y-4">
      <p className="text-base text-slate-700">
        Prix de vente = prix public de référence × coefficient : 1,00 = prix public, 1,10 = prix public + 10 %. Les remises se règlent par fournisseur (menu{" "}
        <Link href="/app/fournisseurs" className="font-bold underline">
          Fournisseurs
        </Link>
        ).
      </p>
      {brands.map((b) => (
        <BrandEditor key={b.id} brand={b} />
      ))}
      <BrandEditor />
    </div>
  );
}

function BrandEditor({ brand }: { brand?: BrandItem }) {
  const router = useRouter();
  const [form, setForm] = useState<BrandForm>(brandToForm(brand));
  const [errors, setErrors] = useState<Partial<Record<keyof BrandForm, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof BrandForm) => (v: string) => {
    setForm({ ...form, [k]: v });
    setMsg(null);
  };
  return (
    <Card title={brand ? undefined : "Ajouter une marque"}>
      <Field label="Marque" value={form.name} onChange={set("name")} error={errors.name} />
      {brand?.is_example && <p className="text-sm font-bold text-amber-800">Marque d&apos;exemple (fictive)</p>}
      <Field label="Coefficient de vente" value={form.sale_coefficient} onChange={set("sale_coefficient")} error={errors.sale_coefficient} inputMode="decimal" suffix="×" />
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          full
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveBrand(brand?.id ?? null, form);
              setErrors(r.errors ?? {});
              setMsg({ ok: r.ok, text: r.message ?? "" });
              if (r.ok && !brand) {
                setForm(brandToForm());
                router.refresh();
              }
            })
          }
        >
          {brand ? "Enregistrer" : "Ajouter la marque"}
        </Button>
        {brand && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              const warn = brand.product_count > 0 ? `Supprimer « ${brand.name} » et ses ${brand.product_count} produit(s) ?` : `Supprimer « ${brand.name} » ?`;
              if (!confirm(warn)) return;
              start(async () => {
                const r = await deleteBrand(brand.id);
                if (!r.ok) setMsg({ ok: false, text: r.message ?? "" });
                else router.refresh();
              });
            }}
          >
            Supprimer
          </Button>
        )}
      </div>
      {brand && <p className="text-sm text-slate-600">{brand.product_count} produit(s)</p>}
    </Card>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  const cls = "block rounded-2xl border-2 border-slate-300 bg-white p-4";
  return useContext(CatalogContext).isAdmin ? (
    <Link href={href} className={`${cls} hover:border-brand`}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}
