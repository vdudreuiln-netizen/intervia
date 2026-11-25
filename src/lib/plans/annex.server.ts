import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromSelection } from "@/lib/quote/equipment";
import { loadQuoteLines, loadWizardCatalog, type QuoteRecord } from "@/lib/quote/load";
import { toRoomNeeds } from "@/lib/quote/rooms";
import { EMPTY_METRE, type Equipment } from "@/lib/quote/types";
import { annexOverlay, type PlanAnnex } from "./annex";
import { sanitizeLayout } from "./layout";
import type { SpecInput } from "./spec";

/**
 * Données des annexes techniques d'un devis. `costDb` = lecteur filtré par
 * entreprise (src/lib/security/costs.ts) : seuls libellés, quantités et repères
 * en sortent, jamais un prix.
 */
export async function loadAnnexData(supabase: SupabaseClient, costDb: SupabaseClient, companyId: string, q: QuoteRecord): Promise<{ plans: PlanAnnex[]; spec: SpecInput | null; equipment: Equipment | null }> {
  const [{ data: rows }, lines, catalog] = await Promise.all([
    supabase.from("quote_plans").select("level, label, image_path, width_px, height_px, scale_m_per_px, north_deg, layout").eq("quote_id", q.id).order("level"),
    loadQuoteLines(costDb, companyId, q.id),
    q.wizard.selection ? loadWizardCatalog(costDb, companyId) : Promise.resolve(null),
  ]);
  const equipment = q.wizard.selection && catalog ? fromSelection(q.wizard.selection, catalog.products) : null;

  const plans: PlanAnnex[] = [];
  for (const p of rows ?? []) {
    const { data } = await supabase.storage.from("plans").download(p.image_path);
    if (!data) continue;
    const layout = sanitizeLayout(p.layout, { width: p.width_px, height: p.height_px });
    plans.push({
      label: p.label ?? `Niveau ${p.level}`,
      image: { data: Buffer.from(await data.arrayBuffer()), format: p.image_path.endsWith(".png") ? "png" : "jpg" },
      width: p.width_px,
      height: p.height_px,
      northDeg: p.north_deg === null ? null : Number(p.north_deg),
      ...annexOverlay(layout, equipment, p.scale_m_per_px === null ? null : Number(p.scale_m_per_px)),
    });
  }

  const spec: SpecInput | null = equipment
    ? {
        quoteNumber: q.number,
        client: { name: q.project.client.name, phone: q.project.client.phone, email: q.project.client.email },
        site: { address: q.project.site_address, postalCode: q.project.site_postal_code, city: q.project.site_city, parking: q.project.parking_enabled },
        equipment,
        rooms: toRoomNeeds(q.rooms),
        metre: q.wizard.metre ?? EMPTY_METRE,
        lines: lines.map((l) => ({ key: l.wizardKey, kind: l.kind, designation: l.designation, quantity: l.quantity, unit: l.unit })),
        laborDays: q.laborDays,
        plans: plans.filter((p) => p.markers.length > 0).map((p) => p.label),
      }
    : null;
  return { plans, spec, equipment };
}

export interface Datasheet {
  productId: string;
  name: string;
  path: string;
}

/** Fiches techniques des produits présents dans le devis (une par produit). */
export async function loadDatasheets(costDb: SupabaseClient, companyId: string, quoteId: string): Promise<Datasheet[]> {
  const lines = await loadQuoteLines(costDb, companyId, quoteId);
  const ids = [...new Set(lines.flatMap((l) => (l.productId && l.quantity > 0 ? [l.productId] : [])))];
  if (ids.length === 0) return [];
  const { data } = await costDb.from("products").select("id, reference, datasheet_path, datasheet_name, brands(name)").eq("company_id", companyId).in("id", ids).not("datasheet_path", "is", null);
  return (data ?? []).map((p) => ({
    productId: p.id,
    path: p.datasheet_path as string,
    name: (p.datasheet_name as string | null) ?? `Fiche technique ${(p.brands as unknown as { name: string } | null)?.name ?? ""} ${p.reference}.pdf`.replace(/\s+/g, " "),
  }));
}
