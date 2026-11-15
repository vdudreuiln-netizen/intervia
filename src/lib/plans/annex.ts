/**
 * Plans d'implantation pour les PDF (PUR) : image + repères + tracés, sans
 * aucun prix. Utilisé par l'annexe du devis et le dossier chantier.
 */
import type { Equipment } from "@/lib/quote/types";
import { equipmentTags, markerTag, MARKER_LABELS, ROUTE_COLORS, ROUTE_LABELS, routeLengthM, type Layout, type RouteKind } from "./layout";

export interface PlanAnnex {
  label: string;
  image: { data: Buffer; format: "jpg" | "png" };
  width: number;
  height: number;
  northDeg: number | null;
  markers: { x: number; y: number; tag: string; dark: boolean }[];
  routes: { points: { x: number; y: number }[]; color: string; dashed: boolean }[];
  /** Légende : repère → description ; tracé → longueur. */
  legend: string[];
}

export function annexOverlay(layout: Layout, eq: Equipment | null, mPerPx: number | null): Pick<PlanAnnex, "markers" | "routes" | "legend"> {
  const tags = eq ? equipmentTags(eq) : { indoor: new Map<string, string>(), outdoor: new Map<string, string>() };
  const markers = layout.markers.map((m) => ({ x: m.x, y: m.y, tag: markerTag(m, layout.markers, tags), dark: m.kind === "ue" }));
  const routes = layout.routes.filter((r) => r.points.length >= 2).map((r) => ({ points: r.points, color: ROUTE_COLORS[r.kind], dashed: r.kind === "condensats" }));
  const legend: string[] = [];
  for (const m of layout.markers) legend.push(`${markerTag(m, layout.markers, tags)} : ${MARKER_LABELS[m.kind].toLowerCase()}`);
  const byRoute = new Map<string, number>();
  for (const r of layout.routes) {
    if (r.points.length < 2 || !mPerPx) continue;
    const k = `${r.kind}|${r.equipmentKey}`;
    byRoute.set(k, (byRoute.get(k) ?? 0) + routeLengthM(r, mPerPx));
  }
  for (const [k, len] of byRoute) {
    const [kind, key] = k.split("|") as [RouteKind, string];
    const tag = tags.indoor.get(key) ?? tags.outdoor.get(key) ?? "";
    legend.push(`${ROUTE_LABELS[kind]} ${tag} : ${len.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m`);
  }
  return { markers, routes, legend: [...new Set(legend)] };
}

export const ROUTE_LEGEND = (Object.keys(ROUTE_COLORS) as RouteKind[]).map((k) => ({ label: ROUTE_LABELS[k], color: ROUTE_COLORS[k], dashed: k === "condensats" }));

export type ShareMode = "seul" | "annexes" | "complet";
export const SHARE_MODES: Record<ShareMode, { label: string; hint: string }> = {
  seul: { label: "Devis seul", hint: "Le devis, sans annexe" },
  annexes: { label: "Devis + annexes", hint: "Plan d'implantation et cahier des charges ; fiches techniques en fichiers séparés" },
  complet: { label: "Dossier complet", hint: "Devis, annexes et fiches techniques fusionnés en un seul PDF" },
};
export const parseShareMode = (v: string | null | undefined): ShareMode => (v === "seul" || v === "complet" ? v : "annexes");
