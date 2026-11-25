/**
 * Rapprochement d'un même article chez plusieurs fournisseurs.
 *
 * Règles (validées) :
 *  - référence fabricant normalisée : majuscules, sans espaces, tirets, points
 *    ni barres obliques, préfixe de marque retiré ;
 *  - EAN identique = correspondance CERTAINE ;
 *  - référence normalisée identique = correspondance CERTAINE ;
 *  - les suffixes ne sont PAS retirés automatiquement : si une référence
 *    prolonge l'autre (ex. « MSZ-AP25VG » / « MSZ-AP25VGK »), c'est une
 *    correspondance PROBABLE, à confirmer par l'artisan.
 */

export type MatchStatus = "certain" | "probable" | "none";

const SEPARATORS = /[\s\-./\\_]+/g;

/** Normalise une référence fabricant pour la comparer d'un tarif à l'autre. */
export function normalizeManufacturerRef(ref: string, brandName?: string | null): string {
  let r = ref.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(SEPARATORS, "");
  if (brandName) {
    const b = brandName.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(SEPARATORS, "");
    if (b.length > 0 && r.startsWith(b) && r.length > b.length + 2) r = r.slice(b.length);
  }
  return r;
}

/** EAN-8 / EAN-13 / GTIN-14 : chiffres seulement, longueur plausible. */
export function normalizeEan(ean: string | null | undefined): string | null {
  if (!ean) return null;
  const d = String(ean).replace(/\D/g, "");
  return d.length >= 8 && d.length <= 14 ? d.padStart(13, "0") : null;
}

export interface MatchCandidate {
  id: string;
  reference: string;
  brandName: string | null;
  ean?: string | null;
}

export interface MatchResult {
  status: MatchStatus;
  candidateId: string | null;
  /** Explication courte affichée à l'artisan. */
  reason: string;
}

/** Longueur minimale de la partie commune pour proposer une correspondance probable. */
const MIN_PROBABLE = 5;

export interface MatchIndex {
  byEan: Map<string, MatchCandidate>;
  /** marque normalisée → (référence normalisée → candidat) */
  byBrand: Map<string, Map<string, MatchCandidate>>;
}

const brandKey = (b: string | null | undefined) => (b ? normalizeManufacturerRef(b) : "");

/** Index des articles existants (à construire une fois par import). */
export function buildMatchIndex(candidates: MatchCandidate[]): MatchIndex {
  const byEan = new Map<string, MatchCandidate>();
  const byBrand = new Map<string, Map<string, MatchCandidate>>();
  for (const c of candidates) {
    const e = normalizeEan(c.ean);
    if (e && !byEan.has(e)) byEan.set(e, c);
    const k = brandKey(c.brandName);
    const m = byBrand.get(k) ?? new Map<string, MatchCandidate>();
    const r = normalizeManufacturerRef(c.reference, c.brandName);
    if (r && !m.has(r)) m.set(r, c);
    byBrand.set(k, m);
  }
  return { byEan, byBrand };
}

export function matchWithIndex(index: MatchIndex, item: { reference: string; brandName: string | null; ean?: string | null }): MatchResult {
  const ean = normalizeEan(item.ean);
  if (ean) {
    const c = index.byEan.get(ean);
    if (c) return { status: "certain", candidateId: c.id, reason: "EAN identique" };
  }
  const ref = normalizeManufacturerRef(item.reference, item.brandName);
  if (!ref) return { status: "none", candidateId: null, reason: "Référence vide" };
  // Sans marque connue d'un côté ou de l'autre : on cherche dans toutes les marques
  const pools = item.brandName ? [index.byBrand.get(brandKey(item.brandName)), index.byBrand.get("")] : [...index.byBrand.values()];
  for (const pool of pools) {
    const c = pool?.get(ref);
    if (c)
      return {
        status: "certain",
        candidateId: c.id,
        reason: "Même référence fabricant",
      };
  }
  let best: MatchCandidate | null = null;
  let bestGap = Infinity;
  for (const pool of pools) {
    if (!pool) continue;
    for (const [other, c] of pool) {
      const [short, long] = other.length <= ref.length ? [other, ref] : [ref, other];
      if (short.length >= MIN_PROBABLE && long.startsWith(short)) {
        const gap = long.length - short.length;
        if (gap < bestGap || (gap === bestGap && best && c.id < best.id)) {
          best = c;
          bestGap = gap;
        }
      }
    }
  }
  if (best)
    return {
      status: "probable",
      candidateId: best.id,
      reason: "Référence proche (suffixe différent) : à confirmer",
    };
  return {
    status: "none",
    candidateId: null,
    reason: "Aucun article correspondant",
  };
}

/** Rapproche un article d'une liste de candidats (voir les règles en tête de fichier). */
export function matchArticle(item: { reference: string; brandName: string | null; ean?: string | null }, candidates: MatchCandidate[]): MatchResult {
  return matchWithIndex(buildMatchIndex(candidates), item);
}
