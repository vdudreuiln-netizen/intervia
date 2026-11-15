import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { loadBrands, loadPriceHistory } from "@/lib/catalog/queries";
import { productToForm } from "@/lib/catalog/forms";
import { PriceHistory } from "../../PriceHistory";
import { ProductEditor } from "./ProductEditor";
import { DatasheetCard } from "./DatasheetCard";
import { loadDiscountBook, loadOffers, loadSuppliers } from "@/lib/suppliers/load";
import { buildItemPricing } from "@/lib/suppliers/views";
import { centsToInput, rateToInput } from "@/lib/format";

export const metadata: Metadata = { title: "Produit" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, role, company } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const brands = await loadBrands(supabase, company.id);
  const isNew = id === "nouveau";
  let initial = productToForm();
  let history: Awaited<ReturnType<typeof loadPriceHistory>> = [];
  let refPublic: number | null = null;
  let datasheet: { name: string; url: string | null } | null = null;
  if (!isNew) {
    const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    refPublic = Number(data.public_price_cents);
    if (data.datasheet_path) {
      const { data: signed } = await supabase.storage.from("datasheets").createSignedUrl(data.datasheet_path, 600);
      datasheet = { name: data.datasheet_name ?? "Fiche technique.pdf", url: signed?.signedUrl ?? null };
    }
    initial = productToForm({
      ...data,
      cooling_kw: data.cooling_kw === null ? null : Number(data.cooling_kw),
      heating_kw: data.heating_kw === null ? null : Number(data.heating_kw),
      max_indoor_ratio: data.max_indoor_ratio === null ? null : Number(data.max_indoor_ratio),
      discount_rate: data.discount_rate === null ? null : Number(data.discount_rate),
      precharged_length_m: data.precharged_length_m === null ? null : Number(data.precharged_length_m),
    });
    history = await loadPriceHistory(supabase, "product_id", id);
  }
  const [suppliers, book, offers] = await Promise.all([loadSuppliers(supabase, company.id), loadDiscountBook(supabase, company.id), isNew ? Promise.resolve([]) : loadOffers(supabase, company.id, { productIds: [id] })]);
  const brandId = isNew ? null : initial.brand_id || null;
  const { data: brandRow } = brandId ? await supabase.from("brands").select("reference_supplier_id").eq("id", brandId).maybeSingle() : { data: null };
  const pricing = buildItemPricing({
    suppliers,
    offers,
    brandId,
    book,
    referenceSupplierId: brandRow?.reference_supplier_id ?? null,
    referencePublicCents: refPublic,
  });
  // Champs de prix : ceux du fournisseur proposé par défaut
  const own = offers.find((o) => o.supplierId === pricing.defaultSupplierId);
  if (own)
    initial = {
      ...initial,
      public_price: own.publicPriceCents !== null ? centsToInput(own.publicPriceCents) : initial.public_price,
      discount: rateToInput(own.discount),
    };
  return (
    <div className="space-y-6">
      <Link href="/app/catalogue?onglet=materiel" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Catalogue
      </Link>
      <h1 className="text-3xl font-extrabold">{isNew ? "Nouveau produit" : "Produit"}</h1>
      <ProductEditor
        id={isNew ? null : id}
        initial={initial}
        brands={brands.map((b) => ({
          id: b.id,
          name: b.name,
          discount_rate: b.discount_rate,
          sale_coefficient: b.sale_coefficient,
        }))}
        pricing={pricing}
      />
      {!isNew && <DatasheetCard productId={id} companyId={company.id} current={datasheet} />}
      <PriceHistory items={history} />
    </div>
  );
}
