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
 *
 * Setup:
 *   wrangler secret put TDX_CLIENT_ID
 *   wrangler secret put TDX_CLIENT_SECRET
 *   wrangler deploy
 */

const AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2";

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

async function tdxGet(env, path, params) {
  const token = await getToken(env);
  const qs = new URLSearchParams({ ...params, $format: "JSON" });
  const resp = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`TDX GET ${path} failed (${resp.status}): ${await resp.text()}`);
  }
  return resp.json();
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

async function handleCities(env) {
  const cities = await tdxGet(env, "/Basic/City", {});
  return jsonResponse(cities.map((c) => ({ City: c.City, CityName: c.CityName })));
}

async function handleSearch(env, url) {
  const city = url.searchParams.get("city");
  const keyword = url.searchParams.get("keyword");
  if (!city || !keyword) {
    return jsonResponse({ error: "city and keyword query params are required" }, 400);
  }
  const kw = odataStringLiteral(keyword);
  const filter = `contains(StationName/Zh_tw,${kw}) or contains(StationName/En,${kw})`;
  const stations = await tdxGet(env, `/Bus/Station/City/${encodeURIComponent(city)}`, {
    $filter: filter,
    $top: "50",
  });
  return jsonResponse(
    stations.map((s) => ({
      StationID: s.StationID,
      StationName: s.StationName,
      StationPosition: s.StationPosition,
      Stops: (s.Stops || []).map((st) => ({
        RouteID: st.RouteID,
        RouteName: st.RouteName,
        StopID: st.StopID,
        Direction: st.Direction,
      })),
    }))
  );
}

async function handleStopEta(env, url) {
  const city = url.searchParams.get("city");
  const stationId = url.searchParams.get("stationId");
  if (!city || !stationId) {
    return jsonResponse({ error: "city and stationId query params are required" }, 400);
  }
  const eta = await tdxGet(env, `/Bus/EstimatedTimeOfArrival/City/${encodeURIComponent(city)}`, {
    $filter: `StationID eq ${odataStringLiteral(stationId)}`,
    $top: "100",
  });
  return jsonResponse(eta);
}

async function handleRouteStops(env, url) {
  const city = url.searchParams.get("city");
  const routeId = url.searchParams.get("routeId");
  if (!city || !routeId) {
    return jsonResponse({ error: "city and routeId query params are required" }, 400);
  }
  const stopOfRoute = await tdxGet(env, `/Bus/StopOfRoute/City/${encodeURIComponent(city)}`, {
    $filter: `RouteID eq ${odataStringLiteral(routeId)}`,
    $top: "10",
  });
  return jsonResponse(stopOfRoute);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      switch (url.pathname) {
        case "/api/cities":
          return await handleCities(env);
        case "/api/search":
          return await handleSearch(env, url);
        case "/api/stop-eta":
          return await handleStopEta(env, url);
        case "/api/route-stops":
          return await handleRouteStops(env, url);
        default:
          return jsonResponse({ error: "Not found" }, 404);
      }
    } catch (err) {
      return jsonResponse({ error: String(err && err.message ? err.message : err) }, 502);
    }
  },
};
