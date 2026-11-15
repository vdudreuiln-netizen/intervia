"use server";

import { revalidatePath } from "next/cache";
import { readOnlyError } from "@/lib/billing/guard";
import { getCurrentCompany } from "@/lib/company/current";
import { costAccess } from "@/lib/security/costs";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCoefficients, loadQuote, loadWizardCatalog } from "@/lib/quote/load";
import { fromSelection } from "@/lib/quote/equipment";
import { parseRooms, type RoomForm } from "@/lib/quote/rooms";
import { EMPTY_METRE, type IndoorChoice } from "@/lib/quote/types";
import type { Insulation, Orientation } from "@/lib/sizing/sizing";
import { draftFromAnalysis, draftScale, draftTotalArea, sanitizeDraft, type PlanDraft } from "@/lib/plans/analysis";
import { checkTotalArea } from "@/lib/plans/geometry";
import { layoutChecklist, metreFromLayouts, sanitizeLayout, type Layout, type MetreReportLine } from "@/lib/plans/layout";
import { analyzePlanImage, PlanAnalysisError } from "@/lib/plans/analyze.server";
import { LEVEL_LABELS } from "@/lib/quote/rooms";

const FAIL = "Enregistrement impossible. Réessayez.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function ctx(quoteId: string) {
  const g = await readOnlyError();
  if (g) return { error: g };
  if (!UUID.test(quoteId)) return { error: { ok: false as const, message: "Devis introuvable." } };
  const c = await getCurrentCompany();
  const q = await loadQuote(c.supabase, quoteId);
  if (!q) return { error: { ok: false as const, message: "Devis introuvable." } };
  return { c, q };
}

const validLevel = (l: number) => Number.isInteger(l) && l >= -1 && l <= 5;

async function loadPlan(supabase: Awaited<ReturnType<typeof getCurrentCompany>>["supabase"], quoteId: string, level: number) {
  const { data } = await supabase.from("quote_plans").select("*").eq("quote_id", quoteId).eq("level", level).maybeSingle();
  return data;
}

