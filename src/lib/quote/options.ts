/**
 * Propositions automatiques : pour chaque configuration (mono, multi,
 * gainable), jusqu'à 3 options d'une seule marque chacune :
 *  - Éco     : prix client le plus bas
 *  - Confort : meilleure marge nette pour l'artisan
 *  - Premium : marque préférée (paramètres)
 * Éco et Confort sont choisies parmi les options SANS alerte (rien sous le
 * coût, marge/jour ≥ objectif) quand il y en a ; sinon l'alerte est affichée.
 * Deux options identiques (même marque) sont fusionnées.
 */
import { computeQuote, type PricingSettings, type QuoteResult, type TravelFee } from "@/lib/pricing/engine";
import type { LaborDaysParams } from "@/lib/sizing/sizing";
import { buildEquipment, type EquipmentOptions } from "./equipment";
import { buildLines, enabledLines, proposeDays, type LineSettings } from "./lines";
import { EMPTY_METRE, type CatAccessory, type CatProduct, type ConfigKind, type Equipment, type OptionTag, type RoomNeed } from "./types";

export interface PricedOption {
  tags: OptionTag[];
  equipment: Equipment;
  laborDays: number;
  result: QuoteResult;
  warnings: string[];
}

export interface ConfigProposal {
  kind: ConfigKind;
  options: PricedOption[];
  /** Pourquoi aucune option (ex. « au moins 2 pièces »). */
  unavailable?: string;
  /** La marque préférée ne permet pas cette configuration. */
  premiumNote?: string;
  /** Options écartées d'Éco / Confort car en alerte (sous l'objectif, sous le coût). */
  excluded: PricedOption[];
}

export interface ProposalInput {
  rooms: RoomNeed[];
  products: CatProduct[];
  accessories: CatAccessory[];
  equipmentOptions: EquipmentOptions;
  lineSettings: LineSettings;
  pricing: PricingSettings;
  laborParams: LaborDaysParams & { zoningPerRoom?: number };
  /** Frais de déplacement pour un nombre de jours donné. */
  travelFor: (laborDays: number) => TravelFee | null;
  preferredBrandId: string | null;
}

/** Chiffre complètement une configuration avec le métré par défaut. */
export function priceEquipment(eq: Equipment, input: ProposalInput): Omit<PricedOption, "tags"> {
  const days = proposeDays(eq, EMPTY_METRE, input.laborParams);
  const built = buildLines(eq, input.rooms, EMPTY_METRE, input.accessories, input.lineSettings, days, input.travelFor(days));
  const result = computeQuote({ lines: enabledLines(built.lines), laborDays: days, settings: input.pricing });
  return { equipment: eq, laborDays: days, result, warnings: [...eq.warnings, ...built.warnings] };
}

export function proposeConfigurations(input: ProposalInput): ConfigProposal[] {
  const brandIds = [...new Set(input.products.map((p) => p.brandId))];
  return (["mono", "multi", "gainable"] as ConfigKind[]).map((kind) => {
    const priced: Omit<PricedOption, "tags">[] = [];
    let lastReason = "Aucune marque du catalogue ne permet cette configuration";
    for (const brandId of brandIds) {
      const r = buildEquipment(kind, brandId, input.rooms, input.products, input.equipmentOptions);
      if (r.ok) priced.push(priceEquipment(r.equipment, input));
      else lastReason = r.reason;
    }
    if (priced.length === 0) return { kind, options: [], unavailable: lastReason, excluded: [] };

    const clean = priced.filter((p) => p.result.alerts.length === 0);
    const pool = clean.length > 0 ? clean : priced;
    const eco = [...pool].sort((a, b) => a.result.totalTtcCents - b.result.totalTtcCents)[0]!;
    const confort = [...pool].sort((a, b) => b.result.margin.netMarginCents - a.result.margin.netMarginCents)[0]!;
    const premium = input.preferredBrandId ? priced.find((p) => p.equipment.brandId === input.preferredBrandId) : undefined;

    const options: PricedOption[] = [];
    const push = (o: Omit<PricedOption, "tags"> | undefined, tag: OptionTag) => {
      if (!o) return;
      const same = options.find((x) => x.equipment.brandId === o.equipment.brandId);
      if (same) same.tags.push(tag);
      else options.push({ ...o, tags: [tag] });
    };
    push(eco, "eco");
    push(confort, "confort");
    push(premium, "premium");

    let premiumNote: string | undefined;
    if (!input.preferredBrandId) premiumNote = "Choisissez votre marque préférée dans les paramètres pour l'option Premium";
    else if (!premium) premiumNote = "Votre marque préférée ne permet pas cette configuration";
    const shown = new Set(options.map((o) => o.equipment.brandId));
    const excluded = clean.length > 0 ? priced.filter((p) => p.result.alerts.length > 0 && !shown.has(p.equipment.brandId)).map((p) => ({ ...p, tags: [] })) : [];
    return { kind, options, premiumNote, excluded };
  });
}
