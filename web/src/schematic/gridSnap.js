// Ports the grid-snap + octilinear-connector approach from
// tdx_taichung_bus_schematic.py into pure JS so it can run in the browser
// against /api/network's { stations, routes } payload. Same idea, no QGIS:
// project lon/lat to local metres, round onto a regular grid (this is the
// "simplification" -- nearby stops collapse onto one node), then connect
// consecutive grid nodes with single-bend 0/45/90-degree segments instead
// of straight geographic lines.

const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LON_AT_EQUATOR = 111320;

// A simple equirectangular approximation centered on the dataset's mean
// latitude is accurate to well under 1% at city scale -- good enough for a
// schematic diagram, and avoids pulling in a full projection library.
export function makeProjector(meanLat) {
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  return (lon, lat) => [lon * METERS_PER_DEG_LON_AT_EQUATOR * cosLat, lat * METERS_PER_DEG_LAT];
}

export function snapToGrid(xMeters, yMeters, cellSizeMeters) {
  return [Math.round(xMeters / cellSizeMeters), Math.round(yMeters / cellSizeMeters)];
}

// Single-bend heuristic: if the two points are already aligned to
// 0/45/90 degrees, connect directly; otherwise move diagonally for the
// shorter axis first, then straight for the remainder -- both resulting
// segments land on a multiple of 45 degrees.
export function octilinearPath([x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) {
    return [[x1, y1], [x2, y2]];
  }
  const step = Math.min(Math.abs(dx), Math.abs(dy));
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  return [
    [x1, y1],
    [x1 + step * sx, y1 + step * sy],
    [x2, y2],
  ];
}

