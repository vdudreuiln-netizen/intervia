"use server";

import { revalidatePath } from "next/cache";
import { readOnlyError } from "@/lib/billing/guard";
import { loadQuote } from "@/lib/quote/load";
import { costAccess } from "@/lib/security/costs";
import { computeDeviation } from "@/lib/site/load.server";
import { validateReception, type Checks, type DeviationKind, type Values } from "@/lib/site/site";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAIL = "Enregistrement impossible. Réessayez.";
type Result = { ok: boolean; message?: string };

async function ctx(quoteId: string) {
  const g = await readOnlyError();
  if (g) return { error: g };
  if (!UUID.test(quoteId)) return { error: { ok: false, message: "Chantier introuvable." } };
  const a = await costAccess();
  const q = await loadQuote(a.supabase, quoteId);
  if (!q || q.status !== "accepte") return { error: { ok: false, message: "Chantier introuvable (le devis doit être accepté)." } };
  const { data: job } = await a.supabase.from("site_jobs").select("*").eq("quote_id", quoteId).maybeSingle();
  return { a, q, job };
}

function done(quoteId: string) {
  revalidatePath(`/app/chantiers/${quoteId}`);
  revalidatePath("/app/chantiers");
}

/** 1. Cocher / décocher un élément posé. Le chantier démarre au premier élément coché. */
export async function setCheck(quoteId: string, itemId: string, on: boolean, total: number): Promise<Result> {
  const c = await ctx(quoteId);
  if ("error" in c) return c.error!;
  if (typeof itemId !== "string" || itemId.length > 80) return { ok: false, message: "Élément invalide." };
  const checks: Checks = { ...((c.job?.checks as Checks | undefined) ?? {}) };
  if (on) checks[itemId] = { at: new Date().toISOString(), by: c.a.user.id };
  else delete checks[itemId];
  const now = new Date().toISOString();
  const { error } = await c.a.supabase
    .from("site_jobs")
    .upsert({ quote_id: quoteId, company_id: c.a.companyId, checks, items_done: Object.keys(checks).length, items_total: Math.max(0, Math.min(500, Math.round(total) || 0)), status: c.job?.status === "termine" ? "termine" : "en_cours", started_at: c.job?.started_at ?? now, updated_at: now });
  if (error) return { ok: false, message: FAIL };
  done(quoteId);
  return { ok: true };
}

/** 2. Photo déjà déposée dans le stockage, placée sur le plan à l'endroit de l'élément. */
export async function addPhoto(quoteId: string, p: { path: string; elementId: string | null; level: number | null; x: number | null; y: number | null; kind: string; caption: string }): Promise<Result> {
  const c = await ctx(quoteId);
  if ("error" in c) return c.error!;
  if (!p.path.startsWith(`${c.a.companyId}/${quoteId}/`) || p.path.includes("..")) return { ok: false, message: "Fichier invalide." };
  const kind = ["avant", "apres", "passage", "etiquette", "autre"].includes(p.kind) ? p.kind : "autre";
  const n = (v: number | null) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const { error } = await c.a.supabase.from("site_photos").insert({ company_id: c.a.companyId, quote_id: quoteId, path: p.path, element_id: p.elementId?.slice(0, 80) ?? null, level: n(p.level), x: n(p.x), y: n(p.y), kind, caption: p.caption.trim().slice(0, 200) || null, created_by: c.a.user.id });
  if (error) return { ok: false, message: FAIL };
  done(quoteId);
  return { ok: true };
}

export async function deletePhoto(quoteId: string, photoId: string): Promise<Result> {
  const c = await ctx(quoteId);
  if ("error" in c) return c.error!;
  if (!UUID.test(photoId)) return { ok: false, message: "Photo introuvable." };
  const { data } = await c.a.supabase.from("site_photos").select("path").eq("quote_id", quoteId).eq("id", photoId).maybeSingle();
  if (!data) return { ok: false, message: "Photo introuvable." };
  await c.a.supabase.storage.from("chantier").remove([data.path]);
  await c.a.supabase.from("site_photos").delete().eq("id", photoId);
  done(quoteId);
  return { ok: true };
}

/**
 * 3. Écart signalé par le technicien. Le surcoût et l'impact sur la marge sont
 * calculés ici, côté serveur, et rangés dans une table que seuls les membres
 * autorisés peuvent lire.
 */
