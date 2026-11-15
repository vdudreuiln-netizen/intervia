import { describe, expect, it } from "vitest";
import type { CatProduct, Equipment } from "@/lib/quote/types";
import { EMPTY_METRE } from "@/lib/quote/types";
import { bearingToOrientation, checkTotalArea, chooseScale, polygonArea, polylineLength, wallBearing } from "./geometry";
import { draftFromAnalysis, draftTotalArea, levelFromLabel, proposeRooms, PlanAnalysisSchema, type PlanAnalysis } from "./analysis";
import { equipmentTags, layoutChecklist, metreFromLayouts, roundUpHalf, sanitizeLayout, type Layout } from "./layout";
import { buildClientSpec, buildSiteSpec, type SpecInput } from "./spec";

const sq = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe("géométrie", () => {
  it("aires et longueurs", () => {
    expect(polygonArea(sq(0, 0, 100, 50))).toBe(5000);
    expect(polylineLength([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 100 }])).toBe(110);
  });

  it("échelle : mesure de l'artisan > cotes > surfaces écrites", () => {
    const rooms = [{ polygon: sq(0, 0, 100, 100), writtenAreaM2: 25 }]; // 10 000 px² = 25 m² → 0,05 m/px
    const dims = [
      { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, lengthM: 8 }, // 0,04
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, lengthM: 4 }, // 0,04
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, lengthM: 40 }, // cote mal lue : écartée par la médiane
    ];
    expect(chooseScale({ dimensions: [], rooms })).toEqual({ mPerPx: 0.05, source: "surfaces" });
    expect(chooseScale({ dimensions: dims, rooms })).toEqual({ mPerPx: 0.04, source: "cotes" });
    expect(chooseScale({ measured: { a: { x: 0, y: 0 }, b: { x: 0, y: 420 }, lengthM: 4.2 }, dimensions: dims, rooms })).toEqual({ mPerPx: 0.01, source: "mesure" });
    expect(chooseScale({ dimensions: [], rooms: [{ polygon: sq(0, 0, 10, 10), writtenAreaM2: null }] })).toBeNull();
  });

  it("orientation du mur selon la flèche du nord (normale sortant de la pièce)", () => {
    const room = sq(100, 100, 200, 100);
    const top = [{ x: 150, y: 100 }, { x: 250, y: 100 }] as const;
    const bottom = [{ x: 150, y: 200 }, { x: 250, y: 200 }] as const;
    const right = [{ x: 300, y: 120 }, { x: 300, y: 180 }] as const;
    // Nord en haut de l'image
    expect(bearingToOrientation(wallBearing(top[0], top[1], room, 0))).toBe("N");
    expect(bearingToOrientation(wallBearing(bottom[0], bottom[1], room, 0))).toBe("S");
    expect(bearingToOrientation(wallBearing(right[0], right[1], room, 0))).toBe("E");
    // Sens du tracé indifférent
    expect(bearingToOrientation(wallBearing(bottom[1], bottom[0], room, 0))).toBe("S");
    // Flèche du nord vers la droite de l'image (90°) : le mur du haut regarde l'ouest
    expect(bearingToOrientation(wallBearing(top[0], top[1], room, 90))).toBe("O");
    expect(bearingToOrientation(wallBearing(right[0], right[1], room, 90))).toBe("N");
  });

  it("surface totale : alerte au-delà de 10 %", () => {
    expect(checkTotalArea(95, 100).ok).toBe(true);
    expect(checkTotalArea(110, 100).ok).toBe(true);
    const r = checkTotalArea(85, 100);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("15 %");
    expect(checkTotalArea(50, null).ok).toBe(true);
  });
});

