import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { cleaner, fillOfficialCerfa, fillSheetForm } from "./cerfa-fill";
import { adrOf, buildCerfaSheets, leakCheckMonthsHfo, NO_CAPACITY_WARNING } from "./cerfa";
import { EMPTY_METRE, type CatProduct, type Equipment } from "@/lib/quote/types";

const template = new Uint8Array(readFileSync("src/lib/site/cerfa/cerfa_15497-04.pdf"));
const product = (id: string, type: CatProduct["type"]): CatProduct => ({
  id, brandId: "b", brandName: "Daikin", reference: id.toUpperCase(), rangeName: null, type, coolingKw: 3.5, heatingKw: 4, maxOutlets: 1, maxIndoorRatio: null,
  linkDiameters: "1/4 - 3/8", prechargedLengthM: 10, extraChargeGPerM: 20, publicPriceCents: 100000, brandDiscount: 0.4, productDiscount: null, brandCoefficient: 1,
});
const sys = { key: "s1", outdoor: product("ue", "ue_mono"), indoors: [{ key: "i1", product: product("mu", "ui_murale"), roomIds: ["r1"] }] };
const equipment: Equipment = { kind: "mono", brandId: "b", brandName: "Daikin", warnings: [], systems: [sys] };
const input = (over: Partial<Parameters<typeof buildCerfaSheets>[0]> = {}) => ({
  country: "FR",
  number: "FI-2026-0001",
  company: { name: "Clim Atlantique EI", address: "5 quai des Chartrons, 33000 Bordeaux", siret: "73282932000074", capacityNumber: "AC-33-0457", leakDetectorId: "Testo 316-3", leakDetectorCheckedOn: "2026-03-02" },
  client: { name: "M. Martin", address: "3 allée des Pins, 33600 Pessac", siret: null },
  installationAddress: "3 allée des Pins, 33600 Pessac",
  equipment,
  metre: { ...EMPTY_METRE, linkM: { i1: 14 } },
  tech: { ue: { refrigerant: "R32", factoryChargeKg: 0.85, maxLinkM: 20, maxHeightDiffM: 15, clearances: {} } },
  commissioning: { "s1.serial": "J004512" },
  form: { systems: {} },
  ...over,
});

async function filled(sheet: ReturnType<typeof buildCerfaSheets>[number]) {
  const doc = await PDFDocument.load(template);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  fillSheetForm(form, font, cleaner(font), sheet);
  return { text: (n: string) => form.getTextField(n).getText() ?? "", on: (n: string) => form.getCheckBox(n).isChecked(), radio: form.getRadioGroup("Bouton_Oui") };
}

