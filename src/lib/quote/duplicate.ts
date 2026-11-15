/**
 * Copie d'un devis : renumérotation des pièces dans l'état de l'assistant et
 * comparaison des prix (catalogue actuel vs devis d'origine).
 */
import type { PriceNotice, QuoteEdits } from "./types";

/** Remplace chaque identifiant (UUID) par son nouveau dans une structure JSON. */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  if (map.size === 0) return value;
  let json = JSON.stringify(value ?? null);
  for (const [from, to] of map) json = json.split(from).join(to);
  return JSON.parse(json) as T;
}

export interface ComparableLine {
  wizardKey: string | null;
  designation: string;
  unitSaleCents: number;
  unitPurchaseCents: number;
}

/**
 * Écarts entre les lignes du devis d'origine (clés déjà renumérotées) et celles
 * régénérées avec le catalogue actuel.
 *  - ligne non retouchée dont le prix de vente change : « updated » ;
 *  - ligne retouchée (prix conservé) dont le prix d'achat change : « override_kept »
 *    (à vérifier : la marge de cette ligne a bougé).
 */
export function priceNotices(before: ComparableLine[], after: ComparableLine[], edits: QuoteEdits | undefined): PriceNotice[] {
  const old = new Map(before.filter((l) => l.wizardKey).map((l) => [l.wizardKey!, l]));
  const out: PriceNotice[] = [];
  for (const l of after) {
    if (!l.wizardKey) continue;
    const o = old.get(l.wizardKey);
    if (!o) continue;
    const overridden = edits?.overrides[l.wizardKey]?.unitSaleCents !== undefined;
    if (overridden) {
      if (o.unitPurchaseCents !== l.unitPurchaseCents) {
        out.push({ designation: l.designation, kind: "override_kept", keptSaleCents: l.unitSaleCents });
      }
    } else if (o.unitSaleCents !== l.unitSaleCents) {
      out.push({ designation: l.designation, kind: "updated", fromCents: o.unitSaleCents, toCents: l.unitSaleCents });
    }
  }
  return out;
}
