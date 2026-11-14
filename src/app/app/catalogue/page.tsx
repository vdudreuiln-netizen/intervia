import type { Metadata } from "next";
import { getCurrentCompany } from "@/lib/company/current";
import { loadAccessories, loadBrands, loadProducts } from "@/lib/catalog/queries";
import { CatalogView } from "./CatalogView";

export const metadata: Metadata = { title: "Catalogue" };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const { onglet } = await searchParams;
  const { supabase, company } = await getCurrentCompany();
  const [brands, products, accessories] = await Promise.all([loadBrands(supabase), loadProducts(supabase), loadAccessories(supabase, company.accessory_sale_coefficient, company.accessory_purchase_coefficient)]);
  const tab = onglet === "accessoires" || onglet === "marques" ? onglet : "materiel";
  return <CatalogView tab={tab} brands={brands} products={products} accessories={accessories} accessoryCoefficient={company.accessory_sale_coefficient} purchaseCoefficient={company.accessory_purchase_coefficient} />;
}
