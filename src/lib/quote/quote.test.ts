import { describe, expect, it } from "vitest";
import { computeQuote, type PricingSettings } from "@/lib/pricing/engine";
import { DEFAULT_LABOR_DAYS, DEFAULT_SIZING } from "@/lib/sizing/sizing";
import { buildEquipment, fromSelection, pickIndoor, toSelection, type EquipmentOptions } from "./equipment";
import { buildLines, defaultDiameters, enabledLines, normalizeDiameter, proposeDays, type LineSettings } from "./lines";
import { proposeConfigurations, type ProposalInput } from "./options";
import { EMPTY_METRE, type CatAccessory, type CatProduct, type Metre, type RoomNeed } from "./types";

// --- Mini-catalogue -----------------------------------------------------------
let n = 0;
function prod(brand: string, type: CatProduct["type"], kw: number, price: number, extra: Partial<CatProduct> = {}): CatProduct {
  const b = BRANDS[brand]!;
  return {
    id: `${brand}-${type}-${kw}-${n++}`,
    brandId: brand,
    brandName: brand,
    reference: `${brand.toUpperCase()}-${type}-${kw}`,
    rangeName: null,
    type,
    coolingKw: kw,
    heatingKw: kw * 1.15,
    maxOutlets: type === "ue_mono" ? 1 : null,
    maxIndoorRatio: null,
    linkDiameters: null,
    prechargedLengthM: type.startsWith("ue") ? 7.5 : null,
    extraChargeGPerM: type.startsWith("ue") ? 20 : null,
    publicPriceCents: Math.round(price * b.price * 100),
    brandDiscount: b.discount,
    productDiscount: null,
    brandCoefficient: 1,
    ...extra,
  };
}
// « eco » : bon marché, petite remise ; « marge » : plus cher mais grosse remise ; « pref » : préférée
const BRANDS: Record<string, { price: number; discount: number }> = {
  eco: { price: 0.8, discount: 0.25 },
  marge: { price: 1.0, discount: 0.45 },
  pref: { price: 1.3, discount: 0.35 },
};
function brandRange(b: string): CatProduct[] {
  return [
    prod(b, "ui_murale", 2.0, 420),
    prod(b, "ui_murale", 2.5, 460),
    prod(b, "ui_murale", 3.5, 540, { linkDiameters: '1/4" - 3/8"' }),
    prod(b, "ui_murale", 5.0, 790),
    prod(b, "ui_console", 3.5, 790),
    prod(b, "ue_mono", 2.5, 890),
    prod(b, "ue_mono", 3.5, 1090),
    prod(b, "ue_mono", 5.0, 1590),
    prod(b, "ue_mono", 7.1, 2290),
    prod(b, "ue_mono", 10.0, 2990),
    prod(b, "ue_multi", 5.0, 1990, { maxOutlets: 2, prechargedLengthM: 20 }),
    prod(b, "ue_multi", 6.8, 2790, { maxOutlets: 3, prechargedLengthM: 30 }),
    prod(b, "ue_multi", 8.0, 3390, { maxOutlets: 4, prechargedLengthM: 40 }),
    prod(b, "ui_gainable", 5.0, 1390),
    prod(b, "ui_gainable", 7.1, 1790),
  ];
}
const PRODUCTS = [...brandRange("eco"), ...brandRange("marge"), ...brandRange("pref")];

const acc = (role: CatAccessory["role"], name: string, unit: string, price: number, diameter: string | null = null): CatAccessory => ({
  id: `a-${role}-${diameter ?? ""}`,
  role,
  category: "x",
  name,
  diameter,
  unit,
  publicPriceCents: price,
  purchasePriceCents: null,
  discount: 0.3,
});
const ACCESSORIES: CatAccessory[] = [
  acc("liaison", "Liaison", "m", 1200, "1/4 - 3/8"),
  acc("liaison", "Liaison", "m", 1500, "1/4 - 1/2"),
  acc("liaison", "Liaison", "m", 2200, "3/8 - 5/8"),
  acc("support_mural", "Support mural", "u", 4500),
  acc("support_sol", "Support sol", "u", 6000),
  acc("goulotte", "Goulotte", "m", 1400),
  acc("condensats", "Tube condensats", "m", 250),
  acc("pompe_relevage", "Pompe de relevage", "u", 12000),
  acc("cable_alim", "Câble 3G2,5", "m", 280),
  acc("cable_liaison", "Câble 4G1,5", "m", 220),
  acc("disjoncteur", "Disjoncteur 16 A", "u", 1800),
  acc("gaz", "R32", "kg", 4500),
  acc("plenum", "Plénum", "u", 9500),
  acc("gaine", "Gaine", "m", 900),
  acc("bouche_soufflage", "Bouche", "u", 4500),
  acc("grille_reprise", "Grille", "u", 6500),
  acc("registre_zonage", "Registre", "u", 14000),
  acc("thermostat_zone", "Thermostat", "u", 9000),
  acc("module_zonage", "Module zonage", "u", 39000),
];

