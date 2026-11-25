import { describe, expect, it } from "vitest";
import { applyEdits, hasEdits, recordOverride, recordRemoval, type KeyedLine } from "./edits";

const line = (key: string, sale: number): KeyedLine => ({ key, id: key, kind: "accessory", designation: key, quantity: 2, unit: "u", unitPurchaseCents: 100, unitSaleCents: sale, vatRate: 0.1 });

describe("retouches réappliquées après regénération", () => {
  it("prix modifié et ligne supprimée sont conservés", () => {
    let e = recordOverride(undefined, "goulotte:i1", { unitSaleCents: 2500 });
    e = recordRemoval(e, "pompe:i1");
    const out = applyEdits([line("goulotte:i1", 1960), line("pompe:i1", 15000), line("disj:s1", 3600)], e);
    expect(out.map((l) => [l.key, l.unitSaleCents])).toEqual([
      ["goulotte:i1", 2500],
      ["disj:s1", 3600],
    ]);
  });
  it("supprimer une ligne retire aussi sa retouche de prix", () => {
    const e = recordRemoval(recordOverride(undefined, "a", { unitSaleCents: 1 }), "a");
    expect(e).toEqual({ overrides: {}, removed: ["a"] });
  });
  it("retouches cumulées sur une même ligne", () => {
    const e = recordOverride(recordOverride(undefined, "mo", { unitSaleCents: 90000 }), "mo", { quantity: 1, unit: "forfait" });
    expect(e.overrides.mo).toEqual({ unitSaleCents: 90000, quantity: 1, unit: "forfait" });
  });
  it("détection des retouches (y compris lignes libres)", () => {
    expect(hasEdits(undefined, 0)).toBe(false);
    expect(hasEdits(undefined, 1)).toBe(true);
    expect(hasEdits(recordRemoval(undefined, "x"), 0)).toBe(true);
  });
});

import { parseDecimal, parseEuros, parsePercent } from "@/lib/format";
import { parseFreeLine } from "./edits";

describe("ligne libre", () => {
  const P = { euros: parseEuros, decimal: parseDecimal, percent: parsePercent };
  it("carottage : prix d'achat et de vente, prestation", () => {
    const r = parseFreeLine({ designation: "Carottage mur béton Ø 60", kind: "other", quantity: "1", unit: "u", purchase: "0", sale: "120", vatRate: "10" }, "assujetti", P);
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ unitPurchaseCents: 0, unitSaleCents: 12000, vatRate: 0.1, kind: "other" });
  });
  it("franchise : TVA ignorée ; erreurs de saisie", () => {
    expect(parseFreeLine({ designation: "X", kind: "material", quantity: "2", unit: "", purchase: "10", sale: "15", vatRate: "7" }, "franchise", P).values.vatRate).toBe(0);
    const bad = parseFreeLine({ designation: "", kind: "material", quantity: "0", unit: "", purchase: "-1", sale: "", vatRate: "" }, "franchise", P);
    expect(Object.keys(bad.errors).sort()).toEqual(["designation", "purchase", "quantity", "sale"]);
  });
});

import { LOSS_MESSAGE, lossLines, sellsAtLoss } from "./edits";

describe("aucune ligne vendue à perte", () => {
  const P = { euros: parseEuros, decimal: parseDecimal, percent: parsePercent };
  it("refuse une ligne libre dont la vente est sous le coût", () => {
    const r = parseFreeLine({ designation: "Support spécial", kind: "material", quantity: "1", unit: "u", purchase: "120", sale: "99", vatRate: "10" }, "assujetti", P);
    expect(r.ok).toBe(false);
    expect(r.errors.sale).toBe(LOSS_MESSAGE);
  });
  it("accepte vente = coût (marge nulle) et au-dessus", () => {
    expect(sellsAtLoss(12000, 12000)).toBe(false);
    expect(sellsAtLoss(11999, 12000)).toBe(true);
    expect(parseFreeLine({ designation: "X", kind: "material", quantity: "1", unit: "u", purchase: "120", sale: "120", vatRate: "10" }, "assujetti", P).ok).toBe(true);
  });
  it("repère les lignes passées sous le coût après remise", () => {
    const lines = [
      { id: "a", quantity: 1, netSaleCents: 9000, totalPurchaseCents: 10000 },
      { id: "b", quantity: 2, netSaleCents: 30000, totalPurchaseCents: 10000 },
      { id: "c", quantity: 0, netSaleCents: 0, totalPurchaseCents: 10000 },
    ];
    expect(lossLines(lines).map((l) => l.id)).toEqual(["a"]);
  });
});
