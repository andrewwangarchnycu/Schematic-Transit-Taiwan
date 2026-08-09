import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStopEta } from "../api/client.js";

const REFRESH_MS = 20000;

// TDX Bus StopStatus: 0 normal, 1 not yet departed, 2 skipped (traffic
// control), 3 last bus already left, 4 no service today.
//
// The live API gives EstimateTime (seconds, only for GPS-tracked buses
// already en route) and/or NextBusTime (absolute ISO timestamp, the
// scheduled prediction) -- a stop can have either, both, or neither
// depending on the route. minutesUntil() normalizes both into one number
// so sorting and display agree.
function minutesUntil(item) {
  if (item.EstimateTime != null) return item.EstimateTime / 60;
  if (item.NextBusTime) {
    const diffMs = new Date(item.NextBusTime).getTime() - Date.now();
    return diffMs / 60000;
  }
  return null;
}

function formatEstimate(item, t) {
  if (item.StopStatus === 4) return t("estimateNoService");
  const minutes = minutesUntil(item);
  if (minutes == null) {
    return item.StopStatus === 1 ? t("estimateNotDeparted") : t("estimateNoInfo");
  }
  if (minutes <= 1.5) return t("estimateArriving");
  return t("estimateMinutes", { minutes: Math.round(minutes) });
}

export default function StopDetail({ city, station, onBack }) {
  const { t, i18n } = useTranslation();
  const [etas, setEtas] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const sorted = [...etas].sort((a, b) => (minutesUntil(a) ?? 1e9) - (minutesUntil(b) ?? 1e9));

  return (
    <div className="stop-detail">
      <button type="button" className="back-button" onClick={onBack}>
        {t("backToSearch")}
      </button>
      <h2>{stationName}</h2>
      <p className="hint-text">{t("autoRefreshHint")}</p>

      {loading && <p>{t("loading")}</p>}
      {error && <p className="error-text">{t("errorPrefix")}{error}</p>}

      {!loading && !error && sorted.length === 0 && <p>{t("estimateNoInfo")}</p>}

      <ul className="eta-list">
        {sorted.map((item, idx) => {
          const routeName = i18n.language === "zh-TW" ? item.RouteName?.Zh_tw : item.RouteName?.En || item.RouteName?.Zh_tw;
          const minutes = minutesUntil(item);
          return (
            <li key={`${item.RouteID}-${item.Direction}-${idx}`} className="eta-row">
              <span className="eta-route">{routeName}</span>
              <span className="eta-direction">{item.Direction === 0 ? t("directionGo") : t("directionBack")}</span>
              <span className={`eta-time ${minutes != null && minutes <= 1.5 ? "eta-soon" : ""}`}>
                {formatEstimate(item, t)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
