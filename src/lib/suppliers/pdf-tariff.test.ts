import { describe, expect, it } from "vitest";
import { buildPlan, normalizeAccessoryRows, normalizeMaterialRows, projectRows, validateMapping } from "@/lib/catalog/import";
import { checkPdfQuota, chunkPages, ExtractionSchema, formatPages, parsePageSelection, reviewRowsToTable, reviewWarnings, type ReviewRow } from "./pdf-tariff";

const row = (r: Partial<ReviewRow>): ReviewRow => ({
  page: 1,
  sourcePage: 3,
  keep: true,
  reference: "FTXM25R",
  designation: "Unité murale 2,5 kW",
  brand: "Daikin",
  supplier_ref: "D-123",
  ean: null,
  product_type: "Murale",
  cooling_kw: 2.5,
  heating_kw: 3.2,
  public_price_eur: 812.5,
  net_price_eur: null,
  discount_percent: 38,
  discount_family: "MURAUX R32",
  unit: null,
  ...r,
});

describe("sélection des pages", () => {
  it("lit les plages et les pages isolées", () => {
    expect(parsePageSelection("1-4, 7", 10)).toEqual({
      pages: [1, 2, 3, 4, 7],
    });
    expect(parsePageSelection("7;3-4;4", 10)).toEqual({ pages: [3, 4, 7] });
    expect(parsePageSelection("", 3)).toEqual({ pages: [1, 2, 3] });
  });
  it("refuse les pages hors du document ou illisibles", () => {
    expect(parsePageSelection("9-12", 10)).toHaveProperty("error");
    expect(parsePageSelection("abc", 10)).toHaveProperty("error");
    expect(parsePageSelection("4-2", 10)).toHaveProperty("error");
  });
  it("clé de mémoire et lots de 5 pages", () => {
    expect(formatPages([7, 1, 2, 3, 4, 9, 10])).toBe("1-4,7,9-10");
    expect(chunkPages([1, 2, 3, 4, 5, 6, 7])).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
  });
});

describe("quota de pages PDF", () => {
  it("autorise dans la limite et annonce le reste", () => {
    expect(checkPdfQuota(20, 250, 300)).toMatchObject({
      allowed: true,
      remainingBefore: 50,
      remainingAfter: 30,
    });
  });
  it("refuse au-delà et propose l'import Excel / CSV", () => {
    const q = checkPdfQuota(60, 250, 300);
    expect(q.allowed).toBe(false);
    expect(q.message).toContain("Excel / CSV");
  });
});

describe("schéma d'extraction", () => {
  it("accepte une réponse conforme, refuse une réponse incomplète", () => {
    const ok = {
      rows: [{ ...row({}), sourcePage: undefined, keep: undefined }],
    };
    expect(ExtractionSchema.safeParse(ok).success).toBe(true);
    expect(ExtractionSchema.safeParse({ rows: [{ reference: "X" }] }).success).toBe(false);
  });
  it("signale les lignes douteuses", () => {
    expect(reviewWarnings(row({ public_price_eur: null }))).toContain("aucun prix");
    expect(reviewWarnings(row({ net_price_eur: 900 }))).toContain("prix net supérieur au prix public");
    expect(reviewWarnings(row({}))).toEqual([]);
  });
});

describe("lignes validées → import classique", () => {
  it("matériel : passe par la même lecture, les mêmes contrôles et le même plan", () => {
    const { table, mapping } = reviewRowsToTable([row({}), row({ reference: "IGNORÉE", keep: false })], "materiel");
    expect(table).toHaveLength(2);
    expect(validateMapping(mapping, "materiel", {})).toEqual([]);
    const { rows, errors } = normalizeMaterialRows(projectRows(table, 0, mapping), {});
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      brand: "Daikin",
      reference: "FTXM25R",
      type: "ui_murale",
      cooling_kw: 2.5,
      public_price_cents: 81250,
      discount_rate: 0.38,
      supplier_ref: "D-123",
      discount_family: "MURAUX R32",
    });
    const plan = buildPlan("materiel", rows, [], []);
    expect(plan.creates).toHaveLength(1);
  });
  it("accessoires : prix net seul", () => {
    const { table, mapping } = reviewRowsToTable(
      [
        row({
          reference: "CAROT",
          designation: "Carottage",
          public_price_eur: null,
          net_price_eur: 18,
          discount_percent: null,
          unit: "u",
        }),
      ],
      "accessoires",
    );
    const { rows, errors } = normalizeAccessoryRows(projectRows(table, 0, mapping), {});
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      name: "Carottage",
      public_price_cents: null,
      net_price_cents: 1800,
    });
  });
});
