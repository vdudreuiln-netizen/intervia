/**
 * Mode chantier (PUR) : éléments à cocher, écarts chiffrés, avenant,
 * mise en service, fiche fluides, procès-verbal de réception.
 */
import { computeQuote, roundCents, type PricingSettings, type QuoteLineInput } from "@/lib/pricing/engine";
import type { BuiltLine } from "@/lib/quote/lines";
import { linkLength } from "@/lib/quote/lines";
import type { Equipment, Metre } from "@/lib/quote/types";
import { equipmentTags, markerTag, MARKER_LABELS, ROUTE_LABELS, type Layout } from "@/lib/plans/layout";
import { systemChargeKg, type UnitTech } from "@/lib/plans/rules";

// ---------------------------------------------------------------------------
// 1. Avancement : éléments à cocher
// ---------------------------------------------------------------------------

export interface SiteItem {
  id: string;
  label: string;
  group: string;
  level: number | null;
  x: number | null;
  y: number | null;
}

const POSE: Record<string, string> = { ui: "posée", ue: "posée", bouche: "posée", grille: "posée" };
const TIREE: Record<string, string> = { liaison: "tirée", condensats: "posés", goulotte: "posée", electrique: "tirée", gaine: "tirées" };

/** Éléments de l'implantation à cocher ; sans implantation, liste déduite du matériel. */
export function siteItems(plans: { level: number; layout: Layout }[], eq: Equipment): SiteItem[] {
  const tags = equipmentTags(eq);
  const items: SiteItem[] = [];
  const seen = new Set<string>();
  for (const p of plans) {
    for (const m of p.layout.markers) {
      if (!POSE[m.kind]) continue;
      const tag = markerTag(m, p.layout.markers, tags);
      items.push({ id: `m:${m.id}`, label: `${tag} – ${MARKER_LABELS[m.kind].toLowerCase()} ${POSE[m.kind]}`, group: m.kind === "ue" ? "Unités extérieures" : m.kind === "ui" ? "Unités intérieures" : "Gainable", level: p.level, x: m.x, y: m.y });
      if (m.equipmentKey) seen.add(`${m.kind}:${m.equipmentKey}`);
    }
    for (const r of p.layout.routes) {
      if (r.points.length < 2) continue;
      const tag = tags.indoor.get(r.equipmentKey) ?? tags.outdoor.get(r.equipmentKey) ?? "";
      const mid = r.points[Math.floor(r.points.length / 2)]!;
      items.push({ id: `r:${r.id}`, label: `${ROUTE_LABELS[r.kind]} ${tag} ${TIREE[r.kind]}`, group: "Réseaux", level: p.level, x: mid.x, y: mid.y });
      seen.add(`${r.kind}:${r.equipmentKey}`);
    }
  }
  const extra = (id: string, label: string, group: string) => items.push({ id, label, group, level: null, x: null, y: null });
  for (const s of eq.systems) {
    const e = tags.outdoor.get(s.key)!;
    if (!seen.has(`ue:${s.key}`)) extra(`eq:ue:${s.key}`, `${e} – unité extérieure posée`, "Unités extérieures");
    if (!seen.has(`electrique:${s.key}`)) extra(`eq:electrique:${s.key}`, `Alimentation électrique ${e} tirée`, "Réseaux");
    for (const i of s.indoors) {
      const t = tags.indoor.get(i.key)!;
      if (!seen.has(`ui:${i.key}`)) extra(`eq:ui:${i.key}`, `${t} – unité intérieure posée`, "Unités intérieures");
      if (!seen.has(`liaison:${i.key}`)) extra(`eq:liaison:${i.key}`, `Liaison frigorifique ${t} tirée`, "Réseaux");
      if (!seen.has(`condensats:${i.key}`)) extra(`eq:condensats:${i.key}`, `Condensats ${t} posés`, "Réseaux");
    }
  }
  return items;
}

export type Checks = Record<string, { at: string; by?: string }>;

