/**
 * Cloudflare Worker: TDX proxy for the Taiwan transit web app.
 *
 * Why this exists: GitHub Pages only serves static files, so the TDX
 * client_secret can never live in the frontend bundle (anyone can read it
 * from the page source). This Worker holds the secret (as a Wrangler
 * secret, never in source), gets an OAuth2 token, and re-exposes a small
 * read-only JSON API that the frontend calls instead of TDX directly.
 *
 * Endpoints:
 *   GET /api/cities
 *       -> [{ CityName: {Zh_tw, En}, City: "Taichung" }, ...]
 *   GET /api/search?city=Taichung&keyword=Taichung
 *       -> matching bus stations in that city
 *   GET /api/stop-eta?city=Taichung&stationId=TCH1234
 *       -> live estimated-time-of-arrival entries for every route/direction
 *          serving that station
 *   GET /api/route-stops?city=Taichung&routeId=1234
 *       -> ordered stop list (both directions) for that route
 *   GET /api/route-search?city=Taichung&keyword=100
 *       -> matching bus routes in that city
 *   GET /api/network?city=Taichung
 *       -> { stations: [...], routes: [...] } for the whole city, used by
 *          the Schematic tab to compute a grid-simplified map client-side
 *   GET /api/routing?origin=lat,lng&destination=lat,lng[&gc=&top=&transit=&...]
 *       -> TDX MaaS multi-modal trip planning, proxied as-is
 *   GET /api/nearby?lat=&lng=&city=&radius=(default 500m)
 *       -> [{ mode: "bus"|"tra"|"thsr"|"metro"|"bike", id, name, distance, live }, ...]
 *          nearest stations across every mode, with live info attached for
 *          every mode except bus (bus reuses /api/stop-eta on click instead,
 *          to avoid an ETA fetch per nearby bus stop). city is required for
 *          bus/bike (both are city-partitioned in TDX); TRA/THSR/Metro are
 *          nationwide and work without it.
 *   GET /api/station-stops?city=&stationId=
 *       -> one station's Stops[] (StopID per route), for on-demand ETA
 *          lookups where the caller only has a StationID (e.g. the
 *          Schematic tab, which strips Stops from /api/network to keep
 *          the whole-city payload small)
 *   GET /api/geocode?q=
 *       -> { lat, lng, displayName } | null, via OpenStreetMap Nominatim,
 *          used as a fallback when a stop-name search comes up empty so an
 *          address/landmark query still finds nearby stops
 *   GET /api/route-timetable?city=&routeId=&stopId=
 *       -> that stop's full scheduled TimeTables[] for the day (via
 *          Bus/DailyStopTimeTable), for on-demand "next scheduled
 *          departure" when there's no live estimate (not yet departed /
 *          last bus already gone). One TDX call per route, so this is
 *          deliberately click-triggered rather than fetched automatically
 *          for every route at a stop.
 *
 * Setup:
 *   wrangler secret put TDX_CLIENT_ID
 *   wrangler secret put TDX_CLIENT_SECRET
 *   wrangler deploy
 */

const AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2";
const MAAS_API_BASE = "https://tdx.transportdata.tw/api/maas";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Token is cached per warm isolate. Cloudflare may spin up a fresh isolate
// at any time, in which case this just re-authenticates once (cheap, TDX
// tokens are valid ~24h so steady-state traffic barely triggers this).
let cachedToken = null;
let cachedTokenExpiry = 0;

async function getToken(env) {
  if (cachedToken && Date.now() < cachedTokenExpiry) {
    return cachedToken;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.TDX_CLIENT_ID,
    client_secret: env.TDX_CLIENT_SECRET,
  });
  const resp = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`TDX auth failed (${resp.status}): ${await resp.text()}`);
  }
  const payload = await resp.json();
  cachedToken = payload.access_token;
  cachedTokenExpiry = Date.now() + (payload.expires_in - 60) * 1000;
  return cachedToken;
}

