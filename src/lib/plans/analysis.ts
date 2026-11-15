/**
 * Lecture d'un plan par l'IA → brouillon de pièces validé par l'artisan (PUR).
 *
 * Règles validées :
 *  - plans acceptés : PDF d'architecte, photo d'un plan papier, croquis, plan d'agence ;
 *  - échelle lue sur le plan (cotes ou surfaces écrites), sinon une cote connue
 *    mesurée par l'artisan ; surface totale du logement demandée, alerte si la
 *    somme des pièces s'en écarte de plus de 10 % ;
 *  - pièces, surfaces, dimensions, fenêtres / portes-fenêtres (mur, largeur),
 *    pièces ouvertes entre elles, niveau ; orientation par la flèche du nord ;
 *  - RIEN n'est utilisé avant validation par l'artisan.
 */
import { z } from "zod";
import type { Orientation } from "@/lib/sizing/sizing";
import { bearingToOrientation, chooseScale, polygonArea, wallBearing, type Dimension, type Pt, type Scale } from "./geometry";

// ---------------------------------------------------------------------------
// Réponse de l'IA (coordonnées normalisées 0–1000 sur la largeur / hauteur de l'image)
// ---------------------------------------------------------------------------

const NPt = z.object({ x: z.number(), y: z.number() });
const NSeg = z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() });

export const PlanAnalysisSchema = z.object({
  plan_kind: z.enum(["architecte", "agence", "croquis", "photo", "autre"]).describe("Nature du document"),
  level_label: z.string().nullable().describe("Niveau indiqué (RDC, R+1, étage, sous-sol…), sinon null"),
  north_arrow_deg: z.number().nullable().describe("Si une flèche du nord est dessinée : angle en degrés, sens horaire, depuis le haut de l'image (0 = nord vers le haut). Sinon null"),
  total_area_m2_written: z.number().nullable().describe("Surface habitable totale écrite sur le plan, sinon null"),
  rooms: z
    .array(
      z.object({
        id: z.string().describe("Identifiant court unique : r1, r2…"),
        name: z.string().describe("Nom de la pièce tel qu'écrit, sinon un nom déduit (Chambre, Séjour…)"),
        polygon: z.array(NPt).describe("Contour intérieur de la pièce, sommets dans l'ordre, coordonnées 0–1000"),
        written_area_m2: z.number().nullable().describe("Surface écrite dans la pièce, sinon null"),
      }),
    )
    .describe("Pièces habitables et annexes visibles (y compris salle de bain, WC, couloir)"),
  windows: z
    .array(
      NSeg.extend({
        room_id: z.string(),
        kind: z.enum(["fenetre", "porte_fenetre", "baie_vitree"]),
        width_m: z.number().nullable().describe("Largeur écrite si cotée, sinon null"),
      }),
    )
    .describe("Ouvertures vitrées sur l'extérieur, segment le long du mur"),
  openings: z.array(z.object({ room_a: z.string(), room_b: z.string() })).describe("Pièces ouvertes l'une sur l'autre sans porte (cuisine ouverte sur séjour…)"),
  dimension_lines: z.array(NSeg.extend({ length_m: z.number() })).describe("Cotes lisibles : segment mesuré et longueur en mètres"),
  notes: z.array(z.string()).describe("Doutes de lecture à signaler à l'artisan, en français, courts"),
});
export type PlanAnalysis = z.infer<typeof PlanAnalysisSchema>;

export const PLAN_SYSTEM_PROMPT = `Tu lis des plans de logements français pour un artisan climaticien : plans d'architecte, plans d'agence immobilière, photos de plans papier, croquis à main levée.

Règles :
- Coordonnées normalisées de 0 à 1000 : x de gauche à droite sur la LARGEUR de l'image, y de haut en bas sur la HAUTEUR de l'image.
- Une pièce par espace fermé ; donne son contour intérieur (au moins 4 sommets, dans l'ordre).
- Recopie les surfaces et cotes écrites exactement (virgule française → point). N'invente aucune valeur : null si absent.
- Fenêtres, portes-fenêtres et baies : uniquement celles qui donnent sur l'extérieur, avec le segment du mur où elles se trouvent.
- openings : pièces ouvertes l'une sur l'autre sans cloison ni porte (ex. cuisine ouverte sur séjour).
- Flèche du nord : angle seulement si une flèche ou une rose des vents est dessinée.
- Si le document n'est pas un plan de logement lisible, renvoie des listes vides et explique-le dans notes.`;

