import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { ruleSettings } from "@/lib/plans/rules";
import { RulesForm } from "./RulesForm";

export const metadata: Metadata = { title: "Règles d'implantation" };

export default async function PlacementRulesPage() {
  const { company, role } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  return (
    <div className="space-y-6">
      <Link href="/app/parametres" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Paramètres
      </Link>
      <h1 className="text-3xl font-extrabold">Règles d&apos;implantation et fiche fluides</h1>
      <p className="text-lg text-slate-700">Contrôles appliqués quand vous placez le matériel sur le plan. Impératif : à corriger, ou à forcer avec un motif. Préférence : simple conseil. La notice du fabricant prime toujours.</p>
      <RulesForm initial={ruleSettings(company.placement_rules)} fluid={{ country: company.country ?? "FR", capacityNumber: company.fluid_capacity_number ?? "", leakDetectorId: company.leak_detector_id ?? "", leakDetectorCheckedOn: company.leak_detector_checked_on ?? "" }} />
    </div>
  );
}
