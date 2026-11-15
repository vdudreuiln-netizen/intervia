/**
 * Formulaires « Fournisseurs » : fiche, frais de port, remises en masse. PUR et testé.
 */
import { centsToInput, formatEuros, parseEuros, parsePercent, rateToInput } from "@/lib/format";
import { familyKey, validateShippingRule, type ShippingRule } from "./pricing";

export interface SupplierForm {
  name: string;
  agency: string;
  contact_name: string;
  phone: string;
  email: string;
  delivery_terms: string;
  shipping_fee: string;
  franco: string;
  tiers: { from: string; fee: string }[];
}

export interface SupplierValues {
  name: string;
  agency: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  delivery_terms: string | null;
  shipping_fee_cents: number;
  franco_cents: number | null;
  shipping_tiers: { fromCents: number; feeCents: number }[];
}

export type SupplierErrors = Partial<Record<keyof SupplierForm | "tiers", string>>;

export function supplierToForm(v?: Partial<SupplierValues>): SupplierForm {
  return {
    name: v?.name ?? "",
    agency: v?.agency ?? "",
    contact_name: v?.contact_name ?? "",
    phone: v?.phone ?? "",
    email: v?.email ?? "",
    delivery_terms: v?.delivery_terms ?? "",
    shipping_fee: centsToInput(v?.shipping_fee_cents ?? 0),
    franco: centsToInput(v?.franco_cents ?? null),
    tiers: (v?.shipping_tiers ?? []).map((t) => ({
      from: centsToInput(t.fromCents),
      fee: centsToInput(t.feeCents),
    })),
  };
}

const opt = (s: string) => (s.trim() === "" ? null : s.trim());

export function parseSupplierForm(f: SupplierForm): {
  ok: boolean;
  values: SupplierValues;
  errors: SupplierErrors;
} {
  const errors: SupplierErrors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Indiquez le nom du fournisseur";
  if (name.length > 120) errors.name = "Nom trop long";
  const email = opt(f.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Adresse e-mail invalide";
  const fee = f.shipping_fee.trim() === "" ? 0 : parseEuros(f.shipping_fee);
  if (fee === null || fee < 0) errors.shipping_fee = "Montant invalide";
  const franco = f.franco.trim() === "" ? null : parseEuros(f.franco);
  if (franco !== null && franco <= 0) errors.franco = "Montant invalide";
  if (f.franco.trim() !== "" && franco === null) errors.franco = "Montant invalide";
  const tiers: { fromCents: number; feeCents: number }[] = [];
  for (const t of f.tiers) {
    if (t.from.trim() === "" && t.fee.trim() === "") continue;
    const from = parseEuros(t.from);
    const tf = parseEuros(t.fee);
    if (from === null || from < 0 || tf === null || tf < 0) {
      errors.tiers = "Palier invalide : indiquez « à partir de » et « frais » en euros";
      break;
    }
    tiers.push({ fromCents: from, feeCents: tf });
  }
  tiers.sort((a, b) => a.fromCents - b.fromCents);
  const values: SupplierValues = {
    name,
    agency: opt(f.agency),
    contact_name: opt(f.contact_name),
    phone: opt(f.phone),
    email,
    delivery_terms: opt(f.delivery_terms),
    shipping_fee_cents: fee ?? 0,
    franco_cents: franco,
    shipping_tiers: tiers,
  };
  if (!errors.tiers && !errors.shipping_fee && !errors.franco) {
    const e = validateShippingRule({
      feeCents: values.shipping_fee_cents,
      francoCents: values.franco_cents,
      tiers,
    });
    if (e) errors.tiers = e;
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** Résumé lisible des conditions de port. */
export function shippingLabel(rule: ShippingRule): string {
  if (rule.feeCents === 0 && rule.tiers.length === 0) return "Port offert";
  const parts: string[] = [];
  if (rule.tiers.length) {
    parts.push(`${formatEuros(rule.feeCents)} de port`);
    for (const t of [...rule.tiers].sort((a, b) => a.fromCents - b.fromCents)) parts.push(`${formatEuros(t.feeCents)} dès ${formatEuros(t.fromCents, { decimals: false })}`);
  } else parts.push(`${formatEuros(rule.feeCents)} de port`);
  if (rule.francoCents !== null) parts.push(`franco à ${formatEuros(rule.francoCents, { decimals: false })} HT`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Remises en masse
// ---------------------------------------------------------------------------

export interface DiscountEntryForm {
  /** brand_id ou libellé de famille */
  key: string;
  rate: string;
}

export type DiscountChange = { key: string; rate: number | null };

/**
 * Lignes saisies → changements : vide = supprimer la remise (on retombe sur le
 * niveau moins précis), sinon un taux entre 0 et 99,99 %.
 */
export function parseDiscountEntries(entries: DiscountEntryForm[]): {
  ok: boolean;
  changes: DiscountChange[];
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const changes: DiscountChange[] = [];
  for (const e of entries) {
    if (!e.key.trim()) continue;
    if (e.rate.trim() === "") {
      changes.push({ key: e.key.trim(), rate: null });
      continue;
    }
    const r = parsePercent(e.rate);
    if (r === null || r < 0 || r >= 1) errors[e.key] = "Remise entre 0 et 99 %";
    else changes.push({ key: e.key.trim(), rate: r });
  }
  return { ok: Object.keys(errors).length === 0, changes, errors };
}

/** Familles : on garde le libellé tel que saisi, la clé normalisée sert à l'unicité. */
export function familyRows(changes: DiscountChange[]): { family: string; family_key: string; rate: number | null }[] {
  const seen = new Map<string, { family: string; family_key: string; rate: number | null }>();
  for (const c of changes)
    seen.set(familyKey(c.key), {
      family: c.key,
      family_key: familyKey(c.key),
      rate: c.rate,
    });
  return [...seen.values()];
}

export const rateInput = rateToInput;
