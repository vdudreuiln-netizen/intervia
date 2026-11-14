/**
 * Géocodage via le service public de l'IGN (Géoplateforme), successeur de
 * l'API Adresse (api-adresse.data.gouv.fr, décommissionnée début 2026).
 * Gratuit, sans clé. Doc : https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage
 */

export const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";

export interface AddressSuggestion {
  label: string;
  street: string;
  postcode: string;
  city: string;
  /** Code INSEE de la commune : sert à savoir si le chantier est « dans la commune ». */
  citycode: string;
  lat: number;
  lng: number;
}

interface GeoJsonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    name?: string;
    postcode?: string;
    city?: string;
    citycode?: string;
    type?: string;
  };
}

export function parseGeocodeResponse(json: unknown): AddressSuggestion[] {
  const features = (json as { features?: GeoJsonFeature[] })?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f) => {
    const p = f.properties;
    const c = f.geometry?.coordinates;
    if (!p?.label || !c || c.length < 2) return [];
    return [{
      label: p.label,
      street: p.type === "municipality" ? "" : p.name ?? "",
      postcode: p.postcode ?? "",
      city: p.city ?? "",
      citycode: p.citycode ?? "",
      lng: c[0],
      lat: c[1],
    }];
  });
}

export async function geocode(query: string, limit = 5, fetchImpl: typeof fetch = fetch): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `${GEOCODE_URL}?${new URLSearchParams({ q, limit: String(limit), index: "address" })}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Géocodage indisponible (${res.status})`);
  return parseGeocodeResponse(await res.json());
}

/** Même commune ? (code INSEE si disponible, sinon code postal + nom normalisé) */
export function isSameCommune(
  a: { citycode?: string | null; postcode?: string | null; city?: string | null },
  b: { citycode?: string | null; postcode?: string | null; city?: string | null },
): boolean {
  if (a.citycode && b.citycode) return a.citycode === b.citycode;
  const norm = (s?: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  return !!a.postcode && a.postcode === b.postcode && norm(a.city) === norm(b.city);
}
