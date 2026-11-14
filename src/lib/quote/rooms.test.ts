import { describe, expect, it } from "vitest";
import { DEFAULT_SIZING } from "@/lib/sizing/sizing";
import { newRoom, parseRooms, toRoomNeeds } from "./rooms";

describe("saisie des pièces", () => {
  it("calcule le besoin et applique la puissance forcée", () => {
    const r = parseRooms([{ ...newRoom(0), name: "Salon", surface: "30", height: "2,5" }, { ...newRoom(1), surface: "12", overrideW: "2000" }], DEFAULT_SIZING);
    expect(r.ok).toBe(true);
    expect(r.values[0]!.need_watts).toBe(3140);
    expect(r.values[1]!.name).toBe("Pièce 2");
    expect(toRoomNeeds(r.values).map((x) => x.needW)).toEqual([3140, 2000]);
  });
  it("signale les saisies impossibles par pièce", () => {
    const bad = { ...newRoom(0), surface: "abc", height: "12" };
    const r = parseRooms([bad], DEFAULT_SIZING);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors[bad.id]!)).toEqual(["surface", "height"]);
  });
  it("au moins une pièce", () => {
    expect(parseRooms([], DEFAULT_SIZING).ok).toBe(false);
  });
});
