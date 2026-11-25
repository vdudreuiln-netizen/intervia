import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { buildPurchaseOrders } from "./orders";
import { PurchaseOrderPdf } from "./PurchaseOrderPdf";

describe("bon de commande PDF", () => {
  it("se génère (A4, une page) avec les données du bon", async () => {
    const [order] = buildPurchaseOrders(
      [
        {
          supplierId: "s",
          supplierRef: "CDS-1",
          manufacturerRef: "FTXM25R",
          designation: "Unité murale 2,5 kW",
          quantity: 2,
          unit: "u",
          unitNetCents: 41000,
        },
      ],
      [
        {
          id: "s",
          name: "Clim Distribution Sud",
          agency: "Mérignac",
          contactName: "Paul",
          email: null,
          phone: null,
        },
      ],
      {
        quoteNumber: "D-2026-012",
        clientName: "M. Martin",
        siteCity: "Pessac",
        delivery: "chantier",
        depotAddress: { line: null, postalCode: null, city: null },
        siteAddress: {
          line: "3 allée des Pins",
          postalCode: "33600",
          city: "Pessac",
        },
        desiredDate: "2026-11-20",
        generatedAt: new Date("2026-11-15T09:00:00Z"),
        shippingBySupplier: { s: 2500 },
      },
    );
    const el = createElement(PurchaseOrderPdf, {
      order: { ...order!, generatedAt: order!.generatedAt.toISOString() },
      company: {
        name: "Clim Test",
        address: "1 rue A, 33000 Bordeaux",
        phone: null,
        email: null,
        siret: null,
      },
    }) as unknown as ReactElement<DocumentProps>;
    const buf = await renderToBuffer(el);
    const text = buf.toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });
});
