"use server";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { parseCoefficientsForm } from "@/lib/sizing/coefficients";

export async function saveCoefficients(form: Record<string, string>): Promise<{ ok: boolean; errors?: Record<string, string>; message: string }> {
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseCoefficientsForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certaines valeurs sont hors limites." };
  const { error } = await supabase
    .from("settings_coefficients")
    .upsert({ company_id: company.id, sizing: parsed.value.sizing, labor_days: parsed.value.laborDays, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: "Enregistrement impossible. Réessayez." };
  revalidatePath("/app/parametres/coefficients");
  return { ok: true, message: "Coefficients enregistrés ✔" };
}
