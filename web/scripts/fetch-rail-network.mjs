#!/usr/bin/env node
// Fetches nationwide TRA/THSR/Metro station + route data once, for the
// Schematic tab's optional rail overlay. Separate from fetch-network.mjs
// (per-city bus data) since rail is nationwide and doesn't need
// re-fetching for every city -- the Schematic tab filters it down to
// whatever falls near the currently loaded city's bus network at
// render time.
//
// TRA renders as station markers only, not connected lines: TDX doesn't
// expose a clean branch-line grouping API the way it does for
// Bus/StopOfRoute or Rail/Metro/StationOfRoute, and guessing at branch
// topology (山線/海線/支線 all diverge) risked drawing a wrong diagram.
// THSR and Metro both have a real ordered-stops-per-route resource, so
// those get actual lines.
//
// Usage: TDX_CLIENT_ID=... TDX_CLIENT_SECRET=... node scripts/fetch-rail-network.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2";
const OUT_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));

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

async function tdxGet(token, path, label) {
  await throttle();
  const qs = new URLSearchParams({ $format: "JSON" });
  process.stdout.write(`  ${label}... `);
  const resp = await fetch(`${API_BASE}${path}?${qs.toString()}`, { headers: { authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`TDX GET ${path} failed (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  console.log(`${data.length} rows`);
  return data;
}

const METRO_SYSTEMS = ["TRTC", "KRTC", "TYMC", "TMRT", "NTMC", "KLRT", "TRTCMG"];

// THSR's 12 stations physically never change; TDX has no explicit
// north-south sequence field, so the real geographic order (south to
// north) is hardcoded here by StationCode, confirmed against
// Rail/THSR/Station's StationCode field.
const THSR_ORDER = ["ZUY", "TNN", "CHY", "YUL", "CHA", "TAC", "MIL", "HSC", "TAY", "BAN", "TPE", "NAK"];

async function main() {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set TDX_CLIENT_ID and TDX_CLIENT_SECRET environment variables first.");
    process.exit(1);
  }

  console.log(`Rate limit: 5 req/min -> pacing every ${REQUEST_INTERVAL_MS}ms.`);
  const token = await getToken(clientId, clientSecret);

  const stations = [];
  const lines = [];

  const traStations = await tdxGet(token, "/Rail/TRA/Station", "TRA stations");
  for (const s of traStations) {
    if (!s.StationPosition) continue;
    stations.push({ StationID: s.StationID, StationName: s.StationName, StationPosition: s.StationPosition, mode: "tra" });
  }

  const thsrStations = await tdxGet(token, "/Rail/THSR/Station", "THSR stations");
  for (const s of thsrStations) {
    if (!s.StationPosition) continue;
    stations.push({ StationID: s.StationID, StationName: s.StationName, StationPosition: s.StationPosition, mode: "thsr" });
  }
  const thsrByCode = new Map(thsrStations.map((s) => [s.StationCode, s]));
  const thsrPath = THSR_ORDER.map((code) => thsrByCode.get(code)?.StationID).filter(Boolean);
  if (thsrPath.length > 1) {
    lines.push({ key: "thsr-main", name: "台灣高鐵", mode: "thsr", path: thsrPath });
  }

  for (const system of METRO_SYSTEMS) {
    try {
      const metroStations = await tdxGet(token, `/Rail/Metro/Station/${system}`, `Metro ${system} stations`);
      const metroRoutes = await tdxGet(token, `/Rail/Metro/StationOfRoute/${system}`, `Metro ${system} routes`);
      for (const s of metroStations) {
        if (!s.StationPosition) continue;
        stations.push({ StationID: s.StationID, StationName: s.StationName, StationPosition: s.StationPosition, mode: "metro", system });
      }
      for (const r of metroRoutes) {
        const path = [...(r.Stations || [])].sort((a, b) => (a.Sequence ?? 0) - (b.Sequence ?? 0)).map((s) => s.StationID);
        if (path.length > 1) {
          lines.push({
            key: `metro-${system}-${r.RouteID}-${r.Direction}`,
            name: r.RouteName?.Zh_tw || r.RouteID,
            mode: "metro",
            system,
            path,
          });
        }
      }
    } catch (err) {
      console.error(`  Metro ${system} FAILED: ${err.message}`);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(new URL("rail-network.json", `file://${OUT_DIR}/`), JSON.stringify({ stations, lines }));
  console.log(`\nSaved ${stations.length} rail stations, ${lines.length} rail lines to rail-network.json`);
  console.log("Commit web/public/data/rail-network.json to publish it.");
}

main();
