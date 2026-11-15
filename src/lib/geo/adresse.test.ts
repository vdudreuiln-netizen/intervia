import { describe, expect, it } from "vitest";
import { geocode, isSameCommune, parseGeocodeResponse } from "./adresse";

const sample = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-0.573, 44.8378] },
      properties: { label: "12 Rue Sainte-Catherine 33000 Bordeaux", name: "12 Rue Sainte-Catherine", postcode: "33000", city: "Bordeaux", citycode: "33063", type: "housenumber" },
    },
    { type: "Feature", geometry: null, properties: { label: "cassé" } },
  ],
};

describe("géocodage", () => {
  it("lit la réponse GeoJSON de la Géoplateforme", () => {
    expect(parseGeocodeResponse(sample)).toEqual([
      { label: "12 Rue Sainte-Catherine 33000 Bordeaux", street: "12 Rue Sainte-Catherine", postcode: "33000", city: "Bordeaux", citycode: "33063", lat: 44.8378, lng: -0.573 },
    ]);
  });
  it("réponse inattendue → liste vide", () => {
    expect(parseGeocodeResponse({ oops: true })).toEqual([]);
    expect(parseGeocodeResponse(null)).toEqual([]);
  });
  it("appelle le service avec la requête encodée", async () => {
    let called = "";
    const fake = (async (url: string) => {
      called = url;
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await geocode("12 rue Sainte-Catherine Bordeaux", 5, fake);
    expect(called).toContain("data.geopf.fr/geocodage/search");
    expect(called).toContain("q=12+rue+Sainte-Catherine+Bordeaux");
    expect(r).toHaveLength(1);
  });
  it("même commune : code INSEE, sinon code postal + nom", () => {
    expect(isSameCommune({ citycode: "33063" }, { citycode: "33063" })).toBe(true);
    expect(isSameCommune({ citycode: "33063" }, { citycode: "33281" })).toBe(false);
    expect(isSameCommune({ postcode: "33000", city: "Bordeaux" }, { postcode: "33000", city: "BORDEAUX" })).toBe(true);
  });
});
