import { describe, expect, it } from "vitest";
import { buildLines, enabledLines, type LineSettings } from "@/lib/quote/lines";
import { EMPTY_METRE, type CatAccessory, type CatProduct, type Equipment } from "@/lib/quote/types";
import type { Layout } from "@/lib/plans/layout";
import {
  buildAmendment,
  buildFluidForm,
  checkCommissioning,
  commissioningSections,
  deviationCosts,
  diffLines,
  metreWithDeviation,
  plannedExtraChargeG,
  progress,
  siteItems,
  validateReception,
} from "./site";

const product = (id: string, type: CatProduct["type"]): CatProduct => ({
  id, brandId: "b", brandName: "Arctica", reference: id.toUpperCase(), rangeName: null, type, coolingKw: 3.5, heatingKw: 4, maxOutlets: 1, maxIndoorRatio: null,
  linkDiameters: "1/4 - 3/8", prechargedLengthM: 5, extraChargeGPerM: 20, publicPriceCents: 100000, brandDiscount: 0.4, productDiscount: null, brandCoefficient: 1,
});
const equipment: Equipment = { kind: "mono", brandId: "b", brandName: "Arctica", warnings: [], systems: [{ key: "s1", outdoor: product("ue", "ue_mono"), indoors: [{ key: "i1", product: product("mu", "ui_murale"), roomIds: ["r1"] }] }] };
const acc = (role: CatAccessory["role"], name: string, unit: string, price: number, diameter: string | null = null): CatAccessory => ({ id: `a-${role}`, role, category: "x", name, diameter, unit, publicPriceCents: price, purchasePriceCents: null, discount: 0.5 });
const ACC = [acc("liaison", "Liaison", "m", 1200, "1/4 - 3/8"), acc("goulotte", "Goulotte", "m", 1400), acc("condensats", "Condensats", "m", 250), acc("cable_liaison", "Câble 4G1,5", "m", 220), acc("pompe_relevage", "Pompe de relevage", "u", 12000), acc("gaz", "R32", "kg", 4500)];
const LS: LineSettings = { vatRate: 0.1, dailyLaborRateCents: 45000, commissioningPriceCents: 0, fluidFormPriceCents: 0, fluidFormPolicy: "complement", defaultElectricM: 10, companyAccessoryCoefficient: 1.3, accessoryPurchaseCoefficient: 2, materialCoefficient: null, accessoryCoefficient: null };
const rooms = [{ id: "r1", name: "Séjour", needW: 3000, level: 0, indoorType: "mural" as const }];
const build = (m = EMPTY_METRE) => buildLines(equipment, rooms, m, ACC, LS, 1, null).lines;
const settings = { vatRegime: "assujetti" as const, laborChargesRate: 0.2, materialChargesRate: 0.1, targetMarginPerDayCents: 0 };

describe("avancement du chantier", () => {
  const layout: Layout = {
    markers: [
      { id: "a", kind: "ui", x: 10, y: 10, equipmentKey: "i1" },
      { id: "t", kind: "tableau", x: 0, y: 0, equipmentKey: null },
      { id: "l", kind: "lit", x: 5, y: 5, equipmentKey: null },
    ],
    routes: [{ id: "r", kind: "liaison", equipmentKey: "i1", points: [{ x: 10, y: 10 }, { x: 50, y: 10 }], extraM: 0 }],
  };
  it("éléments du plan à cocher, complétés par ce qui n'est pas dessiné", () => {
    const items = siteItems([{ level: 0, layout }], equipment);
    expect(items.map((i) => i.label)).toEqual(["I1 – unité intérieure posée", "Liaison frigorifique I1 tirée", "E1 – unité extérieure posée", "Alimentation électrique E1 tirée", "Condensats I1 posés"]);
    expect(items[0]).toMatchObject({ id: "m:a", level: 0, x: 10, y: 10 });
    expect(progress(items, { "m:a": { at: "x" }, "eq:ue:s1": { at: "x" } })).toEqual({ done: 2, total: 5, percent: 40 });
  });
  it("sans implantation : liste déduite du matériel", () => {
    expect(siteItems([], equipment)).toHaveLength(5);
  });
});

