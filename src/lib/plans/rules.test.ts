import { describe, expect, it } from "vitest";
import type { CatProduct, Equipment } from "@/lib/quote/types";
import type { Layout, Marker } from "./layout";
import { sanitizeLayout } from "./layout";
import { autoToggles, blocking, DEFAULT_RULE_SETTINGS, evaluateRules, RULES, minRoomArea, ruleSettings, systemChargeKg, type RuleContext, type RulePlan, type UnitTech } from "./rules";
import { suggestIndoor, suggestMissing, suggestOutdoor, type SuggestContext } from "./suggest";

const sq = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const product = (id: string, type: CatProduct["type"]): CatProduct => ({
  id, brandId: "b", brandName: "Arctica", reference: id.toUpperCase(), rangeName: null, type, coolingKw: 2.5, heatingKw: 3, maxOutlets: 3, maxIndoorRatio: null,
  linkDiameters: "1/4 - 3/8", prechargedLengthM: 15, extraChargeGPerM: 20, publicPriceCents: 1, brandDiscount: 0, productDiscount: null, brandCoefficient: 1,
});
const equipment: Equipment = {
  kind: "multi", brandId: "b", brandName: "Arctica", warnings: [],
  systems: [{ key: "s1", outdoor: product("ue", "ue_multi"), indoors: [{ key: "i1", product: product("mu1", "ui_murale"), roomIds: ["q1"] }, { key: "i2", product: product("mu2", "ui_murale"), roomIds: ["q2"] }] }],
};
const tech = (over: Partial<UnitTech> = {}): UnitTech => ({ refrigerant: "R32", factoryChargeKg: 1.4, maxLinkM: 20, maxHeightDiffM: 10, clearances: { top: 15, left: 10, right: 10, front: 50 }, ...over });

// 1 px = 1 cm. Séjour 6 × 4 m, chambre 3 × 3 m, salle de bain 2 × 2 m.
const rooms = [
  { id: "p1", name: "Séjour", polygon: sq(0, 0, 600, 400) },
  { id: "p2", name: "Chambre", polygon: sq(600, 0, 300, 300) },
  { id: "p3", name: "Salle de bain", polygon: sq(600, 300, 200, 200) },
];
const mk = (m: Partial<Marker> & Pick<Marker, "id" | "kind" | "x" | "y">): Marker => ({ equipmentKey: null, ...m });
const plan = (layout: Partial<Layout>): RulePlan => ({ level: 0, mPerPx: 0.01, rooms, bedroomWindows: [{ a: { x: 700, y: 0 }, b: { x: 800, y: 0 } }], layout: { markers: [], routes: [], overrides: [], ...layout } });
const ctx = (layout: Partial<Layout>, over: Partial<RuleContext> = {}): RuleContext => ({
  plans: [plan(layout)],
  equipment,
  tech: { ue: tech(), mu1: tech(), mu2: tech() },
  rooms: [
    { id: "q1", name: "Séjour", surfaceM2: 24, ceilingM: 2.5 },
    { id: "q2", name: "Chambre", surfaceM2: 9, ceilingM: 2.5 },
  ],
  settings: DEFAULT_RULE_SETTINGS,
  ...over,
});
const ids = (c: RuleContext) => evaluateRules(c).map((f) => f.ruleId);

const ui1 = mk({ id: "ui1", kind: "ui", x: 300, y: 10, equipmentKey: "i1", angle: 180, gapCm: 20, support: "mur_plein" });
const ue1 = mk({ id: "ue1", kind: "ue", x: 300, y: -60, equipmentKey: "s1", mount: "sol", support: "console_sol", confirmed: ["degagements", "sol_degage"] });
const cond = { id: "c1", kind: "condensats" as const, equipmentKey: "i1", points: [{ x: 300, y: 10 }, { x: 300, y: -30 }], extraM: 0 };
const link = (len: number) => ({ id: "l1", kind: "liaison" as const, equipmentKey: "i1", points: [{ x: 300, y: 10 }, { x: 300, y: 10 - len * 100 }], extraM: 0 });

