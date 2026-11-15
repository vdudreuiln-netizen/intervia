import { describe, expect, it } from "vitest";
import {
  buildPlan,
  detectHeaderRow,
  guessMapping,
  normalizeAccessoryRows,
  normalizeMaterialRows,
  parseCsv,
  parseDiscount,
  parseKw,
  parsePriceCents,
  parseProductType,
  projectRows,
  templateCsv,
  validateMapping,
  type ExistingItem,
} from "./import";

describe("lecture CSV", () => {
  it("séparateur « ; », BOM, guillemets et retours Windows", () => {
    const rows = parseCsv('﻿Réf;Désignation;Prix\r\nA1;"Support ; mural";45,50\r\nA2;"Dit ""pro""";12\r\n\r\n');
    expect(rows).toEqual([
      ["Réf", "Désignation", "Prix"],
      ["A1", "Support ; mural", "45,50"],
      ["A2", 'Dit "pro"', "12"],
    ]);
  });
  it("détecte la virgule comme séparateur", () => {
    expect(parseCsv("a,b,c\n1,2,3")[1]).toEqual(["1", "2", "3"]);
  });
  it("le modèle téléchargeable se relit et se mappe tout seul", () => {
    const table = parseCsv(templateCsv("materiel"));
    const header = detectHeaderRow(table, "materiel");
    expect(header).toBe(0);
    const mapping = guessMapping(table[0]!, "materiel");
    expect(validateMapping(mapping, "materiel", {})).toEqual([]);
    const { rows, errors } = normalizeMaterialRows(projectRows(table, header, mapping), {});
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ brand: "MaMarque", reference: "UE-35", type: "ue_mono", cooling_kw: 3.5, public_price_cents: 109000, discount_rate: 0.35, link_diameters: "1/4 - 3/8", precharged_length_m: 7.5, extra_charge_g_per_m: 20 });
    expect(rows[1]!.discount_rate).toBeNull();
  });
});

describe("détection de l'en-tête", () => {
  it("ignore le titre et la date au-dessus du tableau", () => {
    const table = [
      ["TARIF CLIMATISATION 2026", null, null],
      ["Valable au 01/01/2026", null, null],
      [null, null, null],
      ["Code article", "Désignation", "Famille", "PPI"],
      ["X1", "Murale 2,5", "Mural", 460],
    ];
    expect(detectHeaderRow(table, "materiel")).toBe(3);
  });
});

describe("correspondance des colonnes", () => {
  it("reconnaît les intitulés usuels des tarifs", () => {
    const m = guessMapping(["Fabricant", "Code article", "Famille", "Puissance frigorifique", "PPI", "Remise %"], "materiel");
    expect(m).toEqual({ brand: "Fabricant", reference: "Code article", type: "Famille", cooling_kw: "Puissance frigorifique", public_price: "PPI", discount: "Remise %" });
  });
  it("réutilise la correspondance mémorisée du fournisseur", () => {
    const m = guessMapping(["Col A", "Col B", "Tarif"], "materiel", { reference: "Col B", brand: "Supprimée" });
    expect(m.reference).toBe("Col B");
    expect(m.brand).toBeUndefined(); // la colonne mémorisée n'existe plus
    expect(m.public_price).toBe("Tarif");
  });
  it("signale les colonnes obligatoires manquantes et les doublons", () => {
    expect(validateMapping({ reference: "A" }, "materiel", {})).toHaveLength(3);
    expect(validateMapping({ reference: "A", public_price: "A" }, "materiel", { brand: "X", type: "ue_mono" })).toEqual(["Une même colonne est utilisée pour deux informations"]);
  });
});