export async function reportDeviation(quoteId: string, d: { kind: DeviationKind; equipmentKey: string | null; quantity: number | null; accessoryId: string | null; description: string; elementId: string | null }): Promise<Result> {
  const c = await ctx(quoteId);
  if ("error" in c) return c.error!;
  const kinds: DeviationKind[] = ["longueur", "carottage", "pompe", "materiel", "autre"];
  if (!kinds.includes(d.kind)) return { ok: false, message: "Type d'écart invalide." };
  const description = d.description.trim().slice(0, 300);
  if (description.length < 3) return { ok: false, message: "Décrivez l'écart en quelques mots." };
  const quantity = d.kind === "pompe" ? 1 : d.quantity;
  if (d.kind !== "autre" && !(typeof quantity === "number" && quantity > 0 && quantity <= 500)) return { ok: false, message: "Indiquez la quantité (ex. 2 m)." };
  if ((d.kind === "longueur" || d.kind === "pompe") && !d.equipmentKey) return { ok: false, message: "Choisissez l'unité concernée." };
  const accessoryId = d.accessoryId && UUID.test(d.accessoryId) ? d.accessoryId : null;
  const { data: row, error } = await c.a.supabase
    .from("site_deviations")
    .insert({ company_id: c.a.companyId, quote_id: quoteId, kind: d.kind, equipment_key: d.equipmentKey?.slice(0, 80) ?? null, quantity: quantity ?? null, accessory_id: accessoryId, description, element_id: d.elementId?.slice(0, 80) ?? null, created_by: c.a.user.id })
    .select("id")
    .single();
  if (error) return { ok: false, message: FAIL };
  try {
    const costs = await computeDeviation(c.a.supabase, c.a.db, c.a.company, c.q, { kind: d.kind, equipmentKey: d.equipmentKey, quantity: quantity ?? null, accessoryId, description });
    await c.a.db.from("site_deviation_costs").upsert({ deviation_id: row.id, company_id: c.a.companyId, lines: costs.lines, extra_purchase_cents: costs.extraPurchaseCents, extra_sale_cents: costs.extraSaleCents, margin_if_billed_cents: costs.marginIfBilledCents, margin_if_absorbed_cents: costs.marginIfAbsorbedCents });
  } catch (e) {
    console.error("Chiffrage de l'écart :", e instanceof Error ? e.message : e);
  }
  done(quoteId);
  return { ok: true, message: "Écart transmis à l'administrateur ✔" };
}

async function adminCtx(quoteId: string) {
  const c = await ctx(quoteId);
  if ("error" in c) return c;
  if (c.a.role !== "admin") return { error: { ok: false, message: "Réservé aux administrateurs du compte." } };
  return c;
}

/** Écart libre : l'administrateur saisit le prix de vente et le coût. */
export async function priceDeviation(quoteId: string, deviationId: string, saleCents: number, purchaseCents: number): Promise<Result> {
  const c = await adminCtx(quoteId);
  if ("error" in c) return c.error!;
  if (!UUID.test(deviationId) || !Number.isInteger(saleCents) || !Number.isInteger(purchaseCents) || saleCents < 0 || purchaseCents < 0 || saleCents > 10_000_000) return { ok: false, message: "Montants invalides." };
  const { data: d } = await c.a.supabase.from("site_deviations").select("kind, equipment_key, quantity, accessory_id, description").eq("quote_id", quoteId).eq("id", deviationId).maybeSingle();
  if (!d) return { ok: false, message: "Écart introuvable." };
  const costs = await computeDeviation(c.a.supabase, c.a.db, c.a.company, c.q, { kind: d.kind, equipmentKey: d.equipment_key, quantity: 1, accessoryId: null, description: d.description }, { saleCents, purchaseCents });
  const { error } = await c.a.db.from("site_deviation_costs").upsert({ deviation_id: deviationId, company_id: c.a.companyId, lines: costs.lines, extra_purchase_cents: costs.extraPurchaseCents, extra_sale_cents: costs.extraSaleCents, margin_if_billed_cents: costs.marginIfBilledCents, margin_if_absorbed_cents: costs.marginIfAbsorbedCents, computed_at: new Date().toISOString() });
  if (error) return { ok: false, message: FAIL };
  done(quoteId);
  return { ok: true, message: "Écart chiffré ✔" };
}

