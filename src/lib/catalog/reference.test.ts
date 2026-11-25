import { describe, expect, it } from "vitest";
import type { DiscountBook, SupplierOffer } from "@/lib/suppliers/pricing";
import { alertMonths, canPublish, cheapest, compareTariffs, netOffers, newerTariffsAvailable, staleTariffs, tariffAgeMonths } from "./reference";

describe("catalogue commun : accord écrit obligatoire", () => {
  it("publication refusée sans accord, sans date ou sans justificatif", () => {
    expect(canPublish({ name: "Daikin", status: "demande", date: null, proofPath: null })).toMatchObject({ ok: false });
    expect(canPublish({ name: "Daikin", status: "obtenu", date: null, proofPath: "x.pdf" })).toMatchObject({ ok: false, reason: expect.stringContaining("date") });
    expect(canPublish({ name: "Daikin", status: "obtenu", date: "2026-12-01", proofPath: null })).toMatchObject({ ok: false, reason: expect.stringContaining("justificatif") });
    expect(canPublish({ name: "Daikin", status: "obtenu", date: "2026-12-01", proofPath: "accords/daikin.pdf" })).toEqual({ ok: true });
  });
});

describe("comparaison d'un nouveau tarif fabricant", () => {
  it("nouvelles références, références retirées, hausses et variations suspectes", () => {
    const c = compareTariffs(
      [{ ref: "RXM35R", publicPriceCents: 100000 }, { ref: "FTXM35R", publicPriceCents: 80000 }, { ref: "OLD1", publicPriceCents: 5000 }],
      [{ ref: "rxm35r ", publicPriceCents: 104000 }, { ref: "FTXM35R", publicPriceCents: 80000 }, { ref: "RXM50R", publicPriceCents: 150000 }],
    );
    expect(c).toMatchObject({ total: 3, added: ["RXM50R"], removed: ["OLD1"], increased: 1, decreased: 0, unchanged: 1, averageChange: 0.02 });
    const odd = compareTariffs([{ ref: "A", publicPriceCents: 10000 }], [{ ref: "A", publicPriceCents: 1000 }]);
    expect(odd.outliers).toEqual([{ ref: "A", fromCents: 10000, toCents: 1000, change: -0.9 }]);
  });
});

describe("prix net et distributeur le moins cher", () => {
  const suppliers = [
    { id: "s1", name: "Distri Nord" },
    { id: "s2", name: "Clim Négoce" },
    { id: "s3", name: "Sans remise" },
  ];
  const book: DiscountBook = { brand: { s1: { daikin: 0.4 }, s2: { daikin: 0.35 } }, family: { s2: { "SPLIT MURAL": 0.45 } } };
  const item = { publicPriceCents: 100000, brandId: "daikin", family: "Split mural" };

  it("sans tarif distributeur : prix public fabricant × remise du tableau (famille avant marque)", () => {
    const r = netOffers(item, [], suppliers, book);
    expect(r.map((o) => [o.supplierName, o.netCents, o.level, o.source])).toEqual([
      ["Clim Négoce", 55000, "famille", "remise"],
      ["Distri Nord", 60000, "marque", "remise"],
    ]);
  });
  it("un tarif importé du distributeur passe avant (prix net du tarif)", () => {
    const offers: SupplierOffer[] = [{ supplierId: "s1", publicPriceCents: 100000, netPriceCents: 52000, discount: null, family: null }];
    const best = cheapest(item, offers, suppliers, book)!;
    expect(best).toMatchObject({ supplierName: "Distri Nord", netCents: 52000, level: "net", source: "tarif" });
  });
  it("aucun prix calculable sans remise ni tarif", () => {
    expect(cheapest({ ...item, brandId: "autre", family: null }, [], suppliers, book)).toBeNull();
  });
});

describe("alertes de tarif", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  it("âge en mois et seuil réglable (12 par défaut)", () => {
    expect(tariffAgeMonths("2025-11-26", now)).toBe(12);
    expect(tariffAgeMonths("2025-11-27", now)).toBe(11);
    expect(alertMonths(null)).toBe(12);
    expect(alertMonths(6)).toBe(6);
    expect(alertMonths(0)).toBe(12);
  });
  it("tarifs de plus de N mois signalés, date inconnue aussi", () => {
    const r = staleTariffs([{ label: "Daikin", tariffDate: "2025-10-01" }, { label: "Atlantic", tariffDate: "2026-09-01" }, { label: "Toshiba", tariffDate: null }], 12, now);
    expect(r.map((x) => x.label)).toEqual(["Daikin", "Toshiba"]);
    expect(r[0]!.message).toContain("01/10/2025");
    expect(staleTariffs([{ label: "Atlantic", tariffDate: "2026-04-01" }], 6, now)).toHaveLength(1);
  });
  it("nouveau tarif commun disponible pour une marque utilisée et non rattachée", () => {
    const r = newerTariffsAvailable(
      [
        { brandName: "Daikin", tariffDate: "2026-01-01", linked: false },
        { brandName: "Atlantic", tariffDate: "2026-06-01", linked: false },
        { brandName: "Toshiba", tariffDate: null, linked: true },
      ],
      [{ brandName: "daikin", effectiveDate: "2027-01-01" }, { brandName: "Atlantic", effectiveDate: "2026-01-01" }, { brandName: "Toshiba", effectiveDate: "2027-01-01" }],
    );
    expect(r).toEqual([{ brandName: "daikin", effectiveDate: "2027-01-01" }]);
  });
});
