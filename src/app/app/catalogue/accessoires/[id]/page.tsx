import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { loadPriceHistory } from "@/lib/catalog/queries";
import { accessoryToForm } from "@/lib/catalog/forms";
import { PriceHistory } from "../../PriceHistory";
import { AccessoryEditor } from "./AccessoryEditor";
import { loadDiscountBook, loadOffers, loadSuppliers } from "@/lib/suppliers/load";
import { buildItemPricing } from "@/lib/suppliers/views";
import { centsToInput, rateToInput } from "@/lib/format";

export const metadata: Metadata = { title: "Accessoire" };

export default async function AccessoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, company , role } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const isNew = id === "nouveau";
  let initial = accessoryToForm();
  let history: Awaited<ReturnType<typeof loadPriceHistory>> = [];
  let refPublic: number | null = null;
  if (!isNew) {
    const { data } = await supabase.from("accessories").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    refPublic = data.public_price_cents === null ? null : Number(data.public_price_cents);
    initial = accessoryToForm({
      ...data,
      discount_rate: Number(data.discount_rate),
    });
    history = await loadPriceHistory(supabase, "accessory_id", id);
  }
  const [suppliers, book, offers] = await Promise.all([loadSuppliers(supabase, company.id), loadDiscountBook(supabase, company.id), isNew ? Promise.resolve([]) : loadOffers(supabase, company.id, { accessoryIds: [id] })]);
  const pricing = buildItemPricing({
    suppliers,
    offers,
    brandId: null,
    book,
    referenceSupplierId: null,
    referencePublicCents: refPublic,
  });
  const own = offers.find((o) => o.supplierId === pricing.defaultSupplierId);
  if (own)
    initial = {
      ...initial,
      public_price: own.publicPriceCents !== null ? centsToInput(own.publicPriceCents) : "",
      discount: rateToInput(own.discount),
      purchase_price: own.publicPriceCents === null ? centsToInput(own.netPriceCents) : "",
    };
  return (
    <div className="space-y-6">
      <Link href="/app/catalogue?onglet=accessoires" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Catalogue
      </Link>
      <h1 className="text-3xl font-extrabold">{isNew ? "Nouvel accessoire" : "Accessoire"}</h1>
      <AccessoryEditor id={isNew ? null : id} initial={initial} coefficient={company.accessory_sale_coefficient} purchaseCoefficient={company.accessory_purchase_coefficient} pricing={pricing} />
      <PriceHistory items={history} />
    </div>
  );
}
