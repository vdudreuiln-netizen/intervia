import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import type { Mapping } from "@/lib/catalog/import";
import { ImportWizard } from "./ImportWizard";
import { UndoLastImport } from "./UndoLastImport";

export const metadata: Metadata = { title: "Importer un tarif" };
// Lecture des tarifs PDF : jusqu'à ~1 min par lot de pages.
export const maxDuration = 300;

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ cible?: string }> }) {
  const { cible } = await searchParams;
  const { supabase, role, company } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const [{ data: suppliers }, { data: brands }, { data: last }] = await Promise.all([
    supabase.from("suppliers").select("id, name, column_mapping, kind, brands!suppliers_brand_id_fkey(name)").eq("company_id", company.id).eq("active", true).order("name"),
    supabase.from("brands").select("name").eq("company_id", company.id).order("name"),
    supabase.from("catalog_imports").select("filename, created_at, tariff_date, price_kind, created_count, updated_count, suppliers(name)").eq("company_id", company.id).is("undone_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const distributors = (suppliers ?? []).filter((s) => s.kind !== "fabricant");
  const manufacturerMappings = Object.fromEntries(
    (suppliers ?? []).filter((s) => s.kind === "fabricant").map((s) => [((s.brands as unknown as { name: string } | null)?.name ?? "").toLowerCase(), (s.column_mapping ?? {}) as Partial<Record<"materiel" | "accessoires", Mapping>>]),
  );
  return (
    <div className="space-y-6">
      <Link href={`/app/catalogue?onglet=${cible === "accessoires" ? "accessoires" : "materiel"}`} className="text-lg font-bold text-brand underline underline-offset-4">
        ← Catalogue
      </Link>
      <h1 className="text-3xl font-extrabold">Importer un tarif</h1>
      <p className="text-lg text-slate-700">Votre tarif (fabricant ou distributeur, Excel / CSV / PDF) reste réservé à votre compte. Les devis déjà émis gardent leurs prix.</p>
      {last && (
        <UndoLastImport
          last={{
            filename: last.filename,
            createdAt: last.created_at,
            supplier: (last.suppliers as unknown as { name: string } | null)?.name ?? null,
            tariffDate: last.tariff_date,
            priceKind: last.price_kind === "net" ? "net" : "public",
            created: last.created_count,
            updated: last.updated_count,
          }}
        />
      )}
      <ImportWizard
        manufacturerMappings={manufacturerMappings}
        initialTarget={cible === "accessoires" ? "accessoires" : "materiel"}
        suppliers={distributors.map((s) => ({
          id: s.id as string,
          name: s.name as string,
          mapping: (s.column_mapping ?? {}) as Partial<Record<"materiel" | "accessoires", Mapping>>,
        }))}
        brands={(brands ?? []).map((b) => b.name as string)}
      />
    </div>
  );
}
