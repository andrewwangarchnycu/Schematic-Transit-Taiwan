// The production build fails at build time (see vite.config.js) if
// VITE_API_BASE isn't set, so this dev-only fallback can never end up in a
// deployed bundle -- it only exists to make `npm run dev` work with zero
// config when the local Worker is running on its default port.
// Strip any trailing slash -- a value like "https://x.workers.dev/" would
// otherwise produce double-slash paths ("...dev//api/cities") that don't
// match the Worker's exact-string route table.
const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:8787" : "")).replace(/\/+$/, "");

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

async function postJson(path, body) {
  if (!API_BASE) {
    throw new Error("API not configured (VITE_API_BASE missing)");
  }
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(b.error || `Request failed (${resp.status})`);
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

// Schematic tab data: a fixed snapshot in web/public/data/, regenerated
// manually via `npm run fetch-network` (see scripts/fetch-network.mjs)
// rather than fetched live -- network topology barely changes, and every
// live /api/network call was several TDX requests against a tight quota.
export async function getNetworkManifest() {
  const resp = await fetch(`${import.meta.env.BASE_URL}data/manifest.json`);
  if (!resp.ok) return [];
  return resp.json();
}

export async function getStaticNetwork(city) {
  const resp = await fetch(`${import.meta.env.BASE_URL}data/network-${encodeURIComponent(city)}.json`);
  if (!resp.ok) {
    throw new Error(`No static network snapshot for ${city} yet`);
  }
  return resp.json();
}

// Nationwide TRA/THSR/Metro overlay (scripts/fetch-rail-network.mjs).
// Optional -- if it hasn't been generated yet, the Schematic tab just
// shows the bus network without it.
export async function getRailNetwork() {
  const resp = await fetch(`${import.meta.env.BASE_URL}data/rail-network.json`);
  if (!resp.ok) return null;
  return resp.json();
}

export function planTrip(origin, destination, { depart, arrival } = {}) {
  const params = {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  };
  if (depart) params.depart = depart;
  if (arrival) params.arrival = arrival;
  return getJson("/api/routing", params);
}

export function getNearby(lat, lng, city, radius = 500) {
  const params = { lat, lng, radius };
  if (city) params.city = city;
  return getJson("/api/nearby", params);
}

export function getStationStops(city, stationId) {
  return getJson("/api/station-stops", { city, stationId });
}

export async function geocodeAddress(query) {
  const result = await getJson("/api/geocode", { q: query });
  return result || null;
}

export function getRouteTimetable(city, routeId, stopId) {
  return getJson("/api/route-timetable", { city, routeId, stopId });
}

// Arrival push notifications: subscription set up client-side via the
// browser Push API (see utils/push.js), watches stored server-side in the
// Worker's KV so the scheduled cron can check TDX and send a push even
// when the app isn't open.
export function getPushVapidKey() {
  return getJson("/api/push-vapid-key", {});
}

export function pushWatch(subscription, watch) {
  return postJson("/api/push-watch", { subscription, watch });
}

export function pushUnwatch(endpoint, watchId) {
  return postJson("/api/push-unwatch", { endpoint, watchId });
}
