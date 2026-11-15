/**
 * Import de tarif PDF par l'IA — partie PURE (testée) : schéma des lignes
 * extraites, sélection de pages, découpage en lots, quotas, et conversion des
 * lignes validées en « tableur virtuel » repris par l'import classique
 * (même aperçu, mêmes rapprochements, même transaction).
 */
import { z } from "zod";
import type { Cell, ImportTarget, Mapping } from "@/lib/catalog/import";

/** Pages envoyées par appel (taille de requête et durée maîtrisées). */
export const PAGES_PER_CHUNK = 5;
/** Taille maximale d'un lot envoyé au serveur (Vercel limite le corps à 4,5 Mo). */
export const MAX_CHUNK_BYTES = 3_500_000;

export const ExtractedRowSchema = z.object({
  page: z.number().int().describe("Numéro de page dans le lot reçu (1 = première page du lot)"),
  reference: z.string().describe("Référence fabricant (modèle) telle qu'imprimée"),
  designation: z.string().describe("Désignation / libellé de l'article"),
  brand: z.string().nullable().describe("Marque du fabricant si indiquée, sinon null"),
  supplier_ref: z.string().nullable().describe("Code article du distributeur s'il est distinct de la référence fabricant, sinon null"),
  ean: z.string().nullable().describe("Code EAN / GTIN (chiffres) s'il est imprimé, sinon null"),
  product_type: z.string().nullable().describe("Type d'unité si identifiable (unité extérieure, murale, console, cassette, gainable, multi-split, accessoire), sinon null"),
  cooling_kw: z.number().nullable().describe("Puissance froid nominale en kW, sinon null"),
  heating_kw: z.number().nullable().describe("Puissance chaud nominale en kW, sinon null"),
  public_price_eur: z.number().nullable().describe("Prix public HT en euros (nombre, point décimal), sinon null"),
  net_price_eur: z.number().nullable().describe("Prix net HT en euros si le tarif le donne, sinon null"),
  discount_percent: z.number().nullable().describe("Remise en pourcentage (35 pour 35 %) si imprimée sur la ligne, sinon null"),
  discount_family: z.string().nullable().describe("Famille / code / groupe de remise, sinon null"),
  unit: z.string().nullable().describe("Unité de vente (u, m, kg) si indiquée, sinon null"),
});
export type ExtractedRow = z.infer<typeof ExtractedRowSchema>;

export const ExtractionSchema = z.object({
  rows: z.array(ExtractedRowSchema),
});

/** Ligne affichée dans l'écran de validation (page = page du PDF d'origine). */
export interface ReviewRow extends ExtractedRow {
  sourcePage: number;
  /** Décochée = ignorée à l'import. */
  keep: boolean;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** « 1-4, 7 » → [1, 2, 3, 4, 7] (trié, sans doublon). Erreur si hors du document. */
export function parsePageSelection(text: string, pageCount: number): { pages: number[] } | { error: string } {
  const t = text.trim();
  if (t === "") return { pages: Array.from({ length: pageCount }, (_, i) => i + 1) };
  const set = new Set<number>();
  for (const part of t.split(/[,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d+)\s*(?:[-–à]\s*(\d+))?$/.exec(p);
    if (!m) return { error: `Pages illisibles : « ${p} » (exemple : 1-4, 7)` };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > pageCount)
      return {
        error: `Pages hors du document : « ${p} » (le PDF a ${pageCount} pages)`,
      };
    for (let i = a; i <= b; i++) set.add(i);
  }
  if (set.size === 0) return { error: "Aucune page choisie" };
  return { pages: [...set].sort((x, y) => x - y) };
}

/** [1, 2, 3, 4, 7] → « 1-4,7 » (clé de mémoire des analyses). */
export function formatPages(pages: number[]): string {
  const s = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
    i = j + 1;
  }
  return out.join(",");
}

export function chunkPages(pages: number[], size = PAGES_PER_CHUNK): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pages.length; i += size) out.push(pages.slice(i, i + size));
  return out;
}

export interface QuotaCheck {
  allowed: boolean;
  remainingBefore: number;
  remainingAfter: number;
  message: string;
}

/** Pages déjà analysées (mémoire) : gratuites. */
export function checkPdfQuota(pagesToAnalyse: number, used: number, quota: number): QuotaCheck {
  const remainingBefore = Math.max(0, quota - used);
  const remainingAfter = remainingBefore - pagesToAnalyse;
  const allowed = remainingAfter >= 0;
  const message = allowed
    ? `${pagesToAnalyse} page${pagesToAnalyse > 1 ? "s" : ""} à analyser — il vous restera ${remainingAfter} page${remainingAfter > 1 ? "s" : ""} ce mois-ci.`
    : `Quota insuffisant : ${pagesToAnalyse} pages demandées, ${remainingBefore} restante${remainingBefore > 1 ? "s" : ""} ce mois-ci. Choisissez moins de pages, ou importez le tarif Excel / CSV du fournisseur (gratuit et illimité).`;
  return { allowed, remainingBefore, remainingAfter, message };
}

