import { describe, expect, it } from "vitest";
import { EMPTY_METRE, type CatProduct, type Equipment } from "@/lib/quote/types";
import { adrOf, buildCerfaSheets, KEEP_REMINDER, leakCheckMonths, NO_CAPACITY_WARNING, prgOf, sanitizeSystemInput, teqCo2, validateSystemInput } from "./cerfa";

const product = (id: string, type: CatProduct["type"]): CatProduct => ({
  id, brandId: "b", brandName: "Arctica", reference: id.toUpperCase(), rangeName: null, type, coolingKw: 3.5, heatingKw: 4, maxOutlets: 1, maxIndoorRatio: null,
  linkDiameters: "1/4 - 3/8", prechargedLengthM: 5, extraChargeGPerM: 20, publicPriceCents: 100000, brandDiscount: 0.4, productDiscount: null, brandCoefficient: 1,
});
const equipment: Equipment = { kind: "mono", brandId: "b", brandName: "Arctica", warnings: [], systems: [{ key: "s1", outdoor: product("ue", "ue_mono"), indoors: [{ key: "i1", product: product("mu", "ui_murale"), roomIds: ["r1"] }] }] };
const company = { name: "Clim Test", address: "1 rue A, 33000 Bordeaux", siret: "12345678900011", capacityNumber: "AC-123", leakDetectorId: "Testo 316-3 n° 4471", leakDetectorCheckedOn: "2026-03-02" };
const base = {
  country: "FR",
  number: "FI-2026-0007",
  company,
  client: { name: "M. Martin", address: "3 allée des Pins, 33600 Pessac", siret: null },
  installationAddress: "3 allée des Pins, 33600 Pessac",
  equipment,
  metre: { ...EMPTY_METRE, linkM: { i1: 12 } },
  tech: { ue: { refrigerant: "R32", factoryChargeKg: 0.95, maxLinkM: 20, maxHeightDiffM: 10, clearances: {} } },
  commissioning: { "s1.serial": "SN-998877" },
  form: { systems: {} },
};

describe("CERFA 15497*04 : calculs réglementaires", () => {
  it("tonnage éq. CO2 = kg × PRG ÷ 1000, R32 = 675", () => {
    expect(prgOf("R32")).toBe(675);
    expect(prgOf("R-410A")).toBe(2088);
    expect(teqCo2(1.09, 675)).toBe(0.74);
    expect(teqCo2(7.5, 675)).toBe(5.06);
  });
  it("fréquence des contrôles d'étanchéité [7]–[9], jamais sous 5 t éq. CO2", () => {
    expect(leakCheckMonths(4.99, false)).toBeNull();
    expect(leakCheckMonths(4.99, true)).toBeNull();
    expect(leakCheckMonths(5, false)).toBe(12);
    expect(leakCheckMonths(5, true)).toBe(24);
    expect(leakCheckMonths(49.9, false)).toBe(12);
    expect(leakCheckMonths(50, false)).toBe(6);
    expect(leakCheckMonths(50, true)).toBe(12);
    expect(leakCheckMonths(500, false)).toBe(3);
    expect(leakCheckMonths(500, true)).toBe(6);
  });
  it("cadre [12] : code ONU par fluide (R32 → UN 3252), sinon UN 3161 / 16 05 04* ou UN 1078 / 14 06 01*", () => {
    expect(adrOf("R32")).toMatchObject({ un: "UN 3252", waste: "16 05 04*" });
    expect(adrOf("R1234YF")).toMatchObject({ un: "UN 3161", waste: "16 05 04*" });
    expect(adrOf("R449A")).toMatchObject({ un: "UN 1078", waste: "14 06 01*" });
  });
});

describe("CERFA 15497*04 : fiche pré-remplie", () => {
  it("installation neuve R32 : mise en service cochée, charge = usine + complément, pas de contrôle périodique", () => {
    const [f] = buildCerfaSheets(base);
    expect(f!.format).toBe("cerfa");
    expect(f!.number).toBe("FI-2026-0007");
    expect(f!.natures).toEqual(["mise_en_service"]);
    expect(f!.equipment).toMatchObject({ brand: "Arctica", model: "UE", serial: "SN-998877", fluid: "R-32", factoryChargeKg: 0.95, complementKg: 0.2, totalChargeKg: 1.15, prg: 675, teq: 0.78 });
    expect(f!.permanentDetection).toBe(false);
    expect(f!.leakCheckMonths).toBeNull();
    expect(f!.leakCheckText).toContain("aucun contrôle d'étanchéité périodique");
    expect(f!.charged).toEqual({ a: 0.2, b: 0, c: 0, total: 0.2 });
    expect(f!.recovered.total).toBe(0);
    expect(f!.adr).toBeNull();
    expect(f!.destination).toBeNull();
    expect(f!.reminder).toBeNull();
    expect(f!.warnings).toEqual([]);
    expect(f!.leakDetector).toEqual({ id: "Testo 316-3 n° 4471", checkedOn: "2026-03-02" });
  });
  it("charge mesurée à la mise en service prioritaire sur le calcul", () => {
    const [f] = buildCerfaSheets({ ...base, commissioning: { ...base.commissioning, "s1.charge_g": "250" } });
    expect(f!.equipment.complementKg).toBe(0.25);
    expect(f!.equipment.totalChargeKg).toBe(1.2);
  });
  it("≥ 5 t éq. CO2 : fréquence, rappel de conservation 5 ans ; récupération → ADR et destination", () => {
    const [f] = buildCerfaSheets({
      ...base,
      tech: { ue: { ...base.tech.ue, factoryChargeKg: 7.5 } },
      form: { systems: { s1: { natures: ["maintenance"], permanentDetection: true, recoveredTreatmentKg: 1.2, bsff: "BSFF-2026-ABC", destinationName: "Centre de traitement X" } } },
    });
    expect(f!.leakCheckMonths).toBe(24);
    expect(f!.reminder).toBe(KEEP_REMINDER);
    expect(f!.adr).toMatchObject({ un: "UN 3252", box: "autre_inflammable" });
    expect(f!.destination?.name).toBe("Centre de traitement X");
    expect(f!.recovered).toEqual({ d: 1.2, e: 0, total: 1.2 });
  });
  it("sans attestation de capacité : avertissement ; hors France : fiche générique", () => {
    const [f] = buildCerfaSheets({ ...base, country: "BE", company: { ...company, capacityNumber: null } });
    expect(f!.warnings).toContain(NO_CAPACITY_WARNING);
    expect(f!.format).toBe("generique");
  });
  it("plusieurs unités extérieures : une fiche chacune, numéro suffixé", () => {
    const two: Equipment = { ...equipment, systems: [equipment.systems[0]!, { ...equipment.systems[0]!, key: "s2" }] };
    expect(buildCerfaSheets({ ...base, equipment: two }).map((f) => f.number)).toEqual(["FI-2026-0007-1", "FI-2026-0007-2"]);
  });
  it("saisie validée : fuites (3 lignes max), « autre » précisé, destination si récupération", () => {
    const s = sanitizeSystemInput({ natures: ["autre", "pirate"], leaksFound: true, leaks: [{ location: "Raccord UI", repaired: true }, { location: "a" }, { location: "b" }, { location: "c" }], recoveredReuseKg: 2 });
    expect(s.natures).toEqual(["autre"]);
    expect(s.leaks).toHaveLength(3);
    expect(validateSystemInput(s)).toContain("Précisez");
    expect(validateSystemInput({ ...s, natureOther: "Remplacement compresseur" })).toContain("destination");
  });
});
