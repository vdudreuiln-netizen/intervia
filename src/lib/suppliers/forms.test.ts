import { describe, expect, it } from "vitest";
import { familyRows, parseDiscountEntries, parseSupplierForm, shippingLabel, supplierToForm } from "./forms";

const base = supplierToForm({ name: "Clim Distribution" });

describe("fiche fournisseur", () => {
  it("valeurs par défaut : port offert, pas de franco", () => {
    const r = parseSupplierForm(base);
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({
      name: "Clim Distribution",
      shipping_fee_cents: 0,
      franco_cents: null,
      shipping_tiers: [],
      agency: null,
    });
  });
  it("« 25 € sous un franco de 500 € HT » avec paliers triés", () => {
    const r = parseSupplierForm({
      ...base,
      shipping_fee: "25",
      franco: "500",
      tiers: [
        { from: "300", fee: "10" },
        { from: "150", fee: "18,50" },
        { from: "", fee: "" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.values.shipping_tiers).toEqual([
      { fromCents: 15000, feeCents: 1850 },
      { fromCents: 30000, feeCents: 1000 },
    ]);
    expect(
      shippingLabel({
        feeCents: r.values.shipping_fee_cents,
        francoCents: r.values.franco_cents,
        tiers: r.values.shipping_tiers,
      }),
    ).toContain("franco à 500");
  });
  it("erreurs : nom, e-mail, montants, paliers en double", () => {
    const r = parseSupplierForm({
      ...base,
      name: " ",
      email: "pas-un-mail",
      franco: "-5",
      tiers: [{ from: "100", fee: "x" }],
    });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["email", "franco", "name", "tiers"]);
    expect(
      parseSupplierForm({
        ...base,
        tiers: [
          { from: "100", fee: "5" },
          { from: "100", fee: "3" },
        ],
      }).errors.tiers,
    ).toBeDefined();
  });
  it("aller-retour formulaire", () => {
    const v = parseSupplierForm({
      ...base,
      shipping_fee: "19,90",
      franco: "450",
      tiers: [{ from: "200", fee: "9" }],
    }).values;
    expect(parseSupplierForm(supplierToForm(v)).values).toEqual(v);
  });
});

describe("remises en masse", () => {
  it("vide = retirer la remise, sinon 0 à 99 %", () => {
    const r = parseDiscountEntries([
      { key: "b1", rate: "35" },
      { key: "b2", rate: "" },
      { key: "b3", rate: "120" },
      { key: "b4", rate: "42,5" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual({ b3: "Remise entre 0 et 99 %" });
    expect(r.changes).toEqual([
      { key: "b1", rate: 0.35 },
      { key: "b2", rate: null },
      { key: "b4", rate: 0.425 },
    ]);
  });
  it("familles : une seule entrée par famille normalisée", () => {
    expect(
      familyRows([
        { key: "Muraux R32", rate: 0.3 },
        { key: "MURAUX  r32", rate: 0.32 },
      ]),
    ).toEqual([{ family: "MURAUX  r32", family_key: "MURAUX R32", rate: 0.32 }]);
  });
});
