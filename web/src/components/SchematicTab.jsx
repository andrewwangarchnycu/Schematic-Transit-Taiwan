import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./CitySelect.jsx";
import { getNetwork, getStationStops, getStopEta } from "../api/client.js";
import { buildSchematic, computeGridBounds, makeProjector } from "../schematic/gridSnap.js";
import { minutesUntil, formatEstimate } from "../utils/eta.js";

const PIXELS_PER_CELL = 22;
const PADDING_CELLS = 2;
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;

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

  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeEtas, setNodeEtas] = useState([]);
  const [nodeEtaLoading, setNodeEtaLoading] = useState(false);

  const [userPoint, setUserPoint] = useState(null);

  const panelRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map());
  const dragState = useRef(null);

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
    getNetwork(city)
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
    if (document.fullscreenElement) document.exitFullscreen();
    else panelRef.current?.requestFullscreen();
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

  const bounds = useMemo(() => {
    const b = computeGridBounds(schematic.nodes, schematic.lines);
    if (userGridPoint) {
      b.minX = Math.min(b.minX, userGridPoint[0]);
      b.maxX = Math.max(b.maxX, userGridPoint[0]);
      b.minY = Math.min(b.minY, userGridPoint[1]);
      b.maxY = Math.max(b.maxY, userGridPoint[1]);
    }
    return b;
  }, [schematic, userGridPoint]);

  const toSvgX = (gx) => (gx - bounds.minX + PADDING_CELLS) * PIXELS_PER_CELL;
  const toSvgY = (gy) => (bounds.maxY - gy + PADDING_CELLS) * PIXELS_PER_CELL;
  const svgWidth = (bounds.maxX - bounds.minX + PADDING_CELLS * 2) * PIXELS_PER_CELL;
  const svgHeight = (bounds.maxY - bounds.minY + PADDING_CELLS * 2) * PIXELS_PER_CELL;

  const sortedNodeEtas = [...nodeEtas].sort((a, b) => (minutesUntil(a) ?? 1e9) - (minutesUntil(b) ?? 1e9));

  return (
    <>
      <aside className="side-panel">
        <CitySelect value={city} onChange={setCity} />

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

        {selectedNode && (
          <div className="stop-detail">
            <h2>{selectedNode.name}</h2>
            {nodeEtaLoading && <p>{t("loading")}</p>}
            {!nodeEtaLoading && sortedNodeEtas.length === 0 && <p className="hint-text">{t("estimateNoInfo")}</p>}
            <ul className="eta-list">
              {sortedNodeEtas.map((item, idx) => {
                const routeName = i18n.language === "zh-TW" ? item.RouteName?.Zh_tw : item.RouteName?.En || item.RouteName?.Zh_tw;
                const minutes = minutesUntil(item);
                return (
                  <li key={`${item.RouteID}-${item.Direction}-${idx}`} className="eta-row">
                    <span className="eta-route">{routeName}</span>
                    <span className={`eta-time ${minutes != null && minutes <= 1.5 ? "eta-soon" : ""}`}>
                      {formatEstimate(item, t)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </aside>

      <main className="map-panel schematic-panel" ref={panelRef}>
        {schematic.lines.length === 0 && !loading ? (
          <p className="hint-text schematic-placeholder">{t("schematicEmpty")}</p>
        ) : (
          <div
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
              {schematic.lines.map((line) => (
                <polyline
                  key={line.key}
                  points={line.path.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(" ")}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={highlightedKey === line.key ? 5 : 2.5}
                  strokeOpacity={highlightedKey && highlightedKey !== line.key ? 0.25 : 0.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  onClick={() => setHighlightedKey((prev) => (prev === line.key ? null : line.key))}
                >
                  <title>{line.name}</title>
                </polyline>
              ))}
              {schematic.nodes.map((node) => (
                <circle
                  key={node.key}
                  cx={toSvgX(node.gx)}
                  cy={toSvgY(node.gy)}
                  r={node.isInterchange ? 5 : 2.5}
                  fill={selectedNode?.key === node.key ? "#4da3ff" : "#fff"}
                  stroke="#222"
                  strokeWidth={node.isInterchange ? 1.5 : 1}
                  onClick={() => selectNode(node)}
                >
                  <title>{node.name}</title>
                </circle>
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
            <button type="button" onClick={toggleFullscreen}>{isFullscreen ? "⤓" : "⤢"}</button>
          </div>
        )}
      </main>
    </>
  );
}
