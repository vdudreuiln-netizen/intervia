import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { computeQuote } from "@/lib/pricing/engine";
import { buildQuoteDocument, type DocCompany, type DocLine, type DocQuote } from "@/lib/pdf/document";
import { QuotePdf } from "@/lib/pdf/QuotePdf";
import { EMPTY_METRE, type CatProduct, type Equipment } from "@/lib/quote/types";
import { annexOverlay, type PlanAnnex } from "./annex";
import { SitePdf } from "./PlanPdf";
import { buildClientSpec, buildSiteSpec, type SpecInput } from "./spec";

/** PNG blanc avec un cadre (plan factice), généré sans dépendance. */
function fakePlanPng(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // niveaux de gris
  const raw = Buffer.alloc((w + 1) * h, 255);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3 || x === Math.floor(w / 2)) raw[y * (w + 1) + 1 + x] = 40;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const product = (id: string, type: CatProduct["type"]): CatProduct => ({
  id, brandId: "b", brandName: "Arctica", reference: id.toUpperCase(), rangeName: null, type, coolingKw: 2.5, heatingKw: 3.2, maxOutlets: 2, maxIndoorRatio: null,
  linkDiameters: "1/4 - 3/8", prechargedLengthM: 15, extraChargeGPerM: 20, publicPriceCents: 100000, brandDiscount: 0.3, productDiscount: null, brandCoefficient: 1,
});
const equipment: Equipment = {
  kind: "multi", brandId: "b", brandName: "Arctica", warnings: [],
  systems: [{ key: "s1", outdoor: product("ue-50", "ue_multi"), indoors: [{ key: "i1", product: product("mu-25", "ui_murale"), roomIds: ["r1"] }, { key: "i2", product: product("mu-35", "ui_murale"), roomIds: ["r2"] }] }],
};
const layout = {
  markers: [
    { id: "a", kind: "ui" as const, x: 120, y: 80, equipmentKey: "i1" },
    { id: "b", kind: "ui" as const, x: 300, y: 80, equipmentKey: "i2" },
    { id: "c", kind: "ue" as const, x: 380, y: 260, equipmentKey: "s1" },
  ],
  routes: [
    { id: "r", kind: "liaison" as const, equipmentKey: "i1", points: [{ x: 120, y: 80 }, { x: 120, y: 260 }, { x: 380, y: 260 }], extraM: 1 },
    { id: "s", kind: "condensats" as const, equipmentKey: "i1", points: [{ x: 120, y: 80 }, { x: 60, y: 80 }], extraM: 0 },
  ],
};
const plan: PlanAnnex = { label: "Rez-de-chaussée", image: { data: fakePlanPng(400, 300), format: "png" }, width: 400, height: 300, northDeg: 30, ...annexOverlay(layout, equipment, 0.02) };

const spec: SpecInput = {
  quoteNumber: "D-2026-001",
  client: { name: "M. et Mme Martin", phone: "06 98 76 54 32", email: null },
  site: { address: "12 allée des Pins", postalCode: "33600", city: "Pessac", parking: true },
  equipment,
  rooms: [
    { id: "r1", name: "Séjour", needW: 3000, level: 0, indoorType: "mural" },
    { id: "r2", name: "Chambre", needW: 1500, level: 0, indoorType: "mural" },
  ],
  metre: { ...EMPTY_METRE, linkM: { i1: 11, i2: 6 } },
  lines: [
    { key: "eq:s1", kind: "material", designation: "Unité extérieure UE-50", quantity: 1, unit: "u" },
    { key: "liaison:i1", kind: "accessory", designation: "Liaison 1/4 - 3/8", quantity: 11, unit: "m" },
    { key: "condensats:i1", kind: "accessory", designation: "Condensats", quantity: 1.5, unit: "m" },
    { key: "cable:s1", kind: "accessory", designation: "Câble d'alimentation", quantity: 8, unit: "m" },
  ],
  laborDays: 2,
  plans: ["Rez-de-chaussée"],
};

const company: DocCompany = {
  legal_name: "Clim Atlantique EI", siret: "73282932000074", address_line: "5 quai des Chartrons", postal_code: "33000", city: "Bordeaux", phone: null, email: null,
  insurer_name: "Assur BTP", insurance_policy: "DEC-1", insurance_coverage: "France", bank_holder: null, iban: null, bic: null, vat_regime: "franchise", vat_number: null,
  payment_terms: "Virement.", mediator_name: "Médiateur", mediator_address: "Paris", mediator_website: "https://mediateur.fr",
};
const lines: DocLine[] = [
  { id: "eq:s1", kind: "material", designation: "Unité extérieure UE-50", quantity: 1, unit: "u", unitPurchaseCents: 90000, unitSaleCents: 150000, vatRate: 0, wizardKey: "eq:s1", origin: "wizard" },
];
const quote: DocQuote = {
  number: "D-2026-001", issueDate: "2026-11-16", validityDays: 30, presentation: "particulier", signedOffPremises: false, earlyStart: false, urgentRepair: false,
  depositRate: 0.3, schedule: null, discount: null,
  client: { name: "M. et Mme Martin", address: null, postalCode: null, city: null, phone: null, email: null }, site: { address: null, postalCode: null, city: null },
};

const pageCount = async (buf: Buffer | Uint8Array) => (await PDFDocument.load(buf)).getPageCount();

describe("PDF du bloc A", () => {
  it("devis + annexes : plan d'implantation (paysage) et cahier des charges client", async () => {
    const result = computeQuote({ lines, laborDays: 2, settings: { vatRegime: "franchise", laborChargesRate: 0.2, materialChargesRate: 0.1, targetMarginPerDayCents: 0 } });
    const doc = buildQuoteDocument(company, quote, lines, result);
    const seul = await renderToBuffer(<QuotePdf doc={doc} logo={null} stamp={null} />);
    const annexes = await renderToBuffer(<QuotePdf doc={doc} logo={null} stamp={null} annexes={{ plans: [plan], spec: buildClientSpec(spec) }} />);
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/devis-annexes.pdf`, annexes);
    expect(await pageCount(annexes)).toBe((await pageCount(seul)) + 2);

    // Dossier complet : fusion avec une fiche technique
    const sheet = await PDFDocument.create();
    sheet.addPage();
    sheet.addPage();
    const merged = await PDFDocument.load(annexes);
    const src = await PDFDocument.load(await sheet.save());
    for (const p of await merged.copyPages(src, src.getPageIndices())) merged.addPage(p);
    expect(merged.getPageCount()).toBe((await pageCount(annexes)) + 2);
  });

  it("dossier chantier : sans prix, une page de plan par niveau", async () => {
    const buf = await renderToBuffer(<SitePdf company="Clim Atlantique EI" quoteNumber="D-2026-001" spec={buildSiteSpec(spec)} plans={[plan]} generatedAt="16/11/2026" />);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await pageCount(buf)).toBeGreaterThanOrEqual(2);
    expect(buf.toString("latin1")).not.toContain("€");
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/chantier.pdf`, buf);
  });

  it("légende du plan : repères et longueurs", () => {
    expect(plan.legend).toContain("I1 : unité intérieure");
    expect(plan.legend).toContain("Liaison frigorifique I1 : 10 m"); // (180 + 260) px × 0,02 + 1 m = 9,8 → 10 m
  });
});
