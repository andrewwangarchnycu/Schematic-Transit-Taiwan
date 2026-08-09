import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./CitySelect.jsx";
import { getNetwork } from "../api/client.js";
import { buildSchematic, computeGridBounds } from "../schematic/gridSnap.js";

const PIXELS_PER_CELL = 22;
const PADDING_CELLS = 2;

export default function SchematicTab() {
  const { t } = useTranslation();
  const [city, setCity] = useState("");
  const [cellSize, setCellSize] = useState(300);
  const [network, setNetwork] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [highlightedKey, setHighlightedKey] = useState(null);

  function generate() {
    if (!city) {
      setError(t("selectCity"));
      return;
    }
    setLoading(true);
    setError(null);
    setNetwork(null);
    setHighlightedKey(null);
    getNetwork(city)
      .then(setNetwork)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  const schematic = useMemo(() => {
    if (!network) return { nodes: [], lines: [] };
    return buildSchematic(network, cellSize);
  }, [network, cellSize]);

  const bounds = useMemo(() => computeGridBounds(schematic.nodes, schematic.lines), [schematic]);

  const toSvgX = (gx) => (gx - bounds.minX + PADDING_CELLS) * PIXELS_PER_CELL;
  const toSvgY = (gy) => (bounds.maxY - gy + PADDING_CELLS) * PIXELS_PER_CELL;
  const svgWidth = (bounds.maxX - bounds.minX + PADDING_CELLS * 2) * PIXELS_PER_CELL;
  const svgHeight = (bounds.maxY - bounds.minY + PADDING_CELLS * 2) * PIXELS_PER_CELL;

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

        <button type="button" disabled={!city || loading} onClick={generate}>
          {t("schematicGenerate")}
        </button>

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
      </aside>

      <main className="map-panel schematic-panel">
        {schematic.lines.length === 0 && !loading ? (
          <p className="hint-text schematic-placeholder">{t("schematicEmpty")}</p>
        ) : (
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="schematic-svg"
            preserveAspectRatio="xMidYMid meet"
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
                fill="#fff"
                stroke="#222"
                strokeWidth={node.isInterchange ? 1.5 : 1}
              >
                <title>{node.name}</title>
              </circle>
            ))}
          </svg>
        )}
      </main>
    </>
  );
}
