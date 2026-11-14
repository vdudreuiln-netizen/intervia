"use server";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { isSameCommune } from "@/lib/geo/adresse";
import { roadDistance } from "@/lib/geo/route";
import { computeQuote, roundToPsychologicalPrice, type QuoteDiscount } from "@/lib/pricing/engine";
import { parseDecimal, parseEuros, parsePercent } from "@/lib/format";
import { applyEdits, parseFreeLine, recordOverride, recordRemoval, type FreeLineForm } from "@/lib/quote/edits";
import { documentWarnings, validateSchedule } from "@/lib/pdf/document";
import { parseClientSite, type ClientSiteErrors, type ClientSiteForm } from "@/lib/quote/client";
import { calcContext } from "@/lib/quote/context";
import { fromSelection } from "@/lib/quote/equipment";
import { buildLines, enabledLines, proposeDays } from "@/lib/quote/lines";
import { companyPricing, loadCoefficients, loadQuote, loadQuoteLines, loadWizardCatalog, siteInfo } from "@/lib/quote/load";
import { parseRooms, toRoomNeeds, type RoomForm } from "@/lib/quote/rooms";
import { EMPTY_EDITS, EMPTY_METRE, type WizardState } from "@/lib/quote/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAIL = "Enregistrement impossible. Réessayez.";

// ---------------------------------------------------------------------------
// Étape 1 : client et chantier
// ---------------------------------------------------------------------------

export async function saveClientSite(quoteId: string | null, form: ClientSiteForm): Promise<{ ok: boolean; errors?: ClientSiteErrors; message?: string; id?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseClientSite(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };
  const { client, site } = parsed.values;

  if (quoteId) {
    const q = await loadQuote(supabase, quoteId);
    if (!q) return { ok: false, message: "Devis introuvable." };
    const a = await supabase.from("clients").update(client).eq("id", q.project.client.id);
    const b = await supabase.from("projects").update(site).eq("id", q.project.id);
    if (a.error || b.error) return { ok: false, message: FAIL };
    revalidatePath(`/app/devis/${quoteId}`);
    return { ok: true, id: quoteId };
  }

  const { data: c, error: e1 } = await supabase.from("clients").insert({ ...client, company_id: company.id }).select("id").single();
  if (e1) return { ok: false, message: FAIL };
  const { data: p, error: e2 } = await supabase.from("projects").insert({ ...site, company_id: company.id, client_id: c.id }).select("id").single();
  if (e2) return { ok: false, message: FAIL };
  const { data: q, error: e3 } = await supabase
    .from("quotes")
    .insert({ company_id: company.id, project_id: p.id, vat_regime: company.vat_regime, validity_days: company.quote_validity_days, payment_terms: company.payment_terms })
    .select("id")
    .single();
  if (e3) return { ok: false, message: FAIL };
  revalidatePath("/app");
  return { ok: true, id: q.id };
}

/** Distance routière depuis l'adresse de l'entreprise + détection « même commune ». */
export async function computeDistance(site: { lat: number; lng: number; citycode: string; postcode: string; city: string }): Promise<{ ok: boolean; oneWayKm?: number; source?: "route" | "estimation"; sameCommune?: boolean; message?: string }> {
  const { company } = await getCurrentCompany();
  const sameCommune = isSameCommune(
    { citycode: company.base_citycode, postcode: company.base_postal_code, city: company.base_city },
    { citycode: site.citycode, postcode: site.postcode, city: site.city },
  );
  if (sameCommune) return { ok: true, oneWayKm: 0, source: "route", sameCommune };
  if (company.base_lat === null || company.base_lng === null) {
    return { ok: false, sameCommune, message: "Adresse de départ non localisée (Paramètres › Déplacements) : saisissez la distance à la main." };
  }
  const d = await roadDistance({ lat: Number(company.base_lat), lng: Number(company.base_lng) }, { lat: site.lat, lng: site.lng });
  return { ok: true, oneWayKm: d.oneWayKm, source: d.source, sameCommune };
}

