import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { loadPriceHistory } from "@/lib/catalog/queries";
import { accessoryToForm } from "@/lib/catalog/forms";
import { PriceHistory } from "../../PriceHistory";
import { AccessoryEditor } from "./AccessoryEditor";

export const metadata: Metadata = { title: "Accessoire" };

export default async function AccessoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, company } = await getCurrentCompany();
  const isNew = id === "nouveau";
  let initial = accessoryToForm();
  let history: Awaited<ReturnType<typeof loadPriceHistory>> = [];
  if (!isNew) {
    const { data } = await supabase.from("accessories").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    initial = accessoryToForm({ ...data, discount_rate: Number(data.discount_rate) });
    history = await loadPriceHistory(supabase, "accessory_id", id);
  }
  return (
    <div className="space-y-6">
      <Link href="/app/catalogue?onglet=accessoires" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Catalogue
      </Link>
      <h1 className="text-3xl font-extrabold">{isNew ? "Nouvel accessoire" : "Accessoire"}</h1>
      <AccessoryEditor id={isNew ? null : id} initial={initial} coefficient={company.accessory_sale_coefficient} />
      <PriceHistory items={history} />
    </div>
  );
}
