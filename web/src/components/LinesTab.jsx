import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./CitySelect.jsx";
import SearchBar from "./SearchBar.jsx";
import { searchRoutes, getRouteStops } from "../api/client.js";

const ROUTE_LINE_COLOR = "#c0392b";

function localized(field, lang) {
  return lang === "zh-TW" ? field?.Zh_tw : field?.En || field?.Zh_tw;
}

export default function LinesTab({ setMapState }) {
  const { t, i18n } = useTranslation();
  const [city, setCity] = useState("");
  const [results, setResults] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [directions, setDirections] = useState([]);
  const [activeDirection, setActiveDirection] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleSearch(keyword) {
    if (!city) {
      setError(t("selectCity"));
      return;
    }
    setLoading(true);
    setError(null);
    searchRoutes(city, keyword)
      .then(setResults)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function handleSelectRoute(route) {
    setSelectedRoute(route);
    setDirections([]);
    setLoading(true);
    setError(null);
    getRouteStops(city, route.RouteID)
      .then((data) => {
        setDirections(data);
        setActiveDirection(data[0]?.Direction ?? 0);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function backToSearch() {
    setSelectedRoute(null);
    setDirections([]);
  }

  const current = directions.find((d) => d.Direction === activeDirection) || directions[0] || null;
  const stopsSorted = current
    ? [...(current.Stops || [])].sort((a, b) => (a.StopSequence ?? 0) - (b.StopSequence ?? 0))
    : [];

  useEffect(() => {
    const withPos = stopsSorted.filter((s) => s.StopPosition);
    const positions = withPos.map((s) => [s.StopPosition.PositionLat, s.StopPosition.PositionLon]);
    const markers = withPos.map((s, idx) => ({
      id: `${s.StopUID}-${idx}`,
      lat: s.StopPosition.PositionLat,
      lng: s.StopPosition.PositionLon,
      label: localized(s.StopName, i18n.language),
    }));
    setMapState({
      markers,
      polylines: positions.length > 1 ? [{ id: "route-line", positions, color: ROUTE_LINE_COLOR, weight: 5 }] : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, i18n.language]);

  return (
    <>
      {!selectedRoute && (
        <>
          <CitySelect value={city} onChange={setCity} />
          <SearchBar disabled={!city} onSearch={handleSearch} placeholderKey="searchRoutePlaceholder" />
          {loading && <p>{t("loading")}</p>}
          {error && (
            <p className="error-text">
              {t("errorPrefix")}
              {error}
            </p>
          )}
          {!loading && results.length === 0 && <p className="hint-text">{t("noResults")}</p>}
          <ul className="stop-list">
            {results.map((r) => (
              <li key={r.RouteID}>
                <button type="button" onClick={() => handleSelectRoute(r)}>
                  <span className="stop-name">{localized(r.RouteName, i18n.language)}</span>
                  <span className="stop-route-count">
                    {i18n.language === "zh-TW" ? r.DepartureStopNameZh : r.DepartureStopNameEn || r.DepartureStopNameZh}
                    {" → "}
                    {i18n.language === "zh-TW" ? r.DestinationStopNameZh : r.DestinationStopNameEn || r.DestinationStopNameZh}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selectedRoute && (
        <div className="route-detail">
          <button type="button" className="back-button" onClick={backToSearch}>
            {t("backToSearch")}
          </button>
          <h2>{localized(selectedRoute.RouteName, i18n.language)}</h2>

          {directions.length > 1 && (
            <div className="direction-tabs">
              {directions.map((d) => (
                <button
                  key={d.Direction}
                  type="button"
                  className={d.Direction === activeDirection ? "active" : ""}
                  onClick={() => setActiveDirection(d.Direction)}
                >
                  {d.Direction === 0 ? t("directionGo") : t("directionBack")}
                </button>
              ))}
            </div>
          )}

          {loading && <p>{t("loading")}</p>}
          {error && (
            <p className="error-text">
              {t("errorPrefix")}
              {error}
            </p>
          )}

          <ol className="route-stop-list">
            {stopsSorted.map((s, idx) => (
              <li key={`${s.StopUID}-${idx}`}>{localized(s.StopName, i18n.language)}</li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
