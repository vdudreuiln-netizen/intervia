/**
 * Règles d'implantation (PUR, utilisable dans le navigateur et sur le serveur).
 *
 * IMPÉRATIVES (rouge) : l'élément ne peut pas être validé sans forcer avec un motif.
 * PRÉFÉRENCES (orange) : simple conseil.
 * Toutes activables / désactivables dans les paramètres de l'entreprise.
 *
 * Surface minimale R32 : formule de l'annexe GG de l'IEC 60335-2-40
 *   A_min = ( m / (2,5 × LFL^(5/4) × h0) )²
 * avec LFL = 0,307 kg/m³ (R32), h0 = hauteur de pose (sol 0,6 m, mural 1,8 m,
 * plafond 2,2 m). En dessous du seuil m1 = 6 m³ × LFL (≈ 1,84 kg) aucune
 * surface minimale n'est imposée. La notice du fabricant prime toujours.
 */
import type { ProductType } from "@/lib/catalog/import";
import type { Equipment } from "@/lib/quote/types";
import { centroid, dist, pointInPolygon, polygonArea, polylineLength, type Pt } from "./geometry";
import { equipmentTags, type Layout, type Marker } from "./layout";

// ---------------------------------------------------------------------------
// Catalogue des règles
// ---------------------------------------------------------------------------

export type RuleId =
  | "r32_surface"
  | "liaison_longueur"
  | "liaison_denivele"
  | "degagements"
  | "piece_eau"
  | "source_chaleur"
  | "condensats"
  | "ue_acces"
  | "support_fixation"
  | "sol_degage"
  | "lit"
  | "soufflage_meubles"
  | "soufflage_longueur"
  | "ue_rue"
  | "ue_chambres"
  | "ue_voisins"
  | "liaison_courte"
  | "gainable_reprise"
  | "gainable_bouches"
  | "donnees";

export type Severity = "rouge" | "orange";

export const RULES: { id: RuleId; severity: Severity; label: string }[] = [
  { id: "r32_surface", severity: "rouge", label: "Surface minimale de la pièce (R32, charge totale du système)" },
  { id: "liaison_longueur", severity: "rouge", label: "Longueur maximale des liaisons (fabricant)" },
  { id: "liaison_denivele", severity: "rouge", label: "Dénivelé maximal des liaisons (fabricant)" },
  { id: "degagements", severity: "rouge", label: "Dégagements minimaux de la notice" },
  { id: "piece_eau", severity: "rouge", label: "Pas d'unité intérieure dans une salle de bain ou une pièce d'eau" },
  { id: "source_chaleur", severity: "rouge", label: "Pas d'unité près d'une source de chaleur ou de flamme" },
  { id: "condensats", severity: "rouge", label: "Condensats évacuables (sinon pompe de relevage ajoutée)" },
  { id: "ue_acces", severity: "rouge", label: "Unité extérieure accessible pour l'entretien" },
  { id: "support_fixation", severity: "rouge", label: "Support de fixation vérifié sur place (unité extérieure et unité murale)" },
  { id: "sol_degage", severity: "rouge", label: "Sol dégagé devant l'unité extérieure vérifié sur place" },
  { id: "lit", severity: "orange", label: "Pas d'unité intérieure au-dessus d'un lit" },
  { id: "soufflage_meubles", severity: "orange", label: "Ne pas souffler directement sur un lit, un canapé ou un bureau" },
  { id: "soufflage_longueur", severity: "orange", label: "Souffler dans la plus grande longueur de la pièce" },
  { id: "ue_rue", severity: "orange", label: "Unité extérieure côté jardin plutôt que côté rue" },
  { id: "ue_chambres", severity: "orange", label: "Unité extérieure loin des fenêtres des chambres" },
  { id: "ue_voisins", severity: "orange", label: "Unité extérieure loin des voisins" },
  { id: "liaison_courte", severity: "orange", label: "Liaisons les plus courtes possibles" },
  { id: "gainable_reprise", severity: "orange", label: "Gainable : reprise centrale ou dans le couloir" },
  { id: "gainable_bouches", severity: "orange", label: "Gainable : bouches éloignées de la reprise" },
  { id: "donnees", severity: "orange", label: "Données fabricant manquantes (règle non vérifiable)" },
];