// ---------------------------------------------------------------------------
// Brouillon (pixels) éditable par l'artisan
// ---------------------------------------------------------------------------

export type WindowKind = "fenetre" | "porte_fenetre" | "baie_vitree";

export interface DraftWindow {
  id: string;
  a: Pt;
  b: Pt;
  kind: WindowKind;
  /** Largeur écrite, sinon mesurée sur le plan à l'échelle. */
  widthM: number | null;
}

export interface DraftRoom {
  id: string;
  name: string;
  level: number;
  polygon: Pt[];
  writtenAreaM2: number | null;
  /** Surface saisie / corrigée par l'artisan (prioritaire). */
  areaOverrideM2: number | null;
  windows: DraftWindow[];
  /** Pièce à ignorer pour la climatisation (WC, couloir…) */
  excluded: boolean;
}

export interface PlanDraft {
  width: number;
  height: number;
  level: number;
  rooms: DraftRoom[];
  /** Paires de pièces ouvertes entre elles : fusionnées par défaut pour le dimensionnement. */
  openings: { a: string; b: string; merge: boolean }[];
  dimensions: Dimension[];
  measured: Dimension | null;
  northDeg: number | null;
  declaredTotalM2: number | null;
  notes: string[];
}

const NOT_HEATED = /\b(wc|toilettes?|d[ée]gagement|couloir|placard|dressing|cellier|buanderie|garage|cave|local|entr[ée]e|palier|escalier|terrasse|balcon|loggia|sas)\b/i;

/** Niveau déduit du libellé (« R+1 », « 1er étage », « sous-sol »…). */
export function levelFromLabel(label: string | null | undefined, fallback = 0): number {
  if (!label) return fallback;
  const t = label.toLowerCase();
  if (/sous[- ]sol|\bss\b|r-1/.test(t)) return -1;
  if (/\brdc\b|rez/.test(t)) return 0;
  const m = /r\s*\+\s*(\d)|(\d)\s*(?:er|e|ème|eme)?\s*[ée]tage/.exec(t);
  if (m) return Math.min(5, Number(m[1] ?? m[2]));
  if (/[ée]tage|combles/.test(t)) return 1;
  return fallback;
}

export function draftFromAnalysis(a: PlanAnalysis, width: number, height: number, defaults: { level?: number; declaredTotalM2?: number | null } = {}): PlanDraft {
  const px = (p: { x: number; y: number }): Pt => ({ x: (Math.min(1000, Math.max(0, p.x)) / 1000) * width, y: (Math.min(1000, Math.max(0, p.y)) / 1000) * height });
  const level = defaults.level ?? levelFromLabel(a.level_label, 0);
  const ids = new Set(a.rooms.map((r) => r.id));
  const rooms: DraftRoom[] = a.rooms
    .filter((r) => r.polygon.length >= 3)
    .map((r) => ({
      id: r.id,
      name: r.name.trim() || "Pièce",
      level,
      polygon: r.polygon.map(px),
      writtenAreaM2: r.written_area_m2 && r.written_area_m2 > 0 && r.written_area_m2 < 500 ? r.written_area_m2 : null,
      areaOverrideM2: null,
      windows: a.windows
        .filter((w) => w.room_id === r.id)
        .map((w, i) => ({ id: `${r.id}-w${i + 1}`, a: px({ x: w.x1, y: w.y1 }), b: px({ x: w.x2, y: w.y2 }), kind: w.kind, widthM: w.width_m && w.width_m > 0 && w.width_m < 15 ? w.width_m : null })),
      excluded: NOT_HEATED.test(r.name),
    }));
  return {
    width,
    height,
    level,
    rooms,
    openings: a.openings.filter((o) => ids.has(o.room_a) && ids.has(o.room_b) && o.room_a !== o.room_b).map((o) => ({ a: o.room_a, b: o.room_b, merge: true })),
    dimensions: a.dimension_lines.filter((d) => d.length_m > 0 && d.length_m < 100).map((d) => ({ a: px({ x: d.x1, y: d.y1 }), b: px({ x: d.x2, y: d.y2 }), lengthM: d.length_m })),
    measured: null,
    northDeg: a.north_arrow_deg === null ? null : ((a.north_arrow_deg % 360) + 360) % 360,
    declaredTotalM2: defaults.declaredTotalM2 ?? a.total_area_m2_written ?? null,
    notes: a.notes,
  };
}

