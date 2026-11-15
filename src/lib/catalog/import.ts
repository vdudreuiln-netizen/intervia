/**
 * Import de tarifs fournisseurs (CSV « ; » ou Excel .xlsx).
 *
 * Étapes : tableau brut → ligne d'en-tête → correspondance des colonnes →
 * lignes normalisées → plan (créations / mises à jour / erreurs) → résumé.
 * Tout est pur et testé ; l'application en base se fait en une transaction
 * (fonction SQL apply_supplier_import).
 *
 * Multi-fournisseurs : chaque ligne du tarif devient le tarif (« offre ») du
 * fournisseur importé pour un article. L'article est retrouvé par EAN ou par
 * référence fabricant normalisée (correspondance certaine) ; une référence qui
 * n'en diffère que par un suffixe est une correspondance PROBABLE, à confirmer.
 */
import { parseDecimal } from "@/lib/format";
import { buildMatchIndex, matchWithIndex, normalizeEan } from "@/lib/suppliers/matching";

export type ImportTarget = "materiel" | "accessoires";
export type Cell = string | number | boolean | Date | null | undefined;
export type ProductType = "ue_mono" | "ue_multi" | "ui_murale" | "ui_console" | "ui_cassette" | "ui_gainable" | "accessoire";

export const MAX_IMPORT_ROWS = 5000;
export const BIG_INCREASE = 0.05;

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  ue_mono: "Unité extérieure mono-split",
  ue_multi: "Unité extérieure multi-split",
  ui_murale: "Unité intérieure murale",
  ui_console: "Console",
  ui_cassette: "Cassette",
  ui_gainable: "Gainable",
  accessoire: "Accessoire",
};

// ---------------------------------------------------------------------------
// Champs importables et correspondance des colonnes
// ---------------------------------------------------------------------------

export type OfferField = "supplier_ref" | "ean" | "discount_family" | "net_price";
export type MaterialField = "brand" | "range_name" | "reference" | "type" | "cooling_kw" | "heating_kw" | "max_outlets" | "link_diameters" | "precharged_length_m" | "extra_charge_g_per_m" | "public_price" | "discount" | OfferField;
export type AccessoryField = "reference" | "name" | "category" | "diameter" | "unit" | "public_price" | "discount" | OfferField;
export type ImportField = MaterialField | AccessoryField;

export interface FieldDef {
  key: ImportField;
  label: string;
  required: boolean;
  hint?: string;
  synonyms: string[];
}

const OFFER_FIELDS: FieldDef[] = [
  {
    key: "supplier_ref",
    label: "Code fournisseur",
    required: false,
    hint: "Repris sur les bons de commande",
    synonyms: ["code fournisseur", "ref fournisseur", "reference fournisseur", "code distributeur", "ref distributeur", "code article fournisseur", "code interne"],
  },
  {
    key: "ean",
    label: "EAN (code-barres)",
    required: false,
    hint: "Rapprochement certain entre fournisseurs",
    synonyms: ["ean", "ean13", "ean 13", "gencod", "gencode", "code barre", "code barres", "code ean", "gtin"],
  },
  {
    key: "discount_family",
    label: "Famille de remise",
    required: false,
    hint: "Sinon : la gamme",
    synonyms: ["famille de remise", "famille remise", "code remise", "groupe de remise", "fam remise", "famille tarifaire", "classe de remise", "groupe remise"],
  },
  {
    key: "net_price",
    label: "Prix net HT",
    required: false,
    hint: "Si le tarif donne directement votre prix net",
    synonyms: ["prix net ht", "prix net", "net ht", "pnet", "prix d'achat ht", "prix d'achat", "prix achat", "votre prix", "prix remise"],
  },
];

