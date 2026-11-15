"use server";

import { readOnlyError } from "@/lib/billing/guard";
import { costAccess } from "@/lib/security/costs";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { isSameCommune } from "@/lib/geo/adresse";
import { roadDistance } from "@/lib/geo/route";
import { computeQuote, roundToPsychologicalPrice, type QuoteDiscount } from "@/lib/pricing/engine";
import { parseDecimal, parseEuros, parsePercent } from "@/lib/format";
import { applyEdits, parseFreeLine, recordOverride, recordRemoval, type FreeLineForm } from "@/lib/quote/edits";
import { documentWarnings, validateSchedule } from "@/lib/pdf/document";
import { priceNotices, remapIds } from "@/lib/quote/duplicate";
import { parseClientSite, type ClientSiteErrors, type ClientSiteForm } from "@/lib/quote/client";
import { calcContext } from "@/lib/quote/context";
import { fromSelection } from "@/lib/quote/equipment";
import { buildLines, enabledLines, proposeDays } from "@/lib/quote/lines";
import { companyPricing, loadCoefficients, loadQuote, loadQuoteLines, loadWizardCatalog, siteInfo } from "@/lib/quote/load";
import { parseRooms, toRoomNeeds, type RoomForm } from "@/lib/quote/rooms";
import { EMPTY_EDITS, EMPTY_METRE, type WizardState } from "@/lib/quote/types";
import { applySupplierPlan, DELIVERY_KEY, internalShipping, loadQuoteSupplierSettings } from "@/lib/suppliers/quote";
import { loadOffers, loadSuppliers } from "@/lib/suppliers/load";
import { buildPurchaseOrders, validateDesiredDate } from "@/lib/suppliers/orders";
import { shippingCost } from "@/lib/suppliers/pricing";

/** Lecteur des données de coûts (voir src/lib/security/costs.ts), toujours filtré sur l'entreprise. */
async function costDb() {
  const a = await costAccess();
  return { db: a.db, companyId: a.companyId };
}
async function linesOf(quoteId: string) {
  const { db, companyId } = await costDb();
  return loadQuoteLines(db, companyId, quoteId);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAIL = "Enregistrement impossible. Réessayez.";

// ---------------------------------------------------------------------------
// Étape 1 : client et chantier
// ---------------------------------------------------------------------------

export async function saveClientSite(quoteId: string | null, form: ClientSiteForm): Promise<{ ok: boolean; errors?: ClientSiteErrors; message?: string; id?: string }> {
  { const g = await readOnlyError(); if (g) return g as never; }
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
  { const g = await readOnlyError(); if (g) return g as never; }
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
  { const g = await readOnlyError(); if (g) return g as never; }
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
  { const g = await readOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  if (!q.wizard.selection) return { ok: false, message: "Choisissez d'abord une solution (étape 4)." };
  const [catalog, coefs] = await Promise.all([loadWizardCatalog((await costDb()).db, company.id), loadCoefficients(supabase)]);
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

  const existing = await linesOf(quoteId);
  const manual = mode === "keep" ? existing.filter((l) => l.origin === "manual") : [];
  // Fournisseurs imposés à la main sur les lignes générées : conservés
  const forcedByKey = new Map(mode === "keep" ? existing.filter((l) => l.supplierForced && l.wizardKey).map((l) => [l.wizardKey!, l.supplierId]) : []);
  const { db } = await costDb();
  const del = await db.from("quote_lines").delete().eq("company_id", company.id).eq("quote_id", quoteId).in("origin", mode === "keep" ? ["wizard"] : ["wizard", "manual"]);
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
    supplier_id: forcedByKey.get(l.key) ?? null,
    supplier_forced: forcedByKey.has(l.key),
  }));
  if (rows.length) {
    const ins = await db.from("quote_lines").insert(rows);
    if (ins.error) return { ok: false, message: FAIL };
  }
  // lignes libres conservées : après les lignes générées
  for (const [i, m] of manual.entries()) await db.from("quote_lines").update({ position: rows.length + i }).eq("company_id", company.id).eq("id", m.id);

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
  const { db } = await costDb();
  // Fournisseur retenu par ligne (prix net), frais de port, ligne de livraison refacturée
  const plan = await applySupplierPlan(db, company.id, quoteId, q.vatRegime, company.default_vat_rate);
  const r = computeQuote({
    lines: plan.lines,
    laborDays: q.laborDays,
    discount: q.discount,
    settings: pricingSettings(company, q.vatRegime),
    shippingCostCents: internalShipping(plan.settings),
  });
  const { error } = await supabase
    .from("quotes")
    .update({ total_ht_cents: r.totalHtCents, total_ttc_cents: r.totalTtcCents, discount_cents: r.discountCents })
    .eq("id", quoteId);
  // marge nette : table protégée (lisible seulement par les membres autorisés)
  const fin = await db.from("quote_financials").upsert({
    quote_id: quoteId,
    company_id: company.id,
    net_margin_cents: r.margin.netMarginCents,
    updated_at: new Date().toISOString(),
  });
  if (fin.error) return { ok: false, message: FAIL };
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
  const line = (await linesOf(quoteId)).find((l) => l.id === lineId);
  const { db, companyId } = await costDb();
  return line ? { supabase, q, line, db, companyId } : null;
}

