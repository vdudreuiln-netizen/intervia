import { describe, expect, it } from "vitest";
import { parseDecimal } from "@/lib/format";
import { buildPlan, detectHeaderRow, errorReportCsv, guessMapping, normalizeAccessoryRows, normalizeMaterialRows, parseCsv, parsePackaging, parsePriceCents, projectRows, validateMapping } from "./import";
import { priceSourceText, resolvePublicPrice } from "./reference";

describe("fichiers français", () => {
  it("virgule décimale, séparateurs de milliers, symbole €, espaces insécables", () => {
    expect(parsePriceCents("1 234,56 €")).toBe(123456);
    expect(parsePriceCents("1 234,56 € HT")).toBe(123456);
    expect(parsePriceCents("1.234,56")).toBe(123456);
    expect(parsePriceCents("1,234.56")).toBe(123456);
    expect(parsePriceCents("12,5")).toBe(1250);
    expect(parseDecimal("0,35")).toBe(0.35);
  });
  it("CSV point-virgule avec accents et guillemets", () => {
    const csv = "﻿Référence;Désignation;Famille;Unité;Prix HT\r\nLIA-1438;\"Couronne cuivre 1/4\"\" 3/8\"\"\";Liaisons frigorifiques;couronne de 25 m;212,50 €\r\n";
    const table = parseCsv(csv);
    expect(table[0]).toEqual(["Référence", "Désignation", "Famille", "Unité", "Prix HT"]);
    expect(table[1]![1]).toBe('Couronne cuivre 1/4" 3/8"');
  });
});

describe("unité et conditionnement : prix ramené à l'unité", () => {
  it("reconnaît pièce, mètre, couronne, boîte, kilo", () => {
    expect(parsePackaging("pièce")).toMatchObject({ unit: "u", packQty: 1 });
    expect(parsePackaging("le mètre")).toMatchObject({ unit: "m", packQty: 1 });
    expect(parsePackaging("ml")).toMatchObject({ unit: "m", packQty: 1 });
    expect(parsePackaging("Couronne de 25 m")).toMatchObject({ unit: "m", packQty: 25, label: "Couronne de 25 m" });
    expect(parsePackaging("C25m")).toMatchObject({ unit: "m", packQty: 25 });
    expect(parsePackaging("Rouleau 50 ML")).toMatchObject({ unit: "m", packQty: 50 });
    expect(parsePackaging("Boîte de 100")).toMatchObject({ unit: "u", packQty: 100 });
    expect(parsePackaging("seau 5 kg")).toMatchObject({ unit: "kg", packQty: 5 });
    expect(parsePackaging("couronne", 25)).toMatchObject({ unit: "u", packQty: 25 });
    expect(parsePackaging("m", "50")).toMatchObject({ unit: "m", packQty: 50 });
    expect(parsePackaging("", "")).toMatchObject({ unit: "u", packQty: 1 });
    expect(parsePackaging("boîte", "-3")).toBe("invalid");
  });
  it("couronne de 25 m à 212,50 € → 8,50 €/m (public et net)", () => {
    const { rows, errors } = normalizeAccessoryRows(
      [{ line: 2, cells: { reference: "LIA-1438", name: "Couronne cuivre 1/4 3/8", unit: "couronne de 25 m", public_price: "212,50 €", net_price: "127,50" } }],
      {},
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ unit: "m", pack_qty: 25, pack_label: "couronne de 25 m", public_price_cents: 850, net_price_cents: 510 });
  });
});

describe("case « prix publics » / « prix nets » du fichier", () => {
  const cells = { reference: "GOU-60", name: "Goulotte 60x45", unit: "barre de 2 m", public_price: "18,00" };
  it("prix publics : la colonne Prix HT est un prix public", () => {
    expect(normalizeAccessoryRows([{ line: 2, cells }], { priceKind: "public" }).rows[0]).toMatchObject({ public_price_cents: 900, net_price_cents: null, unit: "m" });
  });
  it("prix nets : la même colonne est un prix net (utilisé tel quel, sans remise)", () => {
    expect(normalizeAccessoryRows([{ line: 2, cells }], { priceKind: "net" }).rows[0]).toMatchObject({ public_price_cents: null, net_price_cents: 900 });
  });
  it("matériel en prix nets : une référence inconnue n'est pas créée sans prix public", () => {
    const { rows } = normalizeMaterialRows([{ line: 2, cells: { reference: "RXM35R", public_price: "520,00" } }], { brand: "Daikin", type: "ue_mono", priceKind: "net" });
    expect(rows[0]).toMatchObject({ public_price_cents: null, net_price_cents: 52000 });
    const plan = buildPlan("materiel", rows, [], ["Daikin"]);
    expect(plan.creates).toHaveLength(0);
    expect(plan.errors[0]!.message).toContain("prix public inconnu");
    const known = buildPlan("materiel", rows, [{ id: "p1", brand: "Daikin", reference: "RXM35R", label: "Daikin RXM35R", offer: { public_price_cents: 100000, net_price_cents: null, discount_rate: null, match_status: "certain" } }], ["Daikin"]);
    expect(known.offers[0]).toMatchObject({ item_id: "p1", net_price_cents: 52000, public_price_cents: null });
  });
});

