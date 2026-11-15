import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, LinkButton, Notice } from "@/components/ui";
import { getCurrentCompany } from "@/lib/company/current";
import { shippingLabel } from "@/lib/suppliers/forms";
import { loadSuppliers } from "@/lib/suppliers/load";
import { STALE_TARIFF_MONTHS } from "@/lib/suppliers/pricing";
import { ReferenceSuppliers } from "./ReferenceSuppliers";

export const metadata: Metadata = { title: "Fournisseurs" };

export default async function SuppliersPage() {
  const { supabase, company, role } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const suppliers = await loadSuppliers(supabase, company.id);
  const counts = await Promise.all(suppliers.map(async (s) => (await supabase.from("supplier_offers").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("supplier_id", s.id).neq("match_status", "probable")).count ?? 0));
  const { count: probable } = await supabase.from("supplier_offers").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("match_status", "probable");
  const { data: brands } = await supabase.from("brands").select("id, name, reference_supplier_id").eq("company_id", company.id).order("name");
  const stale = suppliers.filter((s) => s.active && s.stale);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Fournisseurs</h1>
      <p className="text-lg text-slate-700">
        Vos distributeurs, leurs tarifs, vos remises et leurs frais de port. Dans chaque devis, le fournisseur le moins cher au total (port compris) est retenu ligne par ligne : vos techniciens ne voient ni les fournisseurs ni les prix nets, sauf si
        vous les y autorisez.
      </p>
      {stale.length > 0 && (
        <Notice tone="danger">
          Tarif ancien (plus de {STALE_TARIFF_MONTHS} mois sans mise à jour) : {stale.map((s) => s.name).join(", ")}. Importez leur nouveau tarif pour des marges justes.
        </Notice>
      )}
      {(probable ?? 0) > 0 && (
        <Notice>
          <Link href="/app/fournisseurs/correspondances" className="font-bold underline">
            {probable} correspondance{(probable ?? 0) > 1 ? "s" : ""} probable
            {(probable ?? 0) > 1 ? "s" : ""} à confirmer
          </Link>{" "}
          (références presque identiques entre fournisseurs).
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <LinkButton href="/app/fournisseurs/nouveau">+ Nouveau fournisseur</LinkButton>
        <LinkButton href="/app/catalogue/import" variant="secondary">
          Importer un tarif
        </LinkButton>
      </div>
      <ul className="space-y-3">
        {suppliers.map((s, i) => (
          <li key={s.id}>
            <Link href={`/app/fournisseurs/${s.id}`} className={`block rounded-2xl border-2 p-4 ${s.active ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50 opacity-70"}`}>
              <p className="text-xl font-extrabold">
                {s.name} {s.agency && <span className="text-base font-semibold text-slate-600">· {s.agency}</span>}
              </p>
              <p className="text-base">
                {counts[i]} article{counts[i]! > 1 ? "s" : ""} au tarif · {shippingLabel(s.shipping)}
              </p>
              <p className={`text-sm ${s.stale ? "font-bold text-danger" : "text-slate-600"}`}>
                {s.lastPriceUpdateAt ? `Tarif mis à jour le ${new Date(s.lastPriceUpdateAt).toLocaleDateString("fr-FR")}` : "Aucun tarif importé"}
                {s.stale && " · tarif ancien"}
                {!s.active && " · désactivé"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {(brands ?? []).length > 0 && suppliers.length > 0 && (
        <Card title="Fournisseur de référence par marque">
          <p className="text-base text-slate-700">Son prix public fixe votre prix de vente, quel que soit le fournisseur retenu. Sans choix : le prix public le plus élevé connu.</p>
          <ReferenceSuppliers
            brands={(brands ?? []).map((b) => ({
              id: b.id,
              name: b.name,
              referenceSupplierId: b.reference_supplier_id,
            }))}
            suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          />
        </Card>
      )}
    </div>
  );
}
