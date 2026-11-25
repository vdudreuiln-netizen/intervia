/**
 * Distance routière base → chantier via le service d'itinéraire de l'IGN
 * (Géoplateforme, gratuit, sans clé, 5 requêtes/s). Repli : distance à vol
 * d'oiseau × 1,3 (estimation signalée), toujours modifiable à la main.
 */

export const ROUTE_URL = "https://data.geopf.fr/navigation/itineraire";
export const DETOUR_FACTOR = 1.3;

export interface Point {
  lat: number;
  lng: number;
}

export interface RouteDistance {
  oneWayKm: number;
  source: "route" | "estimation";
}

/** Distance à vol d'oiseau (formule de haversine), en km. */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function routeUrl(from: Point, to: Point): string {
  const params = new URLSearchParams({
    resource: "bdtopo-osrm",
    profile: "car",
    optimization: "fastest",
    start: `${from.lng},${from.lat}`,
    end: `${to.lng},${to.lat}`,
    distanceUnit: "kilometer",
    geometryFormat: "geojson",
    getSteps: "false",
  });
  return `${ROUTE_URL}?${params}`;
}

/** Lit la distance de la réponse (en km, ou en m si l'unité renvoyée est le mètre). */
export function parseRouteResponse(json: unknown): number | null {
  const j = json as { distance?: unknown; distanceUnit?: unknown };
  const d = typeof j?.distance === "number" ? j.distance : typeof j?.distance === "string" ? Number(j.distance) : NaN;
  if (!Number.isFinite(d) || d < 0) return null;
  const km = j.distanceUnit === "meter" ? d / 1000 : d;
  return Math.round(km * 10) / 10;
}

export async function roadDistance(from: Point, to: Point, fetchImpl: typeof fetch = fetch): Promise<RouteDistance> {
  try {
    const res = await fetchImpl(routeUrl(from, to), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const km = parseRouteResponse(await res.json());
      if (km !== null) return { oneWayKm: km, source: "route" };
    }
  } catch {
    // service indisponible : estimation
  }
  return { oneWayKm: Math.round(haversineKm(from, to) * DETOUR_FACTOR * 10) / 10, source: "estimation" };
}