describe("surface minimale R32 (IEC 60335-2-40, annexe GG)", () => {
  it("aucune exigence sous le seuil m1 = 6 × LFL = 1,84 kg", () => {
    expect(minRoomArea(1.8, "R32", 1.8)).toBeNull();
    expect(minRoomArea(5, "R410A", 1.8)).toBeNull(); // non inflammable
  });
  it("A_min = max((m / (2,5 × LFL^1,25 × h0))², 3 m²/kg), arrondi au m² supérieur", () => {
    expect(minRoomArea(2.5, "R32", 1.8)).toBe(8); // IEC 5,9 m² ; plancher de prudence 7,5 m²
    expect(minRoomArea(2.5, "R32", 0.6)).toBe(54); // console au sol : IEC 53,2 m²
    expect(minRoomArea(2.5, "R32", 2.2)).toBe(8); // IEC 4,0 m²
    expect(minRoomArea(6, "R32", 1.8)).toBe(35); // IEC 34,0 m²
  });
  it("charge totale = usine + complément au-delà de la longueur pré-chargée", () => {
    expect(systemChargeKg(1.4, 10, 15, 20)).toBe(1.4);
    expect(systemChargeKg(1.4, 45, 15, 20)).toBe(2);
  });
  it("alerte sur la plus petite pièce desservie", () => {
    const c = ctx({ markers: [ui1, ue1], routes: [cond] }, { tech: { ue: tech({ factoryChargeKg: 3.2 }), mu1: tech(), mu2: tech() }, rooms: [{ id: "q1", name: "Séjour", surfaceM2: 24, ceilingM: 2.5 }, { id: "q2", name: "Chambre", surfaceM2: 9, ceilingM: 2.5 }] });
    const f = evaluateRules(c).filter((x) => x.ruleId === "r32_surface");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("Chambre fait 9 m²");
    expect(f[0]!.message).toContain("au moins 10 m²");
    expect(f[0]!.message).toContain("à confirmer avec la notice d'installation du fabricant");
  });
});

describe("règles impératives", () => {
  it("implantation correcte : aucune alerte rouge", () => {
    expect(blocking(evaluateRules(ctx({ markers: [ui1, ue1], routes: [cond, link(5)] })))).toEqual([]);
  });
  it("longueur et dénivelé des liaisons selon le fabricant", () => {
    expect(ids(ctx({ markers: [ui1, ue1], routes: [cond, link(25)] }))).toContain("liaison_longueur");
    const up: RulePlan = { ...plan({ markers: [ui1], routes: [cond] }), level: 4 };
    const down = plan({ markers: [ue1] });
    expect(evaluateRules({ ...ctx({}), plans: [down, up] }).map((f) => f.ruleId)).toContain("liaison_denivele"); // 4 × 2,7 = 10,8 m > 10 m
  });
  it("pièce d'eau, source de chaleur, dégagements", () => {
    expect(ids(ctx({ markers: [{ ...ui1, x: 700, y: 400 }, ue1], routes: [] }))).toContain("piece_eau");
    expect(ids(ctx({ markers: [ui1, ue1, mk({ id: "h", kind: "chaleur", x: 380, y: 40 })], routes: [cond] }))).toContain("source_chaleur");
    expect(ids(ctx({ markers: [{ ...ui1, gapCm: 5 }, ue1], routes: [cond] }))).toContain("degagements");
    expect(ids(ctx({ markers: [{ ...ui1, x: 30 }, ue1], routes: [cond] }))).toContain("degagements"); // trop près de l'angle
    expect(ids(ctx({ markers: [{ ...ui1, gapCm: undefined, confirmed: ["degagements"] }, ue1], routes: [cond] }))).not.toContain("degagements");
  });
  it("condensats : tracé exigé ; pente impossible → pompe ajoutée automatiquement (non bloquant)", () => {
    expect(blocking(evaluateRules(ctx({ markers: [ui1, ue1], routes: [] }))).map((f) => f.ruleId)).toContain("condensats");
    const evac = mk({ id: "ev", kind: "evacuation", x: 300, y: 390, heightM: 2.4 });
    const fs = evaluateRules(ctx({ markers: [ui1, ue1, evac], routes: [{ ...cond, points: [{ x: 300, y: 10 }, { x: 300, y: 390 }] }] }));
    expect(autoToggles(fs)).toEqual({ "pompe:i1": true });
    expect(blocking(fs)).toEqual([]);
  });
  it("unité extérieure : accès et dégagements à confirmer", () => {
    const high = { ...ue1, mount: "mural_haut" as const, confirmed: ["sol_degage"] };
    expect(ids(ctx({ markers: [ui1, high], routes: [cond] }))).toEqual(expect.arrayContaining(["ue_acces", "degagements"]));
    expect(ids(ctx({ markers: [ui1, { ...high, confirmed: ["acces", "degagements", "sol_degage"] }], routes: [cond] }))).not.toContain("ue_acces");
  });
  it("forcer exige un motif ; une règle désactivée ne s'applique plus", () => {
    const base = { markers: [{ ...ui1, x: 700, y: 400 }, ue1], routes: [{ ...cond, points: [{ x: 700, y: 400 }, { x: 700, y: 450 }] }] };
    expect(blocking(evaluateRules(ctx(base))).map((f) => f.ruleId)).toEqual(["piece_eau"]);
    const forced = evaluateRules(ctx({ ...base, overrides: [{ ruleId: "piece_eau", elementId: "ui1", reason: "Unité IPX4 prévue pour pièce humide", at: "2026-11-17" }] }));
    expect(blocking(forced)).toEqual([]);
    expect(forced.find((f) => f.ruleId === "piece_eau")!.forcedReason).toContain("IPX4");
    // motif trop court : rejeté au nettoyage
    expect(sanitizeLayout({ markers: [], routes: [], overrides: [{ ruleId: "piece_eau", elementId: "ui1", reason: "ok", at: "" }] }, { width: 100, height: 100 }).overrides).toEqual([]);
    const off = ruleSettings({ enabled: { piece_eau: false } });
    expect(ids(ctx(base, { settings: off }))).not.toContain("piece_eau");
  });
  it("données fabricant manquantes : signalé, sans bloquer", () => {
    const fs = evaluateRules(ctx({ markers: [ui1, ue1], routes: [cond, link(5)] }, { tech: { ue: tech({ clearances: {} }), mu1: tech({ maxLinkM: null, clearances: {} }), mu2: tech() } }));
    expect(fs.filter((f) => f.ruleId === "donnees").length).toBeGreaterThanOrEqual(2);
    expect(blocking(fs)).toEqual([]);
  });
});