// ---------------------------------------------------------------------------
// Étapes 2 et 3 : pièces et dimensionnement
// ---------------------------------------------------------------------------

export async function saveRooms(quoteId: string, forms: RoomForm[], gainableAccess: boolean): Promise<{ ok: boolean; errors?: Record<string, Record<string, string>>; message?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const coefs = await loadCoefficients(supabase);
  const parsed = parseRooms(forms, coefs.sizing);
  if (!parsed.ok) return { ok: false, errors: parsed.errors as Record<string, Record<string, string>>, message: forms.length === 0 ? "Ajoutez au moins une pièce." : "Certaines pièces sont à corriger." };

  const keep = parsed.values.filter((r) => UUID.test(r.id)).map((r) => r.id);
  const before = q.rooms.map((r) => r.id);
  const removed = before.filter((id) => !keep.includes(id));
  if (removed.length) {
    const { error } = await supabase.from("rooms").delete().in("id", removed);
    if (error) return { ok: false, message: FAIL };
  }
  for (const [i, r] of parsed.values.entries()) {
    const { id, ...row } = r;
    const data = { ...row, position: i, company_id: company.id, project_id: q.project.id };
    const res = UUID.test(id) && before.includes(id) ? await supabase.from("rooms").update(data).eq("id", id) : await supabase.from("rooms").insert(data);
    if (res.error) return { ok: false, message: FAIL };
  }
  await supabase.from("projects").update({ gainable_access: gainableAccess }).eq("id", q.project.id);

  // Pièces ajoutées / supprimées : la sélection de matériel n'est plus valable.
  const changed = removed.length > 0 || parsed.values.some((r) => !UUID.test(r.id));
  if (changed && q.wizard.selection) {
    await supabase.from("quotes").update({ wizard: { ...q.wizard, selection: undefined, metre: undefined } }).eq("id", quoteId);
  }
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Étapes 4 à 6 : état de l'assistant
// ---------------------------------------------------------------------------

export async function saveWizard(quoteId: string, patch: WizardState): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const wizard: WizardState = { ...q.wizard, ...patch };
  const { error } = await supabase.from("quotes").update({ wizard }).eq("id", quoteId);
  if (error) return { ok: false, message: FAIL };
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true };
}

/**
 * Génère les lignes du devis CÔTÉ SERVEUR à partir de l'état de l'assistant
 * et du catalogue en base (on ne fait jamais confiance aux prix envoyés par
 * le navigateur), puis enregistre lignes et totaux.
 *  - mode « keep »   : les retouches (prix, suppressions, lignes libres) sont conservées ;
 *  - mode « recalc » : tout est recalculé, retouches et lignes libres effacées.
 */
