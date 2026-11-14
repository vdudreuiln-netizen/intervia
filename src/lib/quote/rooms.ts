/**
 * Saisie des pièces : validation et besoin calculé.
 */
import { parseDecimal } from "@/lib/format";
import { sizeRoom, type Insulation, type Orientation, type SizingCoefficients } from "@/lib/sizing/sizing";
import type { IndoorChoice, RoomNeed } from "./types";

export interface RoomForm {
  id: string; // uuid existant ou identifiant temporaire « new-… »
  name: string;
  surface: string;
  height: string;
  orientation: Orientation;
  insulation: Insulation;
  largeGlazing: boolean;
  underRoof: boolean;
  level: number;
  indoorType: IndoorChoice;
  overrideW: string; // besoin forcé par l'artisan (vide = calculé)
}

export interface RoomValues {
  id: string;
  name: string;
  surface_m2: number;
  ceiling_height_m: number;
  orientation: Orientation;
  insulation: Insulation;
  large_glazing: boolean;
  under_roof: boolean;
  level: number;
  indoor_type: IndoorChoice;
  need_watts: number;
  need_override_watts: number | null;
}

export const newRoom = (i: number): RoomForm => ({
  id: `new-${Date.now()}-${i}`,
  name: "",
  surface: "",
  height: "2,50",
  orientation: "S",
  insulation: "moyenne",
  largeGlazing: false,
  underRoof: false,
  level: 0,
  indoorType: "mural",
  overrideW: "",
});

export const LEVEL_LABELS: Record<number, string> = { [-1]: "Sous-sol", 0: "Rez-de-chaussée", 1: "1er étage", 2: "2e étage", 3: "3e étage" };

export function parseRooms(forms: RoomForm[], c: SizingCoefficients): { ok: boolean; values: RoomValues[]; errors: Record<string, Partial<Record<"name" | "surface" | "height" | "overrideW", string>>> } {
  const errors: Record<string, Partial<Record<"name" | "surface" | "height" | "overrideW", string>>> = {};
  const values: RoomValues[] = [];
  forms.forEach((f, i) => {
    const e: Partial<Record<"name" | "surface" | "height" | "overrideW", string>> = {};
    const surface = parseDecimal(f.surface);
    const height = parseDecimal(f.height);
    if (surface === null || surface <= 0 || surface > 500) e.surface = "Surface en m² (ex. 25)";
    if (height === null || height < 1.8 || height > 8) e.height = "Hauteur en m (ex. 2,50)";
    let override: number | null = null;
    if (f.overrideW.trim() !== "") {
      override = parseDecimal(f.overrideW);
      if (override === null || override <= 0 || override > 50000) e.overrideW = "Puissance en W (ex. 3500)";
      else override = Math.round(override);
    }
    if (Object.keys(e).length) {
      errors[f.id] = e;
      return;
    }
    const sized = sizeRoom({ name: f.name, surfaceM2: surface!, ceilingHeightM: height!, orientation: f.orientation, insulation: f.insulation, largeGlazing: f.largeGlazing, underRoof: f.underRoof }, c);
    values.push({
      id: f.id,
      name: f.name.trim() || `Pièce ${i + 1}`,
      surface_m2: surface!,
      ceiling_height_m: height!,
      orientation: f.orientation,
      insulation: f.insulation,
      large_glazing: f.largeGlazing,
      under_roof: f.underRoof,
      level: f.level,
      indoor_type: f.indoorType,
      need_watts: sized.watts,
      need_override_watts: override,
    });
  });
  return { ok: Object.keys(errors).length === 0 && forms.length > 0, values, errors };
}

export function toRoomNeeds(values: RoomValues[]): RoomNeed[] {
  return values.map((r) => ({ id: r.id, name: r.name, needW: r.need_override_watts ?? r.need_watts, level: r.level, indoorType: r.indoor_type }));
}