describe("règles de préférence (orange)", () => {
  it("lit, soufflage, rue, chambres, voisins, cloison", () => {
    const fs = evaluateRules(
      ctx({
        markers: [
          { ...ui1, x: 590, y: 200, angle: 270 }, // sur la cloison avec la chambre, souffle vers la gauche (longueur)
          { ...ue1, x: 750, y: -60 },
          mk({ id: "lit", kind: "lit", x: 560, y: 220 }),
          mk({ id: "can", kind: "canape", x: 350, y: 200 }),
          mk({ id: "rue", kind: "rue", x: 800, y: -200 }),
          mk({ id: "v", kind: "voisin", x: 900, y: -60 }),
        ],
        routes: [{ ...cond, points: [{ x: 590, y: 200 }, { x: 590, y: 150 }] }],
      }),
    );
    const got = fs.map((f) => f.ruleId);
    expect(got).toEqual(expect.arrayContaining(["lit", "soufflage_meubles", "ue_rue", "ue_chambres", "ue_voisins"]));
    expect(fs.filter((f) => ["lit", "ue_rue"].includes(f.ruleId)).every((f) => f.severity === "orange")).toBe(true);
    expect(blocking(fs)).toEqual([]);
  });
  it("soufflage dans la largeur signalé", () => {
    expect(ids(ctx({ markers: [{ ...ui1, x: 300, y: 10, angle: 180 }, ue1], routes: [cond] }))).toContain("soufflage_longueur"); // 4 m au lieu de 6 m
    expect(ids(ctx({ markers: [{ ...ui1, x: 10, y: 200, angle: 90 }, ue1], routes: [{ ...cond, points: [{ x: 10, y: 200 }, { x: -30, y: 200 }] }] }))).not.toContain("soufflage_longueur");
  });
});

describe("support de fixation et sol dégagé (vérifiés sur place)", () => {
  it("support obligatoire pour l'UE et l'UI murale ; sol dégagé obligatoire pour l'UE", () => {
    const fs = evaluateRules(ctx({ markers: [{ ...ui1, support: undefined }, { ...ue1, support: undefined, confirmed: ["degagements"] }], routes: [cond] }));
    const red = blocking(fs);
    expect(red.filter((f) => f.ruleId === "support_fixation").map((f) => f.elementId).sort()).toEqual(["ue1", "ui1"]);
    expect(red.filter((f) => f.ruleId === "sol_degage").map((f) => f.elementId)).toEqual(["ue1"]);
    expect(ids(ctx({ markers: [ui1, ue1], routes: [cond] }))).not.toContain("support_fixation");
  });
  it("la règle « mur extérieur » n'existe plus", () => {
    expect(RULES.some((r) => (r.id as string) === "mur_exterieur")).toBe(false);
  });
});