describe("conversion des cellules", () => {
  it.each([
    ["1 234,56 €", 123456],
    [1234.56, 123456],
    ["460", 46000],
    ["45,5 HT", 4550],
  ])("prix %s", (cell, cents) => expect(parsePriceCents(cell)).toBe(cents));
  it("prix illisible", () => expect(parsePriceCents("sur devis")).toBeNull());

  it.each([
    ["35 %", 0.35],
    ["35", 0.35],
    [35, 0.35],
    [0.35, 0.35], // cellule Excel au format pourcentage
    ["42,5", 0.425],
    ["", null],
    [null, null],
  ])("remise %s", (cell, rate) => expect(parseDiscount(cell)).toBe(rate));
  it("remise absurde", () => {
    expect(parseDiscount("120 %")).toBe("invalid");
    expect(parseDiscount("abc")).toBe("invalid");
  });

  it.each([
    ["3,5 kW", 3.5],
    [3.5, 3.5],
    ["3500 W", 3.5],
    [7100, 7.1],
    ["", null],
  ])("puissance %s", (cell, kw) => expect(parseKw(cell)).toBe(kw));

  it.each([
    ["Unité extérieure mono-split", "ue_mono"],
    ["Groupe extérieur", "ue_mono"],
    ["UE multi 3 sorties", "ue_multi"],
    ["Murale", "ui_murale"],
    ["Console allège", "ui_console"],
    ["Cassette 600x600", "ui_cassette"],
    ["Gainable basse pression", "ui_gainable"],
    ["ui_murale", "ui_murale"],
    ["Pompe à chaleur air-eau", null],
  ])("type « %s »", (cell, type) => expect(parseProductType(cell)).toBe(type));
});

describe("normalisation des lignes", () => {
  it("applique marque et type par défaut, signale les lignes en erreur", () => {
    const { rows, errors } = normalizeMaterialRows(
      [
        { line: 2, cells: { reference: "A1", public_price: "100" } },
        { line: 3, cells: { reference: "", public_price: "abc" } },
        { line: 4, cells: { reference: "A3", public_price: "100", type: "Pompe à chaleur air-eau" } },
      ],
      { brand: "Atlas", type: "ui_murale" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ brand: "Atlas", type: "ui_murale" });
    expect(errors.map((e) => e.line)).toEqual([3, 4]);
    expect(errors[0]!.message).toContain("référence manquante");
    expect(errors[1]!.message).toContain("type d'unité non reconnu");
  });
  it("accessoires : unité et catégorie", () => {
    const { rows } = normalizeAccessoryRows([{ line: 2, cells: { reference: "L1", name: "Liaison", public_price: "12", unit: "ml" } }], { category: "liaison" });
    expect(rows[0]).toMatchObject({ unit: "m", category: "liaison", discount_rate: null });
  });
});