describe("CERFA 15497*04 officiel : champs du formulaire", () => {
  it("mise en service R32 < 5 t : champs pré-remplis, aucune case de fréquence, NON détection permanente", async () => {
    const [s] = buildCerfaSheets(input());
    const f = await filled(s!);
    expect(f.text("Fiche_no")).toBe("FI-2026-0001");
    expect(f.text("Operateur")).toBe("Clim Atlantique EI\n5 quai des Chartrons, 33000 Bordeaux\nSIRET 73282932000074");
    expect(f.text("Attestation_no")).toBe("AC-33-0457");
    expect(f.text("Equipement_Fluide")).toBe("32");
    expect(f.text("Equipement_Charge")).toBe("0,95");
    expect(f.text("Equipement_teqCO2")).toBe("0,64");
    expect(f.on("Case_MiseService")).toBe(true);
    expect(f.on("Case_Assemblage")).toBe(false);
    expect(["Case_HFC_5", "Case_HFC_50", "Case_HFC_500", "Case_Sans_12m", "Case_Avec_24m"].some(f.on)).toBe(false);
    expect(f.radio.getSelected()).toBe(f.radio.getOptions()[1]);
    expect(f.on("Case_Fuite_Non")).toBe(true);
    expect(f.text("11_QA")).toBe("0,1");
    expect(["Case_12_UN1078", "Case_12_UN3161", "Case_12_Autre160504"].some(f.on)).toBe(false);
    expect(f.text("Controle_Jour") + f.text("Controle_Mois") + f.text("Controle_Annee")).toBe("02032026");
  });

  it("≥ 5 t avec détection permanente : cases 5–50 t et 24 mois ; récupération R32 → UN 3252 (autres inflammables)", async () => {
    const [s] = buildCerfaSheets(input({ tech: { ue: { refrigerant: "R32", factoryChargeKg: 7.5, maxLinkM: 50, maxHeightDiffM: 30, clearances: {} } }, form: { systems: { s1: { permanentDetection: true, recoveredTreatmentKg: 1.2, destinationName: "Centre X", bsff: "BSFF-1" } } } }));
    const f = await filled(s!);
    expect(f.on("Case_HFC_5")).toBe(true);
    expect(f.on("Case_Avec_24m")).toBe(true);
    expect(f.on("Case_Sans_12m")).toBe(false);
    expect(f.radio.getSelected()).toBe(f.radio.getOptions()[0]);
    expect(f.on("Case_12_Autre160504")).toBe(true);
    expect(f.on("Case_12_UN3161")).toBe(false);
    expect(f.text("Autre-FF-inflammable")).toBe("UN 3252, déchet difluorométhane (gaz réfrigérant R 32), 2.1");
    expect(f.text("14_Observations")).toContain("UN 3252");
    expect(f.text("13_Instal")).toBe("Centre X");
  });

  it("codes ONU : table par fluide, sinon UN 3161 / UN 1078 par défaut", () => {
    expect(adrOf("R32")).toMatchObject({ box: "autre_inflammable", un: "UN 3252", waste: "16 05 04*" });
    expect(adrOf("R454B")).toMatchObject({ box: "UN3161", waste: "16 05 04*" });
    expect(adrOf("R410A")).toMatchObject({ box: "autre_non_inflammable", un: "UN 3163", waste: "14 06 01*" });
    expect(adrOf("R513A")).toMatchObject({ box: "UN1078", waste: "14 06 01*" });
  });

  it("HFO : seuils en kg (1 / 10 / 100 kg)", () => {
    expect(leakCheckMonthsHfo(0.9, false)).toBeNull();
    expect(leakCheckMonthsHfo(1, false)).toBe(12);
    expect(leakCheckMonthsHfo(10, true)).toBe(12);
    expect(leakCheckMonthsHfo(100, false)).toBe(3);
  });

  it("sans attestation de capacité : avertissement reporté en observations", async () => {
    const [s] = buildCerfaSheets(input({ company: { ...input().company, capacityNumber: null } }));
    expect((await filled(s!)).text("14_Observations")).toContain(NO_CAPACITY_WARNING);
  });

  it("PDF final : une page officielle par unité extérieure, champs aplatis", async () => {
    const sheets = buildCerfaSheets(input({ equipment: { ...equipment, systems: [sys, { ...sys, key: "s2" }] } }));
    const out = await PDFDocument.load(await fillOfficialCerfa(template, sheets, { operator: null, holder: null }));
    expect(out.getPageCount()).toBe(2);
    expect(out.getForm().getFields()).toHaveLength(0);
  });
});

describe("PDF final sans référence cassée", () => {
  it("aucune annotation ne pointe vers un objet absent", async () => {
    const bytes = await fillOfficialCerfa(template, buildCerfaSheets(input()), { operator: null, holder: null });
    const doc = await PDFDocument.load(bytes);
    const { PDFArray: A, PDFName: N } = await import("pdf-lib");
    const annots = doc.getPage(0).node.lookupMaybe(N.of("Annots"), A);
    for (const ref of annots?.asArray() ?? []) expect(doc.context.lookup(ref)).toBeDefined();
  });
});