async function tdxGet(env, path, params, base = API_BASE) {
  const token = await getToken(env);
  const qs = new URLSearchParams(params);
  const resp = await fetch(`${base}${path}?${qs.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`TDX GET ${path} failed (${resp.status}): ${await resp.text()}`);
  }
  return resp.json();
}

function tdxBasicGet(env, path, params) {
  return tdxGet(env, path, { ...params, $format: "JSON" }, API_BASE);
}

// Bus/Station and Bus/StopOfRoute cap out at 1000 rows per call regardless
// of the requested $top, same as TDX's other list endpoints; page with
// $skip until a short page comes back (mirrors tdx_taichung_bus_schematic.py).
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tdxBasicGetAllPages(env, path, params) {
  const pageSize = 1000;
  const results = [];
  let skip = 0;
  let first = true;
  while (true) {
    // Courtesy gap between pages of the same pull so incidental callers of
    // this endpoint don't burst TDX back-to-back. This can't guarantee the
    // account's real 5-req/min cap for a big city (10+ pages at a proper
    // 12s/req spacing would exceed a single Worker invocation's execution
    // limit) -- that's what scripts/fetch-network.mjs is for, running the
    // paginated pull directly against TDX with no such time ceiling.
    if (!first) await sleep(400);
    first = false;
    const page = await tdxBasicGet(env, path, { ...params, $top: String(pageSize), $skip: String(skip) });
    if (!page || page.length === 0) break;
    results.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }
  return results;
}

// Nationwide station lists (TRA/THSR/Metro) barely change; cache them with
// a long TTL keyed on their own request so /api/nearby doesn't re-fetch a
// whole system's station list on every search -- only the live info calls
// for stations that actually land inside the search radius stay uncached.
async function cachedTdxBasicGet(env, ctx, path, params, ttlSeconds) {
  const qs = new URLSearchParams({ ...params, $format: "JSON" });
  const cacheKey = new Request(`https://tdx-cache.internal${path}?${qs.toString()}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();
  const data = await tdxBasicGet(env, path, params);
  const resp = new Response(JSON.stringify(data), {
    headers: { "Cache-Control": `public, max-age=${ttlSeconds}` },
  });
  ctx.waitUntil(cache.put(cacheKey, resp));
  return data;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function odataStringLiteral(value) {
  // OData string literals are single-quoted; escape embedded quotes by doubling them.
  return `'${String(value).replace(/'/g, "''")}'`;
}

// TDX's Basic/City endpoint returns CityName as a plain (Chinese) string,
// unlike Bus/Station etc. which nest {Zh_tw, En}. Taiwan's 22 first-level
// divisions are administratively stable, so a static English lookup here
// is safe and avoids a second TDX call just to localize city labels.
const CITY_EN_NAMES = {
  Keelung: "Keelung City",
  Taipei: "Taipei City",
  NewTaipei: "New Taipei City",
  Taoyuan: "Taoyuan City",
  Hsinchu: "Hsinchu City",
  HsinchuCounty: "Hsinchu County",
  MiaoliCounty: "Miaoli County",
  Taichung: "Taichung City",
  ChanghuaCounty: "Changhua County",
  NantouCounty: "Nantou County",
  YunlinCounty: "Yunlin County",
  Chiayi: "Chiayi City",
  ChiayiCounty: "Chiayi County",
  Tainan: "Tainan City",
  Kaohsiung: "Kaohsiung City",
  PingtungCounty: "Pingtung County",
  YilanCounty: "Yilan County",
  HualienCounty: "Hualien County",
  TaitungCounty: "Taitung County",
  PenghuCounty: "Penghu County",
  KinmenCounty: "Kinmen County",
  LienchiangCounty: "Lienchiang County",
};

async function handleCities(env) {
  const cities = await tdxBasicGet(env, "/Basic/City", {});
  return jsonResponse(
    cities.map((c) => ({
      City: c.City,
      CityName: { Zh_tw: c.CityName, En: CITY_EN_NAMES[c.City] || c.City },
    }))
  );
}

async function handleSearch(env, url) {
  const city = url.searchParams.get("city");
  const keyword = url.searchParams.get("keyword");
  if (!city || !keyword) {
    return jsonResponse({ error: "city and keyword query params are required" }, 400);
  }
  const kw = odataStringLiteral(keyword);
  // StationName/En is null for many stations; TDX's OData layer throws a
  // server-side NullReferenceException if contains() runs on a null field,
  // so guard it with a not-null check instead of filtering on Zh_tw alone.
  const filter = `contains(StationName/Zh_tw,${kw}) or (StationName/En ne null and contains(StationName/En,${kw}))`;
  const stations = await tdxBasicGet(env, `/Bus/Station/City/${encodeURIComponent(city)}`, {
    $filter: filter,
    $top: "50",
  });
  return jsonResponse(
    stations.map((s) => ({
      StationID: s.StationID,
      StationName: s.StationName,
      StationPosition: s.StationPosition,
      Bearing: s.Bearing,
      Stops: (s.Stops || []).map((st) => ({
        RouteID: st.RouteID,
        RouteName: st.RouteName,
        StopID: st.StopID,
        Direction: st.Direction,
      })),
    }))
  );
}

async function handleStopEta(env, ctx, url) {
  const city = url.searchParams.get("city");
  const stopIds = (url.searchParams.get("stopIds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!city || stopIds.length === 0) {
    return jsonResponse({ error: "city and stopIds (comma-separated) query params are required" }, 400);
  }
  // EstimatedTimeOfArrival has no StationID field, only StopID (one row per
  // route+direction stop), so OR together every StopID a station serves.
  const filter = stopIds.map((id) => `StopID eq ${odataStringLiteral(id)}`).join(" or ");

  // city can be "+"-joined for a schematic merged from multiple TDX city
  // codes. There's no combined endpoint, so query every real city code and
  // merge -- each stopId only actually exists in whichever single city
  // issued it, the rest just return empty for it.
  const cityCodes = city.split("+");
  const results = await Promise.all(
    cityCodes.map((cityCode) =>
      Promise.all([
        tdxBasicGet(env, `/Bus/EstimatedTimeOfArrival/City/${encodeURIComponent(cityCode)}`, { $filter: filter, $top: "100" }),
        cachedTdxBasicGet(env, ctx, `/Bus/Route/City/${encodeURIComponent(cityCode)}`, {}, STATION_LIST_CACHE_TTL),
      ])
    )
  );

  // No per-record destination on EstimatedTimeOfArrival; attach one using
  // the route's overall Departure/Destination pair as a direction-labeled
  // stand-in (Direction 0 conventionally runs toward Destination, Direction
  // 1 the reverse -- exact per LinesTab which uses the real stop sequence
  // instead, this is a reasonable label here where only the route+direction
  // is known).
  const enriched = [];
  for (const [eta, routes] of results) {
    const routeById = new Map(routes.map((r) => [r.RouteID, r]));
    for (const e of eta) {
      const route = routeById.get(e.RouteID);
      const destination = route ? (e.Direction === 0 ? route.DestinationStopNameZh : route.DepartureStopNameZh) : null;
      enriched.push({ ...e, destination });
    }
  }
  return jsonResponse(enriched);
}

// Used by the Schematic tab: clicking a grid node needs that one station's
// Stops[] (StopID per route) to fetch live ETA, but /api/network strips
// Stops entirely to keep the whole-city payload small.
//
// city can be "+"-joined (e.g. "Hsinchu+HsinchuCounty") for a schematic
// merged from multiple TDX city codes -- there's no such combined TDX
// endpoint, so a StationID from a merged map is looked up against each
// real city code in turn until one has it.
async function handleStationStops(env, url) {
  const city = url.searchParams.get("city");
  const stationId = url.searchParams.get("stationId");
  if (!city || !stationId) {
    return jsonResponse({ error: "city and stationId query params are required" }, 400);
  }
  for (const cityCode of city.split("+")) {
    const stations = await tdxBasicGet(env, `/Bus/Station/City/${encodeURIComponent(cityCode)}`, {
      $filter: `StationID eq ${odataStringLiteral(stationId)}`,
      $top: "1",
    });
    const s = stations[0];
    if (!s) continue;
    return jsonResponse({
      StationID: s.StationID,
      StationName: s.StationName,
      StationPosition: s.StationPosition,
      Bearing: s.Bearing,
      Stops: (s.Stops || []).map((st) => ({
        RouteID: st.RouteID,
        RouteName: st.RouteName,
        StopID: st.StopID,
        Direction: st.Direction,
      })),
    });
  }
  return jsonResponse({ error: "Station not found" }, 404);
}

async function handleRouteStops(env, url) {
  const city = url.searchParams.get("city");
  const routeId = url.searchParams.get("routeId");
  if (!city || !routeId) {
    return jsonResponse({ error: "city and routeId query params are required" }, 400);
  }
  const stopOfRoute = await tdxBasicGet(env, `/Bus/StopOfRoute/City/${encodeURIComponent(city)}`, {
    $filter: `RouteID eq ${odataStringLiteral(routeId)}`,
    $top: "10",
  });
  return jsonResponse(stopOfRoute);
}

// Bus/DailyStopTimeTable has no per-stop filter (only top-level fields like
// RouteID), so it returns the whole route's schedule -- every stop, each
// with its own full-day TimeTables[] -- and we pick out the one stop the
// caller asked about.
async function handleRouteTimetable(env, url) {
  const city = url.searchParams.get("city");
  const routeId = url.searchParams.get("routeId");
  const stopId = url.searchParams.get("stopId");
  if (!city || !routeId || !stopId) {
    return jsonResponse({ error: "city, routeId, and stopId query params are required" }, 400);
  }
  for (const cityCode of city.split("+")) {
    const rows = await tdxBasicGet(env, `/Bus/DailyStopTimeTable/City/${encodeURIComponent(cityCode)}`, {
      $filter: `RouteID eq ${odataStringLiteral(routeId)}`,
      $top: "10",
    });
    for (const row of rows) {
      const stop = (row.Stops || []).find((s) => s.StopID === stopId);
      if (stop) {
        return jsonResponse({
          RouteName: row.RouteName,
          DestinationStopName: row.DestinationStopName,
          StopName: stop.StopName,
          TimeTables: stop.TimeTables || [],
        });
      }
    }
  }
  return jsonResponse({ error: "No timetable found for that stop on this route" }, 404);
}

async function handleRouteSearch(env, url) {
  const city = url.searchParams.get("city");
  const keyword = url.searchParams.get("keyword");
  if (!city || !keyword) {
    return jsonResponse({ error: "city and keyword query params are required" }, 400);
  }
  const kw = odataStringLiteral(keyword);
  const filter = `contains(RouteName/Zh_tw,${kw}) or (RouteName/En ne null and contains(RouteName/En,${kw}))`;
  const routes = await tdxBasicGet(env, `/Bus/Route/City/${encodeURIComponent(city)}`, {
    $filter: filter,
    $top: "50",
  });
  return jsonResponse(
    routes.map((r) => ({
      RouteID: r.RouteID,
      RouteName: r.RouteName,
      DepartureStopNameZh: r.DepartureStopNameZh,
      DepartureStopNameEn: r.DepartureStopNameEn,
      DestinationStopNameZh: r.DestinationStopNameZh,
      DestinationStopNameEn: r.DestinationStopNameEn,
    }))
  );
}

// Whole-city dataset for the Schematic tab, which grid-snaps and lays out
// the network client-side (same idea as tdx_taichung_bus_schematic.py, but
// in-browser). Trimmed hard since even a mid-size city can have thousands
// of stations/route-stops.
async function handleNetwork(env, url) {
  const city = url.searchParams.get("city");
  if (!city) {
    return jsonResponse({ error: "city query param is required" }, 400);
  }

  // Sequential, not Promise.all -- two paginated pulls racing in parallel
  // doubles the peak request rate right when it's most likely to trip the
  // rate limit. Note: this endpoint is no longer on the Schematic tab's
  // live path (see scripts/fetch-network.mjs) precisely because a big
  // city's full pagination can't fit a proper 5-req/min pace inside a
  // single Worker invocation's execution limit -- it's kept for
  // programmatic/manual use where the caller can retry across separate
  // requests if needed.
  const stations = await tdxBasicGetAllPages(env, `/Bus/Station/City/${encodeURIComponent(city)}`, {});
  const stopOfRoute = await tdxBasicGetAllPages(env, `/Bus/StopOfRoute/City/${encodeURIComponent(city)}`, {});

  return jsonResponse({
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
  });
}

const ROUTING_PASSTHROUGH_PARAMS = [
  "transfer_time",
  "depart",
  "arrival",
  "first_mile_mode",
  "first_mile_time",
  "last_mile_mode",
  "last_mile_time",
];

async function handleRouting(env, url) {
  const origin = url.searchParams.get("origin");
  const destination = url.searchParams.get("destination");
  if (!origin || !destination) {
    return jsonResponse({ error: "origin and destination query params are required (\"lat,lng\")" }, 400);
  }

  const params = {
    origin,
    destination,
    gc: url.searchParams.get("gc") || "0.5",
    top: url.searchParams.get("top") || "5",
    transit: url.searchParams.get("transit") || "3,4,5,6,7,8,9",
    // Force walk-only first/last mile so the engine can't fill a gap with a
    // taxi/drive leg; still overridable via passthrough params below.
    first_mile_mode: "0",
    last_mile_mode: "0",
  };
  for (const key of ROUTING_PASSTHROUGH_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) params[key] = value;
  }

  const result = await tdxGet(env, "/routing", params, MAAS_API_BASE);

  // Defense in depth: drop any itinerary that still contains a taxi leg
  // regardless of how it got there.
  if (result?.data?.routes) {
    result.data.routes = result.data.routes.filter(
      (route) => !route.sections?.some((s) => (s.transport?.mode || "").toLowerCase() === "taxi")
    );
  }

  return jsonResponse(result);
}

const METRO_SYSTEMS = ["TRTC", "KRTC", "TYMC", "TMRT", "NTMC", "KLRT", "TRTCMG"];
const STATION_LIST_CACHE_TTL = 24 * 60 * 60;

function nearbyFromList(list, lat, lng, radius) {
  return list
    .filter((s) => s.StationPosition)
    .map((s) => ({ station: s, distance: haversineMeters(lat, lng, s.StationPosition.PositionLat, s.StationPosition.PositionLon) }))
    .filter((s) => s.distance <= radius);
}

async function handleNearby(env, ctx, url) {
  const lat = parseFloat(url.searchParams.get("lat"));
  const lng = parseFloat(url.searchParams.get("lng"));
  const city = url.searchParams.get("city");
  const radius = Math.min(parseInt(url.searchParams.get("radius") || "500", 10) || 500, 2000);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonResponse({ error: "lat and lng query params are required" }, 400);
  }

  const results = [];

  // Bus: city-partitioned, uses TDX's own spatial filter so we never pull a
  // whole city's station list just to find a handful of nearby stops.
  if (city) {
    try {
      const busStations = await tdxBasicGet(env, `/Bus/Station/City/${encodeURIComponent(city)}`, {
        $spatialFilter: `nearby(${lat},${lng},${radius})`,
        $top: "15",
      });
      for (const s of busStations) {
        if (!s.StationPosition) continue;
        results.push({
          mode: "bus",
          id: s.StationID,
          city,
          name: s.StationName?.Zh_tw || s.StationName?.En,
          lat: s.StationPosition.PositionLat,
          lng: s.StationPosition.PositionLon,
          distance: Math.round(haversineMeters(lat, lng, s.StationPosition.PositionLat, s.StationPosition.PositionLon)),
          routeCount: (s.Stops || []).length,
          // Same shape /api/search returns, so the frontend can hand this
          // straight to <StopDetail> on click without a second fetch.
          station: {
            StationID: s.StationID,
            StationName: s.StationName,
            StationPosition: s.StationPosition,
            Bearing: s.Bearing,
            Stops: (s.Stops || []).map((st) => ({
              RouteID: st.RouteID,
              RouteName: st.RouteName,
              StopID: st.StopID,
              Direction: st.Direction,
            })),
          },
        });
      }
    } catch (err) {
      results.push({ mode: "bus", error: String(err.message || err) });
    }
  }

  // YouBike: also city-partitioned; station list is cached, live availability isn't.
  if (city) {
    try {
      const bikeStations = await cachedTdxBasicGet(env, ctx, `/Bike/Station/City/${encodeURIComponent(city)}`, {}, STATION_LIST_CACHE_TTL);
      const near = nearbyFromList(bikeStations, lat, lng, radius);
      if (near.length > 0) {
        const availability = await tdxBasicGet(env, `/Bike/Availability/City/${encodeURIComponent(city)}`, {});
        const availByStation = new Map(availability.map((a) => [a.StationID, a]));
        for (const { station, distance } of near) {
          const a = availByStation.get(station.StationID);
          results.push({
            mode: "bike",
            id: station.StationID,
            name: station.StationName?.Zh_tw || station.StationName?.En,
            lat: station.StationPosition.PositionLat,
            lng: station.StationPosition.PositionLon,
            distance: Math.round(distance),
            live: a ? { availableRent: a.AvailableRentBikes, availableReturn: a.AvailableReturnBikes, serviceStatus: a.ServiceStatus } : null,
          });
        }
      }
    } catch (err) {
      results.push({ mode: "bike", error: String(err.message || err) });
    }
  }

  // TRA: nationwide, station list cached.
  try {
    const traStations = await cachedTdxBasicGet(env, ctx, "/Rail/TRA/Station", {}, STATION_LIST_CACHE_TTL);
    const near = nearbyFromList(traStations, lat, lng, radius);
    for (const { station, distance } of near) {
      let live = null;
      try {
        const board = await tdxBasicGet(env, `/Rail/TRA/LiveBoard/Station/${station.StationID}`, { $top: "4" });
        live = board.map((b) => ({
          trainNo: b.TrainNo,
          trainType: b.TrainTypeName?.Zh_tw,
          destination: b.EndingStationName?.Zh_tw,
          delayMinutes: b.DelayTime,
          scheduledDeparture: b.ScheduledDepartureTime,
        }));
      } catch {
        // best-effort: still return the station even if the live board call fails
      }
      results.push({
        mode: "tra",
        id: station.StationID,
        name: station.StationName?.Zh_tw,
        lat: station.StationPosition.PositionLat,
        lng: station.StationPosition.PositionLon,
        distance: Math.round(distance),
        live,
      });
    }
  } catch (err) {
    results.push({ mode: "tra", error: String(err.message || err) });
  }

  // THSR: nationwide, station list cached; live-ish via today's timetable filtered to upcoming departures.
  try {
    const thsrStations = await cachedTdxBasicGet(env, ctx, "/Rail/THSR/Station", {}, STATION_LIST_CACHE_TTL);
    const near = nearbyFromList(thsrStations, lat, lng, radius);
    if (near.length > 0) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
      const nowHM = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour12: false }).slice(0, 5);
      for (const { station, distance } of near) {
        let live = null;
        try {
          const timetable = await tdxBasicGet(env, `/Rail/THSR/DailyTimetable/Station/${station.StationID}/${today}`, {});
          live = timetable
            .filter((t) => t.DepartureTime >= nowHM)
            .sort((a, b) => a.DepartureTime.localeCompare(b.DepartureTime))
            .slice(0, 4)
            .map((t) => ({ trainNo: t.TrainNo, destination: t.EndingStationName?.Zh_tw, departure: t.DepartureTime }));
        } catch {
          // best-effort
        }
        results.push({
          mode: "thsr",
          id: station.StationID,
          name: station.StationName?.Zh_tw,
          lat: station.StationPosition.PositionLat,
          lng: station.StationPosition.PositionLon,
          distance: Math.round(distance),
          live,
        });
      }
    }
  } catch (err) {
    results.push({ mode: "thsr", error: String(err.message || err) });
  }

  // Metro: nationwide across every operator; station lists cached per system,
  // live board only fetched for a system that actually has a nearby station.
  for (const system of METRO_SYSTEMS) {
    try {
      const metroStations = await cachedTdxBasicGet(env, ctx, `/Rail/Metro/Station/${system}`, {}, STATION_LIST_CACHE_TTL);
      const near = nearbyFromList(metroStations, lat, lng, radius);
      if (near.length === 0) continue;
      const board = await tdxBasicGet(env, `/Rail/Metro/LiveBoard/${system}`, {});
      for (const { station, distance } of near) {
        const live = board
          .filter((b) => b.StationID === station.StationID)
          .slice(0, 4)
          .map((b) => ({
            line: b.LineName?.Zh_tw,
            headsign: b.TripHeadSign,
            minutes: b.EstimateTime != null ? Math.round(b.EstimateTime / 60) : null,
          }));
        results.push({
          mode: "metro",
          id: station.StationID,
          name: station.StationName?.Zh_tw,
          lat: station.StationPosition.PositionLat,
          lng: station.StationPosition.PositionLon,
          distance: Math.round(distance),
          live,
        });
      }
    } catch (err) {
      results.push({ mode: "metro", system, error: String(err.message || err) });
    }
  }

  results.sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
  return jsonResponse(results);
}

