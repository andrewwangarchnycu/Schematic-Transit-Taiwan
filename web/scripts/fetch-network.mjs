#!/usr/bin/env node
// Manually run to (re)generate the static network data the Schematic tab
// reads from web/public/data/. Deliberately not called at build time or
// runtime -- the whole point is that the schematic uses a fixed snapshot
// the site owner refreshes on their own schedule, not a live TDX fetch on
// every visit (network topology barely changes day to day, and every
// live fetch was burning this account's tight TDX rate limit).
//
// Usage:
//   node scripts/fetch-network.mjs Taichung [Taipei NewTaipei ...]
//
// Pulls from the already-deployed Worker's /api/network (which does the
// TDX auth, pagination, and trimming), not from TDX directly -- no
// credentials needed here.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WORKER_BASE = process.env.WORKER_BASE || "https://tw-transit-proxy.890718ding3316.workers.dev";
const OUT_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));

async function main() {
  const cities = process.argv.slice(2);
  if (cities.length === 0) {
    console.error("Usage: node scripts/fetch-network.mjs <City> [City...]");
    console.error("Example: node scripts/fetch-network.mjs Taichung");
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

  for (const city of cities) {
    process.stdout.write(`Fetching ${city}... `);
    const resp = await fetch(`${WORKER_BASE}/api/network?city=${encodeURIComponent(city)}`);
    if (!resp.ok) {
      console.log(`FAILED (HTTP ${resp.status})`);
      continue;
    }
    const data = await resp.json();
    await writeFile(new URL(`network-${city}.json`, `file://${OUT_DIR}/`), JSON.stringify(data));
    console.log(`OK -- ${data.stations.length} stations, ${data.routes.length} route segments`);
    if (!manifest.includes(city)) manifest.push(city);
  }

  manifest.sort();
  await writeFile(manifestPath, JSON.stringify(manifest));
  console.log(`\nUpdated manifest.json: [${manifest.join(", ")}]`);
  console.log("Commit web/public/data/ to publish the refreshed snapshot.");
}

main();
