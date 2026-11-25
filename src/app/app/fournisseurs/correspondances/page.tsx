import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { getCurrentCompany } from "@/lib/company/current";
import { Matches, type MatchItem } from "./Matches";

export const metadata: Metadata = { title: "Correspondances à confirmer" };

export default async function MatchesPage() {
  const { supabase, company, role } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const { data } = await supabase
    .from("supplier_offers")
    .select("id, manufacturer_ref, designation, public_price_cents, net_price_cents, match_reason, suppliers(name), products(reference, brands(name)), accessories(reference, name)")
    .eq("company_id", company.id)
    .eq("match_status", "probable")
    .order("updated_at", { ascending: false })
    .limit(300);
  type Row = {
    id: string;
    manufacturer_ref: string | null;
    designation: string | null;
    public_price_cents: number | null;
    net_price_cents: number | null;
    match_reason: string | null;
    suppliers: { name: string } | null;
    products: { reference: string; brands: { name: string } | null } | null;
    accessories: { reference: string | null; name: string } | null;
  };
  const items: MatchItem[] = ((data ?? []) as unknown as Row[]).map((o) => ({
    id: o.id,
    supplier: o.suppliers?.name ?? "",
    tariffRef: o.manufacturer_ref ?? "",
    tariffLabel: o.designation,
    priceCents: o.public_price_cents ?? o.net_price_cents,
    catalogLabel: o.products ? `${o.products.brands?.name ?? ""} ${o.products.reference}`.trim() : o.accessories ? `${o.accessories.reference ?? ""} – ${o.accessories.name}` : "?",
    reason: o.match_reason,
  }));
  return (
    <div className="space-y-6">
      <Link href="/app/fournisseurs" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Fournisseurs
      </Link>
      <h1 className="text-3xl font-extrabold">Correspondances à confirmer</h1>
      <p className="text-lg text-slate-700">
        Références presque identiques entre le tarif d&apos;un fournisseur et votre catalogue (suffixe différent : couleur, version, kit…). Tant qu&apos;elles ne sont pas confirmées, ces tarifs ne servent pas dans les prix.
      </p>
      {items.length === 0 ? <Notice tone="ok">Rien à confirmer.</Notice> : <Matches items={items} />}
    </div>
  );
}