describe("suggestions d'emplacement", () => {
  const sctx = (markers: Marker[] = []): SuggestContext => ({ plan: plan({ markers }), equipment, quoteRooms: [{ id: "q1", name: "Séjour" }, { id: "q2", name: "Chambre" }], settings: DEFAULT_RULE_SETTINGS });

  it("unité intérieure : mur extérieur, souffle dans la longueur, raison en une ligne", () => {
    const m = suggestIndoor("i1", sctx())!;
    expect(m.suggested).toBe(true);
    expect(m.x).toBeLessThan(30); // mur ouest du séjour : souffle sur 6 m
    expect(m.angle).toBe(90);
    expect(m.reason).toMatch(/Séjour : mur extérieur, souffle dans la longueur \(6 m\)/);
  });
  it("« Autre proposition » donne un emplacement différent ; évite lit et source de chaleur", () => {
    const a = suggestIndoor("i1", sctx())!;
    const b = suggestIndoor("i1", sctx(), 1)!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(100);
    const heat = suggestIndoor("i1", sctx([mk({ id: "h", kind: "chaleur", x: 20, y: 200 })]))!;
    expect(Math.hypot(heat.x - 20, heat.y - 200)).toBeGreaterThan(150);
  });
  it("unité extérieure : dehors, loin de la rue et des fenêtres de chambre", () => {
    const m = suggestOutdoor("s1", sctx([mk({ id: "rue", kind: "rue", x: 450, y: -300 })]))!;
    expect(rooms.some((r) => m.x > r.polygon[0]!.x && m.x < r.polygon[1]!.x && m.y > r.polygon[0]!.y && m.y < r.polygon[2]!.y)).toBe(false);
    expect(Math.hypot(m.x - 450, m.y + 300) * 0.01).toBeGreaterThan(6);
    expect(m.reason).toContain("à l'opposé de la rue");
  });
  it("propose tout ce qui manque sans déplacer ce que l'artisan a posé ; la proposition respecte les règles impératives du plan", () => {
    const placed = { ...ui1, x: 20, y: 200, angle: 90 };
    const added = suggestMissing(sctx([placed]), new Set());
    expect(added.map((m) => `${m.kind}:${m.equipmentKey}`).sort()).toEqual(["ue:s1", "ui:i2"]);
    const all = evaluateRules(ctx({ markers: [placed, ...added.map((m) => ({ ...m, gapCm: 20, support: "mur_plein" as const, confirmed: ["degagements", "sol_degage"] }))], routes: [] }));
    expect(all.filter((f) => f.severity === "rouge").map((f) => f.ruleId).filter((r) => r !== "condensats")).toEqual([]);
    expect(suggestMissing(sctx([placed]), new Set(["ue:s1", "ui:i2"]))).toEqual([]);
  });
});

import { runR32CrossCheck } from "./r32-crosscheck";

describe("R32 : recoupement avec les notices Daikin et Mitsubishi Electric", () => {
  // Recoupement INFORMATIF (non bloquant) : les valeurs des notices ne sont pas encore vérifiées
  // sur les PDF des fabricants. Un écart s'affiche dans les paramètres, il ne fait jamais échouer les tests.
  it("4 cas calculés et comparés (informatif)", () => {
    const r = runR32CrossCheck();
    expect(r).toHaveLength(4);
    expect(r.map((x) => [x.chargeKg, x.heightM, x.climdevisM2])).toEqual([
      [2, 1.8, 6],
      [5, 1.8, 24],
      [7, 1.8, 47],
      [2.4, 2.2, 8],
    ]);
    const gaps = r.filter((x) => !x.ok);
    if (gaps.length) console.info(`Recoupement R32 (informatif) : ${gaps.length} écart(s) à vérifier avec la notice`);
  });
  it("hauteur 1,0 m (allège) : entre le sol et le mural", () => {
    const a06 = minRoomArea(3, "R32", 0.6)!;
    const a10 = minRoomArea(3, "R32", 1.0)!;
    const a18 = minRoomArea(3, "R32", 1.8)!;
    expect(a10).toBeLessThan(a06);
    expect(a10).toBeGreaterThan(a18);
    expect(a10).toBe(28); // (3 / (2,5 × 0,307^1,25 × 1,0))² = 27,6 → 28 m²
  });
});

import { validationBlockers } from "./rules";

describe("devis déjà signé : les alertes rouges sont un rappel", () => {
  it("ne bloque jamais la validation d'un devis accepté", () => {
    const fs = evaluateRules(ctx({ markers: [{ ...ui1, support: undefined }, { ...ue1, support: undefined, confirmed: [] }], routes: [cond] }));
    expect(validationBlockers(fs, "brouillon").length).toBeGreaterThan(0);
    expect(validationBlockers(fs, "envoye").length).toBeGreaterThan(0);
    expect(validationBlockers(fs, "accepte")).toEqual([]);
  });
});
