import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromSelection } from "@/lib/quote/equipment";
import { loadWizardCatalog, type QuoteRecord } from "@/lib/quote/load";
import { sanitizeProduct } from "@/lib/quote/sanitize";
import type { Equipment } from "@/lib/quote/types";
import { sanitizeDraft } from "./analysis";
import { sanitizeLayout } from "./layout";
import { ruleSettings, type Clearances, type RuleContext, type RulePlan, type UnitTech } from "./rules";

const BEDROOM = /\bchambre|\bch\.?\s*\d/i;

/** Équipement sans aucun coût (utilisable dans le navigateur de tous les membres). */
export function publicEquipment(eq: Equipment): Equipment {
  return { ...eq, systems: eq.systems.map((s) => ({ ...s, outdoor: sanitizeProduct(s.outdoor), indoors: s.indoors.map((i) => ({ ...i, product: sanitizeProduct(i.product) })) })) };
}

function clearances(raw: unknown): Clearances {
  const out: Clearances = {};
  const o = (raw ?? {}) as Record<string, unknown>;
  for (const k of ["top", "left", "right", "bottom", "front", "rear"] as const) if (typeof o[k] === "number" && o[k] > 0 && o[k] <= 500) out[k] = o[k];
  return out;
}

/**
 * Tout ce qu'il faut pour évaluer les règles d'un devis : plans (pièces,
 * fenêtres des chambres, implantation), équipement, données techniques.
 * `costDb` = lecteur filtré par entreprise ; seules des données techniques en sortent.
 */
export async function loadRuleContext(supabase: SupabaseClient, costDb: SupabaseClient, companyId: string, q: QuoteRecord, rawSettings: unknown): Promise<(RuleContext & { planRows: { id: string; level: number; width: number; height: number; imagePath: string; northDeg: number | null; label: string | null; layoutValidatedAt: string | null }[] }) | null> {
  if (!q.wizard.selection) return null;
  const catalog = await loadWizardCatalog(costDb, companyId);
  const full = fromSelection(q.wizard.selection, catalog.products);
  if (!full) return null;
  const equipment = publicEquipment(full);
  const ids = [...new Set(equipment.systems.flatMap((s) => [s.outdoor.id, ...s.indoors.map((i) => i.product.id)]))];
  const [{ data: techRows }, { data: plans }] = await Promise.all([
    costDb.from("products").select("id, refrigerant, factory_charge_kg, max_link_m, max_height_diff_m, clearances").eq("company_id", companyId).in("id", ids),
    supabase.from("quote_plans").select("id, level, label, image_path, width_px, height_px, scale_m_per_px, north_deg, draft, layout, layout_validated_at").eq("quote_id", q.id).order("level"),
  ]);
  const tech: Record<string, UnitTech> = {};
  for (const t of techRows ?? []) {
    tech[t.id] = {
      refrigerant: t.refrigerant,
      factoryChargeKg: t.factory_charge_kg === null ? null : Number(t.factory_charge_kg),
      maxLinkM: t.max_link_m === null ? null : Number(t.max_link_m),
      maxHeightDiffM: t.max_height_diff_m === null ? null : Number(t.max_height_diff_m),
      clearances: clearances(t.clearances),
    };
  }
  const rulePlans: RulePlan[] = (plans ?? []).map((p) => {
    const draft = p.draft ? sanitizeDraft(p.draft, p.width_px, p.height_px) : null;
    return {
      level: p.level,
      mPerPx: p.scale_m_per_px === null ? null : Number(p.scale_m_per_px),
      rooms: (draft?.rooms ?? []).map((r) => ({ id: r.id, name: r.name, polygon: r.polygon })),
      bedroomWindows: (draft?.rooms ?? []).filter((r) => BEDROOM.test(r.name)).flatMap((r) => r.windows.map((w) => ({ a: w.a, b: w.b }))),
      layout: sanitizeLayout(p.layout, { width: p.width_px, height: p.height_px }),
    };
  });
  return {
    plans: rulePlans,
    equipment,
    tech,
    rooms: q.rooms.map((r) => ({ id: r.id, name: r.name, surfaceM2: r.surface_m2, ceilingM: r.ceiling_height_m })),
    settings: ruleSettings(rawSettings),
    planRows: (plans ?? []).map((p) => ({ id: p.id, level: p.level, width: p.width_px, height: p.height_px, imagePath: p.image_path, northDeg: p.north_deg === null ? null : Number(p.north_deg), label: p.label, layoutValidatedAt: p.layout_validated_at })),
  };
}
