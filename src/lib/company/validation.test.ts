import { describe, expect, it } from "vitest";
import { formatIban, isValidBic, isValidFrenchPhone, isValidIban, isValidSiret } from "./validation";
import { parseCompanyForm, vatNumberFromSiren } from "./settings";

describe("SIRET", () => {
  it("accepte un SIRET valide, avec ou sans espaces", () => {
    expect(isValidSiret("73282932000074")).toBe(true);
    expect(isValidSiret("732 829 320 00074")).toBe(true);
  });
  it("refuse une faute de frappe (clé de Luhn)", () => {
    expect(isValidSiret("73282932000075")).toBe(false);
  });
  it("refuse une longueur incorrecte", () => {
    expect(isValidSiret("7328293200007")).toBe(false);
  });
  it("gère l'exception La Poste (siège et établissements)", () => {
    expect(isValidSiret("35600000000048")).toBe(true);
    expect(isValidSiret("35600000049837")).toBe(true);
  });
});

describe("IBAN / BIC", () => {
  it("accepte un IBAN français valide, saisi avec espaces", () => {
    expect(isValidIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
  });
  it("refuse un chiffre erroné", () => {
    expect(isValidIban("FR7630006000011234567890188")).toBe(false);
  });
  it("refuse un IBAN français de mauvaise longueur", () => {
    expect(isValidIban("FR763000600001123456789018")).toBe(false);
  });
  it("affiche l'IBAN par blocs de 4", () => {
    expect(formatIban("fr7630006000011234567890189")).toBe("FR76 3000 6000 0112 3456 7890 189");
  });
  it("BIC à 8 ou 11 caractères", () => {
    expect(isValidBic("AGRIFRPP")).toBe(true);
    expect(isValidBic("AGRIFRPP833")).toBe(true);
    expect(isValidBic("AGRI")).toBe(false);
  });
});

describe("téléphone", () => {
  it("formats français", () => {
    expect(isValidFrenchPhone("06 12 34 56 78")).toBe(true);
    expect(isValidFrenchPhone("+33 6 12 34 56 78")).toBe(true);
    expect(isValidFrenchPhone("12345")).toBe(false);
  });
});

describe("n° de TVA intracommunautaire", () => {
  it("déduit du SIREN", () => {
    expect(vatNumberFromSiren("73282932000074")).toBe("FR44732829320");
  });
});

describe("formulaire entreprise", () => {
  it("convertit montants et pourcentages saisis à la française", () => {
    const r = parseCompanyForm(
      { vat_regime: "franchise", labor_charges_rate: "23", material_charges_rate: "16", daily_labor_rate_cents: "450", target_margin_per_day_cents: "700", quote_validity_days: "30", payment_terms: "Acompte 30 %" },
      ["vat_regime", "labor_charges_rate", "material_charges_rate", "daily_labor_rate_cents", "target_margin_per_day_cents", "quote_validity_days", "payment_terms"],
    );
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ labor_charges_rate: 0.23, material_charges_rate: 0.16, daily_labor_rate_cents: 45000, target_margin_per_day_cents: 70000 });
  });
  it("décennale et SIRET obligatoires", () => {
    const r = parseCompanyForm({ siret: "", insurer_name: "" }, ["siret", "insurer_name"]);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors)).toEqual(["siret", "insurer_name"]);
  });
  it("n° de TVA exigé seulement si assujetti", () => {
    expect(parseCompanyForm({ vat_regime: "franchise", vat_number: "" }, ["vat_regime", "vat_number"]).ok).toBe(true);
    expect(parseCompanyForm({ vat_regime: "assujetti", vat_number: "" }, ["vat_regime", "vat_number"]).errors.vat_number).toBeDefined();
  });
  it("refuse un taux de TVA par défaut exotique", () => {
    expect(parseCompanyForm({ default_vat_rate: "7" }, ["default_vat_rate"]).errors.default_vat_rate).toBeDefined();
    expect(parseCompanyForm({ default_vat_rate: "5,5" }, ["default_vat_rate"]).values.default_vat_rate).toBe(0.055);
  });
  it("exige un téléphone ou un e-mail", () => {
    expect(parseCompanyForm({ phone: "", email: "" }, ["phone", "email"]).errors.phone).toBeDefined();
    expect(parseCompanyForm({ phone: "", email: "a@b.fr" }, ["phone", "email"]).ok).toBe(true);
  });
});