/** Modifier le prix de vente (et la TVA) d'une ligne. */
export async function updateLine(quoteId: string, lineId: string, patch: { unitSaleCents: number; vatRate?: number }): Promise<{ ok: boolean; message?: string }> {
  { const g = await readOnlyError(); if (g) return g as never; }
  const c = await lineContext(quoteId, lineId);
  if (!c) return { ok: false, message: "Ligne introuvable." };
  if (!Number.isInteger(patch.unitSaleCents) || patch.unitSaleCents < 0 || patch.unitSaleCents > 100_000_000) return { ok: false, message: "Prix invalide." };
  const vat = c.q.vatRegime === "franchise" ? 0 : patch.vatRate ?? c.line.vatRate;
  if (c.q.vatRegime === "assujetti" && ![0.055, 0.1, 0.2].includes(vat)) return { ok: false, message: "TVA : 5,5 %, 10 % ou 20 %." };
  const { error } = await c.db.from("quote_lines").update({ unit_sale_cents: patch.unitSaleCents, vat_rate: vat }).eq("company_id", c.companyId).eq("id", lineId);
  if (error) return { ok: false, message: FAIL };
  if (c.line.origin === "wizard" && c.line.wizardKey) {
    const edits = recordOverride(c.q.wizard.edits, c.line.wizardKey, { unitSaleCents: patch.unitSaleCents, ...(c.q.vatRegime === "assujetti" ? { vatRate: vat } : {}) });
    await c.supabase.from("quotes").update({ wizard: { ...c.q.wizard, edits } }).eq("id", quoteId);
  }
  return recomputeTotals(quoteId);
}

export async function deleteLine(quoteId: string, lineId: string): Promise<{ ok: boolean; message?: string }> {
  { const g = await readOnlyError(); if (g) return g as never; }
  const c = await lineContext(quoteId, lineId);
  if (!c) return { ok: false, message: "Ligne introuvable." };
  const { error } = await c.db.from("quote_lines").delete().eq("company_id", c.companyId).eq("id", lineId);
  if (error) return { ok: false, message: FAIL };
  // Supprimer la ligne de livraison = ne plus refacturer le port
  if (c.line.wizardKey === DELIVERY_KEY) await c.db.from("quote_financials").update({ shipping_rebill: false }).eq("company_id", c.companyId).eq("quote_id", quoteId);
  if (c.line.origin === "wizard" && c.line.wizardKey) {
    const edits = recordRemoval(c.q.wizard.edits, c.line.wizardKey);
    await c.supabase.from("quotes").update({ wizard: { ...c.q.wizard, edits } }).eq("id", quoteId);
  }
  return recomputeTotals(quoteId);
}

