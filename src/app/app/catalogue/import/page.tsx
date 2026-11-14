import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCompany } from "@/lib/company/current";
import type { Mapping } from "@/lib/catalog/import";
import { ImportWizard } from "./ImportWizard";

export const metadata: Metadata = { title: "Importer un tarif" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ cible?: string }> }) {
  const { cible } = await searchParams;
  const { supabase } = await getCurrentCompany();
  const [{ data: suppliers }, { data: brands }] = await Promise.all([
    supabase.from("suppliers").select("id, name, column_mapping").order("name"),
    supabase.from("brands").select("name").order("name"),
  ]);
  return (
    <div className="space-y-6">
      <Link href={`/app/catalogue?onglet=${cible === "accessoires" ? "accessoires" : "materiel"}`} className="text-lg font-bold text-brand underline underline-offset-4">
        ← Catalogue
      </Link>
      <h1 className="text-3xl font-extrabold">Importer un tarif</h1>
      <ImportWizard
        initialTarget={cible === "accessoires" ? "accessoires" : "materiel"}
        suppliers={(suppliers ?? []).map((s) => ({ name: s.name as string, mapping: (s.column_mapping ?? {}) as Partial<Record<"materiel" | "accessoires", Mapping>> }))}
        brands={(brands ?? []).map((b) => b.name as string)}
      />
    </div>
  );
}
