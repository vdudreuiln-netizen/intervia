/**
 * Dimensionnement simplifié (froid) par pièce : méthode en W/m³ avec
 * coefficients correcteurs. C'est un ORDRE DE GRANDEUR destiné au chiffrage,
 * pas un bilan thermique réglementaire (type NF EN 12831 / outils fabricants).
 * Tous les coefficients sont modifiables par l'artisan (settings_coefficients).
 */

export type Insulation = "faible" | "moyenne" | "bonne" | "rt2012";
export type Orientation = "N" | "E" | "S" | "O" | "aucune";

export interface RoomInput {
  name: string;
  surfaceM2: number;
  ceilingHeightM: number;
  orientation: Orientation;
  insulation: Insulation;
  largeGlazing: boolean;
  underRoof: boolean;
}

export interface SizingCoefficients {
  /** Puissance de base en W par m³ selon l'isolation. */
  wattsPerM3: Record<Insulation, number>;
  /** Multiplicateur selon l'orientation de la façade principale vitrée. */
  orientation: Record<Orientation, number>;
  /** Multiplicateur pièce sous toiture / dernier étage. */
  underRoof: number;
  /** Multiplicateur grandes surfaces vitrées. */
  largeGlazing: number;
  /** Plage acceptable de puissance froid d'une unité par rapport au besoin. */
  unitMinRatio: number;
  unitMaxRatio: number;
  /** Multi-split : l'unité extérieure doit couvrir Σ besoins × ce coefficient (1 = toutes les pièces à pleine charge). */
  multiSimultaneity: number;
}

export const DEFAULT_SIZING: SizingCoefficients = {
  wattsPerM3: { faible: 45, moyenne: 38, bonne: 32, rt2012: 25 },
  orientation: { N: 0.9, E: 1.0, S: 1.1, O: 1.15, aucune: 1.0 },
  underRoof: 1.2,
  largeGlazing: 1.15,
  unitMinRatio: 0.95,
  unitMaxRatio: 1.6,
  multiSimultaneity: 1,
};

export const INSULATION_LABELS: Record<Insulation, string> = {
  faible: "Faible",
  moyenne: "Moyenne",
  bonne: "Bonne",
  rt2012: "RT2012 / RE2020",
};

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  N: "Nord",
  E: "Est",
  S: "Sud",
  O: "Ouest",
  aucune: "Pas de fenêtre",
};

export interface SizingStep {
  label: string;
  factor: number;
}

export interface RoomSizing {
  volumeM3: number;
  baseWattsPerM3: number;
  steps: SizingStep[];
  /** Besoin en froid arrondi à la dizaine de watts. */
  watts: number;
  kw: number;
  /** Détail lisible du calcul. */
  explanation: string;
}

export function sizeRoom(room: RoomInput, c: SizingCoefficients = DEFAULT_SIZING): RoomSizing {
  if (room.surfaceM2 <= 0 || room.ceilingHeightM <= 0) {
    throw new RangeError("Surface et hauteur sous plafond doivent être positives");
  }
  const volumeM3 = Math.round(room.surfaceM2 * room.ceilingHeightM * 100) / 100;
  const base = c.wattsPerM3[room.insulation];
  const steps: SizingStep[] = [{ label: `Orientation ${ORIENTATION_LABELS[room.orientation]}`, factor: c.orientation[room.orientation] }];
  if (room.underRoof) steps.push({ label: "Sous toiture", factor: c.underRoof });
  if (room.largeGlazing) steps.push({ label: "Vitrage important", factor: c.largeGlazing });

  const raw = steps.reduce((w, s) => w * s.factor, volumeM3 * base);
  const watts = Math.round(raw / 10) * 10;
  const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const explanation =
    `${fmt(room.surfaceM2)} m² × ${fmt(room.ceilingHeightM)} m = ${fmt(volumeM3)} m³ ; ` +
    `× ${base} W/m³ (isolation ${INSULATION_LABELS[room.insulation].toLowerCase()})` +
    steps.map((s) => ` × ${fmt(s.factor)} (${s.label.toLowerCase()})`).join("") +
    ` = ${watts.toLocaleString("fr-FR")} W`;
  return { volumeM3, baseWattsPerM3: base, steps, watts, kw: watts / 1000, explanation };
}

