import { describe, expect, it } from "vitest";
import { DEFAULT_SIZING, proposeLaborDays, sizeRoom, unitFitsNeed, type RoomInput } from "./sizing";

const salon: RoomInput = {
  name: "Salon",
  surfaceM2: 30,
  ceilingHeightM: 2.5,
  orientation: "S",
  insulation: "moyenne",
  largeGlazing: false,
  underRoof: false,
};

describe("dimensionnement par pièce", () => {
  it("volume × W/m³ × coefficients", () => {
    // 75 m³ × 38 W/m³ × 1,1 (sud) = 3 135 W → 3 140 W
    const s = sizeRoom(salon);
    expect(s.volumeM3).toBe(75);
    expect(s.watts).toBe(3140);
    expect(s.kw).toBe(3.14);
    expect(s.explanation).toContain("75 m³");
    expect(s.explanation).toContain("38 W/m³");
  });

  it("cumule toiture et vitrage", () => {
    // 75 × 38 × 1,1 × 1,2 × 1,15 = 4 326,3 → 4 330 W
    const s = sizeRoom({ ...salon, underRoof: true, largeGlazing: true });
    expect(s.watts).toBe(4330);
    expect(s.steps.map((x) => x.label)).toEqual(["Orientation Sud", "Sous toiture", "Vitrage important"]);
  });

  it("utilise les coefficients personnalisés de l'artisan", () => {
    const s = sizeRoom({ ...salon, insulation: "rt2012", orientation: "N" }, { ...DEFAULT_SIZING, wattsPerM3: { ...DEFAULT_SIZING.wattsPerM3, rt2012: 20 } });
    expect(s.watts).toBe(1350); // 75 × 20 × 0,9
  });

  it("refuse une surface nulle", () => {
    expect(() => sizeRoom({ ...salon, surfaceM2: 0 })).toThrow(RangeError);
  });

  it("plage de puissance cohérente pour le choix d'une unité", () => {
    expect(unitFitsNeed(3.5, 3.14)).toBe(true);
    expect(unitFitsNeed(2.5, 3.14)).toBe(false); // trop faible
    expect(unitFitsNeed(7.1, 3.14)).toBe(false); // surdimensionné
  });
});

describe("jours de main d'œuvre proposés", () => {
  it("mono-split simple : 1 jour", () => {
    // 0,25 + 0,5 + 0,25 = 1
    expect(proposeLaborDays({ outdoorUnits: 1, indoorUnits: ["mural"], totalLinkMeters: 4 })).toBe(1);
  });
  it("multi-split 3 murales + liaisons longues : arrondi au demi-jour supérieur", () => {
    // 0,25 + 1,5 + (30 − 15) × 0,02 + 0,25 = 2,3 → 2,5
    expect(proposeLaborDays({ outdoorUnits: 1, indoorUnits: ["mural", "mural", "mural"], totalLinkMeters: 30 })).toBe(2.5);
  });
  it("gainable : 2 jours", () => {
    expect(proposeLaborDays({ outdoorUnits: 1, indoorUnits: ["gainable"], totalLinkMeters: 5 })).toBe(2);
  });
  it("rien à poser : 0 jour", () => {
    expect(proposeLaborDays({ outdoorUnits: 0, indoorUnits: [], totalLinkMeters: 0 })).toBe(0);
  });
});