export const FIELDS: Record<ImportTarget, FieldDef[]> = {
  materiel: [
    {
      key: "reference",
      label: "Référence",
      required: true,
      synonyms: ["reference", "ref", "code article", "code", "article", "modele", "code produit", "sku"],
    },
    {
      key: "public_price",
      label: "Prix public HT",
      required: true,
      synonyms: ["prix public ht", "prix public", "ppi", "ppht", "tarif", "prix ht", "prix", "tarif public", "prix catalogue"],
    },
    {
      key: "brand",
      label: "Marque",
      required: false,
      hint: "Sinon : marque choisie pour tout le fichier",
      synonyms: ["marque", "fabricant", "brand", "constructeur"],
    },
    {
      key: "type",
      label: "Type d'unité",
      required: false,
      hint: "Sinon : type choisi pour tout le fichier",
      synonyms: ["type", "famille", "categorie", "type unite", "type d'unite"],
    },
    {
      key: "range_name",
      label: "Gamme",
      required: false,
      synonyms: ["gamme", "serie", "range", "ligne"],
    },
    {
      key: "cooling_kw",
      label: "Puissance froid (kW)",
      required: false,
      synonyms: ["puissance froid (kw)", "puissance froid", "froid", "p froid", "kw froid", "puissance frigorifique", "capacite froid"],
    },
    {
      key: "heating_kw",
      label: "Puissance chaud (kW)",
      required: false,
      synonyms: ["puissance chaud (kw)", "puissance chaud", "chaud", "p chaud", "kw chaud", "puissance calorifique", "capacite chaud"],
    },
    {
      key: "max_outlets",
      label: "Sorties max",
      required: false,
      synonyms: ["sorties max", "sorties", "nb sorties", "nombre de sorties", "nb ui", "unites interieures max"],
    },
    {
      key: "link_diameters",
      label: "Diamètres liaisons",
      required: false,
      synonyms: ["diametres liaisons", "diametres", "diametre liaisons", "raccordements", "liaisons", "diametre liquide/gaz"],
    },
    {
      key: "precharged_length_m",
      label: "Longueur pré-chargée (m)",
      required: false,
      synonyms: ["longueur prechargee (m)", "longueur prechargee", "longueur standard", "precharge", "longueur pre chargee"],
    },
    {
      key: "extra_charge_g_per_m",
      label: "Charge complémentaire (g/m)",
      required: false,
      synonyms: ["charge complementaire (g/m)", "charge complementaire", "complement de charge", "charge additionnelle", "g/m"],
    },
    {
      key: "discount",
      label: "Remise (%)",
      required: false,
      hint: "Sinon : vos remises actuelles sont conservées",
      synonyms: ["remise (%)", "remise", "remise %", "discount", "taux de remise"],
    },
    ...OFFER_FIELDS,
  ],
  accessoires: [
    {
      key: "reference",
      label: "Référence",
      required: true,
      synonyms: ["reference", "ref", "code article", "code", "article", "sku"],
    },
    {
      key: "name",
      label: "Désignation",
      required: true,
      synonyms: ["designation", "libelle", "nom", "description", "produit"],
    },
    {
      key: "public_price",
      label: "Prix public HT",
      required: false,
      hint: "Ou « Prix net HT »",
      synonyms: ["prix public ht", "prix public", "ppi", "tarif", "prix ht", "prix", "prix catalogue"],
    },
    {
      key: "category",
      label: "Catégorie",
      required: false,
      hint: "Sinon : catégorie choisie pour tout le fichier",
      synonyms: ["categorie", "famille", "type"],
    },
    {
      key: "diameter",
      label: "Diamètre",
      required: false,
      synonyms: ["diametre", "dimension", "section"],
    },
    {
      key: "unit",
      label: "Unité (u, m, kg)",
      required: false,
      synonyms: ["unite", "unite de vente", "uv", "conditionnement"],
    },
    {
      key: "discount",
      label: "Remise (%)",
      required: false,
      hint: "Sinon : vos remises actuelles sont conservées",
      synonyms: ["remise (%)", "remise", "remise %", "discount", "taux de remise"],
    },
    ...OFFER_FIELDS,
  ],
};

