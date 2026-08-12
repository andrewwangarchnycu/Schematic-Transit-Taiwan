import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCities, getNetworkManifest, getStaticNetwork, getStationStops, getStopEta, getRailNetwork, getNearby } from "../api/client.js";
import { buildSchematic, buildRailOverlay, computeGridBounds, makeProjector } from "../schematic/gridSnap.js";
import { minutesUntil, formatEstimate } from "../utils/eta.js";
import TimetableFallback from "./TimetableFallback.jsx";
import NearbyCard from "./NearbyCard.jsx";
import SplitPanel from "./SplitPanel.jsx";

const RAIL_MODE_MARKER = {
  tra: { r: 4, fill: "#8e24aa", shape: "square" },
  thsr: { r: 5, fill: "#e53935", shape: "square" },
  metro: { r: 4, fill: "#2e7d32", shape: "circle" },
};

const PIXELS_PER_CELL = 22;
const PADDING_CELLS = 2;
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const LOCATE_ZOOM_SCALE = 3;
// Pointer movement beyond this (px) during a gesture counts as a drag, not
// a tap -- without it, dragging a pan gesture that starts on a station
// circle fires a click too (a browser synthesizes one on pointerup
// regardless of movement), which selects that station and pops the ETA
// panel open mid-drag. On the mobile stacked layout that panel appearing
// yanks the page, which is what felt like being forced out of the pan.
const DRAG_THRESHOLD = 6;

