/**
 * Paramètres de l'entreprise : conversion formulaire (texte saisi) ↔ base
 * (centimes, taux décimaux) et validation par étape de l'onboarding.
 * Utilisé côté client (messages immédiats) ET côté serveur (sécurité).
 */
import { ALLOWED_VAT_RATES } from "@/lib/pricing/engine";
import { centsToInput, decimalToInput, parseDecimal, parseEuros, parsePercent, rateToInput } from "@/lib/format";
import {
  isValidBic,
  isValidEmail,
  isValidFrenchPhone,
  isValidIban,
  isValidPostalCode,
  isValidSiret,
  normalizeIban,
  normalizeSiret,
} from "./validation";

/** Colonnes de `companies` modifiables par l'artisan. */
export interface CompanyRow {
  legal_name: string;
  siret: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  logo_path: string | null;
  stamp_path: string | null;
  insurer_name: string | null;
  insurance_policy: string | null;
  insurance_coverage: string | null;
  bank_holder: string | null;
  iban: string | null;
  bic: string | null;
  vat_regime: "franchise" | "assujetti";
  vat_number: string | null;
  default_vat_rate: number;
  labor_charges_rate: number;
  material_charges_rate: number;
  daily_labor_rate_cents: number;
  accessory_sale_coefficient: number;
  mediator_name: string | null;
  mediator_address: string | null;
  mediator_website: string | null;
  deposit_rate: number;
  follow_up_days: number;
  accessory_purchase_coefficient: number;
  preferred_brand_id: string | null;
  commissioning_price_cents: number;
  fluid_form_price_cents: number;
  fluid_form_policy: "complement" | "always";
  default_electric_length_m: number;
  target_margin_per_day_cents: number;
  quote_validity_days: number;
  payment_terms: string;
  base_address: string | null;
  base_postal_code: string | null;
  base_city: string | null;
  base_citycode: string | null;
  base_lat: number | null;
  base_lng: number | null;
  travel_price_per_km_cents: number;
  travel_minimum_fee_cents: number;
  parking_per_day_cents: number;
  travel_min_daily_with_parking_cents: number;
}

export type CompanyField = keyof CompanyRow;
export type CompanyForm = Record<CompanyField, string>;

export type StepId = "entreprise" | "visuels" | "assurance" | "mentions" | "tva" | "main_oeuvre" | "chantier" | "deplacement";

export const STEPS: { id: StepId; title: string; fields: CompanyField[] }[] = [
  { id: "entreprise", title: "Votre entreprise", fields: ["legal_name", "siret", "address_line", "postal_code", "city", "phone", "email"] },
  { id: "visuels", title: "Logo et tampon", fields: ["logo_path", "stamp_path"] },
  { id: "assurance", title: "Assurance et banque", fields: ["insurer_name", "insurance_policy", "insurance_coverage", "bank_holder", "iban", "bic"] },
  { id: "mentions", title: "Médiateur de la consommation", fields: ["mediator_name", "mediator_address", "mediator_website"] },
  { id: "tva", title: "TVA et charges", fields: ["vat_regime", "vat_number", "default_vat_rate", "labor_charges_rate", "material_charges_rate"] },
  { id: "main_oeuvre", title: "Prix, main d'œuvre et marge", fields: ["daily_labor_rate_cents", "accessory_sale_coefficient", "accessory_purchase_coefficient", "target_margin_per_day_cents", "deposit_rate", "quote_validity_days", "follow_up_days", "payment_terms"] },
  { id: "chantier", title: "Chantier et mise en service", fields: ["preferred_brand_id", "commissioning_price_cents", "fluid_form_policy", "fluid_form_price_cents", "default_electric_length_m"] },
  {
    id: "deplacement",
    title: "Déplacements",
    fields: ["base_address", "base_postal_code", "base_city", "base_citycode", "base_lat", "base_lng", "travel_price_per_km_cents", "travel_minimum_fee_cents", "parking_per_day_cents", "travel_min_daily_with_parking_cents"],
  },
];

const CENTS: CompanyField[] = [
  "daily_labor_rate_cents",
  "commissioning_price_cents",
  "fluid_form_price_cents",
  "target_margin_per_day_cents",
  "travel_price_per_km_cents",
  "travel_minimum_fee_cents",
  "parking_per_day_cents",
  "travel_min_daily_with_parking_cents",
];
const RATES: CompanyField[] = ["labor_charges_rate", "material_charges_rate", "default_vat_rate", "deposit_rate"];

