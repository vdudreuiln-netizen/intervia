/**
 * Implantation sur le plan → métré (PUR).
 *
 * Phase 1 (validée) : l'artisan place lui-même unités intérieures, unité(s)
 * extérieure(s), bouches et grilles, et trace liaisons, gaines, condensats,
 * goulottes et alimentation électrique. Les longueurs mesurées à l'échelle
 * (+ supplément saisi pour les passages verticaux) remplissent le métré.
 */
import type { Equipment, Metre } from "@/lib/quote/types";
import { polylineLength, type Pt } from "./geometry";

export type MarkerKind = "ui" | "ue" | "bouche" | "grille" | "tableau" | "evacuation";
export type RouteKind = "liaison" | "condensats" | "goulotte" | "electrique" | "gaine";

export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  /** ui : clé de l'unité intérieure ; ue : clé du système ; bouche / grille : clé du gainable. */
  equipmentKey: string | null;
}

export interface Route {
  id: string;
  kind: RouteKind;
  /** liaison / condensats / goulotte / gaine : clé de l'unité intérieure ; electrique : clé du système. */
  equipmentKey: string;
  points: Pt[];
  /** Mètres ajoutés : montées, descentes, passage d'étage, lovage. */
  extraM: number;
}

export interface Layout {
  markers: Marker[];
  routes: Route[];
}

export const EMPTY_LAYOUT: Layout = { markers: [], routes: [] };

export const MARKER_LABELS: Record<MarkerKind, string> = {
  ui: "Unité intérieure",
  ue: "Unité extérieure",
  bouche: "Bouche de soufflage",
  grille: "Grille de reprise",
  tableau: "Tableau électrique",
  evacuation: "Évacuation des condensats",
};

export const ROUTE_LABELS: Record<RouteKind, string> = {
  liaison: "Liaison frigorifique",
  condensats: "Condensats",
  goulotte: "Goulotte",
  electrique: "Alimentation électrique",
  gaine: "Gaine de soufflage",
};

export const ROUTE_COLORS: Record<RouteKind, string> = {
  liaison: "#0B4F8A",
  condensats: "#0E7490",
  goulotte: "#6B7280",
  electrique: "#B45309",
  gaine: "#7C3AED",
};

/** Longueur arrondie au demi-mètre supérieur (vente au mètre, chutes). */
export const roundUpHalf = (m: number) => Math.ceil(m * 2 - 1e-9) / 2;

export function routeLengthM(r: Route, mPerPx: number): number {
  return roundUpHalf(polylineLength(r.points) * mPerPx + Math.max(0, r.extraM));
}

/** Repères affichés sur le plan et dans les cahiers des charges : I1, I2…, E1…, B1…, G1…, T, C. */
export function equipmentTags(eq: Equipment): { indoor: Map<string, string>; outdoor: Map<string, string> } {
  const indoor = new Map<string, string>();
  const outdoor = new Map<string, string>();
  let i = 0;
  eq.systems.forEach((s, si) => {
    outdoor.set(s.key, `E${si + 1}`);
    for (const ind of s.indoors) indoor.set(ind.key, `I${++i}`);
  });
  return { indoor, outdoor };
}

export function markerTag(m: Marker, all: Marker[], tags: ReturnType<typeof equipmentTags>): string {
  if (m.kind === "ui") return tags.indoor.get(m.equipmentKey ?? "") ?? "I?";
  if (m.kind === "ue") return tags.outdoor.get(m.equipmentKey ?? "") ?? "E?";
  const same = all.filter((x) => x.kind === m.kind);
  const n = same.findIndex((x) => x.id === m.id) + 1;
  return { bouche: "B", grille: "G", tableau: "T", evacuation: "C" }[m.kind] + (same.length > 1 ? String(n) : "");
}

export interface PlanLayout {
  level: number;
  mPerPx: number | null;
  layout: Layout;
}

export interface MetreReportLine {
  key: string;
  label: string;
  lengthM: number;
}

/**
 * Métré issu de l'implantation (tous niveaux). Seules les valeurs effectivement
 * tracées remplacent le métré existant ; le reste est conservé.
 */