const room = (id: string, needW: number, level = 0, indoorType: RoomNeed["indoorType"] = "mural"): RoomNeed => ({ id, name: id, needW, level, indoorType });
const OPTS: EquipmentOptions = { sizing: DEFAULT_SIZING, multiSimultaneity: 1, gainableAccess: true };
const LS: LineSettings = {
  vatRate: 0.1,
  dailyLaborRateCents: 45000,
  commissioningPriceCents: 0,
  fluidFormPriceCents: 0,
  fluidFormPolicy: "complement",
  defaultElectricM: 10,
  companyAccessoryCoefficient: 1.3,
  accessoryPurchaseCoefficient: 2,
  materialCoefficient: null,
  accessoryCoefficient: null,
};
const PRICING: PricingSettings = { vatRegime: "franchise", laborChargesRate: 0.23, materialChargesRate: 0.16, targetMarginPerDayCents: 0 };

// --- Choix des unités ---------------------------------------------------------
describe("choix des unités", () => {
  it("la plus petite unité dans la plage cohérente", () => {
    expect(pickIndoor(PRODUCTS.filter((p) => p.brandId === "eco"), "ui_murale", 3.14, DEFAULT_SIZING)!.product.coolingKw).toBe(3.5);
  });
  it("surdimensionnée si rien dans la plage", () => {
    // besoin 1 kW : plage 0,95–1,6 kW vide → 2,0 kW signalée surdimensionnée
    const r = pickIndoor(PRODUCTS.filter((p) => p.brandId === "eco"), "ui_murale", 1, DEFAULT_SIZING)!;
    expect(r.product.coolingKw).toBe(2);
    expect(r.oversized).toBe(true);
  });
});

describe("mono-splits", () => {
  it("une unité extérieure par pièce, même marque", () => {
    const r = buildEquipment("mono", "eco", [room("Salon", 3140), room("Chambre", 1800, 0, "console")], PRODUCTS, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.equipment.systems).toHaveLength(2);
    expect(r.equipment.systems.every((s) => s.outdoor.brandId === "eco" && s.indoors[0]!.product.brandId === "eco")).toBe(true);
    expect(r.equipment.systems[0]!.outdoor.coolingKw).toBe(3.5);
    expect(r.equipment.systems[1]!.indoors[0]!.product.type).toBe("ui_console");
  });
});

describe("multi-split", () => {
  it("3 pièces sur une unité tri-split", () => {
    const r = buildEquipment("multi", "eco", [room("A", 2300), room("B", 2300), room("C", 1800)], PRODUCTS, OPTS);
    expect(r.ok && r.equipment.systems.map((s) => [s.outdoor.maxOutlets, s.indoors.length])).toEqual([[3, 3]]);
  });
  it("au-delà des sorties : 2 unités extérieures de la même marque, avec avertissement", () => {
    const rooms = ["A", "B", "C", "D", "E", "F"].map((id) => room(id, 1800));
    const r = buildEquipment("multi", "marge", rooms, PRODUCTS, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.equipment.systems).toHaveLength(2);
    expect(r.equipment.warnings[0]).toBe("2 unités extérieures");
    expect(new Set(r.equipment.systems.flatMap((s) => [s.outdoor.brandId, ...s.indoors.map((i) => i.product.brandId)]))).toEqual(new Set(["marge"]));
    expect(r.equipment.systems.reduce((a, s) => a + s.indoors.length, 0)).toBe(6);
  });
  it("une seule pièce : pas de multi", () => {
    expect(buildEquipment("multi", "eco", [room("A", 2000)], PRODUCTS, OPTS)).toEqual({ ok: false, reason: "Multi-split : au moins 2 pièces" });
  });
});

