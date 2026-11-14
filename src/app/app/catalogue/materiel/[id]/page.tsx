import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { loadBrands, loadPriceHistory } from "@/lib/catalog/queries";
import { productToForm } from "@/lib/catalog/forms";
import { PriceHistory } from "../../PriceHistory";
import { ProductEditor } from "./ProductEditor";

export const metadata: Metadata = { title: "Produit" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getCurrentCompany();
  const brands = await loadBrands(supabase);
  const isNew = id === "nouveau";
  let initial = productToForm();
  let history: Awaited<ReturnType<typeof loadPriceHistory>> = [];
  if (!isNew) {
    const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    initial = productToForm({ ...data, cooling_kw: data.cooling_kw === null ? null : Number(data.cooling_kw), heating_kw: data.heating_kw === null ? null : Number(data.heating_kw), max_indoor_ratio: data.max_indoor_ratio === null ? null : Number(data.max_indoor_ratio), discount_rate: data.discount_rate === null ? null : Number(data.discount_rate), precharged_length_m: data.precharged_length_m === null ? null : Number(data.precharged_length_m) });
    history = await loadPriceHistory(supabase, "product_id", id);
  }
  return (
    <div className="space-y-6">
      <Link href="/app/catalogue?onglet=materiel" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Catalogue
      </Link>
      <h1 className="text-3xl font-extrabold">{isNew ? "Nouveau produit" : "Produit"}</h1>
      <ProductEditor id={isNew ? null : id} initial={initial} brands={brands.map((b) => ({ id: b.id, name: b.name, discount_rate: b.discount_rate, sale_coefficient: b.sale_coefficient }))} />
      <PriceHistory items={history} />
    </div>
  );
}
