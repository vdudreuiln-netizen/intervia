import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { AmendmentPdf, FluidPdf, ReceptionPdf } from "./SitePdfs";
import { buildAmendment, type FluidForm } from "./site";

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

  it("fiche fluides préremplie", async () => {
    const form: FluidForm = {
      operator: [{ label: "Opérateur", value: "Clim Atlantique EI" }, { label: "N° d'attestation de capacité", value: "à compléter" }],
      holder: [{ label: "Détenteur", value: "M. Martin" }],
      systems: [{ tag: "E1", rows: [{ label: "Fluide frigorigène", value: "R32" }, { label: "Charge totale de l'équipement", value: "1,09 kg" }] }],
      intervention: [{ label: "Nature de l'intervention", value: "Assemblage et mise en service de l'équipement" }],
      notes: ["Fiche à signer par l'opérateur et le détenteur, à conserver 5 ans par chacun."],
    };
    const buf = await renderToBuffer(<FluidPdf form={form} company="Clim Atlantique EI" quoteNumber="D-2026-012" />);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await pages(buf)).toBe(1);
  });

  it("avenant : prix de vente, total et nouveau montant du marché", async () => {
    const settings = { vatRegime: "assujetti" as const, laborChargesRate: 0.2, materialChargesRate: 0.1, targetMarginPerDayCents: 0 };
    const a = buildAmendment(1, [{ description: "Pompe de relevage nécessaire (I1)", lines: [{ designation: "Pompe de relevage", quantity: 1, unit: "u", kind: "accessory", unitPurchaseCents: 0, unitSaleCents: 15600, vatRate: 0.1 }] }], settings, 400000);
    const buf = await renderToBuffer(<AmendmentPdf amendment={a} company={company} client={client} quoteNumber="D-2026-012" date="20/11/2026" quoteTotalTtcCents={400000} />);
    expect(await pages(buf)).toBe(1);
    expect(a.newTotalTtcCents).toBe(417160);
  });
});