const analysis: PlanAnalysis = {
  plan_kind: "agence",
  level_label: "RDC",
  north_arrow_deg: 0,
  total_area_m2_written: 60,
  rooms: [
    { id: "r1", name: "Séjour", polygon: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }], written_area_m2: 25 },
    { id: "r2", name: "Cuisine", polygon: [{ x: 500, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 500 }, { x: 500, y: 500 }], written_area_m2: null },
    { id: "r3", name: "Chambre 1", polygon: [{ x: 0, y: 500 }, { x: 500, y: 500 }, { x: 500, y: 1000 }, { x: 0, y: 1000 }], written_area_m2: 25 },
    { id: "r4", name: "WC", polygon: [{ x: 500, y: 500 }, { x: 600, y: 500 }, { x: 600, y: 600 }, { x: 500, y: 600 }], written_area_m2: null },
  ],
  windows: [
    { room_id: "r1", x1: 100, y1: 0, x2: 300, y2: 0, kind: "baie_vitree", width_m: 2.4 },
    { room_id: "r3", x1: 100, y1: 1000, x2: 200, y2: 1000, kind: "fenetre", width_m: null },
  ],
  openings: [{ room_a: "r1", room_b: "r2" }, { room_a: "r1", room_b: "zz" }],
  dimension_lines: [],
  notes: ["Cote du couloir illisible"],
};

