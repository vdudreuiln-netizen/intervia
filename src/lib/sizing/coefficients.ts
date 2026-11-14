/**
 * Coefficients de dimensionnement et de pose modifiables par l'artisan :
 * description des champs, fusion avec les valeurs par défaut, validation.
 */
import { parseDecimal } from "@/lib/format";
import { DEFAULT_LABOR_DAYS, DEFAULT_SIZING, type LaborDaysParams, type SizingCoefficients } from "./sizing";

export interface Coefficients {
  sizing: SizingCoefficients;
  laborDays: LaborDaysParams;
}

export const DEFAULT_COEFFICIENTS: Coefficients = { sizing: DEFAULT_SIZING, laborDays: DEFAULT_LABOR_DAYS };

export interface CoefField {
  path: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  group: string;
}

export const COEF_FIELDS: CoefField[] = [
  { group: "Puissance de base selon l'isolation", path: "sizing.wattsPerM3.faible", label: "Isolation faible", unit: "W/m³", min: 5, max: 150 },
  { group: "Puissance de base selon l'isolation", path: "sizing.wattsPerM3.moyenne", label: "Isolation moyenne", unit: "W/m³", min: 5, max: 150 },
  { group: "Puissance de base selon l'isolation", path: "sizing.wattsPerM3.bonne", label: "Bonne isolation", unit: "W/m³", min: 5, max: 150 },
  { group: "Puissance de base selon l'isolation", path: "sizing.wattsPerM3.rt2012", label: "RT2012 / RE2020", unit: "W/m³", min: 5, max: 150 },
  { group: "Orientation (multiplicateur)", path: "sizing.orientation.N", label: "Nord", unit: "×", min: 0.5, max: 2 },
  { group: "Orientation (multiplicateur)", path: "sizing.orientation.E", label: "Est", unit: "×", min: 0.5, max: 2 },
  { group: "Orientation (multiplicateur)", path: "sizing.orientation.S", label: "Sud", unit: "×", min: 0.5, max: 2 },
  { group: "Orientation (multiplicateur)", path: "sizing.orientation.O", label: "Ouest", unit: "×", min: 0.5, max: 2 },
  { group: "Orientation (multiplicateur)", path: "sizing.orientation.aucune", label: "Pas de fenêtre", unit: "×", min: 0.5, max: 2 },
  { group: "Autres corrections", path: "sizing.underRoof", label: "Pièce sous toiture", unit: "×", min: 1, max: 2 },
  { group: "Autres corrections", path: "sizing.largeGlazing", label: "Vitrage important", unit: "×", min: 1, max: 2 },
  { group: "Choix des unités", path: "sizing.unitMinRatio", label: "Puissance mini de l'unité / besoin", unit: "×", min: 0.5, max: 1.5 },
  { group: "Choix des unités", path: "sizing.unitMaxRatio", label: "Puissance maxi de l'unité / besoin", unit: "×", min: 1, max: 3 },
  { group: "Temps de pose (en jours)", path: "laborDays.perOutdoorUnit", label: "Par unité extérieure", unit: "j", min: 0, max: 5 },
  { group: "Temps de pose (en jours)", path: "laborDays.perIndoorUnit.mural", label: "Par unité murale", unit: "j", min: 0, max: 5 },
  { group: "Temps de pose (en jours)", path: "laborDays.perIndoorUnit.console", label: "Par console", unit: "j", min: 0, max: 5 },
  { group: "Temps de pose (en jours)", path: "laborDays.perIndoorUnit.cassette", label: "Par cassette", unit: "j", min: 0, max: 5 },
  { group: "Temps de pose (en jours)", path: "laborDays.perIndoorUnit.gainable", label: "Par gainable", unit: "j", min: 0, max: 10 },
  { group: "Temps de pose (en jours)", path: "laborDays.includedLinkMetersPerIndoor", label: "Mètres de liaison inclus par unité intérieure", unit: "m", min: 0, max: 50 },
  { group: "Temps de pose (en jours)", path: "laborDays.perExtraLinkMeter", label: "Par mètre de liaison supplémentaire", unit: "j", min: 0, max: 1 },
  { group: "Temps de pose (en jours)", path: "laborDays.commissioning", label: "Mise en service, tirage au vide, essais", unit: "j", min: 0, max: 3 },
  { group: "Temps de pose (en jours)", path: "laborDays.roundTo", label: "Arrondi au", unit: "j", min: 0.25, max: 1 },
];

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

/** Complète des coefficients stockés (éventuellement partiels) avec les valeurs par défaut. */
export function withDefaults(stored: { sizing?: unknown; laborDays?: unknown } | null | undefined): Coefficients {
  const out = structuredClone(DEFAULT_COEFFICIENTS) as unknown as Record<string, unknown>;
  for (const f of COEF_FIELDS) {
    const v = getPath(stored, f.path);
    if (typeof v === "number" && Number.isFinite(v)) setPath(out, f.path, v);
  }
  return out as unknown as Coefficients;
}

export function coefficientsToForm(c: Coefficients): Record<string, string> {
  return Object.fromEntries(COEF_FIELDS.map((f) => [f.path, String(getPath(c, f.path)).replace(".", ",")]));
}

export function parseCoefficientsForm(form: Record<string, string>): { ok: boolean; value: Coefficients; errors: Record<string, string> } {
  const value = structuredClone(DEFAULT_COEFFICIENTS) as unknown as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const f of COEF_FIELDS) {
    const n = parseDecimal(form[f.path] ?? "");
    if (n === null || n < f.min || n > f.max) errors[f.path] = `Entre ${String(f.min).replace(".", ",")} et ${String(f.max).replace(".", ",")}`;
    else setPath(value, f.path, n);
  }
  const v = value as unknown as Coefficients;
  if (!errors["sizing.unitMaxRatio"] && v.sizing.unitMaxRatio <= v.sizing.unitMinRatio) {
    errors["sizing.unitMaxRatio"] = "Doit être supérieur au minimum";
  }
  return { ok: Object.keys(errors).length === 0, value: v, errors };
}
