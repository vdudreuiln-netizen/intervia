import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { fetchAll } from "@/lib/catalog/queries";
import { supplierToForm } from "@/lib/suppliers/forms";
import { loadSuppliers } from "@/lib/suppliers/load";
import { SupplierEditor } from "./SupplierEditor";

export const metadata: Metadata = { title: "Fournisseur" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, company, role } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const isNew = id === "nouveau";
  if (isNew) {
    return (
      <div className="space-y-6">
        <Link href="/app/fournisseurs" className="text-lg font-bold text-brand underline underline-offset-4">
          ← Fournisseurs
        </Link>
        <h1 className="text-3xl font-extrabold">Nouveau fournisseur</h1>
        <SupplierEditor id={null} initial={supplierToForm()} active brands={[]} families={[]} offerCount={0} stale={false} lastUpdate={null} />
      </div>
    );
  }
  const supplier = (await loadSuppliers(supabase, company.id)).find((s) => s.id === id);
  if (!supplier) notFound();

  // Marques et familles présentes dans les tarifs de ce fournisseur
  const offers = await fetchAll<{
    product_id: string | null;
    discount_family: string | null;
  }>((from, to) => supabase.from("supplier_offers").select("product_id, discount_family").eq("company_id", company.id).eq("supplier_id", id).neq("match_status", "probable").order("id").range(from, to) as never);
  const productIds = [...new Set(offers.flatMap((o) => (o.product_id ? [o.product_id] : [])))];
  const brandIds = new Set<string>();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data } = await supabase
      .from("products")
      .select("brand_id")
      .eq("company_id", company.id)
      .in("id", productIds.slice(i, i + 200));
    for (const p of data ?? []) brandIds.add(p.brand_id);
  }
  const [{ data: brands }, { data: discounts }] = await Promise.all([
    supabase.from("brands").select("id, name").eq("company_id", company.id).order("name"),
    supabase.from("supplier_discounts").select("brand_id, family, rate").eq("company_id", company.id).eq("supplier_id", id),
  ]);
  const brandRate = new Map((discounts ?? []).filter((d) => d.brand_id).map((d) => [d.brand_id as string, Number(d.rate)]));
  const familyRate = new Map((discounts ?? []).filter((d) => d.family).map((d) => [d.family as string, Number(d.rate)]));
  const families = new Map<string, number | null>();
  for (const o of offers) if (o.discount_family?.trim()) families.set(o.discount_family.trim(), null);
  for (const [f, r] of familyRate) families.set(f, r);

  return (
    <div className="space-y-6">
      <Link href="/app/fournisseurs" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Fournisseurs
      </Link>
      <h1 className="text-3xl font-extrabold">{supplier.name}</h1>
      <SupplierEditor
        id={id}
        initial={supplierToForm({
          name: supplier.name,
          agency: supplier.agency,
          contact_name: supplier.contactName,
          phone: supplier.phone,
          email: supplier.email,
          delivery_terms: supplier.deliveryTerms,
          shipping_fee_cents: supplier.shipping.feeCents,
          franco_cents: supplier.shipping.francoCents,
          shipping_tiers: supplier.shipping.tiers,
        })}
        active={supplier.active}
        brands={(brands ?? [])
          .filter((b) => brandIds.has(b.id) || brandRate.has(b.id))
          .map((b) => ({
            id: b.id,
            name: b.name,
            rate: brandRate.get(b.id) ?? null,
          }))}
        families={[...families.entries()].sort(([a], [b]) => a.localeCompare(b, "fr")).map(([family, rate]) => ({ family, rate }))}
        offerCount={offers.length}
        stale={supplier.stale}
        lastUpdate={supplier.lastPriceUpdateAt}
      />
    </div>
  );
}
