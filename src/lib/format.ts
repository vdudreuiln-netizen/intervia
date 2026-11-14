/**
 * Saisie et affichage des montants / pourcentages « à la française ».
 * L'artisan tape « 1 234,50 », « 45 », « 21,2 » : on convertit en centimes
 * ou en décimal. Retourne null si la saisie est illisible.
 */

function normalizeNumber(input: string): string {
  return input
    .trim()
    .replace(/[\s  ]/g, "") // espaces, insécables
    .replace(/€|%/g, "")
    .replace(",", ".");
}

export function parseDecimal(input: string): number | null {
  const s = normalizeNumber(input);
  if (s === "" || !/^-?\d*(\.\d*)?$/.test(s) || s === "." || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** « 1 234,5 » → 123450 centimes. */
export function parseEuros(input: string): number | null {
  const n = parseDecimal(input);
  if (n === null) return null;
  return Math.round(n * 100);
}

/** « 21,2 » → 0.212 */
export function parsePercent(input: string): number | null {
  const n = parseDecimal(input);
  if (n === null) return null;
  return Math.round(n * 1000) / 100000;
}

const eurFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eurFmt0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** 123450 → « 1 234,50 € » */
export function formatEuros(cents: number, opts: { decimals?: boolean } = {}): string {
  const v = cents / 100;
  return (opts.decimals === false ? eurFmt0 : eurFmt).format(v);
}

/** Valeur à pré-remplir dans un champ : 123450 → « 1234,50 », 4500 → « 45 » */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const v = cents / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
}

/** 0.212 → « 21,2 » */
export function rateToInput(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "";
  return String(Math.round(rate * 100000) / 1000).replace(".", ",");
}

export function decimalToInput(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(n).replace(".", ",");
}

export function formatPercent(rate: number, digits = 1): string {
  return (rate * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits }) + " %";
}