/** Une unité de puissance froid `unitKw` est-elle cohérente avec le besoin ? */
export function unitFitsNeed(unitKw: number, needKw: number, c: SizingCoefficients = DEFAULT_SIZING): boolean {
  return unitKw >= needKw * c.unitMinRatio && unitKw <= needKw * c.unitMaxRatio;
}

// ---------------------------------------------------------------------------
// Jours de main d'œuvre proposés
// ---------------------------------------------------------------------------

export type IndoorType = "mural" | "console" | "cassette" | "gainable";

export interface LaborDaysParams {
  perOutdoorUnit: number;
  perIndoorUnit: Record<IndoorType, number>;
  /** Jours supplémentaires par mètre de liaison au-delà de la longueur incluse. */
  perExtraLinkMeter: number;
  includedLinkMetersPerIndoor: number;
  /** Mise en service, tirage au vide, essais. */
  commissioning: number;
  /** Arrondi au demi-jour supérieur. */
  roundTo: number;
  /** Gainable avec zonage : temps par pièce zonée. */
  zoningPerRoom: number;
}

export const DEFAULT_LABOR_DAYS: LaborDaysParams = {
  perOutdoorUnit: 0.25,
  perIndoorUnit: { mural: 0.5, console: 0.5, cassette: 0.75, gainable: 1.5 },
  perExtraLinkMeter: 0.02,
  includedLinkMetersPerIndoor: 5,
  commissioning: 0.25,
  roundTo: 0.5,
  zoningPerRoom: 0.25,
};

export interface InstallationSummary {
  outdoorUnits: number;
  indoorUnits: IndoorType[];
  totalLinkMeters: number;
}

export function proposeLaborDays(inst: InstallationSummary, p: LaborDaysParams = DEFAULT_LABOR_DAYS): number {
  if (inst.outdoorUnits === 0 && inst.indoorUnits.length === 0) return 0;
  const included = inst.indoorUnits.length * p.includedLinkMetersPerIndoor;
  const extraMeters = Math.max(0, inst.totalLinkMeters - included);
  const raw =
    inst.outdoorUnits * p.perOutdoorUnit +
    inst.indoorUnits.reduce((a, t) => a + p.perIndoorUnit[t], 0) +
    extraMeters * p.perExtraLinkMeter +
    p.commissioning;
  const r = Math.ceil(raw / p.roundTo - 1e-9) * p.roundTo;
  return Math.max(p.roundTo, r);
}

// ---------------------------------------------------------------------------
// Compatibilité multi-split
// ---------------------------------------------------------------------------

/** Ratio max Σ puissances intérieures / puissance extérieure si le modèle n'en précise pas. */
export const DEFAULT_MAX_INDOOR_RATIO = 1.3;

export interface MultiSplitCheck {
  ok: boolean;
  indoorTotalKw: number;
  ratio: number;
  maxRatio: number;
  problems: string[];
}

export function checkMultiSplit(
  outdoor: { coolingKw: number; maxOutlets: number; maxIndoorRatio?: number | null },
  indoorKws: number[],
): MultiSplitCheck {
  const maxRatio = outdoor.maxIndoorRatio ?? DEFAULT_MAX_INDOOR_RATIO;
  const indoorTotalKw = Math.round(indoorKws.reduce((a, k) => a + k, 0) * 100) / 100;
  const ratio = indoorTotalKw / outdoor.coolingKw;
  const problems: string[] = [];
  if (indoorKws.length > outdoor.maxOutlets) {
    problems.push(`${indoorKws.length} unités intérieures pour ${outdoor.maxOutlets} sorties maximum`);
  }
  if (ratio > maxRatio + 1e-9) {
    const pct = (n: number) => Math.round(n * 100) + " %";
    problems.push(`Puissance intérieure cumulée ${pct(ratio)} de l'unité extérieure (max ${pct(maxRatio)})`);
  }
  return { ok: problems.length === 0, indoorTotalKw, ratio, maxRatio, problems };
}