export function progress(items: SiteItem[], checks: Checks): { done: number; total: number; percent: number } {
  const done = items.filter((i) => checks[i.id]).length;
  return { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// 3. Écarts : surcoût, impact sur la marge, avenant
// ---------------------------------------------------------------------------

export type DeviationKind = "longueur" | "carottage" | "pompe" | "materiel" | "autre";
export const DEVIATION_LABELS: Record<DeviationKind, string> = {
  longueur: "Liaison plus longue que prévu",
  carottage: "Carottage supplémentaire",
  pompe: "Pompe de relevage nécessaire",
  materiel: "Matériel supplémentaire",
  autre: "Autre écart",
};
export type DeviationStatus = "en_attente" | "avenant_envoye" | "accepte" | "refuse" | "absorbe";
export const DEVIATION_STATUS_LABELS: Record<DeviationStatus, string> = {
  en_attente: "En attente de décision",
  avenant_envoye: "Avenant envoyé au client",
  accepte: "Avenant accepté",
  refuse: "Refusé par le client",
  absorbe: "Pris en charge par l'entreprise",
};

export interface DeviationInput {
  kind: DeviationKind;
  /** longueur / pompe : clé de l'unité intérieure. */
  equipmentKey: string | null;
  /** longueur : mètres en plus ; carottage / matériel : quantité. */
  quantity: number | null;
}

export interface DevLine {
  designation: string;
  quantity: number;
  unit: string;
  kind: QuoteLineInput["kind"];
  unitPurchaseCents: number;
  unitSaleCents: number;
  vatRate: number;
}

/** Métré tel qu'il serait avec l'écart (longueur en plus, pompe ajoutée). */
export function metreWithDeviation(metre: Metre, d: DeviationInput): Metre {
  const m: Metre = { ...metre, linkM: { ...metre.linkM }, qty: { ...metre.qty }, toggles: { ...metre.toggles } };
  if (d.kind === "longueur" && d.equipmentKey && d.quantity) {
    m.linkM[d.equipmentKey] = linkLength(metre, d.equipmentKey) + d.quantity;
    // quantités issues du plan (forcées) : elles suivent la liaison
    for (const k of ["goulotte", "condensats"]) if (m.qty[`${k}:${d.equipmentKey}`] !== undefined) m.qty[`${k}:${d.equipmentKey}`] = m.qty[`${k}:${d.equipmentKey}`]! + d.quantity;
  }
  if (d.kind === "pompe" && d.equipmentKey) m.toggles[`pompe:${d.equipmentKey}`] = true;
  return m;
}

/** Lignes en plus entre le devis prévu et le devis avec l'écart (mêmes prix catalogue, mêmes coefficients). */
export function diffLines(before: BuiltLine[], after: BuiltLine[]): DevLine[] {
  const qty = (l: BuiltLine | undefined) => (l && l.enabled ? l.quantity : 0);
  const prev = new Map(before.map((l) => [l.key, l]));
  const out: DevLine[] = [];
  for (const l of after) {
    if (l.kind !== "material" && l.kind !== "accessory") continue;
    const delta = Math.round((qty(l) - qty(prev.get(l.key))) * 1000) / 1000;
    if (delta > 0) out.push({ designation: l.designation.replace(/\s*\(.*m de liaison\)/, ""), quantity: delta, unit: l.unit, kind: l.kind, unitPurchaseCents: l.unitPurchaseCents, unitSaleCents: l.unitSaleCents, vatRate: l.vatRate });
  }
  return out;
}

export interface DeviationCosts {
  lines: DevLine[];
  extraPurchaseCents: number;
  extraSaleCents: number;
  /** Variation de la marge nette si l'écart est facturé au client. */
  marginIfBilledCents: number;
  /** Variation de la marge nette si l'entreprise l'absorbe. */
  marginIfAbsorbedCents: number;
}

/** Surcoût et impact sur la marge du devis (charges sociales comprises). */
export function deviationCosts(base: { lines: QuoteLineInput[]; laborDays: number; settings: PricingSettings; shippingCostCents?: number }, extra: DevLine[]): DeviationCosts {
  const asInput = (l: DevLine, i: number, sale: number): QuoteLineInput => ({ id: `ecart-${i}`, kind: l.kind, designation: l.designation, quantity: l.quantity, unit: l.unit, unitPurchaseCents: l.unitPurchaseCents, unitSaleCents: sale, vatRate: l.vatRate });
  const m0 = computeQuote(base).margin.netMarginCents;
  const billed = computeQuote({ ...base, lines: [...base.lines, ...extra.map((l, i) => asInput(l, i, l.unitSaleCents))] }).margin.netMarginCents;
  const absorbed = computeQuote({ ...base, lines: [...base.lines, ...extra.map((l, i) => asInput(l, i, 0))] }).margin.netMarginCents;
  return {
    lines: extra,
    extraPurchaseCents: extra.reduce((s, l) => s + roundCents(l.quantity * l.unitPurchaseCents), 0),
    extraSaleCents: extra.reduce((s, l) => s + roundCents(l.quantity * l.unitSaleCents), 0),
    marginIfBilledCents: billed - m0,
    marginIfAbsorbedCents: absorbed - m0,
  };
}

export interface Amendment {
  number: number;
  items: { description: string; lines: DevLine[] }[];
  totalHtCents: number;
  vat: { rate: number; baseCents: number; vatCents: number }[];
  totalTtcCents: number;
  vatMention: string | null;
  /** Nouveau montant du marché : devis + avenants. */
  newTotalTtcCents: number;
}

/** Brouillon d'avenant : les écarts retenus, aux prix du devis, TVA du devis. */
export function buildAmendment(number: number, items: { description: string; lines: DevLine[] }[], settings: PricingSettings, quoteTotalTtcCents: number): Amendment {
  const lines = items.flatMap((it, i) => it.lines.map((l, j): QuoteLineInput => ({ id: `a${i}-${j}`, kind: l.kind, designation: l.designation, quantity: l.quantity, unit: l.unit, unitPurchaseCents: l.unitPurchaseCents, unitSaleCents: l.unitSaleCents, vatRate: l.vatRate })));
  const r = computeQuote({ lines, laborDays: 0, settings });
  return { number, items, totalHtCents: r.totalHtCents, vat: r.vat, totalTtcCents: r.totalTtcCents, vatMention: r.vatMention, newTotalTtcCents: quoteTotalTtcCents + r.totalTtcCents };
}

// ---------------------------------------------------------------------------
// 4. Mise en service et fiche fluides
// ---------------------------------------------------------------------------

export interface CommissioningField {
  id: string;
  label: string;
  unit?: string;
  type: "number" | "bool" | "text" | "date";
  required: boolean;
  hint?: string;
}

export interface CommissioningSection {
  title: string;
  fields: CommissioningField[];
}

/** Charge complémentaire prévue (g) selon les longueurs du métré. */
export function plannedExtraChargeG(eq: Equipment, metre: Metre, sysKey: string): number | null {
  const s = eq.systems.find((x) => x.key === sysKey);
  if (!s || s.outdoor.prechargedLengthM === null || s.outdoor.extraChargeGPerM === null) return null;
  const total = s.indoors.reduce((n, i) => n + linkLength(metre, i.key), 0);
  return Math.max(0, Math.round((total - s.outdoor.prechargedLengthM) * s.outdoor.extraChargeGPerM));
}

export function commissioningSections(eq: Equipment, metre: Metre): CommissioningSection[] {
  const tags = equipmentTags(eq);
  const out: CommissioningSection[] = [];
  for (const s of eq.systems) {
    const e = tags.outdoor.get(s.key)!;
    const planned = plannedExtraChargeG(eq, metre, s.key);
    out.push({
      title: `${e} – ${s.outdoor.brandName} ${s.outdoor.reference}`,
      fields: [
        { id: `${s.key}.serial`, label: "N° de série de l'unité extérieure", type: "text", required: true },
        { id: `${s.key}.n2_bar`, label: "Test d'étanchéité à l'azote : pression", unit: "bar", type: "number", required: true },
        { id: `${s.key}.n2_min`, label: "Durée du maintien", unit: "min", type: "number", required: true },
        { id: `${s.key}.n2_ok`, label: "Pression tenue (aucune chute)", type: "bool", required: true },
        { id: `${s.key}.vide_min`, label: "Tirage au vide : durée", unit: "min", type: "number", required: true },
        { id: `${s.key}.vide_mbar`, label: "Vide atteint", unit: "mbar", type: "number", required: true, hint: "Vide maintenu pompe isolée avant ouverture des vannes" },
        { id: `${s.key}.charge_g`, label: "Charge complémentaire ajoutée", unit: "g", type: "number", required: true, hint: planned === null ? "Prévu : à calculer (notice)" : `Prévu au métré : ${planned} g` },
        { id: `${s.key}.bp_bar`, label: "Pression BP en fonctionnement", unit: "bar", type: "number", required: false },
        { id: `${s.key}.hp_bar`, label: "Pression HP en fonctionnement", unit: "bar", type: "number", required: false },
      ],
    });
    for (const i of s.indoors) {
      const t = tags.indoor.get(i.key)!;
      out.push({
        title: `${t} – ${i.product.brandName} ${i.product.reference}`,
        fields: [
          { id: `${i.key}.serial`, label: "N° de série de l'unité intérieure", type: "text", required: false },
          { id: `${i.key}.froid_souffle`, label: "Froid : température de soufflage", unit: "°C", type: "number", required: true },
          { id: `${i.key}.froid_reprise`, label: "Froid : température de reprise", unit: "°C", type: "number", required: true },
          { id: `${i.key}.chaud_souffle`, label: "Chaud : température de soufflage", unit: "°C", type: "number", required: false },
          { id: `${i.key}.chaud_reprise`, label: "Chaud : température de reprise", unit: "°C", type: "number", required: false },
          { id: `${i.key}.condensats_ok`, label: "Écoulement des condensats testé à l'eau", type: "bool", required: true },
        ],
      });
    }
  }
  out.push({
    title: "Intervention",
    fields: [
      { id: "date", label: "Date de la mise en service", type: "date", required: true },
      { id: "operateur", label: "Technicien (nom)", type: "text", required: true },
    ],
  });
  return out;
}

export type Values = Record<string, string>;
const numOf = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
};

export interface CommissioningCheck {
  complete: boolean;
  missing: string[];
  /** Bloquant : la mise en service n'est pas conforme. */
  errors: string[];
  warnings: string[];
}

export function checkCommissioning(sections: CommissioningSection[], v: Values, eq: Equipment): CommissioningCheck {
  const missing: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const s of sections) {
    for (const f of s.fields) {
      const raw = (v[f.id] ?? "").trim();
      if (f.required && (raw === "" || (f.type === "bool" && raw !== "oui" && raw !== "non"))) missing.push(`${s.title.split(" – ")[0]} : ${f.label}`);
      if (f.type === "number" && raw !== "" && numOf(raw) === null) errors.push(`${f.label} : valeur illisible`);
    }
  }
  const tags = equipmentTags(eq);
  for (const s of eq.systems) {
    const e = tags.outdoor.get(s.key)!;
    if (v[`${s.key}.n2_ok`] === "non") errors.push(`${e} : le test à l'azote n'a pas tenu. Recherchez la fuite avant toute mise en service.`);
    const vide = numOf(v[`${s.key}.vide_mbar`]);
    if (vide !== null && vide > 2) warnings.push(`${e} : vide de ${vide} mbar, visez moins de 2 mbar (humidité).`);
    for (const i of s.indoors) {
      const a = numOf(v[`${i.key}.froid_reprise`]);
      const b = numOf(v[`${i.key}.froid_souffle`]);
      if (a !== null && b !== null && (a - b < 8 || a - b > 16)) warnings.push(`${tags.indoor.get(i.key)} : écart reprise / soufflage en froid de ${Math.round((a - b) * 10) / 10} °C (habituel : 8 à 15 °C).`);
      if (v[`${i.key}.condensats_ok`] === "non") errors.push(`${tags.indoor.get(i.key)} : l'écoulement des condensats n'est pas bon.`);
    }
  }
  return { complete: missing.length === 0 && errors.length === 0, missing, errors, warnings };
}

// ---------------------------------------------------------------------------
// 5. Réception
// ---------------------------------------------------------------------------

export interface Reception {
  signerName: string;
  signedAt: string;
  reserves: string[];
  signaturePath: string | null;
}

export function validateReception(r: { signerName: string; reserves: string[]; hasSignature: boolean }): string | null {
  if (r.signerName.trim().length < 2) return "Indiquez le nom du signataire.";
  if (!r.hasSignature) return "La signature du client est nécessaire.";
  if (r.reserves.some((x) => x.trim().length > 300)) return "Réserve trop longue (300 caractères maximum).";
  return null;
}

export const RECEPTION_LEGAL =
  "La réception est l'acte par lequel le client déclare accepter l'ouvrage, avec ou sans réserves (article 1792-6 du Code civil). Elle marque le point de départ des garanties : parfait achèvement (1 an), bon fonctionnement des équipements (2 ans) et responsabilité décennale (10 ans). Les réserves sont levées par l'entreprise dans le délai convenu.";

export type JobStatus = "a_venir" | "en_cours" | "termine";
export const JOB_STATUS_LABELS: Record<JobStatus, string> = { a_venir: "À venir", en_cours: "En cours", termine: "Terminé" };
