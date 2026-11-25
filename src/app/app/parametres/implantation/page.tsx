import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { R32_WARNING, ruleSettings } from "@/lib/plans/rules";
import { runR32CrossCheck } from "@/lib/plans/r32-crosscheck";
import { Card, Notice } from "@/components/ui";
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
      <R32CrossCheck />
      <RulesForm initial={ruleSettings(company.placement_rules)} fluid={{ country: company.country ?? "FR", capacityNumber: company.fluid_capacity_number ?? "", leakDetectorId: company.leak_detector_id ?? "", leakDetectorCheckedOn: company.leak_detector_checked_on ?? "" }} />
    </div>
  );
}

function R32CrossCheck() {
  const results = runR32CrossCheck();
  const fmt = (n: number | null) => (n === null ? "aucune" : `${n.toLocaleString("fr-FR")} m²`);
  return (
    <Card title="Surface minimale R32 : recoupement avec les notices">
      <Notice>{R32_WARNING}</Notice>
      <p className="text-base text-slate-700">Formule de l&apos;annexe GG de l&apos;IEC 60335-2-40, hauteurs de pose 0,6 / 1,0 / 1,8 / 2,2 m, jamais moins de 3 m² par kg, arrondi au m² supérieur. Recoupement à titre informatif : valeurs relevées dans des notices publiées, non encore vérifiées sur les PDF des fabricants. Seule la notice d&apos;installation de l&apos;appareil posé fait foi.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b-2 border-slate-300">
              <th className="py-2 pr-2">Notice</th>
              <th className="py-2 pr-2">Charge · hauteur</th>
              <th className="py-2 pr-2">Notice</th>
              <th className="py-2 pr-2">ClimDevis</th>
              <th className="py-2">Résultat</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={`${r.document}-${r.chargeKg}`} className="border-b border-slate-200 align-top">
                <td className="py-2 pr-2">
                  <strong>{r.brand}</strong>
                  <span className="block text-sm text-slate-600">{r.document}</span>
                </td>
                <td className="py-2 pr-2">
                  {r.chargeKg.toLocaleString("fr-FR")} kg · {r.heightM.toLocaleString("fr-FR")} m ({r.position})
                </td>
                <td className="py-2 pr-2">{fmt(r.noticeM2)}</td>
                <td className="py-2 pr-2 font-bold">{fmt(r.climdevisM2)}</td>
                <td className={`py-2 font-bold ${r.ok ? "text-ok" : "text-amber-800"}`}>{r.ok ? (r.climdevisM2 === r.noticeM2 ? "✔ égal" : "✔ plus prudent") : "⚠ écart à vérifier"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
