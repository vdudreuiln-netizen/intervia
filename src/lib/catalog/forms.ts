/**
 * Formulaires du catalogue : validation et conversion texte saisi → base.
 */
import { centsToInput, decimalToInput, parseDecimal, parseEuros, parsePercent, rateToInput } from "@/lib/format";
import { DEFAULT_MAX_INDOOR_RATIO } from "@/lib/sizing/sizing";
import { PRODUCT_TYPE_LABELS, type ProductType } from "./import";
import { AUTO_ROLE_LABELS, type AutoRole } from "@/lib/quote/types";

export const ACCESSORY_CATEGORIES: Record<string, string> = {
  aeraulique: "Réseau aéraulique (gainable)",
  zonage: "Zonage",
  liaison: "Liaisons frigorifiques",
  goulotte: "Goulottes",
  support: "Supports",
  pompe: "Pompes de relevage",
  condensats: "Évacuation des condensats",
  electricite: "Électricité",
  gaz: "Fluide frigorigène",
  autre: "Autres",
};

export const ACCESSORY_UNITS: Record<string, string> = { u: "à l'unité", m: "au mètre", kg: "au kg", forfait: "forfait" };

type Errors<K extends string> = Partial<Record<K, string>>;

// --- Produits ----------------------------------------------------------------

export type ProductFormKey = "brand_id" | "range_name" | "reference" | "type" | "cooling_kw" | "heating_kw" | "max_outlets" | "max_indoor_ratio" | "link_diameters" | "precharged_length_m" | "extra_charge_g_per_m" | "public_price" | "discount";
export type ProductForm = Record<ProductFormKey, string>;

export interface ProductValues {
  brand_id: string;
  range_name: string | null;
  reference: string;
  type: ProductType;
  cooling_kw: number | null;
  heating_kw: number | null;
  max_outlets: number | null;
  max_indoor_ratio: number | null;
  link_diameters: string | null;
  precharged_length_m: number | null;
  extra_charge_g_per_m: number | null;
  public_price_cents: number;
  discount_rate: number | null;
}

export function productToForm(p?: Partial<ProductValues>): ProductForm {
  return {
    brand_id: p?.brand_id ?? "",
    range_name: p?.range_name ?? "",
    reference: p?.reference ?? "",
    type: p?.type ?? "",
    cooling_kw: decimalToInput(p?.cooling_kw),
    heating_kw: decimalToInput(p?.heating_kw),
    max_outlets: p?.max_outlets ? String(p.max_outlets) : "",
    max_indoor_ratio: p?.max_indoor_ratio ? String(Math.round(p.max_indoor_ratio * 100)) : "",
    link_diameters: p?.link_diameters ?? "",
    precharged_length_m: decimalToInput(p?.precharged_length_m),
    extra_charge_g_per_m: p?.extra_charge_g_per_m === null || p?.extra_charge_g_per_m === undefined ? "" : String(p.extra_charge_g_per_m),
    public_price: centsToInput(p?.public_price_cents),
    discount: rateToInput(p?.discount_rate),
  };
}

export function parseProductForm(f: ProductForm): { ok: boolean; values: ProductValues; errors: Errors<ProductFormKey> } {
  const errors: Errors<ProductFormKey> = {};
  const type = f.type as ProductType;
  if (!f.brand_id) errors.brand_id = "Choisissez la marque";
  if (!f.reference.trim()) errors.reference = "Indiquez la référence";
  if (!(type in PRODUCT_TYPE_LABELS)) errors.type = "Choisissez le type";
  const isUnit = type !== "accessoire";
  const kw = (k: "cooling_kw" | "heating_kw") => {
    if (f[k].trim() === "") return null;
    const n = parseDecimal(f[k]);
    if (n === null || n <= 0 || n > 100) errors[k] = "Puissance en kW (ex. 3,5)";
    return n;
  };
  const cooling = kw("cooling_kw");
  const heating = kw("heating_kw");
  if (isUnit && cooling === null && !errors.cooling_kw) errors.cooling_kw = "La puissance froid sert au dimensionnement";
  let outlets: number | null = null;
  let ratio: number | null = null;
  if (type === "ue_multi") {
    outlets = parseDecimal(f.max_outlets);
    if (outlets === null || !Number.isInteger(outlets) || outlets < 2 || outlets > 8) errors.max_outlets = "Entre 2 et 8 sorties";
    if (f.max_indoor_ratio.trim() !== "") {
      const pct = parseDecimal(f.max_indoor_ratio);
      if (pct === null || pct < 100 || pct > 200) errors.max_indoor_ratio = "Entre 100 et 200 %";
      else ratio = pct / 100;
    } else ratio = DEFAULT_MAX_INDOOR_RATIO;
  } else if (type === "ue_mono") outlets = 1;
  const price = parseEuros(f.public_price);
  if (price === null || price <= 0) errors.public_price = "Prix public HT invalide";
  let discount: number | null = null;
  if (f.discount.trim() !== "") {
    discount = parsePercent(f.discount);
    if (discount === null || discount < 0 || discount >= 1) errors.discount = "Remise entre 0 et 99 %";
  }
  const isOutdoor = type === "ue_mono" || type === "ue_multi";
  let precharged: number | null = null;
  let gPerM: number | null = null;
  if (isOutdoor && f.precharged_length_m.trim() !== "") {
    precharged = parseDecimal(f.precharged_length_m);
    if (precharged === null || precharged < 0 || precharged > 200) errors.precharged_length_m = "Longueur en m (ex. 7,5)";
  }
  if (isOutdoor && f.extra_charge_g_per_m.trim() !== "") {
    gPerM = parseDecimal(f.extra_charge_g_per_m);
    if (gPerM === null || !Number.isInteger(gPerM) || gPerM < 0 || gPerM > 500) errors.extra_charge_g_per_m = "Grammes par mètre (ex. 20)";
  }
  const dia = f.link_diameters.trim();
  if (dia && !/^\d+\/\d+"?\s*[-–]\s*\d+\/\d+"?$/.test(dia)) errors.link_diameters = "Format : liquide - gaz, ex. 1/4 - 3/8";
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values: {
      brand_id: f.brand_id,
      range_name: f.range_name.trim() || null,
      reference: f.reference.trim(),
      type,
      cooling_kw: cooling,
      heating_kw: heating,
      max_outlets: outlets,
      max_indoor_ratio: ratio,
      link_diameters: dia || null,
      precharged_length_m: precharged,
      extra_charge_g_per_m: gPerM,
      public_price_cents: price ?? 0,
      discount_rate: discount,
    },
  };
}