// Deterministic string -> HSL color, stable across reloads without needing
// a hashing library.
export function routeColor(name) {
  const str = String(name);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

function stationLabel(station) {
  return station.StationName?.Zh_tw || station.StationName?.En || station.StationID;
}

function routeLabel(route) {
  return route.RouteName?.Zh_tw || route.RouteName?.En || route.RouteID;
}

export function buildSchematic({ stations, routes }, cellSizeMeters) {
  const withPosition = stations.filter((s) => s.StationPosition);
  if (withPosition.length === 0) return { nodes: [], lines: [] };

  const meanLat = withPosition.reduce((sum, s) => sum + s.StationPosition.PositionLat, 0) / withPosition.length;
  const project = makeProjector(meanLat);

  // Distinct route count per station, for interchange-node sizing. routes[]
  // has one entry per route+direction, so dedupe by RouteID or a
  // round-trip route would double-count its own stations.
  const routeIdsByStation = new Map();
  for (const route of routes) {
    for (const stop of route.Stops) {
      if (!stop.StationID) continue;
      if (!routeIdsByStation.has(stop.StationID)) routeIdsByStation.set(stop.StationID, new Set());
      routeIdsByStation.get(stop.StationID).add(route.RouteID);
    }
  }

  const stationGrid = new Map();
  const cellMerge = new Map();
  for (const station of withPosition) {
    const [xm, ym] = project(station.StationPosition.PositionLon, station.StationPosition.PositionLat);
    const [gx, gy] = snapToGrid(xm, ym, cellSizeMeters);
    stationGrid.set(station.StationID, [gx, gy]);

    const key = `${gx},${gy}`;
    const routeCount = routeIdsByStation.get(station.StationID)?.size || 0;
    const existing = cellMerge.get(key);
    if (existing) {
      existing.names.add(stationLabel(station));
      existing.stationIds.add(station.StationID);
      existing.routeCount = Math.max(existing.routeCount, routeCount);
    } else {
      cellMerge.set(key, { gx, gy, names: new Set([stationLabel(station)]), stationIds: new Set([station.StationID]), routeCount });
    }
  }

  const nodes = [...cellMerge.entries()].map(([key, c]) => ({
    key,
    gx: c.gx,
    gy: c.gy,
    name: [...c.names].slice(0, 3).join(" / "),
    stationIds: [...c.stationIds],
    routeCount: c.routeCount,
    isInterchange: c.routeCount > 1,
    mode: "bus",
  }));

  const lines = [];
  for (const route of routes) {
    const sortedStops = [...route.Stops].sort((a, b) => (a.StopSequence ?? 0) - (b.StopSequence ?? 0));
    const gridSeq = [];
    for (const stop of sortedStops) {
      const g = stationGrid.get(stop.StationID);
      if (!g) continue;
      const last = gridSeq[gridSeq.length - 1];
      if (last && last[0] === g[0] && last[1] === g[1]) continue;
      gridSeq.push(g);
    }
    if (gridSeq.length < 2) continue;

    const fullPath = [gridSeq[0]];
    for (let i = 0; i < gridSeq.length - 1; i++) {
      const segment = octilinearPath(gridSeq[i], gridSeq[i + 1]);
      fullPath.push(...segment.slice(1));
    }

    const name = routeLabel(route);
    lines.push({
      key: `${route.RouteID}-${route.Direction}`,
      routeId: route.RouteID,
      name,
      direction: route.Direction,
      color: routeColor(name),
      path: fullPath,
    });
  }

  return { nodes, lines };
}

const RAIL_MODE_COLORS = { thsr: "#e53935", metro: "#2e7d32" };

// Official per-system fallback (used when a metro line's name doesn't match
// any of the specific-line rules below, e.g. a system with just one line).
const METRO_SYSTEM_COLORS = {
  KRTC: "#e3002c",
  TYMC: "#7b4397",
  TMRT: "#00a650",
  NTMC: "#ffd100",
  KLRT: "#ee7203",
};

// Real line names -> each system's actual official color, so the overlay
// reads like the real system maps instead of one flat green for every
// metro line in the country. Matched against the route name TDX returns
// (Rail/Metro/StationOfRoute's RouteName), zh or en.
const METRO_LINE_COLOR_RULES = [
  { match: /淡水信義|Tamsui.?Xinyi/i, color: "#e3002c" },
  { match: /板南|Bannan/i, color: "#0070bd" },
  { match: /松山新店|Songshan.?Xindian/i, color: "#008659" },
  { match: /中和新蘆|Zhonghe.?Xinlu/i, color: "#f8b61c" },
  { match: /文湖|Wenhu/i, color: "#c48c31" },
  { match: /環狀|Circular/i, color: "#ffd100" },
  { match: /紅線|Red Line/i, color: "#e3002c" },
  { match: /橘線|Orange Line/i, color: "#f8a800" },
];

function metroLineColor(line) {
  const rule = METRO_LINE_COLOR_RULES.find((r) => r.match.test(line.name));
  if (rule) return rule.color;
  return METRO_SYSTEM_COLORS[line.system] || RAIL_MODE_COLORS.metro;
}

// Projects the nationwide rail-network.json (see
// scripts/fetch-rail-network.mjs) into the SAME grid the bus schematic
// already computed (same meanLat/cellSize), then keeps only what falls
// near the bus network's bounds -- most of a nationwide TRA/THSR/Metro
// dataset is nowhere near whichever single city's bus map is loaded.
// TRA has no line entries (see the script for why), so it only ever
// contributes station nodes here.
export function buildRailOverlay(railNetwork, meanLat, cellSizeMeters, busBounds, marginCells = 15) {
  if (!railNetwork || !busBounds || !Number.isFinite(busBounds.minX)) return { nodes: [], lines: [] };
  const project = makeProjector(meanLat);
  const minX = busBounds.minX - marginCells;
  const maxX = busBounds.maxX + marginCells;
  const minY = busBounds.minY - marginCells;
  const maxY = busBounds.maxY + marginCells;

  const grid = new Map();
  const nodes = [];
  // Counts stations per grid cell regardless of mode/system, so a TRA+THSR+
  // Metro complex (e.g. Taipei Main) or a two-line metro interchange -- each
  // a separate StationID in TDX, just colocated -- reads as one interchange
  // rather than silently overlapping icons with no visual cue.
  const cellStationCount = new Map();
  for (const s of railNetwork.stations) {
    if (!s.StationPosition) continue;
    const [xm, ym] = project(s.StationPosition.PositionLon, s.StationPosition.PositionLat);
    const [gx, gy] = snapToGrid(xm, ym, cellSizeMeters);
    if (gx < minX || gx > maxX || gy < minY || gy > maxY) continue;
    grid.set(s.StationID, [gx, gy]);
    const cellKey = `${gx},${gy}`;
    cellStationCount.set(cellKey, (cellStationCount.get(cellKey) || 0) + 1);
    nodes.push({
      key: `${s.mode}-${s.StationID}`,
      cellKey,
      gx,
      gy,
      name: s.StationName?.Zh_tw || s.StationName?.En || s.StationID,
      mode: s.mode,
      stationId: s.StationID,
      lat: s.StationPosition.PositionLat,
      lng: s.StationPosition.PositionLon,
    });
  }

  const interchanges = [];
  const seenInterchangeCells = new Set();
  for (const node of nodes) {
    node.isInterchange = (cellStationCount.get(node.cellKey) || 0) > 1;
    if (node.isInterchange && !seenInterchangeCells.has(node.cellKey)) {
      seenInterchangeCells.add(node.cellKey);
      interchanges.push({ key: `interchange-${node.cellKey}`, gx: node.gx, gy: node.gy });
    }
  }

  const lines = [];
  for (const line of railNetwork.lines || []) {
    const pathIds = line.path.filter((id) => grid.has(id));
    // Only draw a line when most of its real stations are actually in
    // view -- a metro/THSR line mostly outside the loaded city would
    // otherwise draw a stray, misleading fragment of itself.
    if (pathIds.length < 2 || pathIds.length < line.path.length * 0.6) continue;
    const gridSeq = pathIds.map((id) => grid.get(id));
    const fullPath = [gridSeq[0]];
    for (let i = 0; i < gridSeq.length - 1; i++) {
      const segment = octilinearPath(gridSeq[i], gridSeq[i + 1]);
      fullPath.push(...segment.slice(1));
    }
    lines.push({
      key: line.key,
      name: line.name,
      mode: line.mode,
      system: line.system,
      color: line.mode === "metro" ? metroLineColor(line) : RAIL_MODE_COLORS[line.mode] || routeColor(line.name),
      path: fullPath,
    });
  }

  return { nodes, lines, interchanges };
}

export function computeGridBounds(nodes, lines) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const consider = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  nodes.forEach((n) => consider(n.gx, n.gy));
  lines.forEach((l) => l.path.forEach(([x, y]) => consider(x, y)));
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  return { minX, maxX, minY, maxY };
}