/** Après dépôt de l'image dans le stockage (navigateur) : enregistre le plan du niveau. */
export async function registerPlan(quoteId: string, level: number, file: { path: string; width: number; height: number; sourceName: string; sourceKind: "pdf" | "image" }): Promise<Result> {
  const r = await ctx(quoteId);
  if ("error" in r) return r.error!;
  const { c } = r;
  if (!validLevel(level)) return { ok: false, message: "Niveau invalide." };
  if (!file.path.startsWith(`${c.company.id}/${quoteId}/`) || file.path.includes("..")) return { ok: false, message: "Fichier invalide." };
  if (!(file.width >= 50 && file.width <= 10000 && file.height >= 50 && file.height <= 10000)) return { ok: false, message: "Image invalide." };
  const old = await loadPlan(c.supabase, quoteId, level);
  const row = {
    company_id: c.company.id,
    quote_id: quoteId,
    level,
    label: LEVEL_LABELS[level] ?? `Niveau ${level}`,
    image_path: file.path,
    width_px: Math.round(file.width),
    height_px: Math.round(file.height),
    source_name: file.sourceName.slice(0, 120),
    source_kind: file.sourceKind === "pdf" ? "pdf" : "image",
    scale_m_per_px: null,
    scale_source: null,
    north_deg: null,
    draft: null,
    layout: { markers: [], routes: [] },
    analyzed_at: null,
    validated_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await c.supabase.from("quote_plans").upsert(row, { onConflict: "quote_id,level" });
  if (error) return { ok: false, message: FAIL };
  if (old?.image_path && old.image_path !== file.path) await c.supabase.storage.from("plans").remove([old.image_path]);
  revalidatePath(`/app/devis/${quoteId}/plan`);
  return { ok: true };
}

/** Lecture du plan par l'IA : 1 analyse du quota mensuel « plans ». */
export async function analyzePlan(quoteId: string, level: number): Promise<Result<{ draft: PlanDraft }>> {
  const r = await ctx(quoteId);
  if ("error" in r) return r.error!;
  const { c, q } = r;
  const plan = await loadPlan(c.supabase, quoteId, level);
  if (!plan) return { ok: false, message: "Importez d'abord le plan." };
  const { data: blob, error: dlErr } = await c.supabase.storage.from("plans").download(plan.image_path);
  if (dlErr || !blob) return { ok: false, message: "Image du plan introuvable : importez-la de nouveau." };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mediaType = plan.image_path.endsWith(".png") ? "image/png" : "image/jpeg";

  const admin = createAdminClient();
  const { error: qErr } = await admin.rpc("consume_ai_quota", { p_company: c.company.id, p_kind: "plan", p_units: 1 });
  if (qErr) {
    if (qErr.message.includes("QUOTA_DEPASSE")) return { ok: false, message: "Quota mensuel d'analyses de plans atteint : dessinez les pièces à la main, ou passez à une formule supérieure." };
    return { ok: false, message: "Vérification du quota impossible. Réessayez." };
  }
  let draft: PlanDraft;
  try {
    const analysis = await analyzePlanImage(bytes, mediaType, { levelLabel: plan.label });
    const { data: proj } = await c.supabase.from("projects").select("total_area_m2").eq("id", q.project.id).single();
    draft = draftFromAnalysis(analysis, plan.width_px, plan.height_px, { level, declaredTotalM2: proj?.total_area_m2 === null || proj?.total_area_m2 === undefined ? undefined : Number(proj.total_area_m2) });
  } catch (e) {
    await admin.rpc("refund_ai_quota", { p_company: c.company.id, p_kind: "plan", p_units: 1 });
    console.error("Lecture de plan :", e instanceof Error ? e.message : e);
    return { ok: false, message: e instanceof PlanAnalysisError ? e.userMessage : "Lecture impossible pour le moment. Réessayez." };
  }
  const scale = draftScale(draft);
  const { error } = await c.supabase
    .from("quote_plans")
    .update({ draft, scale_m_per_px: scale?.mPerPx ?? null, scale_source: scale?.source ?? null, north_deg: draft.northDeg, analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", plan.id);
  if (error) return { ok: false, message: FAIL };
  revalidatePath(`/app/devis/${quoteId}/plan`);
  return { ok: true, draft };
}

/** Enregistre le brouillon corrigé (pièces, fenêtres, échelle, nord, surface du logement). */
export async function saveDraft(quoteId: string, level: number, raw: unknown): Promise<Result<{ totalCheck: string | null }>> {
  const r = await ctx(quoteId);
  if ("error" in r) return r.error!;
  const { c, q } = r;
  const plan = await loadPlan(c.supabase, quoteId, level);
  if (!plan) return { ok: false, message: "Plan introuvable." };
  const draft = sanitizeDraft(raw, plan.width_px, plan.height_px);
  const scale = draftScale(draft);
  const { error } = await c.supabase
    .from("quote_plans")
    .update({ draft, scale_m_per_px: scale?.mPerPx ?? null, scale_source: scale?.source ?? null, north_deg: draft.northDeg, updated_at: new Date().toISOString() })
    .eq("id", plan.id);
  if (error) return { ok: false, message: FAIL };
  if (draft.declaredTotalM2 !== null) await c.supabase.from("projects").update({ total_area_m2: draft.declaredTotalM2 }).eq("id", q.project.id);
  const total = draftTotalArea(draft);
  return { ok: true, totalCheck: total === null ? null : checkTotalArea(total, draft.declaredTotalM2).message };
}

export interface PlanRoomInput {
  name: string;
  surface: string;
  level: number;
  orientation: Orientation;
  largeGlazing: boolean;
  insulation: Insulation;
  height: string;
  underRoof: boolean;
  indoorType: IndoorChoice;
}

/**
 * Pièces validées par l'artisan → pièces du devis (dimensionnement).
 * Les pièces issues d'un précédent import de CE plan sont remplacées ; les
 * autres pièces (saisies à la main, autres niveaux) sont conservées.
 */
export async function applyPlanRooms(quoteId: string, level: number, rooms: PlanRoomInput[]): Promise<Result | { ok: false; message: string; errors: Record<string, Record<string, string>> }> {
  const r = await ctx(quoteId);
  if ("error" in r) return r.error!;
  const { c, q } = r;
  const plan = await loadPlan(c.supabase, quoteId, level);
  if (!plan) return { ok: false, message: "Plan introuvable." };
  if (rooms.length === 0 || rooms.length > 40) return { ok: false, message: "Gardez au moins une pièce à climatiser." };
  const forms: RoomForm[] = rooms.map((x, i) => ({
    id: `new-${i}`,
    name: x.name,
    surface: x.surface,
    height: x.height || "2,50",
    orientation: x.orientation,
    insulation: x.insulation,
    largeGlazing: Boolean(x.largeGlazing),
    underRoof: Boolean(x.underRoof),
    level: validLevel(x.level) ? x.level : level,
    indoorType: x.indoorType,
    overrideW: "",
  }));
  const coefs = await loadCoefficients(c.supabase);
  const parsed = parseRooms(forms, coefs.sizing);
  if (!parsed.ok) return { ok: false, message: "Certaines pièces sont à corriger.", errors: parsed.errors as Record<string, Record<string, string>> };

  const { error: delErr } = await c.supabase.from("rooms").delete().eq("project_id", q.project.id).eq("plan_id", plan.id);
  if (delErr) return { ok: false, message: FAIL };
  const start = q.rooms.length + 1;
  const { error } = await c.supabase.from("rooms").insert(
    parsed.values.map(({ id: _id, ...row }, i) => ({ ...row, position: start + i, company_id: c.company.id, project_id: q.project.id, plan_id: plan.id })),
  );
  if (error) return { ok: false, message: FAIL };
  await c.supabase.from("quote_plans").update({ validated_at: new Date().toISOString() }).eq("id", plan.id);
  // Pièces changées : la sélection de matériel et le métré ne sont plus valables
  if (q.wizard.selection) await c.supabase.from("quotes").update({ wizard: { ...q.wizard, selection: undefined, metre: undefined } }).eq("id", quoteId);
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true };
}

/**
 * Enregistre l'implantation d'un niveau et reporte les longueurs de TOUS les
 * niveaux dans le métré de l'assistant (les valeurs non tracées sont conservées).
 */
export async function saveLayout(quoteId: string, level: number, raw: unknown): Promise<Result<{ report: MetreReportLine[]; warnings: string[]; todo: string[] }>> {
  const r = await ctx(quoteId);
  if ("error" in r) return r.error!;
  const { c, q } = r;
  const plan = await loadPlan(c.supabase, quoteId, level);
  if (!plan) return { ok: false, message: "Plan introuvable." };
  if (!q.wizard.selection) return { ok: false, message: "Choisissez d'abord une solution (étape 4)." };
  const layout: Layout = sanitizeLayout(raw, { width: plan.width_px, height: plan.height_px });
  const { error } = await c.supabase.from("quote_plans").update({ layout, updated_at: new Date().toISOString() }).eq("id", plan.id);
  if (error) return { ok: false, message: FAIL };

  const { db, companyId } = await costAccess();
  const catalog = await loadWizardCatalog(db, companyId);
  const equipment = fromSelection(q.wizard.selection, catalog.products);
  if (!equipment) return { ok: false, message: "Un produit choisi n'existe plus : refaites le choix à l'étape 4." };
  const { data: plans } = await c.supabase.from("quote_plans").select("level, scale_m_per_px, layout, width_px, height_px").eq("quote_id", quoteId);
  const all = (plans ?? []).map((p) => ({ level: p.level, mPerPx: p.scale_m_per_px === null ? null : Number(p.scale_m_per_px), layout: p.level === level ? layout : sanitizeLayout(p.layout, { width: p.width_px, height: p.height_px }) }));
  const { metre, report, warnings } = metreFromLayouts(all, equipment, q.wizard.metre ?? EMPTY_METRE);
  if (!warnings.length) {
    const { error: wErr } = await c.supabase.from("quotes").update({ wizard: { ...q.wizard, metre } }).eq("id", quoteId);
    if (wErr) return { ok: false, message: FAIL };
  }
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true, report, warnings, todo: layoutChecklist(all, equipment) };
}

/** Surface totale du logement (contrôle des 10 %). */
export async function saveTotalArea(quoteId: string, m2: number | null): Promise<Result> {
  const r = await ctx(quoteId);
  if ("error" in r) return r.error!;
  if (m2 !== null && !(m2 > 5 && m2 < 10000)) return { ok: false, message: "Surface invalide." };
  const { error } = await r.c.supabase.from("projects").update({ total_area_m2: m2 }).eq("id", r.q.project.id);
  return error ? { ok: false, message: FAIL } : { ok: true };
}

/** Supprime le plan d'un niveau (les pièces déjà créées restent). */
export async function deletePlan(quoteId: string, level: number): Promise<Result> {
  const r = await ctx(quoteId);
  if ("error" in r) return r.error!;
  const plan = await loadPlan(r.c.supabase, quoteId, level);
  if (!plan) return { ok: true };
  await r.c.supabase.storage.from("plans").remove([plan.image_path]);
  const { error } = await r.c.supabase.from("quote_plans").delete().eq("id", plan.id);
  revalidatePath(`/app/devis/${quoteId}/plan`);
  return error ? { ok: false, message: FAIL } : { ok: true };
}
