import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { writeFileSync } from "node:fs";
import { computeQuote } from "@/lib/pricing/engine";
import { buildQuoteDocument, type DocCompany, type DocLine, type DocQuote } from "./document";
import { pdfEuros, QuotePdf } from "./QuotePdf";

const company: DocCompany = {
  legal_name: "Clim Atlantique EI",
  siret: "73282932000074",
  address_line: "5 quai des Chartrons",
  postal_code: "33000",
  city: "Bordeaux",
  phone: "06 12 34 56 78",
  email: "contact@clim.fr",
  insurer_name: "Assur BTP",
  insurance_policy: "DEC-123",
  insurance_coverage: "France métropolitaine",
  bank_holder: "Clim Atlantique",
  iban: "FR7630006000011234567890189",
  bic: "AGRIFRPP",
  vat_regime: "franchise",
  vat_number: null,
  payment_terms: "Paiement par virement ou chèque.",
  mediator_name: null,
  mediator_address: null,
  mediator_website: null,
};
const L = (id: string, kind: DocLine["kind"], designation: string, quantity: number, unit: string, sale: number, wizardKey: string | null = id): DocLine => ({
  id, kind, designation, quantity, unit, unitPurchaseCents: Math.round(sale * 0.6), unitSaleCents: sale, vatRate: 0, wizardKey, origin: wizardKey ? "wizard" : "manual",
});
export const SAMPLE_LINES: DocLine[] = [
  L("eq:s1", "material", "Unité extérieure multi-split Boréal BOR-M4-80 8 kW", 1, "u", 311900),
  L("eq:i1", "material", "Unité intérieure murale Boréal BOR-MU35 3,5 kW – Séjour", 1, "u", 49700),
  L("eq:i2", "material", "Unité intérieure murale Boréal BOR-MU25 2,5 kW – Chambre 1", 1, "u", 42300),
  L("liaison:i1", "accessory", "Liaison frigorifique 1/4 - 3/8", 12, "m", 1680),
  L("goulotte:i1", "accessory", "Goulotte de finition 80 × 60", 12, "m", 2100),
  L("support_mural:s1", "accessory", "Support mural unité extérieure", 1, "u", 6750),
  L("mes:s1", "other", "Mise en service : tirage au vide, test d'étanchéité à l'azote, contrôles (inclus)", 1, "forfait", 0),
  L("cerfa:s1", "other", "Fiche d'intervention fluides frigorigènes (CERFA 15497*04)", 1, "forfait", 3500),
  L("mo", "labor", "Main d'œuvre : pose et raccordements", 2, "jour", 45000),
  L("dep", "travel", "Déplacement et stationnement (2 j × 70,00 € (36 km aller-retour + stationnement 40,00 €/j))", 1, "forfait", 14000),
  L("free1", "other", "Carottage mur béton Ø 60", 1, "u", 12000, null),
];
export const SAMPLE_QUOTE: DocQuote = {
  number: "D-2026-001",
  issueDate: "2026-11-14",
  validityDays: 30,
  presentation: "particulier",
  signedOffPremises: true,
  earlyStart: true,
  urgentRepair: false,
  depositRate: 0.3,
  schedule: null,
  discount: { kind: "percent", value: 0.05 },
  client: { name: "M. et Mme Martin", address: "3 rue des Lilas", postalCode: "33700", city: "Mérignac", phone: "06 98 76 54 32", email: null },
  site: { address: "12 allée des Pins", postalCode: "33600", city: "Pessac" },
};

describe("rendu PDF", () => {
  it("montants sans espace fine insécable (police Helvetica)", () => {
    expect(pdfEuros(349000)).toBe("3 490,00 €");
  });
  it.each(["particulier", "detaille"] as const)("génère un PDF valide (%s)", async (presentation) => {
    const q = { ...SAMPLE_QUOTE, presentation };
    const result = computeQuote({ lines: SAMPLE_LINES, laborDays: 2, discount: q.discount, settings: { vatRegime: "franchise", laborChargesRate: 0.23, materialChargesRate: 0.16, targetMarginPerDayCents: 0 } });
    const doc = buildQuoteDocument(company, q, SAMPLE_LINES, result);
    const buf = await renderToBuffer(<QuotePdf doc={doc} logo={null} stamp={null} />);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/devis-${presentation}.pdf`, buf);
  });
});