describe("plan d'import (multi-fournisseurs)", () => {
  const offer = (public_price_cents: number, discount_rate: number | null = null) => ({
    public_price_cents,
    net_price_cents: null,
    discount_rate,
    match_status: "certain" as const,
  });
  const existing: ExistingItem[] = [
    {
      id: "p1",
      brand: "Atlas",
      reference: "UE-35",
      label: "Atlas UE-35",
      offer: offer(100000, 0.4),
    }, // remise saisie à la main
    {
      id: "p2",
      brand: "Atlas",
      reference: "MU-35",
      label: "Atlas MU-35",
      offer: offer(50000),
    },
    {
      id: "p3",
      brand: "Atlas",
      reference: "MU-25",
      label: "Atlas MU-25",
      offer: offer(40000),
    },
    {
      id: "p4",
      brand: "Atlas",
      reference: "MSZ-AP25VG",
      label: "Atlas MSZ-AP25VG",
      offer: null,
    }, // au catalogue, pas chez ce fournisseur
    {
      id: "p5",
      brand: "Atlas",
      reference: "CO-50",
      label: "Atlas CO-50",
      ean: "3700000000017",
      offer: null,
    },
  ];
  const row = (line: number, reference: string, price: number, discount: number | null = null, brand = "Atlas", extra: Record<string, unknown> = {}) => ({
    line,
    link_diameters: null,
    precharged_length_m: null,
    extra_charge_g_per_m: null,
    brand,
    reference,
    type: "ue_mono" as const,
    range_name: null,
    cooling_kw: null,
    heating_kw: null,
    max_outlets: null,
    public_price_cents: price,
    discount_rate: discount,
    supplier_ref: null,
    ean: null,
    discount_family: null,
    net_price_cents: null,
    ...extra,
  });

  const plan = buildPlan(
    "materiel",
    [
      row(2, "ue-35", 108000), // +8 %, remise absente du fichier
      row(3, "MU-35", 51000, 0.3), // +2 %, remise fournie
      row(4, "MU-25", 40000), // inchangé
      row(5, "GA-50", 139000), // nouveau
      row(6, "GA-50", 140000), // doublon dans le fichier
      row(7, "X-1", 9900, null, "ATLAS"), // nouvelle référence, marque écrite autrement
      row(8, "Z-1", 9900, null, "Borée"), // nouvelle marque
      row(10, "MSZ-AP25VGK", 70000), // suffixe en plus : probable
      row(11, "AUTRE-REF", 80000, null, "Atlas", {
        ean: "3700000000017",
        supplier_ref: "S-11",
      }), // même EAN : certain
    ],
    existing,
    ["Atlas"],
    [{ line: 9, message: "prix illisible" }],
  );

  it("offres pour les articles existants, créations pour les nouveaux (référence insensible à la casse)", () => {
    expect(plan.offers.map((o) => o.item_id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(plan.creates.map((c) => c.reference)).toEqual(["GA-50", "X-1", "Z-1"]);
    expect((plan.creates[0]!.offer as { public_price_cents: number }).public_price_cents).toBe(139000);
  });
  it("ne touche pas à la remise saisie à la main si le fichier n'en contient pas", () => {
    expect("discount_rate" in plan.offers.find((o) => o.item_id === "p1")!).toBe(false);
    expect(plan.offers.find((o) => o.item_id === "p2")!.discount_rate).toBe(0.3);
  });
  it("EAN identique = correspondance certaine ; suffixe différent = probable, à confirmer", () => {
    expect(plan.offers.find((o) => o.item_id === "p5")).toMatchObject({
      match_status: "certain",
      supplier_ref: "S-11",
      manufacturer_ref: "AUTRE-REF",
    });
    expect(plan.offers.find((o) => o.item_id === "p4")!.match_status).toBe("probable");
    expect(plan.probable).toEqual([
      {
        line: 10,
        label: "Atlas MSZ-AP25VGK",
        candidateId: "p4",
        candidateLabel: "Atlas MSZ-AP25VG",
      },
    ]);
  });
  it("résumé : prix modifiés, nouveaux articles, nouveaux chez ce fournisseur, probables", () => {
    expect(plan.summary).toEqual({
      newItems: 3,
      newOffers: 1,
      probable: 1,
      priceChanges: 2,
      bigIncreases: 1,
      decreases: 0,
      discountChanges: 1,
      unchanged: 1,
      errors: 2,
    });
    expect(plan.priceChanges[0]).toMatchObject({
      id: "p1",
      oldPriceCents: 100000,
      newPriceCents: 108000,
    });
    expect(plan.priceChanges[0]!.change).toBeCloseTo(0.08);
  });
  it("réutilise l'orthographe de la marque existante et crée les nouvelles", () => {
    expect(plan.creates.find((c) => c.reference === "X-1")!.brand).toBe("Atlas");
    expect(plan.brandsToCreate).toEqual([{ name: "Borée" }]);
  });
  it("signale les doublons du fichier et garde les erreurs de lecture", () => {
    expect(plan.errors.map((e) => e.line)).toEqual([6, 9]);
  });
  it("une hausse d'exactement 5 % n'est pas comptée comme forte hausse", () => {
    const p = buildPlan("materiel", [row(2, "MU-25", 42000)], existing, ["Atlas"]);
    expect(p.summary.bigIncreases).toBe(0);
    expect(p.summary.priceChanges).toBe(1);
  });
  it("deux lignes du fichier ne peuvent pas viser le même article", () => {
    const p = buildPlan("materiel", [row(2, "UE-35", 1000), row(3, "UE35", 1000)], existing, ["Atlas"]);
    expect(p.offers).toHaveLength(1);
    expect(p.errors.map((e) => e.line)).toEqual([3]);
  });
});

describe("colonnes fournisseur", () => {
  it("lit code fournisseur, EAN, famille de remise (gamme à défaut) et prix net", () => {
    const { rows, errors } = normalizeMaterialRows(
      [
        {
          line: 2,
          cells: {
            reference: "UE",
            brand: "A",
            type: "ue_mono",
            public_price: "1000",
            supplier_ref: "F-1",
            ean: "3 700000 000017",
            discount_family: "UE MONO",
            net_price: "520,50",
          },
        },
        {
          line: 3,
          cells: {
            reference: "U2",
            brand: "A",
            type: "ue_mono",
            public_price: "1000",
            range_name: "Confort",
          },
        },
        {
          line: 4,
          cells: {
            reference: "U3",
            brand: "A",
            type: "ue_mono",
            public_price: "1000",
            net_price: "sur demande",
          },
        },
      ],
      {},
    );
    expect(errors.map((e) => e.line)).toEqual([4]);
    expect(rows[0]).toMatchObject({
      supplier_ref: "F-1",
      ean: "3700000000017",
      discount_family: "UE MONO",
      net_price_cents: 52050,
    });
    expect(rows[1]!.discount_family).toBe("Confort");
  });
  it("accessoires : prix public OU prix net", () => {
    const { rows, errors } = normalizeAccessoryRows(
      [
        {
          line: 2,
          cells: { reference: "C", name: "Carottage", net_price: "18" },
        },
        { line: 3, cells: { reference: "D", name: "Sans prix" } },
      ],
      {},
    );
    expect(rows[0]).toMatchObject({
      public_price_cents: null,
      net_price_cents: 1800,
    });
    expect(errors.map((e) => e.line)).toEqual([3]);
    expect(validateMapping({ reference: "R", name: "N" }, "accessoires", {})).toContain("Choisissez la colonne « Prix public HT » ou « Prix net HT »");
    expect(validateMapping({ reference: "R", name: "N", net_price: "Net" }, "accessoires", {})).toEqual([]);
  });
  it("reconnaît les intitulés fournisseur", () => {
    const m = guessMapping(["Réf. fabricant", "Code fournisseur", "Gencod", "Famille de remise", "Prix public HT", "Prix net HT", "Désignation"], "accessoires");
    expect(m).toMatchObject({
      supplier_ref: "Code fournisseur",
      ean: "Gencod",
      discount_family: "Famille de remise",
      public_price: "Prix public HT",
      net_price: "Prix net HT",
      name: "Désignation",
    });
  });
});

describe("champs techniques à l'import", () => {
  it("lit diamètres, longueur pré-chargée et g/m ; les met à jour au réimport", () => {
    const { rows, errors } = normalizeMaterialRows(
      [
        { line: 2, cells: { reference: "UE", brand: "A", type: "ue_mono", public_price: "1000", link_diameters: '1/4"-3/8"', precharged_length_m: "15 m", extra_charge_g_per_m: "20 g/m" } },
        { line: 3, cells: { reference: "X", brand: "A", type: "ue_mono", public_price: "1000", link_diameters: "6 mm" } },
      ],
      {},
    );
    expect(errors.map((e) => e.line)).toEqual([3]);
    expect(rows[0]).toMatchObject({
      link_diameters: '1/4" - 3/8"',
      precharged_length_m: 15,
      extra_charge_g_per_m: 20,
    });
    const plan = buildPlan("materiel", rows, [{ id: "p", brand: "A", reference: "UE", label: "A UE", offer: null }], ["A"]);
    expect(plan.updates[0]).toMatchObject({
      link_diameters: '1/4" - 3/8"',
      precharged_length_m: 15,
      extra_charge_g_per_m: 20,
    });
  });
});