describe("gainable", () => {
  const rooms = [room("Ch1", 1500), room("Ch2", 1500), room("Séjour", 2500)];
  it("seulement si combles / faux plafond accessibles", () => {
    expect(buildEquipment("gainable", "eco", rooms, PRODUCTS, { ...OPTS, gainableAccess: false }).ok).toBe(false);
  });
  it("une gainable pour toutes les pièces", () => {
    const r = buildEquipment("gainable", "eco", rooms, PRODUCTS, OPTS);
    expect(r.ok && r.equipment.systems.map((s) => [s.indoors[0]!.product.coolingKw, s.indoors[0]!.roomIds.length, s.outdoor.coolingKw])).toEqual([[7.1, 3, 7.1]]);
  });
  it("pièces sur 2 niveaux : 2 gainables", () => {
    const r = buildEquipment("gainable", "eco", [room("Séjour", 3000, 0), room("Ch1", 1500, 1), room("Ch2", 1500, 1)], PRODUCTS, OPTS);
    expect(r.ok && r.equipment.systems.length).toBe(2);
    expect(r.ok && r.equipment.warnings[0]).toContain("2 niveaux");
  });
  it("puissance au-delà de la plus grosse gainable : 2 gainables équilibrées", () => {
    const big = [room("A", 4000), room("B", 4000), room("C", 3000), room("D", 3000)];
    const r = buildEquipment("gainable", "eco", big, PRODUCTS, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.equipment.systems).toHaveLength(2);
    expect(r.equipment.systems.map((s) => s.indoors[0]!.roomIds.length)).toEqual([2, 2]);
  });
});

describe("sauvegarde de la sélection", () => {
  it("aller-retour ids → équipement", () => {
    const r = buildEquipment("multi", "eco", [room("A", 2300), room("B", 1800)], PRODUCTS, OPTS);
    if (!r.ok) throw new Error();
    const back = fromSelection(toSelection(r.equipment), PRODUCTS)!;
    expect(back.systems[0]!.outdoor.id).toBe(r.equipment.systems[0]!.outdoor.id);
    expect(fromSelection({ ...toSelection(r.equipment), systems: [{ key: "s1", outdoorId: "disparu", indoors: [] }] }, PRODUCTS)).toBeNull();
  });
});

// --- Lignes et métré ---------------------------------------------------------
function monoSalon() {
  const r = buildEquipment("mono", "eco", [room("Salon", 3140)], PRODUCTS, OPTS);
  if (!r.ok) throw new Error(r.reason);
  return r.equipment;
}
const keyOf = (lines: { key: string }[]) => lines.map((l) => l.key.split(":")[0]);

