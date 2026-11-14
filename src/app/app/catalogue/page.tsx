import type { Metadata } from "next";
import { costAccess } from "@/lib/security/costs";
import { loadAccessories, loadBrands, loadProducts } from "@/lib/catalog/queries";
import { CatalogView } from "./CatalogView";

export const metadata: Metadata = { title: "Catalogue" };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const { onglet } = await searchParams;
  const { db, companyId, company, role, canSeeMargins, restricted } = await costAccess();
  const [brands, products, accessories] = await Promise.all([
    restricted ? Promise.resolve([]) : loadBrands(db, companyId),
    loadProducts(db, companyId),
    loadAccessories(db, companyId, company.accessory_sale_coefficient, company.accessory_purchase_coefficient),
  ]);
  const tab = onglet === "accessoires" || onglet === "marques" ? onglet : "materiel";
  // Technicien sans accès aux marges : aucune remise ni aucun prix d'achat envoyé au navigateur.
  const safeProducts = restricted ? products.map((p) => ({ ...p, discount_rate: null, prices: { discount: 0, purchaseCents: 0, saleCents: p.prices.saleCents } })) : products;
  const safeAccessories = restricted
    ? accessories.map((a) => ({ ...a, discount_rate: 0, purchase_price_cents: null, prices: { discount: 0, purchaseCents: 0, saleCents: a.prices.saleCents } }))
    : accessories;
  return (
    <CatalogView
      tab={tab}
      brands={brands}
      products={safeProducts}
      accessories={safeAccessories}
      accessoryCoefficient={company.accessory_sale_coefficient}
      purchaseCoefficient={restricted ? 0 : company.accessory_purchase_coefficient}
      isAdmin={role === "admin"}
      showMargin={canSeeMargins}
    />
  );
}