describe("champs reconnus, doublons, rapport d'erreurs", () => {
  it("référence, désignation, marque, famille, prix, unité, quantité par conditionnement", () => {
    const m = guessMapping(["Réf. fabricant", "Libellé", "Marque", "Famille", "Prix unitaire HT", "Unité de vente", "Colisage"], "accessoires");
    expect(m).toMatchObject({ name: "Libellé", brand: "Marque", discount_family: "Famille", public_price: "Prix unitaire HT", unit: "Unité de vente", pack_qty: "Colisage" });
  });
  it("famille de clim sans colonne type : le type est lu dans la famille", () => {
    const table = [["Référence", "Famille", "Prix public"], ["FTXM35R", "Unité murale", "780,00"], ["RXM35R", "Groupe extérieur mono", "1 040,00"]];
    const mapping = guessMapping(table[0]!, "materiel");
    expect(validateMapping(mapping, "materiel", { brand: "Daikin" })).toEqual([]);
    const { rows, errors } = normalizeMaterialRows(projectRows(table, detectHeaderRow(table, "materiel"), mapping), { brand: "Daikin" });
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.type, r.discount_family, r.public_price_cents])).toEqual([
      ["ui_murale", "Unité murale", 78000],
      ["ue_mono", "Groupe extérieur mono", 104000],
    ]);
  });
  it("doublon par référence fabricant : mise à jour, pas de création en double", () => {
    const { rows } = normalizeAccessoryRows(
      [
        { line: 2, cells: { reference: "lia 1438", name: "Couronne", public_price: "212,50", unit: "C25m" } },
        { line: 3, cells: { reference: "LIA-9999", name: "Nouvelle", public_price: "10" } },
        { line: 4, cells: { reference: "LIA-9999", name: "Nouvelle bis", public_price: "11" } },
      ],
      {},
    );
    const plan = buildPlan("accessoires", rows, [{ id: "a1", reference: "LIA1438", label: "LIA1438 – Couronne", offer: { public_price_cents: 800, net_price_cents: null, discount_rate: null, match_status: "certain" } }], []);
    expect(plan.offers.map((o) => o.item_id)).toEqual(["a1"]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.errors.map((e) => e.line)).toEqual([4]);
    expect(plan.summary).toMatchObject({ newItems: 1, priceChanges: 1, errors: 1 });
  });
  it("rapport d'erreurs CSV ouvrable dans Excel", () => {
    const csv = errorReportCsv("tarif.csv", [{ line: 4, message: "référence en double; ligne ignorée" }], new Map([[4, { reference: "LIA-9999", name: "Nouvelle bis" }]]));
    expect(csv.startsWith("﻿Fichier;Ligne;Référence;Désignation;Erreur\r\n")).toBe(true);
    expect(csv).toContain('tarif.csv;4;LIA-9999;Nouvelle bis;"référence en double; ligne ignorée"');
  });
});

describe("priorité des prix publics et source affichée", () => {
  it("tarif commun publié > tarif personnel le plus récent ; source et date", () => {
    expect(resolvePublicPrice({ cents: 104000, date: "2027-01-01" }, { cents: 99000, supplierId: "s1", date: "2027-02-01", origin: "import" })).toEqual({ cents: 104000, source: "commun", date: "2027-01-01", supplierId: null });
    expect(resolvePublicPrice(null, { cents: 99000, supplierId: "s1", date: "2026-11-12", origin: "manuel" })).toMatchObject({ source: "manuel" });
    expect(resolvePublicPrice(null, null)).toBeNull();
    expect(priceSourceText("personnel", "2026-03-01")).toBe("Tarif importé du 01/03/2026");
    expect(priceSourceText("manuel", "2026-11-12")).toBe("Saisi à la main le 12/11/2026");
    expect(priceSourceText("commun", "2027-01-01")).toBe("Tarif commun du 01/01/2027");
  });
});
