import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStopEta } from "../api/client.js";
import { minutesUntil, formatEstimate } from "../utils/eta.js";
import { compassLabel } from "../utils/compass.js";
import TimetableFallback from "./TimetableFallback.jsx";
import DepartureChips from "./DepartureChips.jsx";

const REFRESH_MS = 20000;

export default function StopDetail({ city, station, onBack, onRouteClick }) {
  const { t, i18n } = useTranslation();
  const [etas, setEtas] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState(null);

  const stopIds = useMemo(
    () => [...new Set((station.Stops || []).map((s) => s.StopID).filter(Boolean))],
    [station]
  );

  useEffect(() => {
    if (stopIds.length === 0) {
      setEtas([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    function load() {
      getStopEta(city, stopIds)
        .then((data) => {
          if (!cancelled) {
            setEtas(data);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    setLoading(true);
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [city, stopIds]);

  const stationName =
    i18n.language === "zh-TW" ? station.StationName?.Zh_tw : station.StationName?.En || station.StationName?.Zh_tw;
  const bearing = compassLabel(station.Bearing, t);

  const sorted = [...etas].sort((a, b) => (minutesUntil(a) ?? 1e9) - (minutesUntil(b) ?? 1e9));

  return (
    <div className="stop-detail">
      <button type="button" className="back-button" onClick={onBack}>
        {t("backToSearch")}
      </button>
      <h2>
        {stationName}
        {bearing && <span className="bearing-badge">({bearing})</span>}
      </h2>
      <p className="hint-text">{t("autoRefreshHint")}</p>

      {loading && <p>{t("loading")}</p>}
      {error && <p className="error-text">{t("errorPrefix")}{error}</p>}

      {!loading && !error && sorted.length === 0 && <p>{t("estimateNoInfo")}</p>}

      <ul className="eta-list">
        {sorted.map((item, idx) => {
          const routeName = i18n.language === "zh-TW" ? item.RouteName?.Zh_tw : item.RouteName?.En || item.RouteName?.Zh_tw;
          const minutes = minutesUntil(item);
          const directionLabel = item.destination
            ? `${t("nearbyTowards")} ${item.destination}`
            : item.Direction === 0
              ? t("directionGo")
              : t("directionBack");
          const key = `${item.RouteID}-${item.Direction}-${idx}`;
          const expandable = minutes != null;
          return (
            <li key={key}>
              <div
                className={`eta-row ${expandable ? "eta-row-expandable" : ""}`}
                onClick={expandable ? () => setExpandedKey((prev) => (prev === key ? null : key)) : undefined}
              >
                {onRouteClick ? (
                  <button
                    type="button"
                    className="eta-route eta-route-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRouteClick(item.RouteID, routeName);
                    }}
                  >
                    {routeName}
                  </button>
                ) : (
                  <span className="eta-route">{routeName}</span>
                )}
                <span className="eta-direction">{directionLabel}</span>
                <span className={`eta-time ${minutes != null && minutes <= 1.5 ? "eta-soon" : ""}`}>
                  {formatEstimate(item, t)}
                </span>
              </div>
              {expandedKey === key && <DepartureChips item={item} />}
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
  );
}
