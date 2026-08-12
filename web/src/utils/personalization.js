// All personal features (favorites, recent history, default home view) are
// pure client-side localStorage -- no account/backend, so they're per
// device/browser only, which matches this app's no-login design.

const KEYS = {
  favStops: "tw-transit:fav-stops",
  favRoutes: "tw-transit:fav-routes",
  recentStops: "tw-transit:recent-stops",
  recentRoutes: "tw-transit:recent-routes",
  home: "tw-transit:home",
};

const MAX_RECENTS = 10;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private browsing, quota) -- personalization is
    // best-effort, silently no-op rather than breaking the feature it's attached to.
  }
}

export function getFavoriteStops() {
  return readJson(KEYS.favStops, []);
}

export function isFavoriteStop(city, stationId) {
  return getFavoriteStops().some((f) => f.city === city && f.station.StationID === stationId);
}

export function toggleFavoriteStop(city, station) {
  const list = getFavoriteStops();
  const idx = list.findIndex((f) => f.city === city && f.station.StationID === station.StationID);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift({ city, station });
  writeJson(KEYS.favStops, list);
  return list;
}

export function getFavoriteRoutes() {
  return readJson(KEYS.favRoutes, []);
}

export function isFavoriteRoute(city, routeId) {
  return getFavoriteRoutes().some((f) => f.city === city && f.routeId === routeId);
}

export function toggleFavoriteRoute(city, routeId, routeName) {
  const list = getFavoriteRoutes();
  const idx = list.findIndex((f) => f.city === city && f.routeId === routeId);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift({ city, routeId, routeName });
  writeJson(KEYS.favRoutes, list);
  return list;
}

function pushRecent(key, entry, matches) {
  const list = readJson(key, []).filter((e) => !matches(e));
  list.unshift(entry);
  writeJson(key, list.slice(0, MAX_RECENTS));
}

export function getRecentStops() {
  return readJson(KEYS.recentStops, []);
}

export function recordRecentStop(city, station) {
  pushRecent(KEYS.recentStops, { city, station }, (e) => e.city === city && e.station.StationID === station.StationID);
}

export function clearRecentStops() {
  writeJson(KEYS.recentStops, []);
}

export function getRecentRoutes() {
  return readJson(KEYS.recentRoutes, []);
}

export function recordRecentRoute(city, routeId, routeName) {
  pushRecent(KEYS.recentRoutes, { city, routeId, routeName }, (e) => e.city === city && e.routeId === routeId);
}

export function clearRecentRoutes() {
  writeJson(KEYS.recentRoutes, []);
}

export function getHome() {
  return readJson(KEYS.home, null);
}

export function setHome(home) {
  writeJson(KEYS.home, home);
}

// Mirrors which arrival-notification watches are active, purely for the
// bell icon's on/off UI state -- the server's KV record (see
// worker/src/index.js's push-watch/push-unwatch handlers) is the actual
// source of truth for whether a push fires.
const WATCH_KEY = "tw-transit:push-watches";

export function getActiveWatchIds() {
  return readJson(WATCH_KEY, []);
}

export function isWatchActive(watchId) {
  return getActiveWatchIds().includes(watchId);
}

export function setWatchActive(watchId, active) {
  const list = getActiveWatchIds().filter((id) => id !== watchId);
  if (active) list.push(watchId);
  writeJson(WATCH_KEY, list);
}
