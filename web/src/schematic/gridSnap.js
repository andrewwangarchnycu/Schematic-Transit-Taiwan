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
      existing.routeCount = Math.max(existing.routeCount, routeCount);
    } else {
      cellMerge.set(key, { gx, gy, names: new Set([stationLabel(station)]), routeCount });
    }
  }

  const nodes = [...cellMerge.entries()].map(([key, c]) => ({
    key,
    gx: c.gx,
    gy: c.gy,
    name: [...c.names].slice(0, 3).join(" / "),
    routeCount: c.routeCount,
    isInterchange: c.routeCount > 1,
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