export type Mapping = Partial<Record<ImportField, string>>;

export function normalizeHeader(h: Cell): string {
  return cellText(h)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_.\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Propose une correspondance en reconnaissant les intitulés usuels des tarifs. */
export function guessMapping(headers: Cell[], target: ImportTarget, remembered?: Mapping): Mapping {
  const names = headers.map(cellText);
  const norm = headers.map(normalizeHeader);
  const mapping: Mapping = {};
  const used = new Set<string>();
  // 1. correspondance mémorisée pour ce fournisseur, si les colonnes existent encore
  for (const [field, col] of Object.entries(remembered ?? {})) {
    if (col && names.includes(col)) {
      mapping[field as ImportField] = col;
      used.add(col);
    }
  }
  // 2. synonymes : correspondance exacte d'abord, puis « commence par »
  for (const pass of ["exact", "prefix"] as const) {
    for (const f of FIELDS[target]) {
      if (mapping[f.key]) continue;
      for (const syn of f.synonyms) {
        const i = norm.findIndex((h, idx) => !used.has(names[idx]!) && (pass === "exact" ? h === syn : h.startsWith(syn)));
        if (i >= 0) {
          mapping[f.key] = names[i]!;
          used.add(names[i]!);
          break;
        }
      }
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Lecture CSV et détection de l'en-tête
// ---------------------------------------------------------------------------

/** CSV robuste : BOM, séparateur « ; » « , » ou tabulation détecté, guillemets, retours chariot. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", "\t", ","].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ";";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Les tarifs fournisseurs ont souvent un titre, un logo, une date au-dessus du
 * tableau : on prend la première ligne (parmi les 20 premières) qui ressemble
 * à un en-tête (≥ 3 cellules texte non numériques), de préférence celle qui
 * contient des intitulés connus.
 */
export function detectHeaderRow(table: Cell[][], target: ImportTarget): number {
  const known = new Set(FIELDS[target].flatMap((f) => f.synonyms));
  let best = 0;
  let bestScore = -1;
  table.slice(0, 20).forEach((row, i) => {
    const texts = row.map(cellText).filter((t) => t !== "" && parseDecimal(t) === null);
    if (texts.length < 3) return;
    const score = texts.length + 10 * row.filter((c) => known.has(normalizeHeader(c))).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Conversion des cellules
// ---------------------------------------------------------------------------

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

function cellNumber(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = cellText(c).replace(/(g\/m|kw|w|€|eur|ht|%|\s(m|ml)$)/gi, "").trim();
  return t === "" ? null : parseDecimal(t);
}

/** « 1 234,56 € », 1234.56 → 123456 centimes. */
export function parsePriceCents(c: Cell): number | null {
  const n = cellNumber(c);
  if (n === null || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Remise : « 35 % », « 35 », 35 → 0.35 ; 0,35 → 0.35 (fraction, comme dans Excel
 * quand la cellule est au format pourcentage). Vide → null (= ne pas toucher).
 */
export function parseDiscount(c: Cell): number | null | "invalid" {
  const raw = cellText(c);
  if (raw === "") return null;
  const n = cellNumber(c);
  if (n === null || n < 0) return "invalid";
  const rate = raw.includes("%") || n > 1 ? n / 100 : n;
  if (rate >= 1) return "invalid";
  return Math.round(rate * 10000) / 10000;
}

/** « 3,5 kW », 3.5, « 3500 W » → 3.5 */
export function parseKw(c: Cell): number | null {
  const isWatts = /\d\s*w\b/i.test(cellText(c)) && !/kw/i.test(cellText(c));
  const n = cellNumber(c);
  if (n === null || n <= 0) return null;
  const kw = isWatts || n > 100 ? n / 1000 : n;
  return Math.round(kw * 100) / 100;
}

/** Reconnaît le type d'unité dans les libellés des fabricants. */
export function parseProductType(c: Cell): ProductType | null {
  const t = normalizeHeader(c);
  if (t === "") return null;
  for (const [type, label] of Object.entries(PRODUCT_TYPE_LABELS)) {
    if (t === type || t === normalizeHeader(label)) return type as ProductType;
  }
  if (/gainab|ducted|conduit/.test(t)) return "ui_gainable";
  if (/cassette/.test(t)) return "ui_cassette";
  if (/console|allege|plancher/.test(t)) return "ui_console";
  if (/mura|wall/.test(t)) return "ui_murale";
  if (/multi/.test(t)) return "ue_multi";
  if (/exter|\bue\b|groupe|outdoor|mono/.test(t)) return "ue_mono";
  if (/accessoire|support|liaison/.test(t)) return "accessoire";
  return null;
}

function parseUnit(c: Cell): string | null {
  const t = normalizeHeader(c);
  if (t === "") return null;
  if (/^(m|ml|metre|metres|m lineaire)$/.test(t)) return "m";
  if (/^(kg|kilo|kilogramme)/.test(t)) return "kg";
  if (/forfait/.test(t)) return "forfait";
  return "u";
}

export function normalizeReference(ref: string): string {
  return ref.replace(/\s+/g, "").toUpperCase();
}

// ---------------------------------------------------------------------------
// Lignes normalisées
// ---------------------------------------------------------------------------

export interface ImportDefaults {
  brand?: string;
  type?: ProductType;
  category?: string;
}

export interface MaterialRow {
  line: number; // n° de ligne dans le fichier (1 = première ligne)
  brand: string;
  reference: string;
  type: ProductType;
  range_name: string | null;
  cooling_kw: number | null;
  heating_kw: number | null;
  max_outlets: number | null;
  link_diameters: string | null;
  precharged_length_m: number | null;
  extra_charge_g_per_m: number | null;
  public_price_cents: number;
  discount_rate: number | null; // null = non fourni par le fichier
  supplier_ref: string | null;
  ean: string | null;
  discount_family: string | null;
  net_price_cents: number | null;
}

export interface AccessoryRow {
  line: number;
  reference: string;
  name: string;
  category: string;
  diameter: string | null;
  unit: string;
  public_price_cents: number | null;
  discount_rate: number | null;
  supplier_ref: string | null;
  ean: string | null;
  discount_family: string | null;
  net_price_cents: number | null;
}

export interface RowError {
  line: number;
  message: string;
}

/** Une ligne de données = objet { champ → cellule brute } selon le mapping. */
export type MappedRow = Partial<Record<ImportField, Cell>>;

export function projectRows(table: Cell[][], headerIndex: number, mapping: Mapping): { line: number; cells: MappedRow }[] {
  const headers = (table[headerIndex] ?? []).map(cellText);
  const colIndex = Object.fromEntries(Object.entries(mapping).map(([f, col]) => [f, headers.indexOf(col!)]));
  return table
    .slice(headerIndex + 1)
    .map((row, i) => ({
      line: headerIndex + 2 + i,
      cells: Object.fromEntries(Object.entries(colIndex).filter(([, idx]) => idx >= 0).map(([f, idx]) => [f, row[idx]])) as MappedRow,
    }))
    .filter((r) => Object.values(r.cells).some((c) => cellText(c) !== ""));
}

export function validateMapping(mapping: Mapping, target: ImportTarget, defaults: ImportDefaults): string[] {
  const problems: string[] = [];
  for (const f of FIELDS[target]) if (f.required && !mapping[f.key]) problems.push(`Choisissez la colonne « ${f.label} »`);
  if (target === "accessoires" && !mapping.public_price && !mapping.net_price) problems.push("Choisissez la colonne « Prix public HT » ou « Prix net HT »");
  if (target === "materiel") {
    if (!mapping.brand && !defaults.brand?.trim()) problems.push("Choisissez la colonne « Marque » ou une marque pour tout le fichier");
    if (!mapping.type && !defaults.type) problems.push("Choisissez la colonne « Type d'unité » ou un type pour tout le fichier");
  }
  const cols = Object.values(mapping).filter(Boolean);
  if (new Set(cols).size !== cols.length) problems.push("Une même colonne est utilisée pour deux informations");
  return problems;
}

export function normalizeMaterialRows(rows: { line: number; cells: MappedRow }[], defaults: ImportDefaults) {
  const out: MaterialRow[] = [];
  const errors: RowError[] = [];
  for (const { line, cells } of rows) {
    const reference = cellText(cells.reference);
    const brand = cellText(cells.brand) || defaults.brand?.trim() || "";
    const price = parsePriceCents(cells.public_price);
    const type = cells.type !== undefined && cellText(cells.type) !== "" ? parseProductType(cells.type) : defaults.type ?? null;
    const discount = parseDiscount(cells.discount);
    const outletsN = cellNumber(cells.max_outlets);
    const precharged = cellNumber(cells.precharged_length_m);
    const gPerM = cellNumber(cells.extra_charge_g_per_m);
    const dia = cellText(cells.link_diameters);
    const net = cells.net_price !== undefined && cellText(cells.net_price) !== "" ? parsePriceCents(cells.net_price) : null;
    const msgs: string[] = [];
    if (cells.net_price !== undefined && cellText(cells.net_price) !== "" && net === null) msgs.push(`prix net illisible (« ${cellText(cells.net_price)} »)`);
    if (!reference) msgs.push("référence manquante");
    if (!brand) msgs.push("marque manquante");
    if (price === null || price === 0) msgs.push(`prix illisible (« ${cellText(cells.public_price)} »)`);
    if (!type) msgs.push(`type d'unité non reconnu (« ${cellText(cells.type)} »)`);
    if (discount === "invalid") msgs.push(`remise illisible (« ${cellText(cells.discount)} »)`);
    if (outletsN !== null && !(Number.isInteger(outletsN) && outletsN >= 1 && outletsN <= 8)) msgs.push("nombre de sorties entre 1 et 8");
    if (precharged !== null && (precharged < 0 || precharged > 200)) msgs.push("longueur pré-chargée illisible");
    if (gPerM !== null && (gPerM < 0 || gPerM > 500)) msgs.push("charge complémentaire illisible (g/m)");
    if (dia && !/^\d+\/\d+"?\s*[-–/]\s*\d+\/\d+"?$/.test(dia)) msgs.push(`diamètres illisibles (« ${dia} », attendu 1/4 - 3/8)`);
    if (msgs.length) {
      errors.push({ line, message: msgs.join(", ") });
      continue;
    }
    out.push({
      line,
      brand,
      reference,
      type: type!,
      range_name: cellText(cells.range_name) || null,
      cooling_kw: parseKw(cells.cooling_kw),
      heating_kw: parseKw(cells.heating_kw),
      max_outlets: outletsN,
      link_diameters: dia ? dia.replace(/\s*[-–]\s*/, " - ") : null,
      precharged_length_m: precharged,
      extra_charge_g_per_m: gPerM === null ? null : Math.round(gPerM),
      public_price_cents: price!,
      discount_rate: discount as number | null,
      ...offerCells(cells, net),
      discount_family: cellText(cells.discount_family) || cellText(cells.range_name) || null,
    });
  }
  return { rows: out, errors };
}

function offerCells(cells: MappedRow, net: number | null) {
  return {
    supplier_ref: cellText(cells.supplier_ref) || null,
    ean: normalizeEan(cellText(cells.ean)),
    discount_family: cellText(cells.discount_family) || null,
    net_price_cents: net,
  };
}

export function normalizeAccessoryRows(rows: { line: number; cells: MappedRow }[], defaults: ImportDefaults) {
  const out: AccessoryRow[] = [];
  const errors: RowError[] = [];
  for (const { line, cells } of rows) {
    const reference = cellText(cells.reference);
    const name = cellText(cells.name);
    const hasPublic = cells.public_price !== undefined && cellText(cells.public_price) !== "";
    const hasNet = cells.net_price !== undefined && cellText(cells.net_price) !== "";
    const price = hasPublic ? parsePriceCents(cells.public_price) : null;
    const net = hasNet ? parsePriceCents(cells.net_price) : null;
    const discount = parseDiscount(cells.discount);
    const msgs: string[] = [];
    if (!reference) msgs.push("référence manquante");
    if (!name) msgs.push("désignation manquante");
    if (hasPublic && (price === null || price === 0)) msgs.push(`prix illisible (« ${cellText(cells.public_price)} »)`);
    if (hasNet && net === null) msgs.push(`prix net illisible (« ${cellText(cells.net_price)} »)`);
    if (!hasPublic && !hasNet) msgs.push("prix manquant");
    if (discount === "invalid") msgs.push(`remise illisible (« ${cellText(cells.discount)} »)`);
    if (msgs.length) {
      errors.push({ line, message: msgs.join(", ") });
      continue;
    }
    out.push({
      line,
      reference,
      name,
      category: (cellText(cells.category) || defaults.category || "autre").toLowerCase(),
      diameter: cellText(cells.diameter) || null,
      unit: parseUnit(cells.unit) ?? "u",
      public_price_cents: price,
      discount_rate: discount as number | null,
      ...offerCells(cells, net),
    });
  }
  return { rows: out, errors };
}

// ---------------------------------------------------------------------------
// Plan d'import
// ---------------------------------------------------------------------------

/** Tarif actuel du fournisseur importé pour un article. */
export interface ExistingOffer {
  public_price_cents: number | null;
  net_price_cents: number | null;
  discount_rate: number | null;
  match_status: "certain" | "probable" | "manuel";
}

export interface ExistingItem {
  id: string;
  brand?: string; // matériel uniquement
  reference: string;
  ean?: string | null;
  label: string;
  /** Offre du fournisseur importé pour cet article (null = pas encore chez lui). */
  offer: ExistingOffer | null;
}

export interface PriceChange {
  id: string;
  line: number;
  label: string;
  oldPriceCents: number;
  newPriceCents: number;
  /** Variation relative (0.07 = +7 %). */
  change: number;
}

export interface OfferData {
  supplier_ref: string | null;
  manufacturer_ref: string;
  ean: string | null;
  designation: string | null;
  public_price_cents: number | null;
  net_price_cents: number | null;
  discount_family: string | null;
  /** Absente = ne pas toucher à la remise existante. */
  discount_rate?: number;
}

export interface OfferUpsert extends OfferData {
  item_id: string;
  match_status: "certain" | "probable";
  match_reason: string;
}

export interface ProbableMatch {
  line: number;
  label: string;
  candidateId: string;
  candidateLabel: string;
}

export interface ImportPlan {
  /** Nouveaux articles, chacun avec son offre (`offer`). */
  creates: Record<string, unknown>[];
  /** Offres du fournisseur pour des articles existants (création ou mise à jour). */
  offers: OfferUpsert[];
  /** Champs techniques mis à jour (matériel, correspondance certaine). */
  updates: Record<string, unknown>[];
  probable: ProbableMatch[];
  brandsToCreate: { name: string }[];
  priceChanges: PriceChange[];
  errors: RowError[];
  summary: {
    newItems: number;
    /** Articles déjà au catalogue, nouveaux chez ce fournisseur. */
    newOffers: number;
    probable: number;
    priceChanges: number;
    bigIncreases: number;
    decreases: number;
    discountChanges: number;
    unchanged: number;
    errors: number;
  };
}

const keyOf = (brand: string | undefined, reference: string) => `${(brand ?? "").trim().toLowerCase()}|${normalizeReference(reference)}`;

function offerOf(row: MaterialRow | AccessoryRow, designation: string | null): OfferData {
  const o: OfferData = {
    supplier_ref: row.supplier_ref,
    manufacturer_ref: row.reference,
    ean: row.ean,
    designation,
    public_price_cents: row.public_price_cents,
    net_price_cents: row.net_price_cents,
    discount_family: row.discount_family,
  };
  if (row.discount_rate !== null) o.discount_rate = row.discount_rate;
  return o;
}

const TECH_FIELDS = ["range_name", "cooling_kw", "heating_kw", "max_outlets", "link_diameters", "precharged_length_m", "extra_charge_g_per_m"] as const;

export function buildPlan(target: ImportTarget, rows: (MaterialRow | AccessoryRow)[], existing: ExistingItem[], existingBrands: string[], rowErrors: RowError[] = []): ImportPlan {
  const index = buildMatchIndex(
    existing.map((e) => ({
      id: e.id,
      reference: e.reference,
      brandName: e.brand ?? null,
      ean: e.ean ?? null,
    })),
  );
  const byId = new Map(existing.map((e) => [e.id, e]));
  const brandSet = new Map(existingBrands.map((b) => [b.trim().toLowerCase(), b]));
  const seen = new Map<string, number>();
  const taken = new Set<string>();
  const plan: ImportPlan = {
    creates: [],
    offers: [],
    updates: [],
    probable: [],
    brandsToCreate: [],
    priceChanges: [],
    errors: [...rowErrors],
    summary: {
      newItems: 0,
      newOffers: 0,
      probable: 0,
      priceChanges: 0,
      bigIncreases: 0,
      decreases: 0,
      discountChanges: 0,
      unchanged: 0,
      errors: 0,
    },
  };

  for (const row of rows) {
    const brand = "brand" in row ? row.brand : undefined;
    const key = keyOf(brand, row.reference);
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      plan.errors.push({ line: row.line, message: `référence en double (déjà ligne ${firstLine}), ligne ignorée` });
      continue;
    }
    seen.set(key, row.line);

    // Marque : on réutilise l'orthographe existante (« DAIKIN » = « Daikin »)
    let brandName = brand;
    if (brand !== undefined) {
      const known = brandSet.get(brand.trim().toLowerCase());
      if (known) brandName = known;
      else {
        brandSet.set(brand.trim().toLowerCase(), brand.trim());
        plan.brandsToCreate.push({ name: brand.trim() });
        brandName = brand.trim();
      }
    }
    const designation = target === "accessoires" ? (row as AccessoryRow).name : null;
    const rowLabel = target === "materiel" ? `${brandName} ${row.reference}` : `${row.reference} – ${designation}`;

    let match = matchWithIndex(index, {
      reference: row.reference,
      brandName: brandName ?? null,
      ean: row.ean,
    });
    if (match.candidateId && taken.has(match.candidateId)) {
      if (match.status === "certain") {
        plan.errors.push({
          line: row.line,
          message: "article déjà présent plus haut dans le fichier (même EAN ou même référence), ligne ignorée",
        });
        continue;
      }
      match = { status: "none", candidateId: null, reason: "" };
    }

    if (match.status === "none" || !match.candidateId) {
      const { line: _l, brand: _b, supplier_ref: _s, ean: _e, discount_family: _f, net_price_cents: _n, public_price_cents: _p, discount_rate: _d, ...data } = row as MaterialRow;
      plan.creates.push({
        ...(target === "materiel" ? { ...data, brand: brandName } : data),
        offer: offerOf(row, designation),
      });
      plan.summary.newItems++;
      continue;
    }

    const current = byId.get(match.candidateId)!;
    taken.add(current.id);
    if (match.status === "probable") {
      plan.probable.push({
        line: row.line,
        label: rowLabel,
        candidateId: current.id,
        candidateLabel: current.label,
      });
      plan.summary.probable++;
    }
    const offer = offerOf(row, designation);
    const prev = current.offer;
    if (target === "materiel" && match.status === "certain") {
      const m = row as MaterialRow;
      const update: Record<string, unknown> = { id: current.id };
      for (const k of TECH_FIELDS) if (m[k] !== null) update[k] = m[k];
      if (Object.keys(update).length > 1) plan.updates.push(update);
    }
    if (!prev) {
      plan.offers.push({
        ...offer,
        item_id: current.id,
        match_status: match.status,
        match_reason: match.reason,
      });
      if (match.status === "certain") plan.summary.newOffers++;
      continue;
    }
    const priceChanged = offer.public_price_cents !== prev.public_price_cents || offer.net_price_cents !== prev.net_price_cents;
    const discountChanged = offer.discount_rate !== undefined && offer.discount_rate !== prev.discount_rate;
    plan.offers.push({
      ...offer,
      item_id: current.id,
      match_status: match.status,
      match_reason: match.reason,
    });
    if (!priceChanged && !discountChanged) {
      plan.summary.unchanged++;
      continue;
    }
    if (discountChanged) plan.summary.discountChanges++;
    const oldP = prev.public_price_cents ?? prev.net_price_cents;
    const newP = offer.public_price_cents ?? offer.net_price_cents;
    if (priceChanged && oldP && newP !== null) {
      const change = (newP - oldP) / oldP;
      plan.priceChanges.push({
        id: current.id,
        line: row.line,
        label: current.label,
        oldPriceCents: oldP,
        newPriceCents: newP,
        change,
      });
      plan.summary.priceChanges++;
      if (change > BIG_INCREASE) plan.summary.bigIncreases++;
      if (change < 0) plan.summary.decreases++;
    }
  }
  plan.priceChanges.sort((a, b) => b.change - a.change);
  plan.errors.sort((a, b) => a.line - b.line);
  plan.summary.errors = plan.errors.length;
  return plan;
}

// ---------------------------------------------------------------------------
// Modèles à télécharger
// ---------------------------------------------------------------------------

export function templateCsv(target: ImportTarget): string {
  const rows =
    target === "materiel"
      ? [
          [
            "Marque",
            "Gamme",
            "Référence",
            "Code fournisseur",
            "EAN",
            "Famille de remise",
            "Type",
            "Puissance froid (kW)",
            "Puissance chaud (kW)",
            "Sorties max",
            "Diamètres liaisons",
            "Longueur pré-chargée (m)",
            "Charge complémentaire (g/m)",
            "Prix public HT",
            "Remise (%)",
          ],
          ["MaMarque", "Confort", "UE-35", "F-10235", "", "UE MONO", "Unité extérieure mono-split", "3,5", "4,0", "1", "1/4 - 3/8", "7,5", "20", "1090,00", "35"],
          ["MaMarque", "Confort", "MU-35", "F-10236", "", "MURAUX", "Murale", "3,5", "4,0", "", "1/4 - 3/8", "", "", "540,00", ""],
          ["MaMarque", "Multi", "M3-68", "F-10240", "", "UE MULTI", "Unité extérieure multi-split", "6,8", "8,6", "3", "", "30", "20", "2790,00", "35"],
          ["MaMarque", "Pro", "GA-50", "F-10250", "", "GAINABLES", "Gainable", "5,0", "6,0", "", "1/4 - 1/2", "", "", "1390,00", ""],
        ]
      : [
          ["Référence", "Code fournisseur", "Désignation", "Catégorie", "Famille de remise", "Diamètre", "Unité", "Prix public HT", "Remise (%)", "Prix net HT"],
          ["LIA-1438", "F-20001", "Liaison frigorifique isolée", "liaison", "LIAISONS", "1/4 - 3/8", "m", "12,00", "30", ""],
          ["GOU-8060", "F-20002", "Goulotte de finition 80 × 60", "goulotte", "GOULOTTES", "", "m", "14,00", "25", ""],
          ["POM-REL", "F-20003", "Pompe de relevage des condensats", "pompe", "", "", "u", "120,00", "", ""],
          ["CAROT-60", "F-20004", "Carottage Ø 60", "autre", "", "", "u", "", "", "18,00"],
        ];
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // BOM pour qu'Excel ouvre correctement les accents
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}