// OpenStreetMap Nominatim: free, keyless, but requires a descriptive
// User-Agent and modest usage per their policy. Used as a fallback when a
// station-name search comes up empty, so an address/landmark query still
// resolves to a point we can search /api/nearby around.
async function handleGeocode(url) {
  const q = url.searchParams.get("q");
  if (!q) {
    return jsonResponse({ error: "q query param is required" }, 400);
  }
  const qs = new URLSearchParams({ format: "json", countrycodes: "tw", limit: "1", q });
  const resp = await fetch(`https://nominatim.openstreetmap.org/search?${qs.toString()}`, {
    headers: { "User-Agent": "TaiwanTransitLive/1.0 (github.com/andrewwangarchnycu/Schematic-Transit-Taiwan)" },
  });
  if (!resp.ok) {
    return jsonResponse({ error: `Geocoding failed (${resp.status})` }, 502);
  }
  const results = await resp.json();
  if (!results || results.length === 0) {
    return jsonResponse(null);
  }
  const r = results[0];
  return jsonResponse({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), displayName: r.display_name });
}

// TDX's free/basic tier rate limit is tight, and endpoints like /api/network
// fan out into several paginated upstream calls per request. Cache
// slow-changing responses (city list, route/stop metadata) with Cloudflare's
// Cache API so repeat visits and page reloads don't re-spend quota; leave
// truly live data (ETAs, trip planning) uncached. Seconds.
const CACHE_TTL_SECONDS = {
  "/api/cities": 24 * 60 * 60,
  "/api/search": 60 * 60,
  "/api/route-stops": 60 * 60,
  "/api/route-search": 60 * 60,
  "/api/network": 6 * 60 * 60,
  "/api/station-stops": 60 * 60,
  "/api/geocode": 7 * 24 * 60 * 60,
  "/api/route-timetable": 60 * 60,
};

