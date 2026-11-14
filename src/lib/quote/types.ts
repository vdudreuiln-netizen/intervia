/**
 * Types partagés de l'assistant de devis (client ET serveur).
 */
import type { ProductType } from "@/lib/catalog/import";

export type IndoorChoice = "mural" | "console" | "cassette";
export type ConfigKind = "mono" | "multi" | "gainable";
export type OptionTag = "eco" | "confort" | "premium";

export const CONFIG_LABELS: Record<ConfigKind, string> = {
  mono: "Mono-splits (une unité extérieure par pièce)",
  multi: "Multi-split",
  gainable: "Gainable",
};
export const OPTION_LABELS: Record<OptionTag, string> = { eco: "Éco", confort: "Confort", premium: "Premium" };
export const OPTION_HINTS: Record<OptionTag, string> = {
  eco: "Prix client le plus bas",
  confort: "Meilleure marge nette",
  premium: "Votre marque préférée",
};

export type AutoRole =
  | "liaison"
  | "support_mural"
  | "support_sol"
  | "goulotte"
  | "condensats"
  | "pompe_relevage"
  | "cable_alim"
  | "cable_liaison"
  | "disjoncteur"
  | "gaz"
  | "plenum"
  | "gaine"
  | "bouche_soufflage"
  | "grille_reprise"
  | "registre_zonage"
  | "thermostat_zone"
  | "module_zonage";

export const AUTO_ROLE_LABELS: Record<AutoRole, string> = {
  liaison: "Liaison frigorifique (choisie selon le diamètre)",
  support_mural: "Support mural d'unité extérieure",
  support_sol: "Support au sol d'unité extérieure",
  goulotte: "Goulotte (au mètre)",
  condensats: "Évacuation des condensats (au mètre)",
  pompe_relevage: "Pompe de relevage",
  cable_alim: "Câble d'alimentation de l'unité extérieure (au mètre)",
  cable_liaison: "Câble de liaison extérieur / intérieur (au mètre)",
  disjoncteur: "Disjoncteur dédié",
  gaz: "Fluide de complément de charge (au kg)",
  plenum: "Gainable : plénum",
  gaine: "Gainable : gaine isolée (au mètre)",
  bouche_soufflage: "Gainable : bouche de soufflage",
  grille_reprise: "Gainable : grille de reprise",
  registre_zonage: "Zonage : registre motorisé",
  thermostat_zone: "Zonage : thermostat de pièce",
  module_zonage: "Zonage : module de régulation",
};

/** Produit du catalogue tel qu'utilisé par l'assistant. */
export interface CatProduct {
  id: string;
  brandId: string;
  brandName: string;
  reference: string;
  rangeName: string | null;
  type: ProductType;
  coolingKw: number | null;
  heatingKw: number | null;
  maxOutlets: number | null;
  maxIndoorRatio: number | null;
  linkDiameters: string | null;
  prechargedLengthM: number | null;
  extraChargeGPerM: number | null;
  publicPriceCents: number;
  brandDiscount: number;
  productDiscount: number | null;
  brandCoefficient: number;
}

export interface CatAccessory {
  id: string;
  role: AutoRole | null;
  category: string;
  name: string;
  diameter: string | null;
  unit: string;
  publicPriceCents: number;
  discount: number;
}

export interface RoomNeed {
  id: string;
  name: string;
  needW: number;
  level: number;
  indoorType: IndoorChoice;
}

/** Une unité extérieure et ses unités intérieures. */
export interface System {
  key: string;
  outdoor: CatProduct;
  indoors: { key: string; product: CatProduct; roomIds: string[] }[];
}

export interface Equipment {
  kind: ConfigKind;
  brandId: string;
  brandName: string;
  systems: System[];
  warnings: string[];
}

/** Sélection enregistrée (ids seulement : les prix sont relus dans le catalogue). */
export interface SavedSelection {
  kind: ConfigKind;
  brandId: string;
  systems: { key: string; outdoorId: string; indoors: { key: string; productId: string; roomIds: string[] }[] }[];
}

/** Métré : longueurs et choix de l'artisan, par clé d'unité / de ligne. */
export interface Metre {
  linkM: Record<string, number>; // par unité intérieure
  electricM: Record<string, number>; // par unité extérieure
  ductMPerRoom: Record<string, number>; // par gainable
  /** Lignes cochées / décochées explicitement (sinon : valeur par défaut). */
  toggles: Record<string, boolean>;
  /** Quantités forcées par l'artisan. */
  qty: Record<string, number>;
}

export const EMPTY_METRE: Metre = { linkM: {}, electricM: {}, ductMPerRoom: {}, toggles: {}, qty: {} };

export interface WizardState {
  selection?: SavedSelection;
  metre?: Metre;
  laborDays?: number | null; // null = proposé automatiquement
  materialCoefficient?: number | null;
  accessoryCoefficient?: number | null;
}