export async function addFreeLine(quoteId: string, form: FreeLineForm): Promise<{ ok: boolean; errors?: Partial<Record<keyof FreeLineForm, string>>; message?: string }> {
  { const g = await readOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const parsed = parseFreeLine(form, q.vatRegime, { euros: parseEuros, decimal: parseDecimal, percent: parsePercent });
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };
  const v = parsed.values;
  const count = (await linesOf(quoteId)).length;
  const { error } = await (await costDb()).db.from("quote_lines").insert({
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
  { const g = await readOnlyError(); if (g) return g as never; }
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
  { const g = await readOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  const lines = await linesOf(quoteId);
  const { db, companyId } = await costDb();
  const shipping = internalShipping(await loadQuoteSupplierSettings(db, companyId, quoteId));
  const r = roundToPsychologicalPrice({
    lines,
    laborDays: q.laborDays,
    discount: q.discount,
    settings: pricingSettings(company, q.vatRegime),
    shippingCostCents: shipping,
  });
  if (r.outcome === "unchanged") return { ok: true, message: r.reason };

  let wizard = q.wizard;
  for (const after of r.lines) {
    const before = lines.find((l) => l.id === after.id)!;
    if (before.unitSaleCents === after.unitSaleCents && before.quantity === after.quantity && before.designation === after.designation) continue;
    await (await costDb()).db
      .from("quote_lines")
      .update({ unit_sale_cents: after.unitSaleCents, quantity: after.quantity, unit: after.unit, designation: after.designation, unit_purchase_cents: after.unitPurchaseCents })
      .eq("company_id", company.id)
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
  { const g = await readOnlyError(); if (g) return g as never; }
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
  { const g = await readOnlyError(); if (g) return g as never; }
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
  { const g = await readOnlyError(); if (g) return g as never; }
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

// ---------------------------------------------------------------------------
// Duplication et relances
// ---------------------------------------------------------------------------

/**
 * Copie un devis en nouveau brouillon. Les prix sont recalculés avec le
 * catalogue ACTUEL ; les retouches manuelles sont conservées ; les écarts de
 * prix sont signalés sur la copie.
 */
export async function duplicateQuote(sourceId: string, target: { mode: "same" | "other"; clientName?: string }): Promise<{ ok: boolean; id?: string; next?: string; message?: string }> {
  { const g = await readOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const src = await loadQuote(supabase, sourceId);
  if (!src) return { ok: false, message: "Devis introuvable." };
  if (target.mode === "other" && !target.clientName?.trim()) return { ok: false, message: "Indiquez le nom du nouveau client." };
  const srcLines = await linesOf(sourceId);

  // Client et chantier
  let clientId = src.project.client.id;
  if (target.mode === "other") {
    const { data, error } = await supabase.from("clients").insert({ company_id: company.id, name: target.clientName!.trim() }).select("id").single();
    if (error) return { ok: false, message: FAIL };
    clientId = data.id;
  }
  const p = src.project;
  const site =
    target.mode === "same"
      ? { site_address: p.site_address, site_postal_code: p.site_postal_code, site_city: p.site_city, site_citycode: p.site_citycode, site_lat: p.site_lat, site_lng: p.site_lng, one_way_km: p.one_way_km, same_commune: p.same_commune, parking_enabled: p.parking_enabled, parking_per_day_cents: p.parking_per_day_cents }
      : {};
  const { data: project, error: e1 } = await supabase.from("projects").insert({ company_id: company.id, client_id: clientId, gainable_access: p.gainable_access, ...site }).select("id").single();
  if (e1) return { ok: false, message: FAIL };

  // Pièces (nouveaux identifiants) et état de l'assistant renuméroté
  const idMap = new Map<string, string>();
  for (const [i, r] of src.rooms.entries()) {
    const { id: oldId, ...row } = r;
    const { data, error } = await supabase.from("rooms").insert({ ...row, position: i, company_id: company.id, project_id: project.id }).select("id").single();
    if (error) return { ok: false, message: FAIL };
    idMap.set(oldId, data.id);
  }
  const wizard: WizardState = remapIds({ ...src.wizard, priceNotices: undefined }, idMap);

  const d = src.document;
  const { data: copy, error: e2 } = await supabase
    .from("quotes")
    .insert({
      company_id: company.id,
      project_id: project.id,
      vat_regime: company.vat_regime,
      validity_days: company.quote_validity_days,
      payment_terms: company.payment_terms,
      wizard,
      labor_days: src.laborDays,
      discount_kind: src.discount?.kind ?? null,
      discount_value: src.discount?.value ?? null,
      presentation: d.presentation,
      signed_off_premises: d.signedOffPremises,
      early_start: d.earlyStart,
      urgent_repair: d.urgentRepair,
      deposit_rate: d.depositRate,
      payment_schedule: d.schedule,
      duplicated_from: sourceId,
    })
    .select("id, number")
    .single();
  if (e2) return { ok: false, message: FAIL };

  // Lignes libres recopiées telles quelles
  // (la ligne « Livraison du matériel » dépend des fournisseurs du devis : non recopiée)
  const manual = srcLines.filter((l) => l.origin === "manual" && l.wizardKey !== DELIVERY_KEY);
  if (manual.length) {
    const { error } = await (await costDb()).db.from("quote_lines").insert(
      manual.map((l, i) => ({
        company_id: company.id,
        quote_id: copy.id,
        position: 1000 + i,
        kind: l.kind,
        origin: "manual",
        designation: l.designation,
        quantity: l.quantity,
        unit: l.unit,
        unit_purchase_cents: l.unitPurchaseCents,
        unit_sale_cents: l.unitSaleCents,
        vat_rate: company.vat_regime === "franchise" ? 0 : l.vatRate,
      })),
    );
    if (error) return { ok: false, message: FAIL };
  }

  revalidatePath("/app");
  if (!wizard.selection) return { ok: true, id: copy.id, next: `/app/devis/${copy.id}?etape=1` };

  // Regénération avec le catalogue actuel, retouches conservées
  const f = await finalizeQuote(copy.id, "keep");
  if (!f.ok) return { ok: true, id: copy.id, next: `/app/devis/${copy.id}?etape=4`, message: f.message };
  const after = await linesOf(copy.id);
  const before = srcLines.map((l) => ({ ...l, wizardKey: l.wizardKey ? remapIds(l.wizardKey, idMap) : null }));
  const items = priceNotices(before, after, wizard.edits);
  if (items.length) await supabase.from("quotes").update({ wizard: { ...wizard, priceNotices: { sourceNumber: src.number, items } } }).eq("id", copy.id);

  // Autre client : il faut renseigner son adresse (frais de déplacement) puis revalider
  return { ok: true, id: copy.id, next: target.mode === "other" ? `/app/devis/${copy.id}?etape=1` : `/app/devis/${copy.id}/apercu` };
}

export async function dismissPriceNotices(quoteId: string): Promise<{ ok: boolean; message?: string }> {
  return saveWizard(quoteId, { priceNotices: undefined });
}

/** Note la date de relance (après le partage du message au client). */
export async function recordFollowUp(quoteId: string): Promise<{ ok: boolean; message?: string }> {
  { const g = await readOnlyError(); if (g) return g as never; }
  const { supabase } = await getCurrentCompany();
  const { data: q } = await supabase.from("quotes").select("follow_up_count").eq("id", quoteId).maybeSingle();
  if (!q) return { ok: false, message: "Devis introuvable." };
  const { error } = await supabase.from("quotes").update({ last_follow_up_at: new Date().toISOString(), follow_up_count: (q.follow_up_count ?? 0) + 1 }).eq("id", quoteId);
  if (error) return { ok: false, message: FAIL };
  revalidatePath("/app");
  return { ok: true, message: "Relance notée ✔" };
}

/** Supprime un devis BROUILLON (et son chantier / client s'ils ne servent plus). */
export async function deleteDraftQuote(quoteId: string): Promise<{ ok: boolean; message?: string }> {
  { const g = await readOnlyError(); if (g) return g as never; }
  const { supabase } = await getCurrentCompany();
  const q = await loadQuote(supabase, quoteId);
  if (!q) return { ok: false, message: "Devis introuvable." };
  if (q.status !== "brouillon") return { ok: false, message: "Seuls les brouillons peuvent être supprimés (les devis envoyés restent dans l'historique)." };
  const { error } = await supabase.from("quotes").delete().eq("id", quoteId);
  if (error) return { ok: false, message: FAIL };
  const { count: otherQuotes } = await supabase.from("quotes").select("id", { count: "exact", head: true }).eq("project_id", q.project.id);
  if (!otherQuotes) {
    await supabase.from("projects").delete().eq("id", q.project.id);
    const { count: otherProjects } = await supabase.from("projects").select("id", { count: "exact", head: true }).eq("client_id", q.project.client.id);
    if (!otherProjects) await supabase.from("clients").delete().eq("id", q.project.client.id);
  }
  revalidatePath("/app");
  return { ok: true, message: "Devis supprimé." };
}

// ---------------------------------------------------------------------------
// Fournisseurs du devis (membres autorisés à voir les marges)
// ---------------------------------------------------------------------------

async function supplierGuard(quoteId: string) {
  const g = await readOnlyError();
  if (g) return { error: g };
  const a = await costAccess();
  if (a.restricted)
    return {
      error: {
        ok: false as const,
        message: "Réservé aux membres autorisés à voir les prix d'achat.",
      },
    };
  const q = await loadQuote(a.supabase, quoteId);
  if (!q) return { error: { ok: false as const, message: "Devis introuvable." } };
  return { a, q };
}

async function supplierExists(db: Awaited<ReturnType<typeof costAccess>>["db"], companyId: string, supplierId: string) {
  if (!UUID.test(supplierId)) return false;
  const { data } = await db.from("suppliers").select("id").eq("company_id", companyId).eq("id", supplierId).maybeSingle();
  return Boolean(data);
}

/** Fournisseur imposé pour une ligne (null = choix automatique). */
export async function setLineSupplier(quoteId: string, lineId: string, supplierId: string | null): Promise<{ ok: boolean; message?: string }> {
  const g = await supplierGuard(quoteId);
  if ("error" in g) return g.error!;
  const { db, companyId } = g.a;
  if (!UUID.test(lineId)) return { ok: false, message: "Ligne introuvable." };
  if (supplierId && !(await supplierExists(db, companyId, supplierId))) return { ok: false, message: "Fournisseur introuvable." };
  const { error } = await db
    .from("quote_lines")
    .update({ supplier_id: supplierId, supplier_forced: supplierId !== null })
    .eq("company_id", companyId)
    .eq("quote_id", quoteId)
    .eq("id", lineId);
  if (error) return { ok: false, message: FAIL };
  return recomputeTotals(quoteId);
}

/** « Tout chez X » (null = combinaison la moins chère, port compris). */
export async function setQuoteSupplier(quoteId: string, supplierId: string | null): Promise<{ ok: boolean; message?: string }> {
  const g = await supplierGuard(quoteId);
  if ("error" in g) return g.error!;
  const { db, companyId } = g.a;
  if (supplierId && !(await supplierExists(db, companyId, supplierId))) return { ok: false, message: "Fournisseur introuvable." };
  const { error } = await db.from("quote_financials").upsert({
    quote_id: quoteId,
    company_id: companyId,
    forced_supplier_id: supplierId,
  });
  if (error) return { ok: false, message: FAIL };
  // « Tout chez X » remplace les choix ligne par ligne
  if (supplierId) await db.from("quote_lines").update({ supplier_forced: false }).eq("company_id", companyId).eq("quote_id", quoteId);
  return recomputeTotals(quoteId);
}

/** Refacturer les frais de port au client (ligne « Livraison du matériel »). */
export async function setShippingRebill(quoteId: string, rebill: boolean): Promise<{ ok: boolean; message?: string }> {
  const g = await supplierGuard(quoteId);
  if ("error" in g) return g.error!;
  const { db, companyId } = g.a;
  const { error } = await db.from("quote_financials").upsert({
    quote_id: quoteId,
    company_id: companyId,
    shipping_rebill: rebill,
  });
  if (error) return { ok: false, message: FAIL };
  return recomputeTotals(quoteId);
}

/** Recalcule le choix des fournisseurs (après un nouveau tarif, par exemple). */
export async function refreshQuoteSuppliers(quoteId: string): Promise<{ ok: boolean; message?: string }> {
  const g = await supplierGuard(quoteId);
  if ("error" in g) return g.error!;
  return recomputeTotals(quoteId);
}

// ---------------------------------------------------------------------------
// Bons de commande fournisseur (devis accepté)
// ---------------------------------------------------------------------------

export interface PurchaseOrderSummary {
  supplierId: string;
  supplierName: string;
  number: string;
  totalCents: number;
  generatedAt: string;
}

/** Un bon par fournisseur retenu, avec les prix nets prévus au devis. */
export async function generatePurchaseOrders(quoteId: string, delivery: "depot" | "chantier", desiredDate: string | null): Promise<{ ok: boolean; message: string; orders?: PurchaseOrderSummary[] }> {
  const g = await supplierGuard(quoteId);
  if ("error" in g) return { ok: false, message: g.error!.message };
  const { a, q } = g;
  if (q.status !== "accepte")
    return {
      ok: false,
      message: "Les bons de commande se génèrent une fois le devis accepté.",
    };
  const now = new Date();
  const dateError = validateDesiredDate(desiredDate || null, now);
  if (dateError) return { ok: false, message: dateError };
  const { db, companyId, company } = a;

  const lines = (await loadQuoteLines(db, companyId, quoteId)).filter((l) => l.supplierId && l.wizardKey !== DELIVERY_KEY);
  if (lines.length === 0)
    return {
      ok: false,
      message: "Aucune ligne de ce devis n'a de fournisseur (tarifs fournisseurs absents).",
    };
  const supplierIds = [...new Set(lines.map((l) => l.supplierId!))];
  const [suppliers, offers] = await Promise.all([
    loadSuppliers(db, companyId),
    loadOffers(db, companyId, {
      productIds: lines.flatMap((l) => (l.productId ? [l.productId] : [])),
      accessoryIds: lines.flatMap((l) => (l.accessoryId ? [l.accessoryId] : [])),
    }),
  ]);
  const offerOf = (l: (typeof lines)[number]) => offers.find((o) => o.supplierId === l.supplierId && (l.productId ? o.productId === l.productId : o.accessoryId === l.accessoryId));
  const { data: products } = await db
    .from("products")
    .select("id, reference")
    .eq("company_id", companyId)
    .in(
      "id",
      lines.flatMap((l) => (l.productId ? [l.productId] : [])),
    );
  const refOfProduct = new Map((products ?? []).map((p) => [p.id, p.reference as string]));

  // Port par fournisseur selon ses conditions, sur le montant commandé
  const shippingBySupplier: Record<string, number> = {};
  for (const sid of supplierIds) {
    const rule = suppliers.find((s) => s.id === sid)?.shipping;
    const subtotal = lines.filter((l) => l.supplierId === sid).reduce((n, l) => n + Math.round(l.quantity * l.unitPurchaseCents), 0);
    shippingBySupplier[sid] = rule ? shippingCost(rule, subtotal) : 0;
  }
  const orders = buildPurchaseOrders(
    lines.map((l) => {
      const o = offerOf(l);
      return {
        supplierId: l.supplierId,
        supplierRef: o?.supplierRef ?? null,
        manufacturerRef: o?.manufacturerRef ?? (l.productId ? (refOfProduct.get(l.productId) ?? null) : null),
        designation: o?.designation && l.accessoryId ? o.designation : l.designation,
        quantity: l.quantity,
        unit: l.unit,
        unitNetCents: l.unitPurchaseCents,
      };
    }),
    suppliers
      .filter((s) => supplierIds.includes(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        agency: s.agency,
        contactName: s.contactName,
        email: s.email,
        phone: s.phone,
      })),
    {
      quoteNumber: q.number,
      clientName: q.project.client.name,
      siteCity: q.project.site_city,
      delivery,
      depotAddress: {
        line: company.base_address,
        postalCode: company.base_postal_code,
        city: company.base_city,
      },
      siteAddress: {
        line: q.project.site_address,
        postalCode: q.project.site_postal_code,
        city: q.project.site_city,
      },
      desiredDate: desiredDate || null,
      generatedAt: now,
      shippingBySupplier,
    },
  );
  for (const o of orders) {
    const { error } = await db.from("purchase_orders").upsert(
      {
        company_id: companyId,
        quote_id: quoteId,
        supplier_id: o.supplier.id,
        number: o.number,
        delivery,
        desired_date: desiredDate || null,
        content: { ...o, generatedAt: o.generatedAt.toISOString() },
        total_cents: o.totalCents,
        generated_at: o.generatedAt.toISOString(),
        generated_by: a.user.id,
      },
      { onConflict: "quote_id,supplier_id" },
    );
    if (error) return { ok: false, message: FAIL };
  }
  // Fournisseurs qui ne sont plus retenus : anciens bons retirés
  await db
    .from("purchase_orders")
    .delete()
    .eq("company_id", companyId)
    .eq("quote_id", quoteId)
    .not("supplier_id", "in", `(${supplierIds.join(",")})`);
  revalidatePath(`/app/devis/${quoteId}/apercu`);
  return {
    ok: true,
    message: `${orders.length} bon${orders.length > 1 ? "s" : ""} de commande prêt${orders.length > 1 ? "s" : ""} ✔`,
    orders: orders.map((o) => ({
      supplierId: o.supplier.id,
      supplierName: o.supplier.name,
      number: o.number,
      totalCents: o.totalCents,
      generatedAt: o.generatedAt.toISOString(),
    })),
  };
}
