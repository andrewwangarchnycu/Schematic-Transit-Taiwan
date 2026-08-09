#!/usr/bin/env node
// Manually run to (re)generate the static network data the Schematic tab
// reads from web/public/data/. Deliberately not called at build time or
// runtime -- the whole point is that the schematic uses a fixed snapshot
// the site owner refreshes on their own schedule, not a live TDX fetch on
// every visit.
//
// Talks to TDX directly (same auth + pagination shape as
// tdx_taichung_bus_schematic.py) rather than going through the deployed
// Worker's /api/network: a mid-size city's Bus/Station + Bus/StopOfRoute
// pull can take 20-30 paginated calls, and this account's TDX plan allows
// only 5 requests/minute -- properly spacing that (12s between every call)
// takes minutes, which is far past what a single Cloudflare Worker
// invocation is allowed to run. A plain Node script has no such ceiling.
//
// Usage:
//   TDX_CLIENT_ID=... TDX_CLIENT_SECRET=... node scripts/fetch-network.mjs Taichung [City...]
//   (or export them / put them in your shell profile first)
//
// Join TDX city codes with "+" in a single argument to merge them into one
// map (e.g. adjacent city+county pairs that share a bus network):
//   node scripts/fetch-network.mjs Hsinchu+HsinchuCounty

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2";
const OUT_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));

// TDX plan on this account: 5 requests/minute. 12.5s spacing gives a small
// safety margin over the exact 12s (60/5) boundary.
const REQUEST_INTERVAL_MS = 12500;
let lastRequestAt = 0;

async function throttle() {
  const wait = lastRequestAt + REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function getToken(clientId, clientSecret) {
  await throttle();
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  const resp = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`TDX auth failed (${resp.status}): ${await resp.text()}`);
  const payload = await resp.json();
  return payload.access_token;
}

async function tdxGetAllPages(token, path, label) {
  const pageSize = 1000;
  const results = [];
  let skip = 0;
  while (true) {
    await throttle();
    const qs = new URLSearchParams({ $top: String(pageSize), $skip: String(skip), $format: "JSON" });
    const url = `${API_BASE}${path}?${qs.toString()}`;
    process.stdout.write(`  ${label}: page at skip=${skip}... `);
    const resp = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`TDX GET ${path} failed (${resp.status}): ${await resp.text()}`);
    const page = await resp.json();
    console.log(`${page.length} rows`);
    if (!page || page.length === 0) break;
    results.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }
  return results;
}

function trimNetwork(stations, stopOfRoute) {
  return {
    stations: stations.map((s) => ({
      StationID: s.StationID,
      StationName: s.StationName,
      StationPosition: s.StationPosition,
    })),
    routes: stopOfRoute.map((r) => ({
      RouteID: r.RouteID,
      RouteName: r.RouteName,
      Direction: r.Direction,
      Stops: (r.Stops || [])
        .sort((a, b) => (a.StopSequence ?? 0) - (b.StopSequence ?? 0))
        .map((st) => ({ StationID: st.StationID, StopSequence: st.StopSequence })),
    })),
  };
}

// Merges multiple already-trimmed city datasets into one, deduping
// stations by StationID (a station right on a city/county boundary can
// legitimately appear in both pulls).
function mergeNetworks(parts) {
  const stationsById = new Map();
  const routes = [];
  for (const part of parts) {
    for (const s of part.stations) stationsById.set(s.StationID, s);
    routes.push(...part.routes);
  }
  return { stations: [...stationsById.values()], routes };
}

async function main() {
  const cities = process.argv.slice(2);
  if (cities.length === 0) {
    console.error("Usage: TDX_CLIENT_ID=... TDX_CLIENT_SECRET=... node scripts/fetch-network.mjs <City> [City...]");
    process.exit(1);
  }
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set TDX_CLIENT_ID and TDX_CLIENT_SECRET environment variables first.");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const manifestPath = new URL("manifest.json", `file://${OUT_DIR}/`);
  let manifest = [];
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    // no manifest yet, start fresh
  }

  console.log(`Rate limit: 5 req/min -> pacing every ${REQUEST_INTERVAL_MS}ms. This will take a while for a big city.`);
  const token = await getToken(clientId, clientSecret);

  for (const arg of cities) {
    const cityCodes = arg.split("+");
    console.log(`\nFetching ${arg}${cityCodes.length > 1 ? ` (merging ${cityCodes.join(", ")})` : ""}...`);
    try {
      const parts = [];
      for (const city of cityCodes) {
        const stations = await tdxGetAllPages(token, `/Bus/Station/City/${encodeURIComponent(city)}`, `${city} Station`);
        const stopOfRoute = await tdxGetAllPages(token, `/Bus/StopOfRoute/City/${encodeURIComponent(city)}`, `${city} StopOfRoute`);
        parts.push(trimNetwork(stations, stopOfRoute));
      }
      const data = cityCodes.length > 1 ? mergeNetworks(parts) : parts[0];
      await writeFile(new URL(`network-${arg}.json`, `file://${OUT_DIR}/`), JSON.stringify(data));
      console.log(`OK -- ${data.stations.length} stations, ${data.routes.length} route segments`);
      if (!manifest.includes(arg)) manifest.push(arg);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    }
  }

  manifest.sort();
  await writeFile(manifestPath, JSON.stringify(manifest));
  console.log(`\nUpdated manifest.json: [${manifest.join(", ")}]`);
  console.log("Commit web/public/data/ to publish the refreshed snapshot.");
}

main();
