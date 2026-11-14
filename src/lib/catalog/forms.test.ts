import { describe, expect, it } from "vitest";
import { accessoryToForm, brandToForm, parseAccessoryForm, parseBrandForm, parseProductForm, productToForm } from "./forms";

describe("formulaire produit", () => {
  const base = { ...productToForm(), brand_id: "b1", reference: "UE-35", type: "ue_mono", cooling_kw: "3,5", public_price: "1090" };
  it("unité mono : 1 sortie, remise vide = remise de la marque", () => {
    const r = parseProductForm(base);
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ max_outlets: 1, discount_rate: null, public_price_cents: 109000, cooling_kw: 3.5 });
  });
  it("multi : sorties obligatoires, ratio 130 % par défaut ou saisi", () => {
    expect(parseProductForm({ ...base, type: "ue_multi" }).errors.max_outlets).toBeDefined();
    expect(parseProductForm({ ...base, type: "ue_multi", max_outlets: "3" }).values.max_indoor_ratio).toBe(1.3);
    expect(parseProductForm({ ...base, type: "ue_multi", max_outlets: "3", max_indoor_ratio: "150" }).values.max_indoor_ratio).toBe(1.5);
    expect(parseProductForm({ ...base, type: "ue_multi", max_outlets: "3", max_indoor_ratio: "250" }).errors.max_indoor_ratio).toBeDefined();
  });
  it("la puissance froid est exigée pour les unités", () => {
    expect(parseProductForm({ ...base, cooling_kw: "" }).errors.cooling_kw).toBeDefined();
  });
  it("aller-retour base → formulaire", () => {
    const f = productToForm({ brand_id: "b", reference: "R", type: "ue_multi", cooling_kw: 6.8, max_outlets: 3, max_indoor_ratio: 1.3, public_price_cents: 279000, discount_rate: 0.35 });
    expect(f).toMatchObject({ cooling_kw: "6,8", max_outlets: "3", max_indoor_ratio: "130", public_price: "2790", discount: "35" });
  });
});

describe("formulaire accessoire", () => {
  it("valide et convertit", () => {
    const r = parseAccessoryForm({ ...accessoryToForm(), category: "liaison", name: "Liaison", diameter: "1/4 - 3/8", unit: "m", public_price: "12", discount: "30" });
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ public_price_cents: 1200, discount_rate: 0.3, unit: "m" });
  });
  it("catégorie et prix obligatoires", () => {
    const r = parseAccessoryForm(accessoryToForm());
    expect(Object.keys(r.errors).sort()).toEqual(["category", "name", "public_price"]);
  });
});

describe("formulaire marque", () => {
  it("coefficient 1,10 et remise 35 %", () => {
    const r = parseBrandForm({ name: "Atlas", discount: "35", sale_coefficient: "1,10" });
    expect(r.values).toEqual({ name: "Atlas", discount_rate: 0.35, sale_coefficient: 1.1 });
  });
  it("valeurs par défaut", () => {
    expect(brandToForm()).toEqual({ name: "", discount: "0", sale_coefficient: "1" });
  });
});

describe("données techniques et rôle", () => {
  const base = { ...productToForm(), brand_id: "b1", reference: "UE-35", type: "ue_mono", cooling_kw: "3,5", public_price: "1090" };
  it("unité extérieure : longueur pré-chargée, g/m et diamètres", () => {
    const r = parseProductForm({ ...base, precharged_length_m: "7,5", extra_charge_g_per_m: "20", link_diameters: '1/4" - 3/8"' });
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ precharged_length_m: 7.5, extra_charge_g_per_m: 20, link_diameters: '1/4" - 3/8"' });
  });
  it("diamètres mal saisis", () => {
    expect(parseProductForm({ ...base, link_diameters: "6 mm" }).errors.link_diameters).toBeDefined();
  });
  it("accessoire : rôle liaison exige un diamètre", () => {
    const f = { ...accessoryToForm(), category: "liaison", name: "Liaison", unit: "m", public_price: "12", auto_role: "liaison" };
    expect(parseAccessoryForm(f).errors.diameter).toBeDefined();
    expect(parseAccessoryForm({ ...f, diameter: "1/4 - 3/8" }).values.auto_role).toBe("liaison");
  });
});
