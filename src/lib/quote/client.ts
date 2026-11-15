/**
 * Étape 1 de l'assistant : client et chantier.
 */
import { parseDecimal, parseEuros } from "@/lib/format";
import { isValidEmail, isValidFrenchPhone } from "@/lib/company/validation";

export interface ClientSiteForm {
  client_name: string;
  client_phone: string;
  client_email: string;
  client_address: string;
  client_postal_code: string;
  client_city: string;
  site_same: boolean;
  site_address: string;
  site_postal_code: string;
  site_city: string;
  site_citycode: string;
  site_lat: string;
  site_lng: string;
  one_way_km: string;
  same_commune: boolean;
  parking_enabled: boolean;
  parking_per_day: string;
}

export type ClientSiteErrors = Partial<Record<keyof ClientSiteForm, string>>;

export interface ClientSiteValues {
  client: { name: string; phone: string | null; email: string | null; address_line: string | null; postal_code: string | null; city: string | null };
  site: {
    site_address: string | null;
    site_postal_code: string | null;
    site_city: string | null;
    site_citycode: string | null;
    site_lat: number | null;
    site_lng: number | null;
    one_way_km: number | null;
    same_commune: boolean;
    parking_enabled: boolean;
    parking_per_day_cents: number | null;
  };
}

export function parseClientSite(f: ClientSiteForm): { ok: boolean; values: ClientSiteValues; errors: ClientSiteErrors } {
  const e: ClientSiteErrors = {};
  const t = (s: string) => (s.trim() === "" ? null : s.trim());
  if (!f.client_name.trim()) e.client_name = "Indiquez le nom du client";
  if (f.client_phone.trim() && !isValidFrenchPhone(f.client_phone)) e.client_phone = "Numéro de téléphone invalide";
  if (f.client_email.trim() && !isValidEmail(f.client_email)) e.client_email = "Adresse e-mail invalide";
  const site = f.site_same
    ? { a: f.client_address, p: f.client_postal_code, c: f.client_city }
    : { a: f.site_address, p: f.site_postal_code, c: f.site_city };
  if (!site.c.trim()) e[f.site_same ? "client_city" : "site_city"] = "Indiquez la ville du chantier";
  let km: number | null = null;
  if (f.one_way_km.trim() !== "") {
    km = parseDecimal(f.one_way_km);
    if (km === null || km < 0 || km > 1000) e.one_way_km = "Distance en km (aller simple)";
  } else if (!f.same_commune) e.one_way_km = "Indiquez la distance (ou cochez « dans ma commune »)";
  let parking: number | null = null;
  if (f.parking_enabled) {
    parking = parseEuros(f.parking_per_day || "0");
    if (parking === null || parking < 0) e.parking_per_day = "Montant invalide";
  }
  const lat = parseDecimal(f.site_lat);
  const lng = parseDecimal(f.site_lng);
  return {
    ok: Object.keys(e).length === 0,
    errors: e,
    values: {
      client: { name: f.client_name.trim(), phone: t(f.client_phone), email: t(f.client_email), address_line: t(f.client_address), postal_code: t(f.client_postal_code), city: t(f.client_city) },
      site: {
        site_address: t(site.a),
        site_postal_code: t(site.p),
        site_city: t(site.c),
        site_citycode: t(f.site_citycode),
        site_lat: lat,
        site_lng: lng,
        one_way_km: f.same_commune ? 0 : km,
        same_commune: f.same_commune,
        parking_enabled: f.parking_enabled,
        parking_per_day_cents: parking,
      },
    },
  };
}
