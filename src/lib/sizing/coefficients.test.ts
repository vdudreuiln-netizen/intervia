import { describe, expect, it } from "vitest";
import { coefficientsToForm, DEFAULT_COEFFICIENTS, parseCoefficientsForm, withDefaults } from "./coefficients";

describe("coefficients modifiables", () => {
  it("aller-retour formulaire sans perte", () => {
    const r = parseCoefficientsForm(coefficientsToForm(DEFAULT_COEFFICIENTS));
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(DEFAULT_COEFFICIENTS);
  });
  it("accepte la virgule décimale", () => {
    const form = coefficientsToForm(DEFAULT_COEFFICIENTS);
    form["sizing.orientation.O"] = "1,25";
    expect(parseCoefficientsForm(form).value.sizing.orientation.O).toBe(1.25);
  });
  it("refuse une valeur hors bornes", () => {
    const form = coefficientsToForm(DEFAULT_COEFFICIENTS);
    form["sizing.wattsPerM3.faible"] = "500";
    const r = parseCoefficientsForm(form);
    expect(r.ok).toBe(false);
    expect(r.errors["sizing.wattsPerM3.faible"]).toBeDefined();
  });
  it("refuse une plage de puissance incohérente", () => {
    const form = coefficientsToForm(DEFAULT_COEFFICIENTS);
    form["sizing.unitMinRatio"] = "1,2";
    form["sizing.unitMaxRatio"] = "1,1";
    expect(parseCoefficientsForm(form).errors["sizing.unitMaxRatio"]).toBeDefined();
  });
  it("complète des coefficients stockés partiels avec les défauts", () => {
    const c = withDefaults({ sizing: { wattsPerM3: { faible: 50 } } });
    expect(c.sizing.wattsPerM3.faible).toBe(50);
    expect(c.sizing.wattsPerM3.moyenne).toBe(38);
    expect(c.laborDays).toEqual(DEFAULT_COEFFICIENTS.laborDays);
  });
});
