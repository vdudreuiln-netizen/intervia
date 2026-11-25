import { describe, expect, it } from "vitest";
import { matchArticle, normalizeEan, normalizeManufacturerRef } from "./matching";
import {
  allAtPlan,
  francoGap,
  isTariffStale,
  netPurchase,
  optimalPlan,
  perLinePlan,
  rankOffers,
  referencePublicPrice,
  resolveDiscount,
  shippingCost,
  supplierScenarios,
  validateShippingRule,
  type ChoiceLine,
  type DiscountBook,
  type SupplierInfo,
  type SupplierOffer,
} from "./pricing";
import { buildPurchaseOrders, siteReference, validateDesiredDate } from "./orders";
import { computeQuote } from "@/lib/pricing/engine";

const offer = (o: Partial<SupplierOffer> & { supplierId: string }): SupplierOffer => ({
  publicPriceCents: null,
  netPriceCents: null,
  discount: null,
  family: null,
  ...o,
});

describe("rapprochement des références", () => {
  it("normalise : majuscules, sans séparateurs, préfixe de marque retiré", () => {
    expect(normalizeManufacturerRef("msz-ap 25.vg/k")).toBe("MSZAP25VGK");
    expect(normalizeManufacturerRef("DAIKIN FTXM25R", "Daikin")).toBe("FTXM25R");
    expect(normalizeManufacturerRef("Daikin-FTXM25R", "daikin")).toBe("FTXM25R");
    // Préfixe identique à la marque mais référence trop courte : on ne coupe pas
    expect(normalizeManufacturerRef("LG1", "LG")).toBe("LG1");
  });

  it("EAN normalisé et prioritaire", () => {
    expect(normalizeEan("4 548 848 123 456")).toBe("4548848123456");
    expect(normalizeEan("123")).toBeNull();
    const r = matchArticle({ reference: "XYZ", brandName: "Arctica", ean: "4548848123456" }, [
      {
        id: "p1",
        reference: "AUTRE",
        brandName: "Arctica",
        ean: "4548848123456",
      },
    ]);
    expect(r).toMatchObject({ status: "certain", candidateId: "p1" });
  });

  it("référence normalisée identique = certaine ; suffixe différent = probable (jamais retiré automatiquement)", () => {
    const cands = [
      { id: "a", reference: "MSZ-AP25VG", brandName: "Mitsubishi" },
      { id: "b", reference: "MSZ-AP35VG", brandName: "Mitsubishi" },
    ];
    expect(matchArticle({ reference: "msz ap25vg", brandName: "Mitsubishi" }, cands)).toMatchObject({ status: "certain", candidateId: "a" });
    expect(matchArticle({ reference: "MSZ-AP25VGK", brandName: "Mitsubishi" }, cands)).toMatchObject({ status: "probable", candidateId: "a" });
    expect(matchArticle({ reference: "MSZ-LN25", brandName: "Mitsubishi" }, cands).status).toBe("none");
  });

  it("ne rapproche pas deux marques différentes", () => {
    expect(matchArticle({ reference: "AB12345", brandName: "Boréal" }, [{ id: "x", reference: "AB12345", brandName: "Arctica" }]).status).toBe("none");
  });
});