describe("lignes du devis", () => {
  it("diamètres : champ de la fiche produit, règle de repli sinon", () => {
    expect(normalizeDiameter('1/4" - 3/8"')).toBe(normalizeDiameter("1/4 - 3/8"));
    expect(defaultDiameters(2.5)).toBe("1/4 - 3/8");
    expect(defaultDiameters(5)).toBe("1/4 - 1/2");
    expect(defaultDiameters(7.1)).toBe("3/8 - 5/8");
    const eq = monoSalon();
    const lia = buildLines(eq, [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES, LS, 1, null).lines.find((l) => l.key.startsWith("liaison"))!;
    expect(lia.designation).toContain("1/4 - 3/8");
    expect(lia.quantity).toBe(5); // 5 m par défaut
  });

  it("accessoires automatiques par unité, pompe et support au sol décochés par défaut", () => {
    const { lines } = buildLines(monoSalon(), [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES, LS, 1, null);
    expect(keyOf(lines.filter((l) => l.enabled))).toEqual(["eq", "eq", "liaison", "goulotte", "cablelia", "condensats", "support_mural", "cable", "disj", "mes", "mo"]);
    expect(lines.find((l) => l.key.startsWith("pompe"))!.enabled).toBe(false);
    expect(lines.find((l) => l.key.startsWith("support_sol"))!.enabled).toBe(false);
  });

  it("support au sol choisi : le support mural se décoche", () => {
    const eq = monoSalon();
    const m: Metre = { ...EMPTY_METRE, toggles: { "support_sol:s1": true, "support_mural:s1": false } };
    const { lines } = buildLines(eq, [room("Salon", 3140)], m, ACCESSORIES, LS, 1, null);
    expect(lines.filter((l) => l.radioGroup && l.enabled).map((l) => l.key)).toEqual(["support_sol:s1"]);
  });

  it("métré : longueur ajustée, quantité forcée, ligne décochée", () => {
    const eq = monoSalon();
    const ik = eq.systems[0]!.indoors[0]!.key;
    const m: Metre = { ...EMPTY_METRE, linkM: { [ik]: 12 }, qty: { [`goulotte:${ik}`]: 8 }, toggles: { [`condensats:${ik}`]: false } };
    const { lines } = buildLines(eq, [room("Salon", 3140)], m, ACCESSORIES, LS, 1, null);
    expect(lines.find((l) => l.key === `liaison:${ik}`)!.quantity).toBe(12);
    expect(lines.find((l) => l.key === `goulotte:${ik}`)!.quantity).toBe(8);
    expect(enabledLines(lines).some((l) => l.id === `condensats:${ik}`)).toBe(false);
  });

  it("complément de gaz au-delà de la longueur pré-chargée + fiche CERFA", () => {
    const eq = monoSalon();
    const ik = eq.systems[0]!.indoors[0]!.key;
    // 12 m − 7,5 m pré-chargés = 4,5 m × 20 g/m = 90 g → 0,1 kg
    const r = buildLines(eq, [room("Salon", 3140)], { ...EMPTY_METRE, linkM: { [ik]: 12 } }, ACCESSORIES, LS, 1, null);
    expect(r.gasKg.s1).toBe(0.1);
    expect(r.lines.find((l) => l.key === "gaz:s1")!.quantity).toBe(0.1);
    expect(r.lines.some((l) => l.key === "cerfa:s1")).toBe(true);
    // 5 m < 7,5 m : pas de complément, pas de fiche (règle « si complément »)
    const short = buildLines(eq, [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES, LS, 1, null);
    expect(short.gasKg.s1).toBe(0);
    expect(short.lines.some((l) => l.key.startsWith("gaz") || l.key.startsWith("cerfa"))).toBe(false);
    // réglage « à chaque mise en service »
    const always = buildLines(eq, [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES, { ...LS, fluidFormPolicy: "always" }, 1, null);
    expect(always.lines.some((l) => l.key === "cerfa:s1")).toBe(true);
  });

  it("charge non calculable si la fiche UE est incomplète : avertissement", () => {
    const eq = monoSalon();
    eq.systems[0]!.outdoor = { ...eq.systems[0]!.outdoor, prechargedLengthM: null };
    expect(buildLines(eq, [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES, LS, 1, null).warnings[0]).toContain("pré-chargée");
  });

  it("gainable : réseau aéraulique ajouté, zonage en option avec son surcoût", () => {
    const rooms = [room("Ch1", 1500), room("Ch2", 1500), room("Séjour", 2500)];
    const r = buildEquipment("gainable", "eco", rooms, PRODUCTS, OPTS);
    if (!r.ok) throw new Error();
    const off = buildLines(r.equipment, rooms, EMPTY_METRE, ACCESSORIES, LS, 2, null);
    const enabled = (k: string) => off.lines.find((l) => l.key.startsWith(k))!;
    expect(enabled("plenum").quantity).toBe(1);
    expect(enabled("gaine").quantity).toBe(18); // 3 pièces × 6 m
    expect(enabled("bouche").quantity).toBe(3);
    expect(enabled("grille").quantity).toBe(1);
    expect(enabled("registre").enabled).toBe(false);
    const on = buildLines(r.equipment, rooms, { ...EMPTY_METRE, toggles: { zonage: true } }, ACCESSORIES, LS, 2, null);
    const zoning = on.lines.filter((l) => l.group.endsWith("zonage") && l.enabled);
    expect(zoning.map((l) => [l.key.split(":")[0], l.quantity])).toEqual([["registre", 3], ["thermostat", 3], ["module", 1]]);
    const cost = (ls: typeof on.lines) => computeQuote({ lines: enabledLines(ls), laborDays: 2, settings: PRICING }).totalHtCents;
    expect(cost(on.lines) - cost(off.lines)).toBeGreaterThan(0);
    // le zonage ajoute du temps de pose
    expect(proposeDays(r.equipment, { ...EMPTY_METRE, toggles: { zonage: true } }, DEFAULT_LABOR_DAYS)).toBeGreaterThan(proposeDays(r.equipment, EMPTY_METRE, DEFAULT_LABOR_DAYS));
  });

  it("accessoire manquant au catalogue : avertissement, pas de ligne", () => {
    const r = buildLines(monoSalon(), [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES.filter((a) => a.role !== "goulotte"), LS, 1, null);
    expect(r.warnings.some((w) => w.includes("Goulotte"))).toBe(true);
  });

  it("les prix des accessoires suivent le coefficient du devis", () => {
    const base = buildLines(monoSalon(), [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES, LS, 1, null).lines.find((l) => l.key.startsWith("goulotte"))!;
    const q = buildLines(monoSalon(), [room("Salon", 3140)], EMPTY_METRE, ACCESSORIES, { ...LS, accessoryCoefficient: 1.6 }, 1, null).lines.find((l) => l.key.startsWith("goulotte"))!;
    // goulotte : public 14 €, achat 9,80 € → max(14 × 1,30 ; 9,80 × 2) = 19,60 €
    expect(base.unitSaleCents).toBe(1960);
    // coefficient du devis 1,60 sur le prix public → 22,40 €
    expect(q.unitSaleCents).toBe(2240);
  });
});

// --- Options Éco / Confort / Premium ----------------------------------------
function input(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    rooms: [room("Salon", 3140), room("Chambre", 1800)],
    products: PRODUCTS,
    accessories: ACCESSORIES,
    equipmentOptions: OPTS,
    lineSettings: LS,
    pricing: PRICING,
    laborParams: DEFAULT_LABOR_DAYS,
    travelFor: () => null,
    preferredBrandId: "pref",
    ...over,
  };
}

describe("options Éco / Confort / Premium", () => {
  const proposals = proposeConfigurations(input());
  const mono = proposals.find((p) => p.kind === "mono")!;

  it("Éco = prix client le plus bas, Confort = meilleure marge, Premium = marque préférée", () => {
    const tagOf = (t: string) => mono.options.find((o) => o.tags.includes(t as never))!;
    expect(tagOf("eco").equipment.brandId).toBe("eco");
    expect(tagOf("confort").equipment.brandId).toBe("marge");
    expect(tagOf("premium").equipment.brandId).toBe("pref");
    const all = mono.options.map((o) => o.result.totalTtcCents);
    expect(tagOf("eco").result.totalTtcCents).toBe(Math.min(...all));
  });

  it("une seule marque par option", () => {
    for (const p of proposals) for (const o of p.options) {
      const brands = new Set(o.equipment.systems.flatMap((s) => [s.outdoor.brandId, ...s.indoors.map((i) => i.product.brandId)]));
      expect(brands.size).toBe(1);
    }
  });

  it("deux options sur le même produit sont fusionnées", () => {
    const p = proposeConfigurations(input({ preferredBrandId: "marge" })).find((x) => x.kind === "mono")!;
    expect(p.options).toHaveLength(2);
    expect(p.options.find((o) => o.equipment.brandId === "marge")!.tags).toEqual(["confort", "premium"]);
  });

  it("Éco et Confort évitent les options en alerte quand c'est possible", () => {
    // objectif de marge que seule la marque « marge » atteint
    const target = mono.options.find((o) => o.equipment.brandId === "marge")!.result.margin.marginPerDayCents! - 1;
    const p = proposeConfigurations(input({ pricing: { ...PRICING, targetMarginPerDayCents: target } })).find((x) => x.kind === "mono")!;
    expect(p.options.find((o) => o.tags.includes("eco"))!.equipment.brandId).toBe("marge");
    // les marques sous l'objectif sont comptées comme écartées (la préférée reste en Premium)
    expect(p.excluded.map((o) => o.equipment.brandId)).toEqual(["eco"]);
  });

  it("configuration impossible : raison affichée", () => {
    const p = proposeConfigurations(input({ equipmentOptions: { ...OPTS, gainableAccess: false } })).find((x) => x.kind === "gainable")!;
    expect(p.options).toEqual([]);
    expect(p.unavailable).toContain("combles");
  });

  it("sans marque préférée : note pour l'option Premium", () => {
    expect(proposeConfigurations(input({ preferredBrandId: null }))[0]!.premiumNote).toContain("paramètres");
  });
});