describe("écarts : surcoût, marge, avenant", () => {
  it("« liaison 2 m plus longue » : liaison, goulotte, câble, condensats et gaz, aux prix du devis", () => {
    const d = { kind: "longueur" as const, equipmentKey: "i1", quantity: 2 };
    const lines = diffLines(build(), build(metreWithDeviation(EMPTY_METRE, d)));
    expect(lines.map((l) => [l.designation.split(" ")[0], l.quantity])).toEqual([["Liaison", 2], ["Goulotte", 2], ["Câble", 2], ["Condensats", 2], ["Complément", 0.1]]);
    const base = { lines: enabledLines(build()), laborDays: 1, settings };
    const c = deviationCosts(base, lines);
    // achat : 2 × (6 + 7 + 1,10 + 1,25) + 0,1 kg × 22,50 (gaz arrondi à 0,1 kg) = 32,95 €
    expect(c.extraPurchaseCents).toBe(3295);
    expect(c.extraSaleCents).toBe(2 * (1560 + 1820 + 286 + 325) + 585);
    expect(c.marginIfAbsorbedCents).toBe(-3295);
    expect(c.marginIfBilledCents).toBeGreaterThan(0);
    expect(c.marginIfBilledCents).toBe(c.extraSaleCents - c.extraPurchaseCents - Math.round(c.extraSaleCents * 0.1));
  });
  it("les longueurs forcées par le plan suivent la liaison", () => {
    const m = metreWithDeviation({ ...EMPTY_METRE, linkM: { i1: 8 }, qty: { "goulotte:i1": 6 } }, { kind: "longueur", equipmentKey: "i1", quantity: 2 });
    expect(m.linkM.i1).toBe(10);
    expect(m.qty["goulotte:i1"]).toBe(8);
  });
  it("« pompe de relevage nécessaire »", () => {
    const lines = diffLines(build(), build(metreWithDeviation(EMPTY_METRE, { kind: "pompe", equipmentKey: "i1", quantity: null })));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ designation: "Pompe de relevage", quantity: 1, unitPurchaseCents: 6000, unitSaleCents: 15600 });
  });
  it("avenant : total HT, TVA du devis, nouveau montant du marché", () => {
    const lines = diffLines(build(), build(metreWithDeviation(EMPTY_METRE, { kind: "pompe", equipmentKey: "i1", quantity: null })));
    const a = buildAmendment(1, [{ description: "Pompe de relevage nécessaire", lines }], settings, 400000);
    expect(a).toMatchObject({ number: 1, totalHtCents: 15600, totalTtcCents: 17160, newTotalTtcCents: 417160, vatMention: null });
    const fr = buildAmendment(2, [{ description: "x", lines }], { ...settings, vatRegime: "franchise" }, 400000);
    expect(fr.totalTtcCents).toBe(15600);
    expect(fr.vatMention).toContain("293 B");
  });
});

describe("mise en service", () => {
  const metre = { ...EMPTY_METRE, linkM: { i1: 12 } };
  const sections = commissioningSections(equipment, metre);
  const ok = {
    "s1.serial": "E123", "s1.n2_bar": "38", "s1.n2_min": "30", "s1.n2_ok": "oui", "s1.vide_min": "45", "s1.vide_mbar": "0,5", "s1.charge_g": "140",
    "i1.froid_souffle": "12", "i1.froid_reprise": "24", "i1.condensats_ok": "oui", date: "2026-11-20", operateur: "Paul",
  };
  it("charge complémentaire prévue rappelée", () => {
    expect(plannedExtraChargeG(equipment, metre, "s1")).toBe(140);
    expect(sections[0]!.fields.find((f) => f.id === "s1.charge_g")!.hint).toBe("Prévu au métré : 140 g");
  });
  it("complète et conforme", () => {
    expect(checkCommissioning(sections, ok, equipment)).toEqual({ complete: true, missing: [], errors: [], warnings: [] });
  });
  it("champs manquants, azote non tenu (bloquant), relevés inhabituels (avertissement)", () => {
    const r = checkCommissioning(sections, { ...ok, "s1.serial": "", "s1.n2_ok": "non", "s1.vide_mbar": "5", "i1.froid_souffle": "20" }, equipment);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["E1 : N° de série de l'unité extérieure"]);
    expect(r.errors[0]).toContain("azote n'a pas tenu");
    expect(r.warnings).toHaveLength(2);
  });
  it("fiche fluides préremplie : charge totale et tonnage équivalent CO2", () => {
    const f = buildFluidForm({
      company: { name: "Clim Test", address: "1 rue A, 33000 Bordeaux", siret: "12345678900011", capacityNumber: "AC-123" },
      client: { name: "M. Martin", address: "3 allée des Pins, 33600 Pessac" },
      equipment,
      tech: { ue: { refrigerant: "R32", factoryChargeKg: 0.95, maxLinkM: 20, maxHeightDiffM: 10, clearances: {} } },
      values: ok,
    });
    const row = (l: string) => f.systems[0]!.rows.find((r) => r.label === l)!.value;
    expect(row("Fluide vierge ajouté")).toBe("0,14 kg");
    expect(row("Charge totale de l'équipement")).toBe("1,09 kg");
    expect(row("Tonnage équivalent CO2")).toBe("0,74 t éq. CO2 (PRG 675)");
    expect(row("Contrôle d'étanchéité")).toContain("aucune fuite");
    expect(f.operator.find((r) => r.label.includes("attestation"))!.value).toBe("AC-123");
    expect(f.notes).toHaveLength(1);
    const big = buildFluidForm({ company: { name: "x", address: "", siret: null, capacityNumber: null }, client: { name: "y", address: "" }, equipment, tech: { ue: { refrigerant: "R32", factoryChargeKg: 7.5, maxLinkM: null, maxHeightDiffM: null, clearances: {} } }, values: ok });
    expect(big.notes.join(" ")).toContain("contrôle d'étanchéité périodique");
    expect(big.operator.find((r) => r.label.includes("attestation"))!.value).toContain("à compléter");
  });
});

describe("réception", () => {
  it("nom et signature obligatoires", () => {
    expect(validateReception({ signerName: "", reserves: [], hasSignature: true })).not.toBeNull();
    expect(validateReception({ signerName: "M. Martin", reserves: [], hasSignature: false })).not.toBeNull();
    expect(validateReception({ signerName: "M. Martin", reserves: ["Retouche peinture goulotte"], hasSignature: true })).toBeNull();
  });
});