export function metreFromLayouts(plans: PlanLayout[], eq: Equipment, base: Metre): { metre: Metre; report: MetreReportLine[]; warnings: string[] } {
  const tags = equipmentTags(eq);
  const sums = new Map<string, number>(); // `${kind}:${key}`
  const counts = new Map<string, number>(); // `bouche:${key}` / `grille:${key}`
  const warnings: string[] = [];
  for (const p of plans) {
    for (const r of p.layout.routes) {
      if (r.points.length < 2) continue;
      if (!p.mPerPx) {
        warnings.push("Échelle du plan inconnue : mesurez une cote avant de reprendre les longueurs.");
        break;
      }
      const k = `${r.kind}:${r.equipmentKey}`;
      sums.set(k, (sums.get(k) ?? 0) + polylineLength(r.points) * p.mPerPx + Math.max(0, r.extraM));
    }
    for (const m of p.layout.markers) if ((m.kind === "bouche" || m.kind === "grille") && m.equipmentKey) counts.set(`${m.kind}:${m.equipmentKey}`, (counts.get(`${m.kind}:${m.equipmentKey}`) ?? 0) + 1);
  }
  const metre: Metre = { ...base, linkM: { ...base.linkM }, electricM: { ...base.electricM }, ductMPerRoom: { ...base.ductMPerRoom }, toggles: { ...base.toggles }, qty: { ...base.qty } };
  const report: MetreReportLine[] = [];
  for (const sys of eq.systems) {
    const e = sums.get(`electrique:${sys.key}`);
    if (e !== undefined) {
      metre.electricM[sys.key] = roundUpHalf(e);
      report.push({ key: `cable:${sys.key}`, label: `Alimentation électrique ${tags.outdoor.get(sys.key)}`, lengthM: roundUpHalf(e) });
    }
    for (const ind of sys.indoors) {
      const tag = tags.indoor.get(ind.key)!;
      const link = sums.get(`liaison:${ind.key}`);
      if (link !== undefined) {
        metre.linkM[ind.key] = roundUpHalf(link);
        report.push({ key: `liaison:${ind.key}`, label: `Liaison ${tag} → ${tags.outdoor.get(sys.key)}`, lengthM: roundUpHalf(link) });
      }
      for (const [kind, line, label] of [
        ["condensats", "condensats", "Condensats"],
        ["goulotte", "goulotte", "Goulotte"],
        ["gaine", "gaine", "Gaines"],
      ] as const) {
        const v = sums.get(`${kind}:${ind.key}`);
        if (v !== undefined) {
          metre.qty[`${line}:${ind.key}`] = roundUpHalf(v);
          report.push({ key: `${line}:${ind.key}`, label: `${label} ${tag}`, lengthM: roundUpHalf(v) });
        }
      }
      if (ind.product.type === "ui_gainable") {
        const b = counts.get(`bouche:${ind.key}`);
        const g = counts.get(`grille:${ind.key}`);
        if (b) metre.qty[`bouche:${ind.key}`] = b;
        if (g) metre.qty[`grille:${ind.key}`] = g;
      }
    }
  }
  return { metre, report, warnings: [...new Set(warnings)] };
}

/** Ce qui reste à placer ou à tracer (affiché dans l'éditeur, non bloquant). */
export function layoutChecklist(plans: PlanLayout[], eq: Equipment): string[] {
  const tags = equipmentTags(eq);
  const markers = plans.flatMap((p) => p.layout.markers);
  const routes = plans.flatMap((p) => p.layout.routes.filter((r) => r.points.length >= 2));
  const todo: string[] = [];
  for (const sys of eq.systems) {
    const e = tags.outdoor.get(sys.key);
    if (!markers.some((m) => m.kind === "ue" && m.equipmentKey === sys.key)) todo.push(`Placer l'unité extérieure ${e}`);
    if (!routes.some((r) => r.kind === "electrique" && r.equipmentKey === sys.key)) todo.push(`Tracer l'alimentation électrique de ${e}`);
    for (const ind of sys.indoors) {
      const t = tags.indoor.get(ind.key);
      if (!markers.some((m) => m.kind === "ui" && m.equipmentKey === ind.key)) todo.push(`Placer l'unité intérieure ${t}`);
      if (!routes.some((r) => r.kind === "liaison" && r.equipmentKey === ind.key)) todo.push(`Tracer la liaison de ${t}`);
      if (!routes.some((r) => r.kind === "condensats" && r.equipmentKey === ind.key)) todo.push(`Tracer les condensats de ${t}`);
      if (ind.product.type === "ui_gainable") {
        if (!markers.some((m) => m.kind === "bouche" && m.equipmentKey === ind.key)) todo.push(`Placer les bouches de soufflage de ${t}`);
        if (!routes.some((r) => r.kind === "gaine" && r.equipmentKey === ind.key)) todo.push(`Tracer les gaines de ${t}`);
      }
    }
  }
  return todo;
}

/** Validation des données reçues du navigateur. */
export function sanitizeLayout(raw: unknown, size: { width: number; height: number }): Layout {
  const L = (raw ?? {}) as Partial<Layout>;
  const inside = (p: { x: unknown; y: unknown }) => typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -50 && p.y >= -50 && p.x <= size.width + 50 && p.y <= size.height + 50;
  const kinds = new Set<string>(Object.keys(MARKER_LABELS));
  const rkinds = new Set<string>(Object.keys(ROUTE_LABELS));
  const str = (v: unknown, max = 80) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    markers: (Array.isArray(L.markers) ? L.markers : [])
      .slice(0, 200)
      .filter((m) => m && kinds.has(m.kind) && inside(m))
      .map((m) => ({ id: str(m.id) || crypto.randomUUID(), kind: m.kind, x: m.x, y: m.y, equipmentKey: m.equipmentKey ? str(m.equipmentKey) : null })),
    routes: (Array.isArray(L.routes) ? L.routes : [])
      .slice(0, 200)
      .filter((r) => r && rkinds.has(r.kind) && typeof r.equipmentKey === "string" && Array.isArray(r.points))
      .map((r) => ({
        id: str(r.id) || crypto.randomUUID(),
        kind: r.kind,
        equipmentKey: str(r.equipmentKey),
        points: r.points.filter(inside).slice(0, 100).map((p) => ({ x: p.x, y: p.y })),
        extraM: typeof r.extraM === "number" && Number.isFinite(r.extraM) ? Math.min(50, Math.max(0, r.extraM)) : 0,
      })),
  };
}