// --- Accessoires ---------------------------------------------------------------

export type AccessoryFormKey = "reference" | "category" | "name" | "diameter" | "unit" | "public_price" | "purchase_price" | "discount" | "auto_role";
export type AccessoryForm = Record<AccessoryFormKey, string>;
export interface AccessoryValues {
  reference: string | null;
  category: string;
  name: string;
  diameter: string | null;
  unit: string;
  public_price_cents: number | null;
  purchase_price_cents: number | null;
  discount_rate: number;
  auto_role: AutoRole | null;
}

export function accessoryToForm(a?: Partial<AccessoryValues>): AccessoryForm {
  return {
    reference: a?.reference ?? "",
    category: a?.category ?? "",
    name: a?.name ?? "",
    diameter: a?.diameter ?? "",
    unit: a?.unit ?? "u",
    public_price: centsToInput(a?.public_price_cents),
    purchase_price: centsToInput(a?.purchase_price_cents),
    discount: rateToInput(a?.discount_rate ?? 0),
    auto_role: a?.auto_role ?? "",
  };
}

export function parseAccessoryForm(f: AccessoryForm): { ok: boolean; values: AccessoryValues; errors: Errors<AccessoryFormKey> } {
  const errors: Errors<AccessoryFormKey> = {};
  if (!(f.category in ACCESSORY_CATEGORIES)) errors.category = "Choisissez la catégorie";
  if (!f.name.trim()) errors.name = "Indiquez la désignation";
  if (!(f.unit in ACCESSORY_UNITS)) errors.unit = "Choisissez l'unité";
  const hasPublic = f.public_price.trim() !== "";
  const price = hasPublic ? parseEuros(f.public_price) : null;
  const purchase = !hasPublic && f.purchase_price.trim() !== "" ? parseEuros(f.purchase_price) : null;
  if (hasPublic && (price === null || price <= 0)) errors.public_price = "Prix public HT invalide";
  if (!hasPublic && (purchase === null || purchase <= 0)) errors.public_price = "Indiquez le prix public HT, ou à défaut le prix d'achat";
  const discount = f.discount.trim() === "" ? 0 : parsePercent(f.discount);
  if (discount === null || discount < 0 || discount >= 1) errors.discount = "Remise entre 0 et 99 %";
  if (f.auto_role && !(f.auto_role in AUTO_ROLE_LABELS)) errors.auto_role = "Rôle inconnu";
  if (f.auto_role === "liaison" && !f.diameter.trim()) errors.diameter = "Indiquez le diamètre de la liaison (ex. 1/4 - 3/8)";
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values: {
      auto_role: (f.auto_role || null) as AutoRole | null,
      reference: f.reference.trim() || null,
      category: f.category,
      name: f.name.trim(),
      diameter: f.diameter.trim() || null,
      unit: f.unit,
      public_price_cents: hasPublic ? price ?? 0 : null,
      purchase_price_cents: hasPublic ? null : purchase,
      discount_rate: hasPublic ? discount ?? 0 : 0,
    },
  };
}

// --- Marques -------------------------------------------------------------------

export type BrandFormKey = "name" | "discount" | "sale_coefficient";
export type BrandForm = Record<BrandFormKey, string>;
export interface BrandValues {
  name: string;
  discount_rate: number;
  sale_coefficient: number;
}

export function brandToForm(b?: Partial<BrandValues>): BrandForm {
  return { name: b?.name ?? "", discount: rateToInput(b?.discount_rate ?? 0), sale_coefficient: decimalToInput(b?.sale_coefficient ?? 1) };
}

export function parseBrandForm(f: BrandForm): { ok: boolean; values: BrandValues; errors: Errors<BrandFormKey> } {
  const errors: Errors<BrandFormKey> = {};
  if (!f.name.trim()) errors.name = "Indiquez le nom de la marque";
  const discount = f.discount.trim() === "" ? 0 : parsePercent(f.discount);
  if (discount === null || discount < 0 || discount >= 1) errors.discount = "Remise entre 0 et 99 %";
  const coef = f.sale_coefficient.trim() === "" ? 1 : parseDecimal(f.sale_coefficient);
  if (coef === null || coef <= 0 || coef > 5) errors.sale_coefficient = "Coefficient entre 0,01 et 5 (1,00 = prix public)";
  return { ok: Object.keys(errors).length === 0, errors, values: { name: f.name.trim(), discount_rate: discount ?? 0, sale_coefficient: coef ?? 1 } };
}
