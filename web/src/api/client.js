// The production build fails at build time (see vite.config.js) if
// VITE_API_BASE isn't set, so this dev-only fallback can never end up in a
// deployed bundle -- it only exists to make `npm run dev` work with zero
// config when the local Worker is running on its default port.
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:8787" : "");

async function getJson(path, params) {
  if (!API_BASE) {
    throw new Error("API not configured (VITE_API_BASE missing)");
  }
  const qs = new URLSearchParams(params);
  const resp = await fetch(`${API_BASE}${path}?${qs.toString()}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${resp.status})`);
  }
  return resp.json();
}

export function getCities() {
  return getJson("/api/cities", {});
}

export function searchStations(city, keyword) {
  return getJson("/api/search", { city, keyword });
}

export function getStopEta(city, stopIds) {
  return getJson("/api/stop-eta", { city, stopIds: stopIds.join(",") });
}

export function getRouteStops(city, routeId) {
  return getJson("/api/route-stops", { city, routeId });
}

export function searchRoutes(city, keyword) {
  return getJson("/api/route-search", { city, keyword });
}

export function getNetwork(city) {
  return getJson("/api/network", { city });
}

export function planTrip(origin, destination) {
  return getJson("/api/routing", {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  });
}