export function companyRowToForm(row: CompanyRow): CompanyForm {
  const form = {} as CompanyForm;
  for (const key of Object.keys(row) as CompanyField[]) {
    const v = row[key];
    if (CENTS.includes(key)) form[key] = centsToInput(v as number);
    else if (RATES.includes(key)) form[key] = rateToInput(v as number);
    else if (key === "accessory_sale_coefficient" || key === "accessory_purchase_coefficient" || key === "default_electric_length_m") form[key] = decimalToInput(Number(v));
    else form[key] = v === null || v === undefined ? "" : String(v);
  }
  return form;
}

/** Numéro de TVA intracommunautaire français déduit du SIREN (clé = (12 + 3 × (SIREN mod 97)) mod 97). */
export function vatNumberFromSiren(sirenOrSiret: string): string | null {
  const siren = normalizeSiret(sirenOrSiret).slice(0, 9);
  if (!/^\d{9}$/.test(siren)) return null;
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${siren}`;
}

export type FieldErrors = Partial<Record<CompanyField, string>>;

export interface ParseResult {
  ok: boolean;
  values: Partial<CompanyRow>;
  errors: FieldErrors;
}

const REQUIRED: Partial<Record<CompanyField, string>> = {
  legal_name: "Indiquez la raison sociale",
  siret: "Le SIRET est obligatoire sur un devis",
  address_line: "Indiquez l'adresse",
  postal_code: "Indiquez le code postal",
  city: "Indiquez la ville",
  insurer_name: "L'assurance décennale est obligatoire sur un devis",
  insurance_policy: "Indiquez le numéro de contrat",
  insurance_coverage: "Indiquez la zone couverte (ex. France métropolitaine)",
  payment_terms: "Indiquez vos conditions de paiement",
};

/** Valide et convertit les champs `fields` du formulaire. */
export function parseCompanyForm(form: Partial<CompanyForm>, fields: CompanyField[]): ParseResult {
  const values: Partial<CompanyRow> = {};
  const errors: FieldErrors = {};
  const get = (k: CompanyField) => (form[k] ?? "").trim();
  const set = <K extends CompanyField>(k: K, v: CompanyRow[K]) => {
    (values as Record<string, unknown>)[k] = v;
  };
  const textOrNull = (k: CompanyField) => (get(k) === "" ? null : get(k));

  for (const k of fields) {
    const raw = get(k);
    if (raw === "" && REQUIRED[k]) {
      errors[k] = REQUIRED[k];
      continue;
    }
    switch (k) {
      case "siret":
        if (!isValidSiret(raw)) errors.siret = "SIRET invalide (14 chiffres, vérifiez la saisie)";
        else set("siret", normalizeSiret(raw));
        break;
      case "postal_code":
      case "base_postal_code":
        if (raw !== "" && !isValidPostalCode(raw)) errors[k] = "Code postal à 5 chiffres";
        else set(k, textOrNull(k));
        break;
      case "phone":
        if (raw !== "" && !isValidFrenchPhone(raw)) errors.phone = "Numéro de téléphone invalide";
        else set("phone", textOrNull(k));
        break;
      case "email":
        if (raw !== "" && !isValidEmail(raw)) errors.email = "Adresse e-mail invalide";
        else set("email", textOrNull(k));
        break;
      case "iban":
        if (raw !== "" && !isValidIban(raw)) errors.iban = "IBAN invalide (vérifiez les chiffres)";
        else set("iban", raw === "" ? null : normalizeIban(raw));
        break;
      case "bic":
        if (raw !== "" && !isValidBic(raw)) errors.bic = "BIC invalide (8 ou 11 caractères)";
        else set("bic", raw === "" ? null : raw.replace(/\s/g, "").toUpperCase());
        break;
      case "vat_regime":
        if (raw !== "franchise" && raw !== "assujetti") errors.vat_regime = "Choisissez votre régime de TVA";
        else set("vat_regime", raw);
        break;
      case "vat_number":
        if (get("vat_regime") === "assujetti" && raw === "") errors.vat_number = "Le n° de TVA intracommunautaire est obligatoire si vous facturez la TVA";
        else if (raw !== "" && !/^FR[0-9A-Z]{2}\d{9}$/.test(raw.replace(/\s/g, "").toUpperCase())) errors.vat_number = "Format attendu : FR + 2 caractères + SIREN";
        else set("vat_number", raw === "" ? null : raw.replace(/\s/g, "").toUpperCase());
        break;
      case "default_vat_rate": {
        const r = parsePercent(raw === "" ? "10" : raw);
        if (r === null || !ALLOWED_VAT_RATES.includes(r)) errors.default_vat_rate = "Taux de TVA : 5,5 %, 10 % ou 20 %";
        else set("default_vat_rate", r);
        break;
      }
      case "deposit_rate": {
        const r = parsePercent(raw === "" ? "0" : raw);
        if (r === null || r < 0 || r >= 1) errors.deposit_rate = "Pourcentage entre 0 et 99 %";
        else set("deposit_rate", r);
        break;
      }
      case "mediator_website":
        if (raw !== "" && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw)) errors.mediator_website = "Adresse de site invalide (ex. www.mediateur.fr)";
        else set("mediator_website", textOrNull(k));
        break;
      case "labor_charges_rate":
      case "material_charges_rate": {
        const r = parsePercent(raw);
        if (r === null || r < 0 || r >= 1) errors[k] = "Pourcentage entre 0 et 99 %";
        else set(k, r);
        break;
      }
      case "daily_labor_rate_cents":
      case "target_margin_per_day_cents":
      case "travel_price_per_km_cents":
      case "travel_minimum_fee_cents":
      case "parking_per_day_cents":
      case "travel_min_daily_with_parking_cents": {
        const c = parseEuros(raw === "" ? "0" : raw);
        if (c === null || c < 0) errors[k] = "Montant invalide";
        else set(k, c);
        break;
      }
      case "commissioning_price_cents":
      case "fluid_form_price_cents": {
        const c = parseEuros(raw === "" ? "0" : raw);
        if (c === null || c < 0) errors[k] = "Montant invalide (0 = inclus)";
        else set(k, c);
        break;
      }
      case "fluid_form_policy":
        if (raw !== "complement" && raw !== "always") errors.fluid_form_policy = "Choisissez une règle";
        else set("fluid_form_policy", raw);
        break;
      case "default_electric_length_m": {
        const n = parseDecimal(raw === "" ? "10" : raw);
        if (n === null || n < 0 || n > 200) errors.default_electric_length_m = "Longueur entre 0 et 200 m";
        else set("default_electric_length_m", n);
        break;
      }
      case "preferred_brand_id":
        set("preferred_brand_id", raw === "" ? null : raw);
        break;
      case "accessory_sale_coefficient":
      case "accessory_purchase_coefficient": {
        const n = parseDecimal(raw === "" ? (k === "accessory_sale_coefficient" ? "1,3" : "2") : raw);
        if (n === null || n <= 0 || n > 5) errors[k] = "Coefficient entre 0,01 et 5";
        else set(k, n);
        break;
      }
      case "follow_up_days": {
        const n = parseDecimal(raw === "" ? "7" : raw);
        if (n === null || !Number.isInteger(n) || n < 1 || n > 90) errors.follow_up_days = "Nombre de jours entre 1 et 90";
        else set("follow_up_days", n);
        break;
      }
      case "quote_validity_days": {
        const n = parseDecimal(raw === "" ? "30" : raw);
        if (n === null || !Number.isInteger(n) || n < 1 || n > 365) errors.quote_validity_days = "Nombre de jours entre 1 et 365";
        else set("quote_validity_days", n);
        break;
      }
      case "base_lat":
      case "base_lng": {
        const n = raw === "" ? null : parseDecimal(raw);
        set(k, n);
        break;
      }
      default:
        set(k, textOrNull(k) as never);
    }
  }
  if (fields.includes("phone") && fields.includes("email") && get("phone") === "" && get("email") === "") {
    errors.phone = "Indiquez au moins un téléphone ou un e-mail";
  }
  if (values.legal_name === null) delete values.legal_name;
  return { ok: Object.keys(errors).length === 0, values, errors };
}

export const ALL_FIELDS: CompanyField[] = STEPS.flatMap((s) => s.fields);
