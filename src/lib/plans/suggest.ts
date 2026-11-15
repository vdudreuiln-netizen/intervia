/**
 * Suggestions d'emplacement (PUR) : UNE proposition par élément, avec la raison
 * en une ligne ; « Autre proposition » prend le candidat suivant.
 * Les candidats qui violent une règle impérative vérifiable sur le plan
 * (source de chaleur, pièce d'eau, coin trop proche) sont écartés ; les
 * préférences donnent le classement.
 */
import type { Equipment } from "@/lib/quote/types";
import { centroid, dist, pointInPolygon, type Pt } from "./geometry";
import type { Marker } from "./layout";
import { dirOf, edgeShared, extentAlong, fmt, inwardAngle, maxExtent, segDist, type PlanRoom, type RulePlan, type RuleSettings } from "./rules";

export interface SuggestContext {
  plan: RulePlan;
  equipment: Equipment;
  /** Pièces du devis (id → nom) pour retrouver les pièces du plan. */
  quoteRooms: { id: string; name: string }[];
  settings: RuleSettings;
}

const WET = /\b(salle (de bains?|d'eau)|sdb|douche|wc|toilettes?)\b/i;
const CORRIDOR = /couloir|d[ée]gagement|circulation|hall|entr[ée]e/i;
const norm = (s: string) => s.trim().toLowerCase();

/** Pièces du plan desservies par une unité (les pièces fusionnées « A + B » sont retrouvées une à une). */
export function planRoomsFor(roomIds: string[], ctx: Pick<SuggestContext, "plan" | "quoteRooms">): PlanRoom[] {
  const names = new Set(roomIds.flatMap((id) => (ctx.quoteRooms.find((r) => r.id === id)?.name ?? "").split("+").map(norm)).filter(Boolean));
  return ctx.plan.rooms.filter((r) => names.has(norm(r.name)));
}

interface Candidate {
  p: Pt;
  angle?: number;
  score: number;
  reasons: string[];
}

const area = (poly: Pt[]) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += poly[i]!.x * poly[(i + 1) % poly.length]!.y - poly[(i + 1) % poly.length]!.x * poly[i]!.y;
  return Math.abs(s) / 2;
};

function pick(cands: Candidate[], variant: number, minGapPx: number): Candidate | null {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const distinct: Candidate[] = [];
  for (const c of sorted) if (!distinct.some((d) => dist(d.p, c.p) < minGapPx)) distinct.push(c);
  return distinct.length ? distinct[variant % distinct.length]! : null;
}

const exteriorEdges = (plan: RulePlan, tol: number) =>
  plan.rooms.flatMap((room) => room.polygon.map((a, i) => ({ a, b: room.polygon[(i + 1) % room.polygon.length]!, room })).filter((e) => dist(e.a, e.b) > tol * 2 && !edgeShared(e.a, e.b, e.room, plan.rooms, tol)));

/** Unité extérieure : dehors, au plus près des unités intérieures, loin de la rue, des chambres et des voisins. */
export function suggestOutdoor(systemKey: string, ctx: SuggestContext, variant = 0): Marker | null {
  const { plan } = ctx;
  const sys = ctx.equipment.systems.find((s) => s.key === systemKey);
  if (!sys || plan.rooms.length === 0) return null;
  const px = (m: number) => (plan.mPerPx ? m / plan.mPerPx : m * 50);
  const m = (p: number) => (plan.mPerPx ? p * plan.mPerPx : p / 50);
  const targets = sys.indoors.map((ind) => plan.layout.markers.find((k) => k.kind === "ui" && k.equipmentKey === ind.key) ?? null).map((mk, i) => (mk ? { x: mk.x, y: mk.y } : (() => {
    const rs = planRoomsFor(sys.indoors[i]!.roomIds, ctx);
    return rs.length ? centroid(rs.flatMap((r) => r.polygon)) : null;
  })())).filter((p): p is Pt => p !== null);
  const marks = (k: Marker["kind"]) => plan.layout.markers.filter((x) => x.kind === k);
  const cands: Candidate[] = [];
  for (const e of exteriorEdges(plan, px(0.4))) {
    const inward = dirOf(inwardAngle(e.a, e.b, e.room.polygon));
    for (const t of [0.25, 0.5, 0.75]) {
      const on = { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t };
      const p = { x: on.x - inward.x * px(0.5), y: on.y - inward.y * px(0.5) };
      if (plan.rooms.some((r) => pointInPolygon(p, r.polygon))) continue;
      if (marks("chaleur").some((h) => m(dist(h, p)) < ctx.settings.heatDistanceM)) continue;
      const reasons: string[] = [];
      let score = 0;
      const avg = targets.length ? targets.reduce((s, q) => s + m(dist(q, p)), 0) / targets.length : 0;
      score -= avg * 2;
      if (targets.length) reasons.push(`à ${fmt(avg)} m en moyenne des unités intérieures`);
      const rue = Math.min(Infinity, ...marks("rue").map((r) => m(dist(r, p))));
      if (rue < 6) score -= 30;
      else if (marks("rue").length) reasons.push("à l'opposé de la rue");
      const win = Math.min(Infinity, ...plan.bedroomWindows.map((w) => m(segDist(p, w.a, w.b))));
      if (win < 3) score -= 20;
      else if (plan.bedroomWindows.length) reasons.push("loin des fenêtres des chambres");
      const voisin = Math.min(Infinity, ...marks("voisin").map((v) => m(dist(v, p))));
      if (voisin < 3) score -= 20;
      else if (marks("voisin").length) reasons.push("loin des voisins");
      if (WET.test(e.room.name) || /cuisine|cellier|garage|buanderie/i.test(e.room.name)) {
        score += 3;
        reasons.push(`contre ${e.room.name.toLowerCase()} (bruit peu gênant)`);
      }
      cands.push({ p, score, reasons });
    }
  }
  const c = pick(cands, variant, px(1.5));
  if (!c) return null;
  return { id: `s-ue-${systemKey}`, kind: "ue", x: Math.round(c.p.x), y: Math.round(c.p.y), equipmentKey: systemKey, mount: "sol", suggested: true, reason: `Façade extérieure, ${c.reasons.slice(0, 3).join(", ") || "accessible de plain-pied"}.` };
}

/** Unité intérieure murale / console / cassette. */
export function suggestIndoor(indoorKey: string, ctx: SuggestContext, variant = 0): Marker | null {
  const { plan } = ctx;
  const sys = ctx.equipment.systems.find((s) => s.indoors.some((i) => i.key === indoorKey));
  const ind = sys?.indoors.find((i) => i.key === indoorKey);
  if (!sys || !ind) return null;
  const rooms = planRoomsFor(ind.roomIds, ctx).filter((r) => !WET.test(r.name));
  if (rooms.length === 0) return null;
  const room = [...rooms].sort((a, b) => area(b.polygon) - area(a.polygon))[0]!;
  const px = (v: number) => (plan.mPerPx ? v / plan.mPerPx : v * 50);
  const m = (p: number) => (plan.mPerPx ? p * plan.mPerPx : p / 50);
  const marks = (k: Marker["kind"]) => plan.layout.markers.filter((x) => x.kind === k);
  const ue = plan.layout.markers.find((k) => k.kind === "ue" && k.equipmentKey === sys.key) ?? null;

  if (ind.product.type === "ui_cassette") {
    const c = centroid(room.polygon);
    return { id: `s-ui-${indoorKey}`, kind: "ui", x: Math.round(c.x), y: Math.round(c.y), equipmentKey: indoorKey, suggested: true, reason: `Au centre de ${room.name.toLowerCase()} : diffusion homogène dans les 4 directions.` };
  }
  const longest = maxExtent(room.polygon);
  const cands: Candidate[] = [];
  room.polygon.forEach((a, i) => {
    const b = room.polygon[(i + 1) % room.polygon.length]!;
    const len = dist(a, b);
    if (m(len) < 1.2) return;
    const angle = inwardAngle(a, b, room.polygon);
    const inward = dirOf(angle);
    const exterior = !edgeShared(a, b, room, plan.rooms, px(0.4));
    for (const t of [0.5, 0.3, 0.7]) {
      const on = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const p = { x: on.x + inward.x * px(0.12), y: on.y + inward.y * px(0.12) };
      if (m(Math.min(dist(on, a), dist(on, b))) < 0.6) continue; // dégagement latéral
      if (marks("chaleur").some((h) => m(dist(h, p)) < ctx.settings.heatDistanceM)) continue;
      const reasons: string[] = [];
      let score = 0;
      if (exterior) {
        score += 6;
        reasons.push("mur extérieur");
      }
      const along = extentAlong(room.polygon, inward);
      if (along >= longest * 0.8) {
        score += 5;
        reasons.push(`souffle dans la longueur (${fmt(m(along))} m)`);
      }
      if (ue) {
        const d = m(dist(ue, p));
        score -= d;
        reasons.push(`à ${fmt(d)} m de l'unité extérieure`);
      }
      if (marks("lit").some((l) => m(dist(l, p)) < ctx.settings.bedDistanceM)) score -= 15;
      else if (marks("lit").some((l) => pointInPolygon(l, room.polygon))) reasons.push("pas au-dessus du lit");
      const blown = [...marks("lit"), ...marks("canape"), ...marks("bureau")].some((f) => {
        const d = m(dist(f, p));
        const ang = (((Math.atan2(f.x - p.x, -(f.y - p.y)) * 180) / Math.PI) % 360 + 360) % 360;
        const diff = Math.abs(((ang - angle + 540) % 360) - 180);
        return d < 3.5 && diff < 25;
      });
      if (blown) score -= 8;
      if (t === 0.5) score += 0.5;
      cands.push({ p, angle, score, reasons });
    }
  });
  const c = pick(cands, variant, px(1));
  if (!c) return null;
  return {
    id: `s-ui-${indoorKey}`,
    kind: "ui",
    x: Math.round(c.p.x),
    y: Math.round(c.p.y),
    equipmentKey: indoorKey,
    angle: Math.round(c.angle ?? 0),
    suggested: true,
    reason: `${room.name} : ${c.reasons.slice(0, 3).join(", ") || "mur libre le plus dégagé"}.`,
  };
}

/** Gainable : reprise dans le couloir (ou au centre), une bouche par pièce, éloignée de la reprise. */
export function suggestDucted(indoorKey: string, ctx: SuggestContext, variant = 0): Marker[] {
  const { plan } = ctx;
  const ind = ctx.equipment.systems.flatMap((s) => s.indoors).find((i) => i.key === indoorKey);
  if (!ind) return [];
  const rooms = planRoomsFor(ind.roomIds, ctx);
  if (rooms.length === 0) return [];
  const centre = centroid(rooms.map((r) => centroid(r.polygon)));
  const corridors = plan.rooms.filter((r) => CORRIDOR.test(r.name)).sort((a, b) => dist(centroid(a.polygon), centre) - dist(centroid(b.polygon), centre));
  const corridor = corridors.length ? corridors[variant % corridors.length]! : null;
  const g = corridor ? centroid(corridor.polygon) : centre;
  const out: Marker[] = [
    { id: `s-grille-${indoorKey}`, kind: "grille", x: Math.round(g.x), y: Math.round(g.y), equipmentKey: indoorKey, suggested: true, reason: corridor ? `Reprise dans ${corridor.name.toLowerCase()} : air repris au centre du logement, bruit hors des pièces.` : "Reprise au centre des pièces desservies." },
    { id: `s-ui-${indoorKey}`, kind: "ui", x: Math.round(g.x + 30), y: Math.round(g.y), equipmentKey: indoorKey, suggested: true, reason: "Gainable au plus près de la reprise : gaines courtes et équilibrées." },
  ];
  rooms.forEach((r, i) => {
    const c = centroid(r.polygon);
    const away = dist(c, g) || 1;
    const k = 0.35 + (variant % 2) * 0.15;
    let p = { x: c.x + ((c.x - g.x) / away) * maxExtent(r.polygon) * k * 0.5, y: c.y + ((c.y - g.y) / away) * maxExtent(r.polygon) * k * 0.5 };
    if (!pointInPolygon(p, r.polygon)) p = c;
    out.push({ id: `s-bouche-${indoorKey}-${i}`, kind: "bouche", x: Math.round(p.x), y: Math.round(p.y), equipmentKey: indoorKey, suggested: true, reason: `${r.name} : bouche à l'opposé de la reprise pour balayer toute la pièce.` });
  });
  return out;
}

/**
 * Propose tout ce qui n'est pas encore placé sur ce niveau (les éléments posés
 * par l'artisan ne bougent pas). `variants` : n° de variante par élément.
 */
export function suggestMissing(ctx: SuggestContext, placedElsewhere: Set<string>, variants: Record<string, number> = {}): Marker[] {
  const has = (kind: Marker["kind"], key: string, markers: Marker[]) => markers.some((m) => m.kind === kind && m.equipmentKey === key);
  let markers = [...ctx.plan.layout.markers];
  const added: Marker[] = [];
  const add = (ms: (Marker | null)[]) => {
    for (const m of ms) {
      if (!m) continue;
      added.push(m);
      markers = [...markers, m];
    }
  };
  const live = (): SuggestContext => ({ ...ctx, plan: { ...ctx.plan, layout: { ...ctx.plan.layout, markers } } });
  for (const sys of ctx.equipment.systems) {
    const served = sys.indoors.some((i) => planRoomsFor(i.roomIds, ctx).length > 0);
    if (served && !has("ue", sys.key, markers) && !placedElsewhere.has(`ue:${sys.key}`)) add([suggestOutdoor(sys.key, live(), variants[`ue:${sys.key}`] ?? 0)]);
    for (const ind of sys.indoors) {
      if (has("ui", ind.key, markers) || placedElsewhere.has(`ui:${ind.key}`)) continue;
      if (ind.product.type === "ui_gainable") add(suggestDucted(ind.key, live(), variants[`ui:${ind.key}`] ?? 0).filter((m) => !has(m.kind, ind.key, markers) || m.kind === "bouche"));
      else add([suggestIndoor(ind.key, live(), variants[`ui:${ind.key}`] ?? 0)]);
    }
  }
  return added;
}
