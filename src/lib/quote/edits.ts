/**
 * Retouches du devis après l'assistant : prix modifiés, lignes supprimées,
 * lignes libres. Quand l'artisan relance l'assistant, il choisit :
 *  - « conserver mes retouches » (par défaut) : on regénère puis on réapplique ;
 *  - « tout recalculer » : on repart des lignes de l'assistant seules.
 */
import type { QuoteLineInput } from "@/lib/pricing/engine";
import { EMPTY_EDITS, type QuoteEdits } from "./types";

/** Ligne générée par l'assistant, avec sa clé stable. */
export interface KeyedLine extends QuoteLineInput {
  key: string;
}

export function applyEdits(lines: KeyedLine[], edits: QuoteEdits | undefined): KeyedLine[] {
  const e = edits ?? EMPTY_EDITS;
  return lines.filter((l) => !e.removed.includes(l.key)).map((l) => ({ ...l, ...(e.overrides[l.key] ?? {}) }));
}

export function hasEdits(edits: QuoteEdits | undefined, manualLines: number): boolean {
  return manualLines > 0 || (!!edits && (Object.keys(edits.overrides).length > 0 || edits.removed.length > 0));
}

export function recordOverride(edits: QuoteEdits | undefined, key: string, patch: QuoteEdits["overrides"][string]): QuoteEdits {
  const e = edits ?? EMPTY_EDITS;
  return { ...e, overrides: { ...e.overrides, [key]: { ...(e.overrides[key] ?? {}), ...patch } } };
}

export function recordRemoval(edits: QuoteEdits | undefined, key: string): QuoteEdits {
  const e = edits ?? EMPTY_EDITS;
  const { [key]: _gone, ...overrides } = e.overrides;
  return { overrides, removed: e.removed.includes(key) ? e.removed : [...e.removed, key] };
}

export type FreeLineKind = "material" | "other";

export interface FreeLineForm {
  designation: string;
  kind: FreeLineKind;
  quantity: string;
  unit: string;
  purchase: string;
  sale: string;
  vatRate: string;
}

export interface FreeLineValues {
  designation: string;
  kind: FreeLineKind;
  quantity: number;
  unit: string;
  unitPurchaseCents: number;
  unitSaleCents: number;
  vatRate: number;
}

export function parseFreeLine(f: FreeLineForm, vatRegime: "franchise" | "assujetti", parse: { euros: (s: string) => number | null; decimal: (s: string) => number | null; percent: (s: string) => number | null }) {
  const errors: Partial<Record<keyof FreeLineForm, string>> = {};
  if (!f.designation.trim()) errors.designation = "Indiquez la désignation";
  const q = parse.decimal(f.quantity || "1");
  if (q === null || q <= 0 || q > 10000) errors.quantity = "Quantité invalide";
  const purchase = parse.euros(f.purchase || "0");
  if (purchase === null || purchase < 0) errors.purchase = "Prix d'achat invalide (0 si aucun)";
  const sale = parse.euros(f.sale);
  if (sale === null || sale < 0) errors.sale = "Prix de vente HT invalide";
  let vat = 0;
  if (vatRegime === "assujetti") {
    const v = parse.percent(f.vatRate || "10");
    if (v === null || ![0.055, 0.1, 0.2].includes(v)) errors.vatRate = "TVA : 5,5 %, 10 % ou 20 %";
    else vat = v;
  }
  const values: FreeLineValues = {
    designation: f.designation.trim(),
    kind: f.kind,
    quantity: q ?? 1,
    unit: f.unit.trim() || "u",
    unitPurchaseCents: purchase ?? 0,
    unitSaleCents: sale ?? 0,
    vatRate: vat,
  };
  return { ok: Object.keys(errors).length === 0, values, errors };
}