export interface RuleSettings {
  enabled: Partial<Record<RuleId, boolean>>;
  /** Distance mini à une source de chaleur (m). */
  heatDistanceM: number;
  /** Distance « au-dessus d'un lit » (m). */
  bedDistanceM: number;
  /** Pente mini des condensats (0,01 = 1 cm/m). */
  condensateSlope: number;
  /** Hauteur d'un niveau (m) pour le dénivelé entre étages. */
  levelHeightM: number;
}

export const DEFAULT_RULE_SETTINGS: RuleSettings = { enabled: {}, heatDistanceM: 1.5, bedDistanceM: 1, condensateSlope: 0.01, levelHeightM: 2.7 };

export function ruleSettings(raw: unknown): RuleSettings {
  const r = (raw ?? {}) as Partial<RuleSettings>;
  const n = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : d);
  const enabled: Partial<Record<RuleId, boolean>> = {};
  for (const rule of RULES) if (typeof r.enabled?.[rule.id] === "boolean") enabled[rule.id] = r.enabled[rule.id];
  return {
    enabled,
    heatDistanceM: n(r.heatDistanceM, DEFAULT_RULE_SETTINGS.heatDistanceM, 0.3, 10),
    bedDistanceM: n(r.bedDistanceM, DEFAULT_RULE_SETTINGS.bedDistanceM, 0.3, 5),
    condensateSlope: n(r.condensateSlope, DEFAULT_RULE_SETTINGS.condensateSlope, 0.005, 0.05),
    levelHeightM: n(r.levelHeightM, DEFAULT_RULE_SETTINGS.levelHeightM, 2, 5),
  };
}

const isOn = (s: RuleSettings, id: RuleId) => s.enabled[id] !== false;

// ---------------------------------------------------------------------------
// Surface minimale (fluides A2L)
// ---------------------------------------------------------------------------

/** Limite inférieure d'inflammabilité (kg/m³). */
export const LFL: Record<string, number> = { R32: 0.307, R454B: 0.296 };
export const INSTALL_HEIGHT_M: Partial<Record<ProductType, number>> = { ui_console: 0.6, ui_murale: 1.8, ui_cassette: 2.2, ui_gainable: 2.2 };

/** Charge totale du système : charge usine + complément au-delà de la longueur pré-chargée. */
export function systemChargeKg(factoryKg: number, totalLinkM: number, prechargedM: number | null, gPerM: number | null): number {
  const extra = prechargedM !== null && gPerM !== null ? Math.max(0, totalLinkM - prechargedM) * gPerM : 0;
  return Math.round((factoryKg + extra / 1000) * 1000) / 1000;
}

/** Surface minimale (m²) ; null si la charge est sous le seuil m1 (aucune exigence). */
export function minRoomArea(chargeKg: number, refrigerant: string, h0: number): number | null {
  const lfl = LFL[refrigerant];
  if (!lfl) return null;
  const m1 = 6 * lfl;
  if (chargeKg <= m1) return null;
  return Math.round((chargeKg / (2.5 * Math.pow(lfl, 1.25) * h0)) ** 2 * 10) / 10;
}

// ---------------------------------------------------------------------------
// Contexte d'évaluation
// ---------------------------------------------------------------------------

export interface Clearances {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  front?: number;
  rear?: number;
}

/** Données techniques (sans prix) d'un produit pour les règles. */
export interface UnitTech {
  refrigerant: string | null;
  factoryChargeKg: number | null;
  maxLinkM: number | null;
  maxHeightDiffM: number | null;
  clearances: Clearances;
}

export interface PlanRoom {
  id: string;
  name: string;
  polygon: Pt[];
}

export interface RulePlan {
  level: number;
  mPerPx: number | null;
  rooms: PlanRoom[];
  /** Fenêtres des chambres (pour l'unité extérieure). */
  bedroomWindows: { a: Pt; b: Pt }[];
  layout: Layout;
}

export interface RuleContext {
  plans: RulePlan[];
  equipment: Equipment;
  tech: Record<string, UnitTech>; // par id de produit
  /** Surface et hauteur des pièces du devis, par nom. */
  rooms: { id: string; name: string; surfaceM2: number; ceilingM: number }[];
  settings: RuleSettings;
}