export async function finalizeQuote(quoteId: string, mode: "keep" | "recalc" = "keep"): Promise<{ ok: boolean; message?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  if (!q.wizard.selection) return { ok: false, message: "Choisissez d'abord une solution (étape 4)." };
  const [catalog, coefs] = await Promise.all([loadWizardCatalog(supabase), loadCoefficients(supabase)]);
  const equipment = fromSelection(q.wizard.selection, catalog.products);
  if (!equipment) return { ok: false, message: "Un produit choisi n'existe plus dans le catalogue : refaites le choix à l'étape 4." };

  const wizard: WizardState = mode === "recalc" ? { ...q.wizard, edits: EMPTY_EDITS } : q.wizard;
  const ctx = calcContext(companyPricing(company), siteInfo(q), coefs, wizard);
  const metre = wizard.metre ?? EMPTY_METRE;
  const days = wizard.laborDays ?? proposeDays(equipment, metre, coefs.laborDays);
  const travel = ctx.travelFor(days);
  const built = buildLines(equipment, toRoomNeeds(q.rooms), metre, catalog.accessories, ctx.lineSettings, days, travel);
  const byKey = new Map(built.lines.map((l) => [l.key, l]));
  const generated = applyEdits(
    enabledLines(built.lines).map((l) => ({ ...l, key: l.id })),
    wizard.edits,
  );

  const existing = await loadQuoteLines(supabase, quoteId);
  const manual = mode === "keep" ? existing.filter((l) => l.origin === "manual") : [];
  const del = await supabase.from("quote_lines").delete().eq("quote_id", quoteId).in("origin", mode === "keep" ? ["wizard"] : ["wizard", "manual"]);
  if (del.error) return { ok: false, message: FAIL };

  const rows = generated.map((l, i) => ({
    company_id: company.id,
    quote_id: quoteId,
    position: i,
    kind: l.kind,
    origin: "wizard",
    wizard_key: l.key,
    product_id: byKey.get(l.key)?.productId ?? null,
    accessory_id: byKey.get(l.key)?.accessoryId ?? null,
    designation: l.designation,
    quantity: l.quantity,
    unit: l.unit,
    unit_purchase_cents: l.unitPurchaseCents,
    unit_sale_cents: l.unitSaleCents,
    vat_rate: ctx.pricing.vatRegime === "franchise" ? 0 : l.vatRate,
  }));
  if (rows.length) {
    const ins = await supabase.from("quote_lines").insert(rows);
    if (ins.error) return { ok: false, message: FAIL };
  }
  // lignes libres conservées : après les lignes générées
  for (const [i, m] of manual.entries()) await supabase.from("quote_lines").update({ position: rows.length + i }).eq("id", m.id);

  const upd = await supabase
    .from("quotes")
    .update({
      wizard,
      labor_days: days,
      travel_trips: travel?.applies ? travel.days : 0,
      one_way_km: q.project.one_way_km,
      ...(mode === "recalc" ? { discount_kind: null, discount_value: null } : {}),
    })
    .eq("id", quoteId);
  if (upd.error) return { ok: false, message: FAIL };
  const t = await recomputeTotals(quoteId);
  if (!t.ok) return t;
  revalidatePath("/app");
  revalidatePath(`/app/devis/${quoteId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Éditeur du devis (après l'assistant)
// ---------------------------------------------------------------------------

/** Recalcule et enregistre les totaux à partir des lignes en base. */
async function recomputeTotals(quoteId: string): Promise<{ ok: boolean; message?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const lines = await loadQuoteLines(supabase, quoteId);
  const r = computeQuote({ lines, laborDays: q.laborDays, discount: q.discount, settings: pricingSettings(company, q.vatRegime) });
  const { error } = await supabase
    .from("quotes")
    .update({ total_ht_cents: r.totalHtCents, total_ttc_cents: r.totalTtcCents, net_margin_cents: r.margin.netMarginCents, discount_cents: r.discountCents })
    .eq("id", quoteId);
  revalidatePath(`/app/devis/${quoteId}/apercu`);
  revalidatePath("/app");
  return error ? { ok: false, message: FAIL } : { ok: true };
}

function pricingSettings(company: { labor_charges_rate: number; material_charges_rate: number; target_margin_per_day_cents: number }, vatRegime: "franchise" | "assujetti") {
  return { vatRegime, laborChargesRate: company.labor_charges_rate, materialChargesRate: company.material_charges_rate, targetMarginPerDayCents: Number(company.target_margin_per_day_cents) };
}

async function lineContext(quoteId: string, lineId: string) {
  const { supabase } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q || !UUID.test(lineId)) return null;
  const line = (await loadQuoteLines(supabase, quoteId)).find((l) => l.id === lineId);
  return line ? { supabase, q, line } : null;
}

/** Modifier le prix de vente (et la TVA) d'une ligne. */
export async function updateLine(quoteId: string, lineId: string, patch: { unitSaleCents: number; vatRate?: number }): Promise<{ ok: boolean; message?: string }> {
  const c = await lineContext(quoteId, lineId);
  if (!c) return { ok: false, message: "Ligne introuvable." };
  if (!Number.isInteger(patch.unitSaleCents) || patch.unitSaleCents < 0 || patch.unitSaleCents > 100_000_000) return { ok: false, message: "Prix invalide." };
  const vat = c.q.vatRegime === "franchise" ? 0 : patch.vatRate ?? c.line.vatRate;
  if (c.q.vatRegime === "assujetti" && ![0.055, 0.1, 0.2].includes(vat)) return { ok: false, message: "TVA : 5,5 %, 10 % ou 20 %." };
  const { error } = await c.supabase.from("quote_lines").update({ unit_sale_cents: patch.unitSaleCents, vat_rate: vat }).eq("id", lineId);
  if (error) return { ok: false, message: FAIL };
  if (c.line.origin === "wizard" && c.line.wizardKey) {
    const edits = recordOverride(c.q.wizard.edits, c.line.wizardKey, { unitSaleCents: patch.unitSaleCents, ...(c.q.vatRegime === "assujetti" ? { vatRate: vat } : {}) });
    await c.supabase.from("quotes").update({ wizard: { ...c.q.wizard, edits } }).eq("id", quoteId);
  }
  return recomputeTotals(quoteId);
}

export async function deleteLine(quoteId: string, lineId: string): Promise<{ ok: boolean; message?: string }> {
  const c = await lineContext(quoteId, lineId);
  if (!c) return { ok: false, message: "Ligne introuvable." };
  const { error } = await c.supabase.from("quote_lines").delete().eq("id", lineId);
  if (error) return { ok: false, message: FAIL };
  if (c.line.origin === "wizard" && c.line.wizardKey) {
    const edits = recordRemoval(c.q.wizard.edits, c.line.wizardKey);
    await c.supabase.from("quotes").update({ wizard: { ...c.q.wizard, edits } }).eq("id", quoteId);
  }
  return recomputeTotals(quoteId);
}

export async function addFreeLine(quoteId: string, form: FreeLineForm): Promise<{ ok: boolean; errors?: Partial<Record<keyof FreeLineForm, string>>; message?: string }> {
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const parsed = parseFreeLine(form, q.vatRegime, { euros: parseEuros, decimal: parseDecimal, percent: parsePercent });
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };
  const v = parsed.values;
  const count = (await loadQuoteLines(supabase, quoteId)).length;
  const { error } = await supabase.from("quote_lines").insert({
    company_id: company.id,
    quote_id: quoteId,
    position: count,
    kind: v.kind,
    origin: "manual",
    designation: v.designation,
    quantity: v.quantity,
    unit: v.unit,
    unit_purchase_cents: v.unitPurchaseCents,
    unit_sale_cents: v.unitSaleCents,
    vat_rate: v.vatRate,
  });
  if (error) return { ok: false, message: FAIL };
  return recomputeTotals(quoteId);
}

export async function setDiscount(quoteId: string, discount: QuoteDiscount | null): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await getCurrentCompany();
  if (discount && (!(discount.value >= 0) || (discount.kind === "percent" && discount.value >= 1))) return { ok: false, message: "Remise invalide." };
  const { error } = await supabase
    .from("quotes")
    .update(discount && discount.value > 0 ? { discount_kind: discount.kind, discount_value: discount.value } : { discount_kind: null, discount_value: null })
    .eq("id", quoteId);
  if (error) return { ok: false, message: FAIL };
  return recomputeTotals(quoteId);
}

/** Bouton « Arrondir aux seuils psychologiques » : calcul fait côté serveur. */
export async function roundQuote(quoteId: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const lines = await loadQuoteLines(supabase, quoteId);
  const r = roundToPsychologicalPrice({ lines, laborDays: q.laborDays, discount: q.discount, settings: pricingSettings(company, q.vatRegime) });
  if (r.outcome === "unchanged") return { ok: true, message: r.reason };

  let wizard = q.wizard;
  for (const after of r.lines) {
    const before = lines.find((l) => l.id === after.id)!;
    if (before.unitSaleCents === after.unitSaleCents && before.quantity === after.quantity && before.designation === after.designation) continue;
    await supabase
      .from("quote_lines")
      .update({ unit_sale_cents: after.unitSaleCents, quantity: after.quantity, unit: after.unit, designation: after.designation, unit_purchase_cents: after.unitPurchaseCents })
      .eq("id", after.id);
    if (before.origin === "wizard" && before.wizardKey) {
      wizard = { ...wizard, edits: recordOverride(wizard.edits, before.wizardKey, { unitSaleCents: after.unitSaleCents, quantity: after.quantity, unit: after.unit, designation: after.designation }) };
    }
  }
  await supabase
    .from("quotes")
    .update({ wizard, discount_kind: r.discount?.kind ?? null, discount_value: r.discount?.value ?? null })
    .eq("id", quoteId);
  const t = await recomputeTotals(quoteId);
  const total = (r.result.totalTtcCents / 100).toLocaleString("fr-FR");
  return { ok: t.ok, message: `${r.reason} Nouveau total : ${total} €.` };
}

/** Coefficients de vente propres au devis : regénère les lignes en conservant les retouches. */
export async function setQuoteCoefficients(quoteId: string, material: number | null, accessory: number | null): Promise<{ ok: boolean; message?: string }> {
  for (const c of [material, accessory]) if (c !== null && !(c > 0 && c <= 5)) return { ok: false, message: "Coefficient entre 0,01 et 5." };
  const s = await saveWizard(quoteId, { materialCoefficient: material, accessoryCoefficient: accessory });
  if (!s.ok) return s;
  return finalizeQuote(quoteId, "keep");
}

// ---------------------------------------------------------------------------
// Document client et statut
// ---------------------------------------------------------------------------

export interface DocumentOptions {
  presentation: "particulier" | "detaille";
  signedOffPremises: boolean;
  earlyStart: boolean;
  urgentRepair: boolean;
  depositRate: number | null; // null = taux des paramètres
  schedule: { label: string; rate: number }[] | null;
}

export async function setDocumentOptions(quoteId: string, o: DocumentOptions): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await getCurrentCompany();
  if (o.presentation !== "particulier" && o.presentation !== "detaille") return { ok: false, message: "Présentation invalide." };
  if (o.depositRate !== null && !(o.depositRate >= 0 && o.depositRate < 1)) return { ok: false, message: "Acompte entre 0 et 99 %." };
  if (o.schedule) {
    const e = validateSchedule(o.schedule);
    if (e) return { ok: false, message: e };
  }
  const { error } = await supabase
    .from("quotes")
    .update({
      presentation: o.presentation,
      signed_off_premises: o.signedOffPremises,
      early_start: o.signedOffPremises && !o.urgentRepair && o.earlyStart,
      urgent_repair: o.urgentRepair,
      deposit_rate: o.depositRate,
      payment_schedule: o.schedule,
    })
    .eq("id", quoteId);
  if (error) return { ok: false, message: FAIL };
  revalidatePath(`/app/devis/${quoteId}/apercu`);
  return { ok: true, message: "Réglages du document enregistrés ✔" };
}

/** Statut à la main : envoyé (bloqué si le devis n'est pas conforme), accepté, refusé, brouillon. */
export async function setQuoteStatus(quoteId: string, status: "brouillon" | "envoye" | "accepte" | "refuse"): Promise<{ ok: boolean; message?: string }> {
  const { supabase, company } = await getCurrentCompany();
  if (!["brouillon", "envoye", "accepte", "refuse"].includes(status)) return { ok: false, message: "Statut invalide." };
  if (status === "envoye") {
    const w = documentWarnings(company);
    if (w.length) return { ok: false, message: `Envoi bloqué : ${w.join(" ; ")}.` };
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === "envoye") patch.sent_at = now;
  if (status === "accepte" || status === "refuse") patch.decided_at = now;
  if (status === "brouillon") Object.assign(patch, { sent_at: null, decided_at: null });
  const { error } = await supabase.from("quotes").update(patch).eq("id", quoteId);
  if (error) return { ok: false, message: FAIL };
  revalidatePath(`/app/devis/${quoteId}/apercu`);
  revalidatePath("/app");
  const labels = { brouillon: "Repassé en brouillon", envoye: "Marqué comme envoyé ✔", accepte: "Devis accepté ✔", refuse: "Devis refusé" };
  return { ok: true, message: labels[status] };
}