function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export default function SchematicTab() {
  const { t, i18n } = useTranslation();
  const [city, setCity] = useState("");
  const [cellSize, setCellSize] = useState(300);
  const [network, setNetwork] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [highlightedKey, setHighlightedKey] = useState(null);
  const [hoveredKey, setHoveredKey] = useState(null);

  // Available cities come from the static snapshot's manifest, not the
  // live /api/cities list -- only cities someone has actually run
  // `npm run fetch-network` for have a schematic to show. Still use
  // /api/cities (cached, cheap) for bilingual display names.
  const [manifest, setManifest] = useState([]);
  const [cityNames, setCityNames] = useState({});

  // Nationwide TRA/THSR/Metro overlay (scripts/fetch-rail-network.mjs);
  // optional, degrades to bus-only if it hasn't been generated yet.
  const [railNetwork, setRailNetwork] = useState(null);

  useEffect(() => {
    getNetworkManifest().then(setManifest);
    getRailNetwork().then(setRailNetwork);
    getCities()
      .then((cities) => {
        const map = {};
        cities.forEach((c) => {
          map[c.City] = c.CityName;
        });
        setCityNames(map);
      })
      .catch(() => {});
  }, []);

  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeEtas, setNodeEtas] = useState([]);
  const [nodeEtaLoading, setNodeEtaLoading] = useState(false);
  const [railInfo, setRailInfo] = useState(null);

  const [userPoint, setUserPoint] = useState(null);

  const panelRef = useRef(null);
  const viewportRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map());
  const dragState = useRef(null);
  const dragMoved = useRef(false);

  function generate() {
    if (!city) {
      setError(t("selectCity"));
      return;
    }
    setLoading(true);
    setError(null);
    setNetwork(null);
    setHighlightedKey(null);
    setSelectedNode(null);
    setView({ scale: 1, x: 0, y: 0 });
    getStaticNetwork(city)
      .then(setNetwork)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError(t("navLocationFailed"))
    );
  }

  async function selectNode(node) {
    setSelectedNode(node);
    setNodeEtas([]);
    setRailInfo(null);

    if (node.mode !== "bus") {
      // TRA/THSR/Metro: reuse /api/nearby's already-working per-mode live
      // lookups by searching a tight radius around the station's own real
      // coordinates, instead of a separate live-data code path per mode.
      setNodeEtaLoading(true);
      try {
        const results = await getNearby(node.lat, node.lng, null, 150);
        const match = results.find((r) => !r.error && r.mode === node.mode && r.id === node.stationId) || results.find((r) => !r.error && r.mode === node.mode);
        setRailInfo(match || null);
      } catch (err) {
        setError(err.message);
      } finally {
        setNodeEtaLoading(false);
      }
      return;
    }

    if (!city || node.stationIds.length === 0) return;
    setNodeEtaLoading(true);
    try {
      const stopsLists = await Promise.all(node.stationIds.map((id) => getStationStops(city, id)));
      const stopIds = [...new Set(stopsLists.flatMap((s) => (s.Stops || []).map((st) => st.StopID)))];
      if (stopIds.length === 0) return;
      const eta = await getStopEta(city, stopIds);
      setNodeEtas(eta);
    } catch (err) {
      setError(err.message);
    } finally {
      setNodeEtaLoading(false);
    }
  }

  useEffect(() => {
    function handler() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  function toggleFullscreen() {
    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    // iOS Safari has no Element.requestFullscreen at all (only <video>
    // supports it), and some other mobile browsers reject it depending on
    // context -- fall back to a fixed-position overlay that behaves like
    // fullscreen without relying on the real API.
    const el = panelRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => setPseudoFullscreen(true));
    } else {
      setPseudoFullscreen(true);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => ({ ...v, scale: clampScale(v.scale * factor) }));
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragMoved.current = false;
      dragState.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y };
    } else if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      dragState.current = {
        pinch: true,
        startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        startScale: view.scale,
      };
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!dragState.current) return;
    if (dragState.current.pinch && pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setView((v) => ({ ...v, scale: clampScale(dragState.current.startScale * (dist / dragState.current.startDist)) }));
    } else if (!dragState.current.pinch) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved.current = true;
      setView((v) => ({ ...v, x: dragState.current.viewX + dx, y: dragState.current.viewY + dy }));
    }
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      dragState.current = null;
    } else if (pointers.current.size === 1) {
      const [[, p]] = pointers.current;
      dragState.current = { startX: p.x, startY: p.y, viewX: view.x, viewY: view.y };
    }
  }

  function zoomBy(factor) {
    setView((v) => ({ ...v, scale: clampScale(v.scale * factor) }));
  }

  function resetView() {
    setView({ scale: 1, x: 0, y: 0 });
  }

  const schematic = useMemo(() => {
    if (!network) return { nodes: [], lines: [] };
    return buildSchematic(network, cellSize);
  }, [network, cellSize]);

  const meanLat = useMemo(() => {
    if (!network) return null;
    const withPos = network.stations.filter((s) => s.StationPosition);
    if (withPos.length === 0) return null;
    return withPos.reduce((sum, s) => sum + s.StationPosition.PositionLat, 0) / withPos.length;
  }, [network]);

  const userGridPoint = useMemo(() => {
    if (!userPoint || meanLat == null) return null;
    const project = makeProjector(meanLat);
    const [xm, ym] = project(userPoint.lng, userPoint.lat);
    return [xm / cellSize, ym / cellSize];
  }, [userPoint, meanLat, cellSize]);

  // Bus network's own bounds, before extending for anything else -- this
  // is the reference area buildRailOverlay filters the nationwide rail
  // dataset against (plus a margin), so a metro line on the far side of
  // Taiwan doesn't get pulled in.
  const busBounds = useMemo(() => computeGridBounds(schematic.nodes, schematic.lines), [schematic]);

  const railOverlay = useMemo(() => {
    if (!railNetwork || meanLat == null) return { nodes: [], lines: [], interchanges: [] };
    return buildRailOverlay(railNetwork, meanLat, cellSize, busBounds, 15);
  }, [railNetwork, meanLat, cellSize, busBounds]);

  // Legend: one row per distinct rail line color actually on screen, plus a
  // fixed TRA row (TRA never gets a line, only station markers -- see
  // buildRailOverlay) when any TRA station is showing.
  const legendLines = useMemo(() => {
    const seen = new Map();
    for (const line of railOverlay.lines) {
      if (!seen.has(line.color)) seen.set(line.color, line.name);
    }
    return [...seen.entries()].map(([color, name]) => ({ color, name }));
  }, [railOverlay.lines]);
  const hasTraNodes = railOverlay.nodes.some((n) => n.mode === "tra");

  const bounds = useMemo(() => {
    const b = { ...busBounds };
    const extend = (gx, gy) => {
      b.minX = Math.min(b.minX, gx);
      b.maxX = Math.max(b.maxX, gx);
      b.minY = Math.min(b.minY, gy);
      b.maxY = Math.max(b.maxY, gy);
    };
    railOverlay.nodes.forEach((n) => extend(n.gx, n.gy));
    railOverlay.lines.forEach((l) => l.path.forEach(([x, y]) => extend(x, y)));
    if (userGridPoint) extend(userGridPoint[0], userGridPoint[1]);
    return b;
  }, [busBounds, railOverlay, userGridPoint]);

  const toSvgX = (gx) => (gx - bounds.minX + PADDING_CELLS) * PIXELS_PER_CELL;
  const toSvgY = (gy) => (bounds.maxY - gy + PADDING_CELLS) * PIXELS_PER_CELL;
  const svgWidth = (bounds.maxX - bounds.minX + PADDING_CELLS * 2) * PIXELS_PER_CELL;
  const svgHeight = (bounds.maxY - bounds.minY + PADDING_CELLS * 2) * PIXELS_PER_CELL;

  function findNearestNode(gx, gy) {
    let best = null;
    let bestDist = Infinity;
    for (const node of [...schematic.nodes, ...railOverlay.nodes]) {
      const d = Math.hypot(node.gx - gx, node.gy - gy);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  // Centers a grid-space point in the viewport at a given zoom, by solving
  // for the CSS translate that lands it on the viewport's screen center.
  // The SVG's own viewBox-to-container mapping (preserveAspectRatio
  // "xMidYMid meet") happens before our CSS transform, so the point is
  // first converted to container-local pixels via that base fit-scale,
  // then the usual "translate = -scale * (point - center)" formula for a
  // transform-origin: center scale.
  function focusOnGridPoint(gx, gy, targetScale) {
    const el = viewportRef.current;
    if (!el || svgWidth === 0 || svgHeight === 0) return;
    const rect = el.getBoundingClientRect();
    const baseScale = Math.min(rect.width / svgWidth, rect.height / svgHeight);
    const px = toSvgX(gx);
    const py = toSvgY(gy);
    const containerX = (rect.width - svgWidth * baseScale) / 2 + px * baseScale;
    const containerY = (rect.height - svgHeight * baseScale) / 2 + py * baseScale;
    const scale = clampScale(targetScale);
    setView({
      scale,
      x: -scale * (containerX - rect.width / 2),
      y: -scale * (containerY - rect.height / 2),
    });
  }

  useEffect(() => {
    if (!userGridPoint || schematic.nodes.length === 0) return;
    const nearest = findNearestNode(userGridPoint[0], userGridPoint[1]);
    if (nearest) selectNode(nearest);
    focusOnGridPoint(userGridPoint[0], userGridPoint[1], LOCATE_ZOOM_SCALE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userGridPoint]);

  const sortedNodeEtas = [...nodeEtas].sort((a, b) => (minutesUntil(a) ?? 1e9) - (minutesUntil(b) ?? 1e9));
  const showFullscreen = isFullscreen || pseudoFullscreen;

  return (
    <SplitPanel
      mainClassName={`schematic-panel ${pseudoFullscreen ? "pseudo-fullscreen" : ""}`}
      mainRef={panelRef}
      side={
        <>
        <select className="city-select" value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">{t("selectCity")}</option>
          {manifest.map((code) => (
            <option key={code} value={code}>
              {code
                .split("+")
                .map((part) => (i18n.language === "zh-TW" ? cityNames[part]?.Zh_tw : cityNames[part]?.En) || part)
                .join(" + ")}
            </option>
          ))}
        </select>
        {manifest.length === 0 && <p className="hint-text">{t("schematicNoManifest")}</p>}

        <label className="cell-size-label">
          {t("schematicCellSize")}: {cellSize} m
          <input
            type="range"
            min="100"
            max="800"
            step="50"
            value={cellSize}
            onChange={(e) => setCellSize(Number(e.target.value))}
          />
        </label>

        <div className="nearby-actions">
          <button type="button" disabled={!city || loading} onClick={generate}>
            {t("schematicGenerate")}
          </button>
          <button type="button" onClick={locateMe}>
            {t("locateMe")}
          </button>
        </div>

        {loading && <p>{t("schematicLoadingHint")}</p>}
        {error && (
          <p className="error-text">
            {t("errorPrefix")}
            {error}
          </p>
        )}
        {network && !loading && (
          <p className="hint-text">
            {t("schematicStats", { stations: schematic.nodes.length, routes: schematic.lines.length })}
          </p>
        )}
        <p className="hint-text">{t("schematicHint")}</p>

        {(legendLines.length > 0 || hasTraNodes) && (
          <div className="schematic-legend">
            <h3>{t("schematicLegendTitle")}</h3>
            {legendLines.map((l) => (
              <div key={l.color} className="schematic-legend-row">
                <span className="schematic-legend-swatch" style={{ background: l.color }} />
                <span>{l.name}</span>
              </div>
            ))}
            {hasTraNodes && (
              <div className="schematic-legend-row">
                <span className="schematic-legend-swatch schematic-legend-swatch-square" style={{ background: RAIL_MODE_MARKER.tra.fill }} />
                <span>{t("mode_tra")}</span>
              </div>
            )}
            <div className="schematic-legend-row">
              <span className="schematic-legend-swatch schematic-legend-swatch-ring" />
              <span>{t("schematicLegendInterchange")}</span>
            </div>
          </div>
        )}

        {selectedNode && selectedNode.mode === "bus" && (
          <div className="stop-detail">
            <h2>{selectedNode.name}</h2>
            {nodeEtaLoading && <p>{t("loading")}</p>}
            {!nodeEtaLoading && sortedNodeEtas.length === 0 && <p className="hint-text">{t("estimateNoInfo")}</p>}
            <ul className="eta-list">
              {sortedNodeEtas.map((item, idx) => {
                const routeName = i18n.language === "zh-TW" ? item.RouteName?.Zh_tw : item.RouteName?.En || item.RouteName?.Zh_tw;
                const minutes = minutesUntil(item);
                return (
                  <li key={`${item.RouteID}-${item.Direction}-${idx}`}>
                    <div className="eta-row">
                      <span className="eta-route">{routeName}</span>
                      <span className={`eta-time ${minutes != null && minutes <= 1.5 ? "eta-soon" : ""}`}>
                        {formatEstimate(item, t)}
                      </span>
                    </div>
                    {minutes == null && item.StopStatus !== 4 && (
                      <div className="eta-extra">
                        <TimetableFallback city={city} routeId={item.RouteID} stopId={item.StopID} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {selectedNode && selectedNode.mode !== "bus" && (
          <div className="stop-detail">
            <h2>{selectedNode.name}</h2>
            {nodeEtaLoading && <p>{t("loading")}</p>}
            {!nodeEtaLoading && !railInfo && <p className="hint-text">{t("estimateNoInfo")}</p>}
            {!nodeEtaLoading && railInfo && (
              <ul className="info-card-list">
                <NearbyCard item={railInfo} onSelectBus={() => {}} />
              </ul>
            )}
          </div>
        )}
        </>
      }
      main={
        <>
        {schematic.lines.length === 0 && !loading ? (
          <p className="hint-text schematic-placeholder">{t("schematicEmpty")}</p>
        ) : (
          <div
            ref={viewportRef}
            className="schematic-viewport"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="schematic-svg"
              preserveAspectRatio="xMidYMid meet"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            >
              {/* Taipei-MRT-style: bold colored line bands, white-disc
                  stations with a heavier ring at interchanges. Real system
                  maps get this clean look because each line has exclusive
                  track and never truly overlaps another; a bus network's
                  routes constantly share the same roads, so this styling
                  reads well per isolated/highlighted line but the full
                  unfiltered view is inherently denser -- full
                  parallel-corridor line bundling (offsetting co-routed
                  segments into separate parallel bands the way a real
                  system map's shared trunks are drawn) is a substantially
                  bigger layout algorithm this doesn't attempt. */}
              {schematic.lines.map((line) => (
                <polyline
                  key={line.key}
                  points={line.path.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(" ")}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={highlightedKey === line.key ? 7 : 4}
                  strokeOpacity={highlightedKey && highlightedKey !== line.key ? 0.18 : 0.95}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  onClick={() => {
                    if (dragMoved.current) return;
                    setHighlightedKey((prev) => (prev === line.key ? null : line.key));
                  }}
                >
                  <title>{line.name}</title>
                </polyline>
              ))}
              {/* TRA/THSR/Metro overlay, projected into the same grid as
                  the bus network and clipped to what's actually nearby
                  (see buildRailOverlay) -- TRA has no line entries (see
                  scripts/fetch-rail-network.mjs for why), only stations. */}
              {railOverlay.lines.map((line) => (
                <polyline
                  key={line.key}
                  points={line.path.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(" ")}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={highlightedKey === line.key ? 7 : 5}
                  strokeOpacity={highlightedKey && highlightedKey !== line.key ? 0.18 : 0.95}
                  strokeDasharray={line.mode === "thsr" ? "1,0" : "10,4"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  onClick={() => {
                    if (dragMoved.current) return;
                    setHighlightedKey((prev) => (prev === line.key ? null : line.key));
                  }}
                >
                  <title>{line.name}</title>
                </polyline>
              ))}
              {schematic.nodes.map((node) => (
                <circle
                  key={node.key}
                  cx={toSvgX(node.gx)}
                  cy={toSvgY(node.gy)}
                  r={node.isInterchange ? 7 : 3}
                  fill={selectedNode?.key === node.key ? "#4da3ff" : "#fff"}
                  stroke="#1a1a1a"
                  strokeWidth={node.isInterchange ? 3 : 1.25}
                  onMouseEnter={() => setHoveredKey(node.key)}
                  onMouseLeave={() => setHoveredKey((prev) => (prev === node.key ? null : prev))}
                  onClick={() => {
                    if (dragMoved.current) return;
                    selectNode(node);
                  }}
                />
              ))}
              {/* Interchange rings: a colocated TRA/THSR/Metro complex or a
                  multi-line metro station is several separate StationIDs at
                  the same grid cell -- draw one shared ring behind them so
                  it reads as one interchange instead of silently stacked icons. */}
              {railOverlay.interchanges.map((ic) => (
                <circle
                  key={ic.key}
                  cx={toSvgX(ic.gx)}
                  cy={toSvgY(ic.gy)}
                  r={10}
                  fill="none"
                  stroke="#1a1a1a"
                  strokeWidth={2}
                  style={{ pointerEvents: "none" }}
                />
              ))}
              {railOverlay.nodes.map((node) => {
                const marker = RAIL_MODE_MARKER[node.mode];
                const selected = selectedNode?.key === node.key;
                const commonProps = {
                  fill: selected ? "#4da3ff" : marker.fill,
                  stroke: "#1a1a1a",
                  strokeWidth: 1.25,
                  onMouseEnter: () => setHoveredKey(node.key),
                  onMouseLeave: () => setHoveredKey((prev) => (prev === node.key ? null : prev)),
                  onClick: () => {
                    if (dragMoved.current) return;
                    selectNode(node);
                  },
                };
                if (marker.shape === "square") {
                  const size = marker.r * 2;
                  return (
                    <rect
                      key={node.key}
                      x={toSvgX(node.gx) - marker.r}
                      y={toSvgY(node.gy) - marker.r}
                      width={size}
                      height={size}
                      {...commonProps}
                    />
                  );
                }
                return <circle key={node.key} cx={toSvgX(node.gx)} cy={toSvgY(node.gy)} r={marker.r} {...commonProps} />;
              })}
              {/* Station names only on hover/tap (tapping already selects,
                  which shows the label here too) -- not permanently drawn,
                  which got unreadable once a city had more than a handful
                  of interchanges. */}
              {[...schematic.nodes, ...railOverlay.nodes]
                .filter((n) => hoveredKey === n.key || selectedNode?.key === n.key)
                .map((node) => (
                  <text
                    key={`label-${node.key}`}
                    x={toSvgX(node.gx) + 11}
                    y={toSvgY(node.gy) + 4}
                    fontSize="12"
                    fontWeight="600"
                    fill="#1a1a1a"
                    stroke="#fff"
                    strokeWidth="3"
                    paintOrder="stroke"
                    style={{ pointerEvents: "none" }}
                  >
                    {node.name}
                  </text>
                ))}
              {userGridPoint && (
                <circle cx={toSvgX(userGridPoint[0])} cy={toSvgY(userGridPoint[1])} r={6} fill="#4285f4" stroke="#fff" strokeWidth={2} />
              )}
            </svg>
          </div>
        )}

        {schematic.lines.length > 0 && (
          <div className="schematic-controls">
            <button type="button" onClick={() => zoomBy(1.3)}>+</button>
            <button type="button" onClick={() => zoomBy(1 / 1.3)}>−</button>
            <button type="button" onClick={resetView}>⤾</button>
            <button type="button" onClick={toggleFullscreen}>{showFullscreen ? "⤓" : "⤢"}</button>
          </div>
        )}
        </>
      }
    />
  );
}