/** Brouillon vide : plan sans lecture automatique (l'artisan dessine lui-même). */
export function emptyDraft(width: number, height: number, level = 0): PlanDraft {
  return { width, height, level, rooms: [], openings: [], dimensions: [], measured: null, northDeg: null, declaredTotalM2: null, notes: [] };
}

export function draftScale(d: PlanDraft): Scale | null {
  return chooseScale({ measured: d.measured, dimensions: d.dimensions, rooms: d.rooms });
}

/** Surface retenue d'une pièce : saisie > écrite sur le plan > mesurée à l'échelle. */
export function roomArea(r: DraftRoom, scale: Scale | null): number | null {
  if (r.areaOverrideM2) return r.areaOverrideM2;
  if (r.writtenAreaM2) return r.writtenAreaM2;
  if (!scale || r.polygon.length < 3) return null;
  return Math.round(polygonArea(r.polygon) * scale.mPerPx * scale.mPerPx * 10) / 10;
}

export function windowWidth(w: DraftWindow, scale: Scale | null): number | null {
  if (w.widthM) return w.widthM;
  if (!scale) return null;
  return Math.round(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * scale.mPerPx * 100) / 100;
}

/** Hauteurs conventionnelles pour estimer la surface vitrée. */
const GLAZING_HEIGHT_M: Record<WindowKind, number> = { fenetre: 1.25, porte_fenetre: 2.15, baie_vitree: 2.15 };
/** Vitrage « important » au-delà de 20 % de la surface au sol (suggestion modifiable). */
export const LARGE_GLAZING_RATIO = 0.2;

export interface RoomProposal {
  /** Pièces du plan regroupées (ouvertes entre elles). */
  sourceIds: string[];
  name: string;
  level: number;
  surfaceM2: number | null;
  orientation: Orientation;
  largeGlazing: boolean;
  glazingM2: number;
  windows: { orientation: Orientation; widthM: number | null; kind: WindowKind }[];
}

/**
 * Pièces proposées au dimensionnement : pièces exclues retirées, pièces
 * ouvertes fusionnées (si l'artisan l'a laissé coché), orientation = façade
 * la plus vitrée selon la flèche du nord (sans flèche : « aucune »).
 */