const ROUTES = {
  "/api/cities": (env, url, ctx) => handleCities(env),
  "/api/search": (env, url, ctx) => handleSearch(env, url),
  "/api/stop-eta": (env, url, ctx) => handleStopEta(env, ctx, url),
  "/api/route-stops": (env, url, ctx) => handleRouteStops(env, url),
  "/api/route-search": (env, url, ctx) => handleRouteSearch(env, url),
  "/api/network": (env, url, ctx) => handleNetwork(env, url),
  "/api/routing": (env, url, ctx) => handleRouting(env, url),
  "/api/nearby": (env, url, ctx) => handleNearby(env, ctx, url),
  "/api/station-stops": (env, url, ctx) => handleStationStops(env, url),
  "/api/geocode": (env, url, ctx) => handleGeocode(url),
  "/api/route-timetable": (env, url, ctx) => handleRouteTimetable(env, url),
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const handler = ROUTES[url.pathname];
    if (!handler) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    const ttl = CACHE_TTL_SECONDS[url.pathname];
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);

    if (ttl) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    try {
      const response = await handler(env, url, ctx);
      if (ttl && response.status === 200) {
        const cacheable = new Response(response.body, response);
        cacheable.headers.set("Cache-Control", `public, max-age=${ttl}`);
        ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
        return cacheable;
      }
      return response;
    } catch (err) {
      return jsonResponse({ error: String(err && err.message ? err.message : err) }, 502);
    }
  },
};