describe("remises et prix nets", () => {
  const book: DiscountBook = {
    brand: { s1: { daikin: 0.3 } },
    family: { s1: { "MURAUX R32": 0.4 } },
  };

  it("référence > famille > marque > aucune", () => {
    expect(resolveDiscount(offer({ supplierId: "s1", discount: 0.45, family: "Muraux R32" }), "daikin", book)).toEqual({ rate: 0.45, level: "reference" });
    expect(resolveDiscount(offer({ supplierId: "s1", family: "  muraux   r32 " }), "daikin", book)).toEqual({ rate: 0.4, level: "famille" });
    expect(resolveDiscount(offer({ supplierId: "s1", family: "Gainables" }), "daikin", book)).toEqual({ rate: 0.3, level: "marque" });
    expect(resolveDiscount(offer({ supplierId: "s2" }), "daikin", book)).toEqual({ rate: 0, level: "aucune" });
  });

  it("une remise à 0 % sur la référence l'emporte quand même", () => {
    expect(resolveDiscount(offer({ supplierId: "s1", discount: 0 }), "daikin", book).level).toBe("reference");
  });

  it("prix net du tarif prioritaire, sinon public × (1 − remise)", () => {
    expect(
      netPurchase(
        offer({
          supplierId: "s1",
          publicPriceCents: 100000,
          netPriceCents: 52000,
        }),
        "daikin",
        book,
      ),
    ).toMatchObject({ netCents: 52000, level: "net" });
    expect(netPurchase(offer({ supplierId: "s1", publicPriceCents: 100000 }), "daikin", book)).toMatchObject({ netCents: 70000, level: "marque" });
    expect(netPurchase(offer({ supplierId: "s1" }), "daikin", book)).toBeNull();
  });

  it("classe les fournisseurs du moins cher au plus cher", () => {
    const r = rankOffers([offer({ supplierId: "s2", publicPriceCents: 100000, discount: 0.35 }), offer({ supplierId: "s1", publicPriceCents: 100000 })], "daikin", book);
    expect(r.map((x) => [x.supplierId, x.netCents])).toEqual([
      ["s2", 65000],
      ["s1", 70000],
    ]);
  });
});

describe("prix public de référence (option A)", () => {
  const offers = [offer({ supplierId: "s1", publicPriceCents: 120000 }), offer({ supplierId: "s2", publicPriceCents: 125000 }), offer({ supplierId: "s3", netPriceCents: 50000 })];
  it("fournisseur de référence de la marque", () => {
    expect(referencePublicPrice(offers, "s1")).toEqual({
      cents: 120000,
      supplierId: "s1",
    });
  });
  it("à défaut, le plus élevé", () => {
    expect(referencePublicPrice(offers, null)).toEqual({
      cents: 125000,
      supplierId: "s2",
    });
    expect(referencePublicPrice(offers, "s3")).toEqual({
      cents: 125000,
      supplierId: "s2",
    });
  });
  it("aucun prix public connu", () => {
    expect(referencePublicPrice([offer({ supplierId: "s3", netPriceCents: 1 })], null)).toBeNull();
  });
});

describe("frais de port", () => {
  const rule = { feeCents: 2500, francoCents: 50000, tiers: [] };
  it("X € sous le franco, offert au-delà", () => {
    expect(shippingCost(rule, 0)).toBe(0);
    expect(shippingCost(rule, 49999)).toBe(2500);
    expect(shippingCost(rule, 50000)).toBe(0);
    expect(francoGap(rule, 42000)).toBe(8000);
    expect(francoGap(rule, 60000)).toBeNull();
  });
  it("barème par paliers", () => {
    const tiers = {
      feeCents: 4000,
      francoCents: 100000,
      tiers: [
        { fromCents: 20000, feeCents: 2500 },
        { fromCents: 50000, feeCents: 1500 },
      ],
    };
    expect(shippingCost(tiers, 10000)).toBe(4000);
    expect(shippingCost(tiers, 30000)).toBe(2500);
    expect(shippingCost(tiers, 70000)).toBe(1500);
    expect(shippingCost(tiers, 100000)).toBe(0);
  });
  it("validation", () => {
    expect(validateShippingRule(rule)).toBeNull();
    expect(validateShippingRule({ feeCents: -1, francoCents: null, tiers: [] })).not.toBeNull();
    expect(
      validateShippingRule({
        feeCents: 0,
        francoCents: null,
        tiers: [
          { fromCents: 1, feeCents: 1 },
          { fromCents: 1, feeCents: 2 },
        ],
      }),
    ).not.toBeNull();
  });
});