// ---------------------------------------------------------------------------
// Lignes validées → tableur virtuel pour l'import classique
// ---------------------------------------------------------------------------

const HEADERS = {
  reference: "Référence",
  name: "Désignation",
  brand: "Marque",
  type: "Type d'unité",
  cooling_kw: "Puissance froid (kW)",
  heating_kw: "Puissance chaud (kW)",
  supplier_ref: "Code fournisseur",
  ean: "EAN",
  discount_family: "Famille de remise",
  public_price: "Prix public HT",
  net_price: "Prix net HT",
  discount: "Remise (%)",
  unit: "Unité",
} as const;

const euros = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

export function reviewRowsToTable(rows: ReviewRow[], target: ImportTarget): { table: Cell[][]; mapping: Mapping } {
  const keys: (keyof typeof HEADERS)[] =
    target === "materiel"
      ? ["reference", "brand", "type", "cooling_kw", "heating_kw", "supplier_ref", "ean", "discount_family", "public_price", "net_price", "discount"]
      : ["reference", "name", "supplier_ref", "ean", "discount_family", "public_price", "net_price", "discount", "unit"];
  const table: Cell[][] = [keys.map((k) => HEADERS[k])];
  for (const r of rows) {
    if (!r.keep) continue;
    const v: Record<keyof typeof HEADERS, Cell> = {
      reference: r.reference.trim(),
      name: r.designation.trim(),
      brand: r.brand ?? "",
      type: r.product_type ?? "",
      cooling_kw: r.cooling_kw === null ? "" : String(r.cooling_kw).replace(".", ","),
      heating_kw: r.heating_kw === null ? "" : String(r.heating_kw).replace(".", ","),
      supplier_ref: r.supplier_ref ?? "",
      ean: r.ean ?? "",
      discount_family: r.discount_family ?? "",
      public_price: euros(r.public_price_eur),
      net_price: euros(r.net_price_eur),
      discount: r.discount_percent === null ? "" : `${r.discount_percent} %`,
      unit: r.unit ?? "",
    };
    table.push(keys.map((k) => v[k]));
  }
  const mapping: Mapping = {};
  for (const k of keys) mapping[k] = HEADERS[k];
  return { table, mapping };
}

/** Contrôle de vraisemblance affiché à côté de chaque ligne (l'artisan corrige avant import). */
export function reviewWarnings(r: ExtractedRow): string[] {
  const w: string[] = [];
  if (!r.reference.trim()) w.push("référence vide");
  if (r.public_price_eur === null && r.net_price_eur === null) w.push("aucun prix");
  if (r.public_price_eur !== null && r.net_price_eur !== null && r.net_price_eur > r.public_price_eur) w.push("prix net supérieur au prix public");
  if (r.discount_percent !== null && (r.discount_percent < 0 || r.discount_percent >= 100)) w.push("remise invalide");
  if (r.public_price_eur !== null && r.public_price_eur > 100000) w.push("prix très élevé : vérifiez la virgule");
  return w;
}

/** Instructions données au modèle (stables : mises en cache côté API). */
export const EXTRACTION_SYSTEM_PROMPT = `Tu extrais des lignes de tarif fournisseur (climatisation, pompes à chaleur, accessoires frigorifiques) depuis des pages de catalogue PDF françaises.

Règles :
- Une ligne par article vendu ayant une référence. Ignore les titres, les en-têtes répétés, les notes de bas de page, les conditions générales et les pages sans article.
- Recopie les références exactement comme imprimées (casse, tirets, suffixes compris). N'invente jamais une référence, un EAN ou un prix.
- Les prix sont HT en euros : convertis « 1 234,56 € » en 1234.56. Si une colonne de prix n'est pas imprimée pour la ligne, mets null.
- « Prix public », « PPI », « tarif » = prix public. « Prix net », « votre prix », « prix remisé » = prix net.
- Un ensemble vendu comme un tout (unité intérieure + extérieure) avec une seule référence est un seul article ; s'il y a une référence par unité, fais une ligne par unité.
- Si la marque est indiquée en titre de page ou de section, reporte-la sur chaque ligne concernée.
- Le champ page est le numéro de page dans les pages reçues (la première page reçue est 1).
- Si aucune ligne de tarif n'apparaît, renvoie une liste vide.`;