export function proposeRooms(d: PlanDraft): RoomProposal[] {
  const scale = draftScale(d);
  const kept = d.rooms.filter((r) => !r.excluded);
  const parent = new Map(kept.map((r) => [r.id, r.id]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const o of d.openings) if (o.merge && parent.has(o.a) && parent.has(o.b)) parent.set(find(o.a), find(o.b));
  const groups = new Map<string, DraftRoom[]>();
  for (const r of kept) groups.set(find(r.id), [...(groups.get(find(r.id)) ?? []), r]);

  return [...groups.values()].map((rs) => {
    const areas = rs.map((r) => roomArea(r, scale));
    const surface = areas.every((x) => x !== null) ? Math.round(areas.reduce<number>((s, x) => s + x!, 0) * 10) / 10 : null;
    const windows = rs.flatMap((r) =>
      r.windows.map((w) => ({
        orientation: d.northDeg === null ? ("aucune" as Orientation) : bearingToOrientation(wallBearing(w.a, w.b, r.polygon, d.northDeg)),
        widthM: windowWidth(w, scale),
        kind: w.kind,
      })),
    );
    const byOrientation = new Map<Orientation, number>();
    let glazing = 0;
    for (const w of windows) {
      const m2 = (w.widthM ?? 1) * GLAZING_HEIGHT_M[w.kind];
      glazing += m2;
      if (w.orientation !== "aucune") byOrientation.set(w.orientation, (byOrientation.get(w.orientation) ?? 0) + m2);
    }
    const orientation = [...byOrientation.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "aucune";
    return {
      sourceIds: rs.map((r) => r.id),
      name: rs.map((r) => r.name).join(" + "),
      level: rs[0]!.level,
      surfaceM2: surface,
      orientation,
      largeGlazing: surface ? glazing / surface >= LARGE_GLAZING_RATIO : false,
      glazingM2: Math.round(glazing * 10) / 10,
      windows,
    };
  });
}

/** Total des pièces du plan (exclues comprises : la surface du logement les inclut). */
export function draftTotalArea(d: PlanDraft): number | null {
  const scale = draftScale(d);
  const areas = d.rooms.map((r) => roomArea(r, scale));
  if (areas.some((a) => a === null)) return null;
  return Math.round(areas.reduce<number>((s, a) => s + a!, 0) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Données reçues du navigateur
// ---------------------------------------------------------------------------

const num = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const pt = (p: unknown, w: number, h: number): Pt | null => {
  const o = p as { x?: unknown; y?: unknown } | null;
  const x = num(o?.x, -50, w + 50);
  const y = num(o?.y, -50, h + 50);
  return x === null || y === null ? null : { x, y };
};
const text = (v: unknown, max = 60) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Nettoie un brouillon renvoyé par le navigateur (bornes, tailles, types). */
export function sanitizeDraft(raw: unknown, width: number, height: number): PlanDraft {
  const d = (raw ?? {}) as Partial<PlanDraft>;
  const P = (p: unknown) => pt(p, width, height);
  const dim = (x: unknown): Dimension | null => {
    const o = x as Partial<Dimension> | null;
    const a = P(o?.a);
    const b = P(o?.b);
    const l = num(o?.lengthM, 0.1, 100);
    return a && b && l ? { a, b, lengthM: l } : null;
  };
  const rooms: DraftRoom[] = (Array.isArray(d.rooms) ? d.rooms : []).slice(0, 60).flatMap((r) => {
    const polygon = (Array.isArray(r?.polygon) ? r.polygon : []).slice(0, 60).map(P).filter((p): p is Pt => p !== null);
    if (polygon.length < 3) return [];
    const windows = (Array.isArray(r.windows) ? r.windows : []).slice(0, 20).flatMap((w, i) => {
      const a = P(w?.a);
      const b = P(w?.b);
      const kind: WindowKind = w?.kind === "porte_fenetre" || w?.kind === "baie_vitree" ? w.kind : "fenetre";
      return a && b ? [{ id: text(w.id) || `w${i}`, a, b, kind, widthM: num(w.widthM, 0.2, 15) }] : [];
    });
    return [{ id: text(r.id) || `r${Math.random().toString(36).slice(2, 7)}`, name: text(r.name) || "Pièce", level: num(r.level, -1, 5) ?? 0, polygon, writtenAreaM2: num(r.writtenAreaM2, 0.5, 500), areaOverrideM2: num(r.areaOverrideM2, 0.5, 500), windows, excluded: Boolean(r.excluded) }];
  });
  const ids = new Set(rooms.map((r) => r.id));
  return {
    width,
    height,
    level: num(d.level, -1, 5) ?? 0,
    rooms,
    openings: (Array.isArray(d.openings) ? d.openings : []).filter((o) => ids.has(o?.a) && ids.has(o?.b)).map((o) => ({ a: o.a, b: o.b, merge: Boolean(o.merge) })),
    dimensions: (Array.isArray(d.dimensions) ? d.dimensions : []).slice(0, 100).map(dim).filter((x): x is Dimension => x !== null),
    measured: dim(d.measured),
    northDeg: num(d.northDeg, 0, 360) === null ? null : num(d.northDeg, 0, 360)! % 360,
    declaredTotalM2: num(d.declaredTotalM2, 5, 10000),
    notes: (Array.isArray(d.notes) ? d.notes : []).slice(0, 10).map((n) => text(n, 200)).filter(Boolean),
  };
}
