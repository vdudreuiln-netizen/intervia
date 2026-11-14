import { describe, expect, it } from "vitest";
import { haversineKm, parseRouteResponse, roadDistance, routeUrl } from "./route";

const bordeaux = { lat: 44.8378, lng: -0.5792 };
const merignac = { lat: 44.8386, lng: -0.6436 };

describe("distance chantier", () => {
  it("vol d'oiseau Bordeaux – Mérignac ≈ 5 km", () => {
    expect(haversineKm(bordeaux, merignac)).toBeCloseTo(5.1, 0);
  });
  it("URL : coordonnées longitude,latitude, unité km", () => {
    const u = routeUrl(bordeaux, merignac);
    expect(u).toContain("data.geopf.fr/navigation/itineraire");
    expect(u).toContain("start=-0.5792%2C44.8378");
    expect(u).toContain("distanceUnit=kilometer");
  });
  it("lit la distance en km ou en m", () => {
    expect(parseRouteResponse({ distance: 8.437, distanceUnit: "kilometer" })).toBe(8.4);
    expect(parseRouteResponse({ distance: 8437, distanceUnit: "meter" })).toBe(8.4);
    expect(parseRouteResponse({ oops: 1 })).toBeNull();
  });
  it("utilise l'itinéraire routier quand le service répond", async () => {
    const fake = (async () => new Response(JSON.stringify({ distance: 8.4, distanceUnit: "kilometer" }))) as unknown as typeof fetch;
    expect(await roadDistance(bordeaux, merignac, fake)).toEqual({ oneWayKm: 8.4, source: "route" });
  });
  it("repli sur une estimation (vol d'oiseau × 1,3) si le service échoue", async () => {
    const down = (async () => new Response("erreur", { status: 503 })) as unknown as typeof fetch;
    const r = await roadDistance(bordeaux, merignac, down);
    expect(r.source).toBe("estimation");
    expect(r.oneWayKm).toBeCloseTo(6.6, 0);
  });
});