describe("choix des fournisseurs", () => {
  const suppliers: SupplierInfo[] = [
    {
      id: "A",
      name: "Alpha",
      shipping: { feeCents: 3000, francoCents: 100000, tiers: [] },
    },
    {
      id: "B",
      name: "Bêta",
      shipping: { feeCents: 3000, francoCents: 100000, tiers: [] },
    },
  ];
  // Groupe : A est un peu moins cher, mais un accessoire seul chez B coûte du port.
  const lines: ChoiceLine[] = [
    {
      key: "ue",
      quantity: 1,
      offers: [
        { supplierId: "A", netCents: 90000 },
        { supplierId: "B", netCents: 92000 },
      ],
    },
    {
      key: "ui",
      quantity: 2,
      offers: [
        { supplierId: "A", netCents: 30000 },
        { supplierId: "B", netCents: 31000 },
      ],
    },
    {
      key: "support",
      quantity: 1,
      offers: [
        { supplierId: "A", netCents: 6000 },
        { supplierId: "B", netCents: 5000 },
      ],
    },
    { key: "mo", quantity: 1, offers: [] },
  ];

  it("ligne par ligne : chacun au moins cher, port calculé ensuite", () => {
    const p = perLinePlan(lines, suppliers);
    expect(p.assignment).toEqual({ ue: "A", ui: "A", support: "B", mo: null });
    expect(p.shippingCents).toBe(3000); // B : 50 € < franco
    expect(p.totalCents).toBe(90000 + 60000 + 5000 + 3000);
  });

  it("optimal : regroupe chez A pour éviter le port de B", () => {
    const p = optimalPlan(lines, suppliers);
    expect(p.assignment).toEqual({ ue: "A", ui: "A", support: "A", mo: null });
    expect(p.shippingCents).toBe(0);
    expect(p.totalCents).toBe(156000);
    expect(p.totalCents).toBeLessThan(perLinePlan(lines, suppliers).totalCents);
  });

  it("optimal : peut déplacer une ligne pour atteindre un franco", () => {
    const s: SupplierInfo[] = [
      {
        id: "A",
        name: "A",
        shipping: { feeCents: 5000, francoCents: 50000, tiers: [] },
      },
      {
        id: "B",
        name: "B",
        shipping: { feeCents: 5000, francoCents: 50000, tiers: [] },
      },
    ];
    const ls: ChoiceLine[] = [
      { key: "x", quantity: 1, offers: [{ supplierId: "A", netCents: 45000 }] },
      {
        key: "y",
        quantity: 1,
        offers: [
          { supplierId: "A", netCents: 6000 },
          { supplierId: "B", netCents: 5500 },
        ],
      },
    ];
    const p = optimalPlan(ls, s);
    expect(p.assignment).toEqual({ x: "A", y: "A" });
    expect(p.totalCents).toBe(51000);
  });

  it("tout chez X : les articles absents vont au moins cher ailleurs et sont signalés", () => {
    const ls: ChoiceLine[] = [
      ...lines,
      {
        key: "pompe",
        quantity: 1,
        offers: [{ supplierId: "A", netCents: 8000 }],
      },
    ];
    const p = allAtPlan(ls, suppliers, "B");
    expect(p.assignment.pompe).toBe("A");
    expect(p.missing).toEqual(["pompe"]);
    expect(p.assignment.ue).toBe("B");
  });

  it("une ligne forcée est toujours respectée", () => {
    const ls = lines.map((l) => (l.key === "ue" ? { ...l, forcedSupplierId: "B" } : l));
    expect(optimalPlan(ls, suppliers).assignment.ue).toBe("B");
    expect(allAtPlan(ls, suppliers, "A").assignment.ue).toBe("B");
    // Fournisseur forcé sans tarif pour l'article : ignoré
    const bad = lines.map((l) => (l.key === "ue" ? { ...l, forcedSupplierId: "Z" } : l));
    expect(optimalPlan(bad, suppliers).assignment.ue).toBe("A");
  });

  it("scénarios : retenu = optimal par défaut, ou « tout chez X » imposé", () => {
    const sc = supplierScenarios(lines, suppliers);
    expect(sc.retainedMode).toBe("optimal");
    expect(sc.retained.totalCents).toBe(sc.optimal.totalCents);
    expect(sc.allAt.map((x) => x.supplierId)).toEqual(["A", "B"]);
    const forced = supplierScenarios(lines, suppliers, "B");
    expect(forced.retainedMode).toBe("all_at");
    expect(forced.retained.assignment.ue).toBe("B");
    expect(forced.retained.totalCents).toBe(92000 + 62000 + 5000);
  });

  it("le prix client ne dépend pas du fournisseur : seule la marge change, port compris", () => {
    const settings = {
      vatRegime: "assujetti" as const,
      laborChargesRate: 0.2,
      materialChargesRate: 0.1,
      targetMarginPerDayCents: 0,
    };
    const sale = {
      id: "l",
      kind: "material" as const,
      designation: "Groupe",
      quantity: 1,
      unit: "u",
      unitSaleCents: 200000,
      vatRate: 0.1,
    };
    const a = computeQuote({
      lines: [{ ...sale, unitPurchaseCents: 90000 }],
      laborDays: 1,
      settings,
    });
    const b = computeQuote({
      lines: [{ ...sale, unitPurchaseCents: 92000 }],
      laborDays: 1,
      settings,
      shippingCostCents: 3000,
    });
    expect(a.totalTtcCents).toBe(b.totalTtcCents);
    expect(a.margin.netMarginCents - b.margin.netMarginCents).toBe(2000 + 3000);
    expect(b.margin.shippingCostCents).toBe(3000);
  });
});

