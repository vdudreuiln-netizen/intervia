import { describe, expect, it } from "vitest";
import { parseClientSite, type ClientSiteForm } from "./client";

const base: ClientSiteForm = {
  client_name: "M. Martin",
  client_phone: "06 12 34 56 78",
  client_email: "",
  client_address: "3 rue des Lilas",
  client_postal_code: "33700",
  client_city: "Mérignac",
  site_same: true,
  site_address: "",
  site_postal_code: "",
  site_city: "",
  site_citycode: "33281",
  site_lat: "44.84",
  site_lng: "-0.64",
  one_way_km: "8,4",
  same_commune: false,
  parking_enabled: true,
  parking_per_day: "40",
};

describe("client et chantier", () => {
  it("chantier = adresse du client, distance et stationnement", () => {
    const r = parseClientSite(base);
    expect(r.ok).toBe(true);
    expect(r.values.site).toMatchObject({ site_city: "Mérignac", one_way_km: 8.4, parking_per_day_cents: 4000, site_lat: 44.84 });
  });
  it("dans la commune : distance 0 sans saisie", () => {
    const r = parseClientSite({ ...base, one_way_km: "", same_commune: true });
    expect(r.ok).toBe(true);
    expect(r.values.site.one_way_km).toBe(0);
  });
  it("distance obligatoire hors commune, nom obligatoire", () => {
    const r = parseClientSite({ ...base, client_name: " ", one_way_km: "" });
    expect(Object.keys(r.errors).sort()).toEqual(["client_name", "one_way_km"]);
  });
});