describe("lecture du plan → brouillon → pièces proposées", () => {
  it("le schéma accepte la réponse de l'IA", () => {
    expect(PlanAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("niveaux lus sur le libellé", () => {
    expect(levelFromLabel("RDC")).toBe(0);
    expect(levelFromLabel("R+1")).toBe(1);
    expect(levelFromLabel("2ème étage")).toBe(2);
    expect(levelFromLabel("Sous-sol")).toBe(-1);
    expect(levelFromLabel("Combles")).toBe(1);
    expect(levelFromLabel(null, 3)).toBe(3);
  });

  it("brouillon : pixels, pièces non chauffées exclues, ouvertures valides seulement", () => {
    const d = draftFromAnalysis(analysis, 1000, 1000);
    expect(d.rooms[0]!.polygon[2]).toEqual({ x: 500, y: 500 });
    expect(d.rooms.find((r) => r.name === "WC")!.excluded).toBe(true);
    expect(d.openings).toEqual([{ a: "r1", b: "r2", merge: true }]);
    expect(d.declaredTotalM2).toBe(60);
  });

  it("pièces ouvertes fusionnées, surfaces à l'échelle, orientation par la façade vitrée", () => {
    const d = draftFromAnalysis(analysis, 1000, 1000);
    const rooms = proposeRooms(d);
    const sejour = rooms.find((r) => r.sourceIds.includes("r1"))!;
    expect(sejour.name).toBe("Séjour + Cuisine");
    // échelle par les surfaces écrites : 25 m² pour 250 000 px² → 0,01 m/px ; cuisine 100 000 px² = 10 m²
    expect(sejour.surfaceM2).toBe(35);
    expect(sejour.orientation).toBe("N");
    expect(sejour.largeGlazing).toBe(false); // 2,4 × 2,15 = 5,2 m² < 20 % de 35 m²
    const ch = rooms.find((r) => r.name === "Chambre 1")!;
    expect(ch.orientation).toBe("S");
    expect(ch.windows[0]!.widthM).toBe(1);
    expect(rooms.some((r) => r.name === "WC")).toBe(false);
    expect(draftTotalArea(d)).toBe(61);
  });

  it("décocher la fusion garde les pièces séparées ; sans flèche du nord, orientation « aucune »", () => {
    const d = draftFromAnalysis(analysis, 1000, 1000);
    d.openings[0]!.merge = false;
    d.northDeg = null;
    const rooms = proposeRooms(d);
    expect(rooms.map((r) => r.name)).toEqual(["Séjour", "Cuisine", "Chambre 1"]);
    expect(rooms[0]!.orientation).toBe("aucune");
  });
});

const product = (id: string, type: CatProduct["type"], extra: Partial<CatProduct> = {}): CatProduct => ({
  id,
  brandId: "b",
  brandName: "Arctica",
  reference: id.toUpperCase(),
  rangeName: null,
  type,
  coolingKw: 2.5,
  heatingKw: 3.2,
  maxOutlets: 2,
  maxIndoorRatio: null,
  linkDiameters: "1/4 - 3/8",
  prechargedLengthM: 15,
  extraChargeGPerM: 20,
  publicPriceCents: 100000,
  brandDiscount: 0.3,
  productDiscount: null,
  brandCoefficient: 1,
  ...extra,
});

const equipment: Equipment = {
  kind: "multi",
  brandId: "b",
  brandName: "Arctica",
  warnings: [],
  systems: [
    {
      key: "s1",
      outdoor: product("ue-50", "ue_multi", { coolingKw: 5 }),
      indoors: [
        { key: "s1-i1", product: product("mu-25", "ui_murale"), roomIds: ["room1"] },
        { key: "s1-i2", product: product("ga-35", "ui_gainable"), roomIds: ["room2", "room3"] },
      ],
    },
  ],
};

describe("implantation → métré", () => {
  const layout: Layout = {
    markers: [
      { id: "m1", kind: "ui", x: 10, y: 10, equipmentKey: "s1-i1" },
      { id: "m2", kind: "ue", x: 500, y: 10, equipmentKey: "s1" },
      { id: "m3", kind: "bouche", x: 100, y: 100, equipmentKey: "s1-i2" },
      { id: "m4", kind: "bouche", x: 200, y: 100, equipmentKey: "s1-i2" },
      { id: "m5", kind: "grille", x: 300, y: 100, equipmentKey: "s1-i2" },
    ],
    routes: [
      { id: "r1", kind: "liaison", equipmentKey: "s1-i1", points: [{ x: 10, y: 10 }, { x: 400, y: 10 }, { x: 400, y: 310 }], extraM: 1.2 },
      { id: "r2", kind: "condensats", equipmentKey: "s1-i1", points: [{ x: 10, y: 10 }, { x: 10, y: 160 }], extraM: 0 },
      { id: "r3", kind: "gaine", equipmentKey: "s1-i2", points: [{ x: 0, y: 0 }, { x: 0, y: 300 }], extraM: 0 },
      { id: "r4", kind: "gaine", equipmentKey: "s1-i2", points: [{ x: 0, y: 0 }, { x: 250, y: 0 }], extraM: 0 },
      { id: "r5", kind: "electrique", equipmentKey: "s1", points: [{ x: 0, y: 0 }, { x: 0, y: 1000 }], extraM: 0.5 },
    ],
  };

  it("longueurs à l'échelle + supplément, arrondies au demi-mètre supérieur", () => {
    expect(roundUpHalf(8.01)).toBe(8.5);
    expect(roundUpHalf(8)).toBe(8);
    const { metre, report, warnings } = metreFromLayouts([{ level: 0, mPerPx: 0.01, layout }], equipment, { ...EMPTY_METRE, linkM: { "s1-i2": 9 } });
    expect(warnings).toEqual([]);
    expect(metre.linkM).toEqual({ "s1-i1": 8.5, "s1-i2": 9 }); // 6,9 m + 1,2 m = 8,1 → 8,5 ; i2 non tracé : conservé
    expect(metre.qty["condensats:s1-i1"]).toBe(1.5);
    expect(metre.qty["gaine:s1-i2"]).toBe(5.5);
    expect(metre.qty["bouche:s1-i2"]).toBe(2);
    expect(metre.qty["grille:s1-i2"]).toBe(1);
    expect(metre.electricM.s1).toBe(10.5);
    expect(report.map((r) => r.label)).toContain("Liaison I1 → E1");
  });

  it("échelle inconnue : rien n'est repris et l'artisan est prévenu", () => {
    const { metre, warnings } = metreFromLayouts([{ level: 0, mPerPx: null, layout }], equipment, EMPTY_METRE);
    expect(metre.linkM).toEqual({});
    expect(warnings[0]).toContain("Échelle");
  });

  it("liste de ce qui reste à placer ou tracer", () => {
    const todo = layoutChecklist([{ level: 0, mPerPx: 0.01, layout }], equipment);
    expect(todo).toContain("Placer l'unité intérieure I2");
    expect(todo).toContain("Tracer la liaison de I2");
    expect(todo).not.toContain("Placer l'unité extérieure E1");
  });

  it("repères et nettoyage des données du navigateur", () => {
    const t = equipmentTags(equipment);
    expect([t.indoor.get("s1-i1"), t.indoor.get("s1-i2"), t.outdoor.get("s1")]).toEqual(["I1", "I2", "E1"]);
    const clean = sanitizeLayout({ markers: [{ id: "a", kind: "ui", x: 5, y: 5, equipmentKey: "s1-i1" }, { kind: "pirate", x: 1, y: 1 }, { kind: "ue", x: 99999, y: 1 }], routes: [{ kind: "liaison", equipmentKey: "s1-i1", points: [{ x: 1, y: 1 }, { x: "x", y: 2 }], extraM: 999 }] }, { width: 1000, height: 800 });
    expect(clean.markers).toHaveLength(1);
    expect(clean.routes[0]!.points).toHaveLength(1);
    expect(clean.routes[0]!.extraM).toBe(50);
  });
});

describe("cahiers des charges", () => {
  const input: SpecInput = {
    quoteNumber: "D-2026-012",
    client: { name: "M. Martin", phone: "06 00 00 00 00", email: null },
    site: { address: "3 allée des Pins", postalCode: "33600", city: "Pessac", parking: false },
    equipment,
    rooms: [
      { id: "room1", name: "Séjour", needW: 3000, level: 0, indoorType: "mural" },
      { id: "room2", name: "Chambre 1", needW: 1500, level: 1, indoorType: "mural" },
      { id: "room3", name: "Chambre 2", needW: 1500, level: 1, indoorType: "mural" },
    ],
    metre: { ...EMPTY_METRE, linkM: { "s1-i1": 8.5, "s1-i2": 12 } },
    lines: [
      { key: "eq:s1", kind: "material", designation: "Groupe UE-50", quantity: 1, unit: "u" },
      { key: "condensats:s1-i1", kind: "accessory", designation: "Condensats", quantity: 1.5, unit: "m" },
      { key: "goulotte:s1-i1", kind: "accessory", designation: "Goulotte", quantity: 8.5, unit: "m" },
      { key: "support_mural:s1", kind: "accessory", designation: "Support mural", quantity: 1, unit: "u" },
      { key: "cable:s1", kind: "accessory", designation: "Câble", quantity: 10.5, unit: "m" },
      { key: "cerfa:s1", kind: "other", designation: "Fiche fluides", quantity: 1, unit: "forfait" },
      { key: "mo", kind: "labor", designation: "Main d'œuvre", quantity: 2, unit: "jour" },
    ],
    laborDays: 2,
    plans: ["Rez-de-chaussée", "1er étage"],
  };

  it("version client : équipements repérés, travaux compris, à la charge du client", () => {
    const s = buildClientSpec(input);
    const text = JSON.stringify(s);
    expect(s.map((x) => x.title)).toEqual(["Objet des travaux", "Équipements installés", "Travaux compris", "À la charge du client"]);
    expect(text).toContain("I1 – Séjour (Rez-de-chaussée)");
    expect(text).toContain("I2 – Chambre 1, Chambre 2 (1er étage)");
    expect(text).toContain("20,5 m au total");
    expect(text).toContain("déclaration préalable");
    expect(text).not.toMatch(/€/);
  });

  it("version chantier : sans prix, détail par unité et charge complémentaire", () => {
    const s = buildSiteSpec(input);
    expect(JSON.stringify(s)).not.toMatch(/€|prix|marge/i);
    expect(s.materials.map((m) => m.designation)).not.toContain("Main d'œuvre");
    expect(s.indoors[0]).toMatchObject({ tag: "I1", where: "Séjour", diameters: "1/4 - 3/8", linkM: 8.5, condensatsM: 1.5, goulotteM: 8.5, pump: false });
    expect(s.outdoors[0]).toMatchObject({ tag: "E1", support: "Support mural", electricM: 10.5, totalLinkM: 20.5, prechargedM: 15, extraChargeG: 110 });
  });
});