describe("tarif ancien", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  it("plus de 12 mois sans mise à jour (seuil par défaut, réglable)", () => {
    expect(isTariffStale("2025-11-10T00:00:00Z", now)).toBe(true);
    expect(isTariffStale("2025-11-20T00:00:00Z", now)).toBe(false);
    expect(isTariffStale("2026-05-10T00:00:00Z", now, 6)).toBe(true);
    expect(isTariffStale(null, now)).toBe(true);
  });
});

describe("bons de commande", () => {
  const supplier = {
    id: "A",
    name: "Clim Distribution Sud",
    agency: "Mérignac",
    contactName: null,
    email: null,
    phone: null,
  };
  const base = {
    quoteNumber: "D-2026-012",
    clientName: "M. Martin",
    siteCity: "Pessac",
    delivery: "depot" as const,
    depotAddress: {
      line: "10 rue des Artisans",
      postalCode: "33700",
      city: "Mérignac",
    },
    siteAddress: {
      line: "3 allée des Pins",
      postalCode: "33600",
      city: "Pessac",
    },
    desiredDate: "2026-11-20",
    generatedAt: new Date("2026-11-15T09:00:00Z"),
    shippingBySupplier: { A: 2500 },
  };
  const lines = [
    {
      supplierId: "A",
      supplierRef: "CDS-123",
      manufacturerRef: "FTXM25R",
      designation: "Unité murale 2,5 kW",
      quantity: 2,
      unit: "u",
      unitNetCents: 41000,
    },
    {
      supplierId: "B",
      supplierRef: "X",
      manufacturerRef: "Y",
      designation: "Autre",
      quantity: 1,
      unit: "u",
      unitNetCents: 1000,
    },
    {
      supplierId: null,
      supplierRef: null,
      manufacturerRef: null,
      designation: "Pose",
      quantity: 1,
      unit: "forfait",
      unitNetCents: 0,
    },
  ];

  it("un bon par fournisseur, référence chantier sans prix client", () => {
    const [bc, ...rest] = buildPurchaseOrders(lines, [supplier], base);
    expect(rest).toHaveLength(0);
    expect(bc!.number).toBe("BC-D-2026-012-CDS");
    expect(bc!.siteReference).toBe("M. Martin – Pessac");
    expect(bc!.deliveryLabel).toBe("Livraison au dépôt");
    expect(bc!.deliveryAddress).toBe("10 rue des Artisans, 33700 Mérignac");
    expect(bc!.lines).toHaveLength(1);
    expect(bc!.subtotalCents).toBe(82000);
    expect(bc!.totalCents).toBe(84500);
    expect(JSON.stringify(bc)).not.toContain("unitSaleCents");
  });

  it("livraison sur chantier", () => {
    const [bc] = buildPurchaseOrders(lines, [supplier], {
      ...base,
      delivery: "chantier",
    });
    expect(bc!.deliveryAddress).toBe("3 allée des Pins, 33600 Pessac");
  });

  it("date souhaitée et référence chantier", () => {
    const today = new Date("2026-11-15T09:00:00Z");
    expect(validateDesiredDate("2026-11-20", today)).toBeNull();
    expect(validateDesiredDate("2026-11-01", today)).not.toBeNull();
    expect(validateDesiredDate("20/11/2026", today)).not.toBeNull();
    expect(validateDesiredDate(null, today)).toBeNull();
    expect(siteReference("Mme Durand ", null)).toBe("Mme Durand");
  });
});