export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  elementId: string;
  message: string;
  /** Règle impérative forcée par l'artisan (motif). */
  forcedReason?: string;
  /** Correction automatique appliquée au métré. */
  autoFix?: { toggle: string; on: boolean };
}

const WET = /\b(salle (de bains?|d'eau)|sdb|s\.d\.b|douche|wc|w\.c|toilettes?|lavabo|salle d eau)\b/i;
const BEDROOM = /\bchambre|\bch\.?\s*\d/i;
const CORRIDOR = /couloir|d[ée]gagement|circulation|hall|entr[ée]e/i;

export function roomAt(p: Pt, rooms: PlanRoom[], tolPx = 0): PlanRoom | null {
  const inside = rooms.find((r) => pointInPolygon(p, r.polygon));
  if (inside || tolPx <= 0) return inside ?? null;
  let best: PlanRoom | null = null;
  let bestD = tolPx;
  for (const r of rooms) {
    for (let i = 0; i < r.polygon.length; i++) {
      const d = segDist(p, r.polygon[i]!, r.polygon[(i + 1) % r.polygon.length]!);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
  }
  return best;
}

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Vecteur unitaire d'un angle « sens horaire depuis le haut ». */
export const dirOf = (deg: number) => ({ x: Math.sin((deg * Math.PI) / 180), y: -Math.cos((deg * Math.PI) / 180) });

/** Étendue (px) d'un polygone le long d'une direction. */
export function extentAlong(poly: Pt[], d: { x: number; y: number }): number {
  const proj = poly.map((p) => p.x * d.x + p.y * d.y);
  return Math.max(...proj) - Math.min(...proj);
}

/** Plus grande étendue du polygone (px), toutes directions testées tous les 15°. */
export function maxExtent(poly: Pt[]): number {
  let m = 0;
  for (let a = 0; a < 180; a += 15) m = Math.max(m, extentAlong(poly, dirOf(a)));
  return m;
}

/** Arête d'un polygone partagée (au moins en partie) avec une autre pièce : cloison intérieure. */
export function edgeShared(a: Pt, b: Pt, self: PlanRoom, rooms: PlanRoom[], tolPx: number): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return rooms.some((r) => r.id !== self.id && r.polygon.some((_, i) => segDist(mid, r.polygon[i]!, r.polygon[(i + 1) % r.polygon.length]!) < tolPx));
}

/** Arête du polygone la plus proche d'un point. */
export function nearestEdge(p: Pt, poly: Pt[]): { a: Pt; b: Pt; d: number; index: number } {
  let best = { a: poly[0]!, b: poly[1 % poly.length]!, d: Infinity, index: 0 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const d = segDist(p, a, b);
    if (d < best.d) best = { a, b, d, index: i };
  }
  return best;
}

/** Normale intérieure d'une arête (vers l'intérieur de la pièce), en degrés « horaire depuis le haut ». */
export function inwardAngle(a: Pt, b: Pt, poly: Pt[]): number {
  const len = dist(a, b) || 1;
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const probe = Math.max(2, len * 0.05);
  if (!pointInPolygon({ x: mid.x + n.x * probe, y: mid.y + n.y * probe }, poly)) n = { x: -n.x, y: -n.y };
  return (((Math.atan2(n.x, -n.y) * 180) / Math.PI) % 360 + 360) % 360;
}

function angleDiff(a: number, b: number) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// ---------------------------------------------------------------------------
// Évaluation
// ---------------------------------------------------------------------------

interface Located {
  marker: Marker;
  plan: RulePlan;
}

export function evaluateRules(ctx: RuleContext): Finding[] {
  const s = ctx.settings;
  const out: Finding[] = [];
  const tags = equipmentTags(ctx.equipment);
  const all: Located[] = ctx.plans.flatMap((plan) => plan.layout.markers.map((marker) => ({ marker, plan })));
  const find = (kind: Marker["kind"], key: string) => all.find((l) => l.marker.kind === kind && l.marker.equipmentKey === key);
  const routesOf = (kind: string, key: string) => ctx.plans.flatMap((plan) => plan.layout.routes.filter((r) => r.kind === kind && r.equipmentKey === key && r.points.length >= 2).map((route) => ({ route, plan })));
  const lenM = (r: { route: { points: Pt[]; extraM: number }; plan: RulePlan }) => (r.plan.mPerPx ? polylineLength(r.route.points) * r.plan.mPerPx + r.route.extraM : null);
  const toM = (plan: RulePlan, px: number) => (plan.mPerPx ? px * plan.mPerPx : null);
  const push = (f: Omit<Finding, "severity">) => {
    if (!isOn(s, f.ruleId)) return;
    out.push({ ...f, severity: RULES.find((r) => r.id === f.ruleId)!.severity });
  };
  const roomByName = new Map(ctx.rooms.map((r) => [r.name.trim().toLowerCase(), r]));

  for (const sys of ctx.equipment.systems) {
    const ue = find("ue", sys.key);
    const ueTech = ctx.tech[sys.outdoor.id];
    const ueTag = tags.outdoor.get(sys.key)!;
    // Longueur totale des liaisons du système (tracées, sinon non connue)
    let totalLink = 0;
    let linkKnown = true;
    for (const ind of sys.indoors) {
      const l = routesOf("liaison", ind.key).reduce<number | null>((acc, r) => (acc === null || lenM(r) === null ? null : acc + lenM(r)!), 0);
      if (l === null || routesOf("liaison", ind.key).length === 0) linkKnown = false;
      else totalLink += l;
    }

    // --- R32 : surface minimale de la plus petite pièce desservie
    if (ueTech?.refrigerant && LFL[ueTech.refrigerant]) {
      if (ueTech.factoryChargeKg === null) {
        push({ ruleId: "donnees", elementId: ue?.marker.id ?? sys.key, message: `${ueTag} : charge usine en fluide non renseignée dans le catalogue, surface minimale non vérifiée.` });
      } else {
        const charge = systemChargeKg(ueTech.factoryChargeKg, linkKnown ? totalLink : 0, sys.outdoor.prechargedLengthM, sys.outdoor.extraChargeGPerM);
        for (const ind of sys.indoors) {
          const h0 = INSTALL_HEIGHT_M[ind.product.type] ?? 1.8;
          const amin = minRoomArea(charge, ueTech.refrigerant, h0);
          if (amin === null) continue;
          const served = ind.roomIds.map((id) => ctx.rooms.find((r) => r.id === id)).filter(Boolean) as RuleContext["rooms"];
          const smallest = served.sort((a, b) => a.surfaceM2 - b.surfaceM2)[0];
          const el = find("ui", ind.key)?.marker.id ?? ind.key;
          if (smallest && smallest.surfaceM2 < amin) {
            push({ ruleId: "r32_surface", elementId: el, message: `${tags.indoor.get(ind.key)} : ${smallest.name} fait ${fmt(smallest.surfaceM2)} m², il faut au moins ${fmt(amin)} m² pour ${fmt(charge, 2)} kg de ${ueTech.refrigerant} (pose à ${fmt(h0)} m, IEC 60335-2-40).` });
          }
        }
      }
    }

    for (const ind of sys.indoors) {
      const tag = tags.indoor.get(ind.key)!;
      const ui = find("ui", ind.key);
      const uiTech = ctx.tech[ind.product.id];
      const el = ui?.marker.id ?? ind.key;

      // --- Longueur et dénivelé des liaisons
      const links = routesOf("liaison", ind.key);
      const linkLen = links.length ? links.reduce<number | null>((a, r) => (a === null || lenM(r) === null ? null : a + lenM(r)!), 0) : null;
      const maxLink = minDefined(uiTech?.maxLinkM ?? null, ueTech?.maxLinkM ?? null);
      if (linkLen !== null) {
        if (maxLink === null) push({ ruleId: "donnees", elementId: el, message: `${tag} : longueur maximale de liaison non renseignée (fiche produit).` });
        else if (linkLen > maxLink) push({ ruleId: "liaison_longueur", elementId: el, message: `${tag} : liaison de ${fmt(linkLen)} m, le fabricant autorise ${fmt(maxLink)} m au maximum.` });
      }
      if (ui && ue) {
        const diff = Math.abs(ui.plan.level - ue.plan.level) * s.levelHeightM + (ue.marker.mount === "toiture" ? 3 : 0);
        const maxDiff = minDefined(uiTech?.maxHeightDiffM ?? null, ueTech?.maxHeightDiffM ?? null);
        if (diff > 0 && maxDiff === null) push({ ruleId: "donnees", elementId: el, message: `${tag} : dénivelé maximal non renseigné (fiche produit).` });
        else if (maxDiff !== null && diff > maxDiff) push({ ruleId: "liaison_denivele", elementId: el, message: `${tag} : dénivelé d'environ ${fmt(diff)} m avec ${ueTag}, le fabricant autorise ${fmt(maxDiff)} m.` });
      }
      if (!ui) continue;
      const plan = ui.plan;
      const room = roomAt(ui.marker, plan.rooms, plan.mPerPx ? 0.6 / plan.mPerPx : 30);
      const quoteRoom = room ? roomByName.get(room.name.trim().toLowerCase()) : undefined;
      const ceiling = quoteRoom?.ceilingM ?? 2.5;

      // --- Pièce d'eau
      if (room && WET.test(room.name)) push({ ruleId: "piece_eau", elementId: el, message: `${tag} est placée dans « ${room.name} » : pas d'unité intérieure dans une pièce d'eau.` });

      // --- Dégagements (côtés calculés sur le plan ; plafond saisi ou à vérifier)
      if (ind.product.type !== "ui_gainable") {
        const c = uiTech?.clearances ?? {};
        const side = Math.max(c.left ?? 0, c.right ?? 0);
        if (!uiTech || Object.keys(c).length === 0) {
          push({ ruleId: "donnees", elementId: el, message: `${tag} : dégagements de la notice non renseignés (fiche produit).` });
        } else {
          const problems: string[] = [];
          if (room && plan.mPerPx && side > 0) {
            const corner = Math.min(...room.polygon.map((p) => dist(p, ui.marker)));
            const cm = corner * plan.mPerPx * 100 - 40; // demi-largeur d'une unité murale (~80 cm)
            if (cm < side) problems.push(`${Math.max(0, Math.round(cm))} cm du mur voisin (mini ${side} cm)`);
          }
          if (c.top && ind.product.type === "ui_murale") {
            if (ui.marker.gapCm === undefined) {
              if (!ui.marker.confirmed?.includes("degagements")) problems.push(`distance au plafond à vérifier (mini ${c.top} cm)`);
            } else if (ui.marker.gapCm < c.top) problems.push(`${ui.marker.gapCm} cm sous le plafond (mini ${c.top} cm)`);
          }
          if (problems.length && !ui.marker.confirmed?.includes("degagements")) push({ ruleId: "degagements", elementId: el, message: `${tag} : ${problems.join(", ")}.` });
        }
      }

      // --- Sources de chaleur
      for (const h of all.filter((l) => l.marker.kind === "chaleur" && l.plan === plan)) {
        const d = toM(plan, dist(h.marker, ui.marker));
        if (d !== null && d < s.heatDistanceM) push({ ruleId: "source_chaleur", elementId: el, message: `${tag} à ${fmt(d)} m d'une source de chaleur (mini ${fmt(s.heatDistanceM)} m).` });
      }

      // --- Condensats : tracé obligatoire, pompe si la pente gravitaire est impossible
      const cond = routesOf("condensats", ind.key);
      if (cond.length === 0) {
        push({ ruleId: "condensats", elementId: el, message: `${tag} : tracez l'évacuation des condensats.` });
      } else {
        const r = cond[0]!;
        const len = lenM(r);
        const end = r.route.points[r.route.points.length - 1]!;
        const evac = all.find((l) => l.marker.kind === "evacuation" && l.plan === r.plan && dist(l.marker, end) < (r.plan.mPerPx ? 0.5 / r.plan.mPerPx : 20));
        const evacHeight = evac?.marker.heightM ?? (evac ? 0.5 : 0);
        const uiHeight = ind.product.type === "ui_console" ? 0.15 : ind.product.type === "ui_murale" ? ceiling - (ui.marker.gapCm ?? 15) / 100 - 0.3 : ceiling - 0.3;
        const drop = uiHeight - evacHeight + (plan.level - r.plan.level) * s.levelHeightM;
        if (len !== null && drop < len * s.condensateSlope) {
          push({
            ruleId: "condensats",
            elementId: el,
            message: `${tag} : pente gravitaire impossible (${fmt(drop)} m de hauteur disponible pour ${fmt(len)} m) : pompe de relevage ajoutée automatiquement.`,
            autoFix: { toggle: `pompe:${ind.key}`, on: true },
          });
        }
      }

      // --- Préférences
      for (const bed of all.filter((l) => l.marker.kind === "lit" && l.plan === plan)) {
        const d = toM(plan, dist(bed.marker, ui.marker));
        if (d !== null && d < s.bedDistanceM) push({ ruleId: "lit", elementId: el, message: `${tag} semble au-dessus d'un lit.` });
      }
      if (ui.marker.angle !== undefined && plan.mPerPx) {
        const dir = ui.marker.angle;
        for (const f of all.filter((l) => (l.marker.kind === "lit" || l.marker.kind === "canape" || l.marker.kind === "bureau") && l.plan === plan)) {
          const d = dist(f.marker, ui.marker) * plan.mPerPx;
          const ang = (((Math.atan2(f.marker.x - ui.marker.x, -(f.marker.y - ui.marker.y)) * 180) / Math.PI) % 360 + 360) % 360;
          if (d < 3.5 && d >= s.bedDistanceM && angleDiff(ang, dir) < 25) push({ ruleId: "soufflage_meubles", elementId: el, message: `${tag} souffle directement sur un ${f.marker.kind === "lit" ? "lit" : f.marker.kind === "canape" ? "canapé" : "bureau"}.` });
        }
        if (room) {
          const along = extentAlong(room.polygon, dirOf(dir));
          const max = maxExtent(room.polygon);
          if (along < max * 0.8) push({ ruleId: "soufflage_longueur", elementId: el, message: `${tag} souffle dans la largeur (${fmt(along * plan.mPerPx)} m) plutôt que dans la longueur (${fmt(max * plan.mPerPx)} m).` });
        }
      }
      if (ind.product.type === "ui_murale" && !ui.marker.support) push({ ruleId: "support_fixation", elementId: el, message: `${tag} : choisissez le support vérifié sur place (mur plein, chevilles chimiques ou isolation par l'extérieur).` });
      if (ue && links.length && ue.plan === plan && plan.mPerPx) {
        const straight = dist(ui.marker, ue.marker) * plan.mPerPx;
        if (linkLen !== null && linkLen > straight * 1.5 + 2) push({ ruleId: "liaison_courte", elementId: el, message: `${tag} : liaison de ${fmt(linkLen)} m pour ${fmt(straight)} m à vol d'oiseau.` });
      }

      // --- Gainable : reprise et bouches
      if (ind.product.type === "ui_gainable") {
        const grilles = all.filter((l) => l.marker.kind === "grille" && l.marker.equipmentKey === ind.key);
        const bouches = all.filter((l) => l.marker.kind === "bouche" && l.marker.equipmentKey === ind.key);
        for (const g of grilles) {
          const gr = roomAt(g.marker, g.plan.rooms);
          const centre = bouches.length ? centroid(bouches.map((b) => b.marker)) : null;
          const off = centre && g.plan.mPerPx ? dist(centre, g.marker) * g.plan.mPerPx : 0;
          if (!(gr && CORRIDOR.test(gr.name)) && off > 3) push({ ruleId: "gainable_reprise", elementId: g.marker.id, message: `Reprise de ${tag} excentrée (${fmt(off)} m du centre des bouches) : préférez le couloir ou une position centrale.` });
          for (const b of bouches) {
            const d = g.plan === b.plan && g.plan.mPerPx ? dist(g.marker, b.marker) * g.plan.mPerPx : Infinity;
            if (d < 2) push({ ruleId: "gainable_bouches", elementId: b.marker.id, message: `Bouche de ${tag} à ${fmt(d)} m de la reprise : l'air repart sans circuler.` });
          }
        }
      }
    }

    // --- Unité extérieure
    if (ue) {
      const el = ue.marker.id;
      const plan = ue.plan;
      if ((ue.marker.mount === "mural_haut" || ue.marker.mount === "toiture") && !ue.marker.confirmed?.includes("acces")) {
        push({ ruleId: "ue_acces", elementId: el, message: `${ueTag} posée ${ue.marker.mount === "toiture" ? "en toiture" : "en hauteur"} : confirmez un accès sûr pour l'entretien.` });
      }
      if (!ue.marker.support) push({ ruleId: "support_fixation", elementId: el, message: `${ueTag} : choisissez le support vérifié sur place (mur plein, chevilles chimiques, isolation par l'extérieur, console au sol, toiture ou terrasse).` });
      if (!ue.marker.confirmed?.includes("sol_degage")) push({ ruleId: "sol_degage", elementId: el, message: `${ueTag} : confirmez que le sol devant l'unité est dégagé (soufflage et entretien).` });
      const c = ueTech?.clearances ?? {};
      if (!ueTech || Object.keys(c).length === 0) push({ ruleId: "donnees", elementId: el, message: `${ueTag} : dégagements de la notice non renseignés (fiche produit).` });
      else if (!ue.marker.confirmed?.includes("degagements")) {
        const parts = [c.front ? `devant ${c.front} cm` : null, c.rear ? `derrière ${c.rear} cm` : null, c.left || c.right ? `côtés ${Math.max(c.left ?? 0, c.right ?? 0)} cm` : null, c.top ? `dessus ${c.top} cm` : null].filter(Boolean);
        push({ ruleId: "degagements", elementId: el, message: `${ueTag} : vérifiez sur place les dégagements de la notice (${parts.join(", ")}).` });
      }
      for (const h of all.filter((l) => l.marker.kind === "chaleur" && l.plan === plan)) {
        const d = toM(plan, dist(h.marker, ue.marker));
        if (d !== null && d < s.heatDistanceM) push({ ruleId: "source_chaleur", elementId: el, message: `${ueTag} à ${fmt(d)} m d'une source de chaleur.` });
      }
      for (const r of all.filter((l) => l.marker.kind === "rue" && l.plan === plan)) {
        const d = toM(plan, dist(r.marker, ue.marker));
        if (d !== null && d < 6) push({ ruleId: "ue_rue", elementId: el, message: `${ueTag} est côté rue : préférez le jardin (bruit, aspect, déclaration en mairie).` });
      }
      for (const w of plan.bedroomWindows) {
        const d = toM(plan, segDist(ue.marker, w.a, w.b));
        if (d !== null && d < 3) push({ ruleId: "ue_chambres", elementId: el, message: `${ueTag} à ${fmt(d)} m d'une fenêtre de chambre.` });
      }
      for (const v of all.filter((l) => l.marker.kind === "voisin" && l.plan === plan)) {
        const d = toM(plan, dist(v.marker, ue.marker));
        if (d !== null && d < 3) push({ ruleId: "ue_voisins", elementId: el, message: `${ueTag} à ${fmt(d)} m de la limite avec le voisin.` });
      }
    }
  }

  // Forçages motivés
  const overrides = ctx.plans.flatMap((p) => p.layout.overrides ?? []);
  return dedupe(out).map((f) => {
    const o = f.severity === "rouge" ? overrides.find((x) => x.ruleId === f.ruleId && x.elementId === f.elementId) : undefined;
    return o ? { ...f, forcedReason: o.reason } : f;
  });
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = `${f.ruleId}|${f.elementId}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const minDefined = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
export const fmt = (n: number, d = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });

/** Alertes rouges non forcées : bloquent la validation de l'implantation. */
export const blocking = (fs: Finding[]) => fs.filter((f) => f.severity === "rouge" && !f.forcedReason && !f.autoFix);

/** Corrections automatiques à reporter au métré (pompe de relevage…). */
export const autoToggles = (fs: Finding[]) => Object.fromEntries(fs.flatMap((f) => (f.autoFix ? [[f.autoFix.toggle, f.autoFix.on] as const] : [])));

export { polygonArea };
