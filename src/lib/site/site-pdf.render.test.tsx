import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { AmendmentPdf, ReceptionPdf } from "./SitePdfs";
import { CerfaPdf } from "./CerfaPdf";
import { buildCerfaSheets } from "./cerfa";
import { buildAmendment } from "./site";
import { EMPTY_METRE, type CatProduct, type Equipment } from "@/lib/quote/types";

const company = { name: "Clim Atlantique EI", lines: ["5 quai des Chartrons, 33000 Bordeaux", "SIRET 73282932000074"] };
const client = { name: "M. Martin", lines: ["3 allée des Pins, 33600 Pessac"] };
const pages = async (b: Buffer) => (await PDFDocument.load(b)).getPageCount();

describe("PDF du mode chantier", () => {
  it("procès-verbal de réception, avec et sans réserves", async () => {
    const base = { company, client, quoteNumber: "D-2026-012", works: ["E1 : unité extérieure", "I1 : unité intérieure – Séjour"], signerName: "M. Martin", signedAt: "20/11/2026", signature: null, photos: [] };
    const sans = await renderToBuffer(<ReceptionPdf {...base} reserves={[]} />);
    const avec = await renderToBuffer(<ReceptionPdf {...base} reserves={["Retouche de peinture autour de la goulotte"]} />);
    expect(await pages(sans)).toBe(1);
    expect(avec.length).toBeGreaterThan(sans.length);
  });

  it("CERFA 15497*04 pré-rempli : une page par unité extérieure ; fiche générique hors France", async () => {
    const product = (id: string, type: CatProduct["type"]): CatProduct => ({
      id, brandId: "b", brandName: "Arctica", reference: id.toUpperCase(), rangeName: null, type, coolingKw: 3.5, heatingKw: 4, maxOutlets: 1, maxIndoorRatio: null,
      linkDiameters: "1/4 - 3/8", prechargedLengthM: 5, extraChargeGPerM: 20, publicPriceCents: 100000, brandDiscount: 0.4, productDiscount: null, brandCoefficient: 1,
    });
    const sys = { key: "s1", outdoor: product("ue", "ue_mono"), indoors: [{ key: "i1", product: product("mu", "ui_murale"), roomIds: ["r1"] }] };
    const equipment: Equipment = { kind: "mono", brandId: "b", brandName: "Arctica", warnings: [], systems: [sys, { ...sys, key: "s2" }] };
    const input = {
      country: "FR",
      number: "FI-2026-0001",
      company: { name: "Clim Atlantique EI", address: "5 quai des Chartrons, 33000 Bordeaux", siret: "73282932000074", capacityNumber: null, leakDetectorId: "Testo 316-3", leakDetectorCheckedOn: "2026-03-02" },
      client: { name: "M. Martin", address: "3 allée des Pins, 33600 Pessac", siret: null },
      installationAddress: "3 allée des Pins, 33600 Pessac",
      equipment,
      metre: EMPTY_METRE,
      tech: { ue: { refrigerant: "R32", factoryChargeKg: 0.95, maxLinkM: 20, maxHeightDiffM: 10, clearances: {} } },
      commissioning: { "s1.serial": "SN-1" },
      form: { systems: { s2: { natures: ["mise_en_service" as const, "controle_non_periodique" as const], leaksFound: true, leaks: [{ location: "Raccord flare UI", repaired: true }], recoveredTreatmentKg: 0.3, destinationName: "Centre X" } }, operatorSign: { name: "J. Dupont", quality: "Gérant", date: "2026-11-20", signaturePath: null } },
    };
    const sheets = buildCerfaSheets(input);
    const buf = await renderToBuffer(<CerfaPdf sheets={sheets} company="Clim Atlantique EI" signatures={{ operator: null, holder: null }} />);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await pages(buf)).toBe(2);
    const gen = await renderToBuffer(<CerfaPdf sheets={buildCerfaSheets({ ...input, country: "BE" })} company="x" signatures={{ operator: null, holder: null }} />);
    expect(await pages(gen)).toBe(2);
  });

  it("avenant : prix de vente, total et nouveau montant du marché", async () => {
    const settings = { vatRegime: "assujetti" as const, laborChargesRate: 0.2, materialChargesRate: 0.1, targetMarginPerDayCents: 0 };
    const a = buildAmendment(1, [{ description: "Pompe de relevage nécessaire (I1)", lines: [{ designation: "Pompe de relevage", quantity: 1, unit: "u", kind: "accessory", unitPurchaseCents: 0, unitSaleCents: 15600, vatRate: 0.1 }] }], settings, 400000);
    const buf = await renderToBuffer(<AmendmentPdf amendment={a} company={company} client={client} quoteNumber="D-2026-012" date="20/11/2026" quoteTotalTtcCents={400000} />);
    expect(await pages(buf)).toBe(1);
    expect(a.newTotalTtcCents).toBe(417160);
  });
});
