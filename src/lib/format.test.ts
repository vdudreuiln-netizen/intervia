import { describe, expect, it } from "vitest";
import { centsToInput, formatEuros, parseEuros, parsePercent, rateToInput } from "./format";

describe("saisie des montants", () => {
  it.each([
    ["1 234,50", 123450],
    ["1234.5", 123450],
    ["45", 4500],
    ["45 €", 4500],
    ["0,5", 50],
    ["1 234,56", 123456],
  ])("« %s » → %i centimes", (input, cents) => {
    expect(parseEuros(input)).toBe(cents);
  });
  it("saisie illisible → null", () => {
    expect(parseEuros("abc")).toBeNull();
    expect(parseEuros("")).toBeNull();
    expect(parseEuros("12,3,4")).toBeNull();
  });
  it("pourcentages", () => {
    expect(parsePercent("21,2")).toBe(0.212);
    expect(parsePercent("5,5 %")).toBe(0.055);
    expect(rateToInput(0.212)).toBe("21,2");
    expect(rateToInput(0.055)).toBe("5,5");
  });
  it("aller-retour champ ↔ centimes", () => {
    expect(centsToInput(4500)).toBe("45");
    expect(centsToInput(123450)).toBe("1234,50");
  });
  it("affichage en euros", () => {
    expect(formatEuros(349000).replace(/\s/g, " ")).toBe("3 490,00 €");
    expect(formatEuros(349000, { decimals: false }).replace(/\s/g, " ")).toBe("3 490 €");
  });
});
