"use server";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { ALL_FIELDS, parseCompanyForm, type CompanyField, type CompanyForm, type FieldErrors } from "@/lib/company/settings";

export interface SaveResult {
  ok: boolean;
  errors?: FieldErrors;
  message?: string;
}

/**
 * Enregistre une partie des paramètres de l'entreprise.
 * `finish` (fin de l'onboarding) revalide TOUT et marque l'onboarding terminé.
 */
export async function saveCompany(fields: CompanyField[], form: Partial<CompanyForm>, finish = false): Promise<SaveResult> {
  const { supabase, company } = await getCurrentCompany();

  // Liste blanche : on ignore tout champ inconnu envoyé par le navigateur.
  const allowed = fields.filter((f) => ALL_FIELDS.includes(f));
  const toCheck = finish ? ALL_FIELDS : allowed;
  // Pour la validation croisée (ex. n° TVA si assujetti), on complète avec les valeurs déjà en base.
  const merged: Partial<CompanyForm> = { vat_regime: company.vat_regime, ...form };
  const parsed = parseCompanyForm(merged, toCheck);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };

  for (const key of ["logo_path", "stamp_path"] as const) {
    const p = parsed.values[key];
    if (p && !p.startsWith(`${company.id}/`)) return { ok: false, message: "Image invalide." };
  }

  const update: Record<string, unknown> = { ...parsed.values, updated_at: new Date().toISOString() };
  if (finish) update.onboarding_done = true;
  const { error } = await supabase.from("companies").update(update).eq("id", company.id);
  if (error) return { ok: false, message: "Enregistrement impossible. Réessayez." };

  revalidatePath("/app", "layout");
  return { ok: true, message: "Enregistré ✔" };
}