/**
 * Décision de l'administrateur :
 *  - « avenant » : les écarts choisis forment le prochain avenant (brouillon PDF prêt à envoyer) ;
 *  - « accepte » / « refuse » : réponse du client à l'avenant ;
 *  - « absorbe » : l'entreprise prend le surcoût à sa charge.
 */
export async function decideDeviations(quoteId: string, ids: string[], decision: "avenant" | "accepte" | "refuse" | "absorbe" | "en_attente"): Promise<Result & { amendment?: number }> {
  const c = await adminCtx(quoteId);
  if ("error" in c) return c.error!;
  const list = ids.filter((i) => UUID.test(i)).slice(0, 50);
  if (list.length === 0) return { ok: false, message: "Choisissez au moins un écart." };
  const base = { decided_by: c.a.user.id, decided_at: new Date().toISOString() };
  let amendment: number | undefined;
  let patch: Record<string, unknown>;
  if (decision === "avenant") {
    const { data } = await c.a.supabase.from("site_deviations").select("amendment_number").eq("quote_id", quoteId).not("amendment_number", "is", null).order("amendment_number", { ascending: false }).limit(1);
    amendment = (data?.[0]?.amendment_number ?? 0) + 1;
    patch = { ...base, status: "avenant_envoye", amendment_number: amendment };
  } else if (decision === "en_attente") patch = { ...base, status: "en_attente", amendment_number: null };
  else if (decision === "absorbe") patch = { ...base, status: "absorbe", amendment_number: null };
  else patch = { ...base, status: decision };
  const { error } = await c.a.supabase.from("site_deviations").update(patch).eq("quote_id", quoteId).in("id", list);
  if (error) return { ok: false, message: FAIL };
  done(quoteId);
  return { ok: true, amendment, message: decision === "avenant" ? `Avenant n° ${amendment} prêt : ouvrez le PDF et envoyez-le au client.` : "Décision enregistrée ✔" };
}

/** 4. Relevés de mise en service (fusionnés avec ceux déjà saisis). */
export async function saveCommissioning(quoteId: string, values: Values): Promise<Result> {
  const c = await ctx(quoteId);
  if ("error" in c) return c.error!;
  const clean: Values = { ...((c.job?.commissioning as Values | undefined) ?? {}) };
  for (const [k, v] of Object.entries(values).slice(0, 300)) if (typeof v === "string" && k.length <= 80) clean[k] = v.trim().slice(0, 120);
  const now = new Date().toISOString();
  const { error } = await c.a.supabase.from("site_jobs").upsert({ quote_id: quoteId, company_id: c.a.companyId, commissioning: clean, status: c.job?.status ?? "en_cours", started_at: c.job?.started_at ?? now, updated_at: now });
  if (error) return { ok: false, message: FAIL };
  done(quoteId);
  return { ok: true, message: "Relevés enregistrés ✔" };
}

/** 5. Procès-verbal de réception signé par le client sur le téléphone. */
export async function saveReception(quoteId: string, r: { signerName: string; reserves: string[]; signaturePath: string | null }): Promise<Result> {
  const c = await ctx(quoteId);
  if ("error" in c) return c.error!;
  const reserves = r.reserves.map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const problem = validateReception({ signerName: r.signerName, reserves, hasSignature: Boolean(r.signaturePath) });
  if (problem) return { ok: false, message: problem };
  if (!r.signaturePath!.startsWith(`${c.a.companyId}/${quoteId}/`) || r.signaturePath!.includes("..")) return { ok: false, message: "Signature invalide." };
  const now = new Date().toISOString();
  const { error } = await c.a.supabase.from("site_jobs").upsert({
    quote_id: quoteId,
    company_id: c.a.companyId,
    reception: { signerName: r.signerName.trim().slice(0, 120), signedAt: now, reserves, signaturePath: r.signaturePath },
    status: "termine",
    started_at: c.job?.started_at ?? now,
    finished_at: now,
    updated_at: now,
  });
  if (error) return { ok: false, message: FAIL };
  done(quoteId);
  return { ok: true, message: "Réception enregistrée ✔ Le procès-verbal est prêt." };
}
