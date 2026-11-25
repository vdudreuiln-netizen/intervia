"use server";

import { revalidatePath } from "next/cache";
import { adminOnlyError } from "@/lib/billing/guard";
import { getCurrentCompany } from "@/lib/company/current";
import { ruleSettings, type RuleSettings } from "@/lib/plans/rules";

export interface FluidSettings {
  country: string;
  capacityNumber: string;
  leakDetectorId: string;
  leakDetectorCheckedOn: string;
}
const COUNTRIES = ["FR", "BE", "LU", "CH", "ES", "DE", "AT", "IT", "GB", "IE", "PT", "NL", "autre"];

export async function savePlacementRules(raw: RuleSettings, fluid: FluidSettings): Promise<{ ok: boolean; message: string }> {
  const g = await adminOnlyError();
  if (g) return g;
  for (const v of [raw.heatDistanceM, raw.bedDistanceM, raw.condensateSlope, raw.levelHeightM]) if (!Number.isFinite(v)) return { ok: false, message: "Un seuil est illisible." };
  const clean = ruleSettings(raw);
  if (clean.heatDistanceM !== raw.heatDistanceM || clean.bedDistanceM !== raw.bedDistanceM || Math.abs(clean.condensateSlope - raw.condensateSlope) > 1e-9 || clean.levelHeightM !== raw.levelHeightM) {
    return { ok: false, message: "Seuil hors limites (chaleur 0,3–10 m ; lit 0,3–5 m ; pente 0,5–5 cm/m ; niveau 2–5 m)." };
  }
  if (!COUNTRIES.includes(fluid.country)) return { ok: false, message: "Pays inconnu." };
  const checked = fluid.leakDetectorCheckedOn.trim();
  if (checked && (!/^\d{4}-\d{2}-\d{2}$/.test(checked) || checked > new Date().toISOString().slice(0, 10))) return { ok: false, message: "Date de contrôle du détecteur invalide (pas dans le futur)." };
  const { supabase, company } = await getCurrentCompany();
  const { error } = await supabase
    .from("companies")
    .update({
      placement_rules: clean,
      fluid_capacity_number: fluid.capacityNumber.trim().slice(0, 60) || null,
      country: fluid.country,
      leak_detector_id: fluid.leakDetectorId.trim().slice(0, 120) || null,
      leak_detector_checked_on: checked || null,
    })
    .eq("id", company.id);
  if (error) return { ok: false, message: "Enregistrement impossible. Réessayez." };
  revalidatePath("/app/parametres/implantation");
  return { ok: true, message: "Règles enregistrées ✔" };
}
