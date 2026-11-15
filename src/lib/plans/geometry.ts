/**
 * Géométrie des plans (PUR). Coordonnées en pixels de l'image du plan,
 * y vers le bas. Échelle en mètres par pixel.
 */
import type { Orientation } from "@/lib/sizing/sizing";

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function polylineLength(points: Pt[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1]!, points[i]!);
  return n;
}

/** Aire (pixels²) d'un polygone simple, formule du lacet. */
export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function centroid(poly: Pt[]): Pt {
  const n = poly.length || 1;
  return { x: poly.reduce((a, p) => a + p.x, 0) / n, y: poly.reduce((a, p) => a + p.y, 0) / n };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

// ---------------------------------------------------------------------------
// Échelle
// ---------------------------------------------------------------------------

export type ScaleSource = "cotes" | "surfaces" | "mesure";

export interface Scale {
  mPerPx: number;
  source: ScaleSource;
}

/** Une cote : segment dessiné + longueur écrite (ou saisie par l'artisan). */
export interface Dimension {
  a: Pt;
  b: Pt;
  lengthM: number;
}

/** Échelle depuis des cotes (médiane, robuste à une cote mal lue). */
export function scaleFromDimensions(dims: Dimension[]): number | null {
  return median(dims.map((d) => (dist(d.a, d.b) > 5 ? d.lengthM / dist(d.a, d.b) : NaN)));
}

/** Échelle depuis des surfaces écrites dans les pièces : √(m² écrits / px²). */
export function scaleFromAreas(rooms: { polygon: Pt[]; writtenAreaM2: number | null }[]): number | null {
  return median(rooms.map((r) => (r.writtenAreaM2 && r.polygon.length >= 3 && polygonArea(r.polygon) > 100 ? Math.sqrt(r.writtenAreaM2 / polygonArea(r.polygon)) : NaN)));
}

/** Priorité : mesure de l'artisan > cotes du plan > surfaces écrites. */
export function chooseScale(input: { measured?: Dimension | null; dimensions: Dimension[]; rooms: { polygon: Pt[]; writtenAreaM2: number | null }[] }): Scale | null {
  if (input.measured && dist(input.measured.a, input.measured.b) > 5 && input.measured.lengthM > 0) return { mPerPx: input.measured.lengthM / dist(input.measured.a, input.measured.b), source: "mesure" };
  const d = scaleFromDimensions(input.dimensions);
  if (d) return { mPerPx: d, source: "cotes" };
  const s = scaleFromAreas(input.rooms);
  return s ? { mPerPx: s, source: "surfaces" } : null;
}

export const SCALE_LABELS: Record<ScaleSource, string> = {
  cotes: "lue sur les cotes du plan",
  surfaces: "déduite des surfaces écrites",
  mesure: "mesurée par vous",
};

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

/**
 * Orientation de la façade d'un segment de mur (fenêtre) d'une pièce.
 * `northDeg` : direction de la flèche du nord, en degrés dans le sens des
 * aiguilles d'une montre depuis le haut de l'image (0 = nord en haut).
 * On prend la normale du segment qui sort de la pièce.
 */
export function wallBearing(a: Pt, b: Pt, room: Pt[], northDeg: number): number {
  const len = dist(a, b) || 1;
  let n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const eps = Math.max(2, len * 0.05);
  if (room.length >= 3 && pointInPolygon({ x: mid.x + n.x * eps, y: mid.y + n.y * eps }, room)) n = { x: -n.x, y: -n.y };
  else if (room.length >= 3 && !pointInPolygon({ x: mid.x - n.x * eps, y: mid.y - n.y * eps }, room)) {
    // segment hors de la pièce (tracé approximatif) : on s'éloigne du centre
    const c = centroid(room);
    if ((mid.x - c.x) * n.x + (mid.y - c.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  }
  const fromUp = (Math.atan2(n.x, -n.y) * 180) / Math.PI; // sens horaire depuis le haut
  return (((fromUp - northDeg) % 360) + 360) % 360;
}

export function bearingToOrientation(bearing: number): Exclude<Orientation, "aucune"> {
  const b = ((bearing % 360) + 360) % 360;
  if (b >= 315 || b < 45) return "N";
  if (b < 135) return "E";
  if (b < 225) return "S";
  return "O";
}

// ---------------------------------------------------------------------------
// Contrôle de la surface totale
// ---------------------------------------------------------------------------

export const TOTAL_AREA_TOLERANCE = 0.1;

export function checkTotalArea(roomsM2: number, declaredM2: number | null): { ok: boolean; gap: number | null; message: string | null } {
  if (!declaredM2 || declaredM2 <= 0) return { ok: true, gap: null, message: null };
  const gap = (roomsM2 - declaredM2) / declaredM2;
  if (Math.abs(gap) <= TOTAL_AREA_TOLERANCE) return { ok: true, gap, message: null };
  const pct = Math.round(Math.abs(gap) * 100);
  return {
    ok: false,
    gap,
    message: `La somme des pièces (${roomsM2.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m²) s'écarte de ${pct} % de la surface du logement (${declaredM2.toLocaleString("fr-FR")} m²). Vérifiez l'échelle, une pièce oubliée ou en trop.`,
  };
}
