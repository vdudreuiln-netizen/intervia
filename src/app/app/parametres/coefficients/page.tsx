import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { coefficientsToForm, withDefaults } from "@/lib/sizing/coefficients";
import { CoefficientsForm } from "./CoefficientsForm";

export const metadata: Metadata = { title: "Coefficients" };

export default async function CoefficientsPage() {
  const { supabase , role } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const { data } = await supabase.from("settings_coefficients").select("sizing, labor_days").maybeSingle();
  const coefs = withDefaults(data ? { sizing: data.sizing, laborDays: data.labor_days } : null);
  return (
    <div className="space-y-6">
      <Link href="/app/parametres" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Paramètres
      </Link>
      <h1 className="text-3xl font-extrabold">Coefficients</h1>
      <p className="text-lg">
        Besoin d&apos;une pièce = volume × puissance de base × corrections. C&apos;est un ordre de grandeur pour chiffrer, pas un bilan thermique réglementaire.
      </p>
      <CoefficientsForm initial={coefficientsToForm(coefs)} />
    </div>
  );
}
