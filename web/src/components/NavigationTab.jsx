import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { planTrip } from "../api/client.js";

const MODE_COLORS = {
  pedestrian: "#888888",
  bus: "#1e88e5",
  metro: "#2e7d32",
  mrt: "#2e7d32",
  lrt: "#00897b",
  rail: "#8e24aa",
  tra: "#8e24aa",
  thsr: "#e53935",
  hsr: "#e53935",
  ferry: "#00acc1",
  gondola: "#6d4c41",
  air: "#546e7a",
};

function modeColor(mode) {
  return MODE_COLORS[(mode || "").toLowerCase()] || "#455a64";
}

function clockOf(isoLocal) {
  // Times come back as "yyyy-mm-ddTHH:mm:ss" already in Taipei wall-clock
  // time (no offset) -- slice instead of Date-parsing to sidestep the
  // viewer's own timezone entirely.
  return isoLocal && isoLocal.length >= 16 ? isoLocal.slice(11, 16) : "";
}

function sectionLine(section, t, i18n) {
  if (section.type === "pedestrian") {
    const minutes = Math.round((section.travelSummary?.duration || 0) / 60);
    return t("navWalk", { minutes });
  }
  const transport = section.transport || {};
  const name = transport.longName || transport.shortName || transport.number || transport.name || transport.mode;
  const stopCount = (section.intermediateStops || []).length + 1;
  return t("navRide", {
    mode: transport.category || transport.mode,
    name,
    headsign: transport.headsign || "",
    stops: stopCount,
  });
}

export default function NavigationTab({ setMapState }) {
  const { t, i18n } = useTranslation();
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [picking, setPicking] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleMapClick(point) {
    if (picking === "origin") setOrigin(point);
    else if (picking === "destination") setDestination(point);
    setPicking(null);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError(t("navLocationFailed"))
    );
  }

  function handlePlan() {
    if (!origin || !destination) return;
    setLoading(true);
    setError(null);
    setRoutes([]);
    setSelectedIdx(null);
    planTrip(origin, destination)
      .then((data) => {
        const found = data?.data?.routes || [];
        setRoutes(found);
        setSelectedIdx(found.length > 0 ? 0 : null);
        if (found.length === 0) setError(t("navNoRoutes"));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function reset() {
    setOrigin(null);
    setDestination(null);
    setPicking(null);
    setRoutes([]);
    setSelectedIdx(null);
    setError(null);
  }

  useEffect(() => {
    const markers = [];
    if (origin) markers.push({ id: "origin", lat: origin.lat, lng: origin.lng, color: "#2e7d32", label: t("navOrigin") });
    if (destination)
      markers.push({ id: "destination", lat: destination.lat, lng: destination.lng, color: "#c62828", label: t("navDestination") });

    const polylines = [];
    const selected = selectedIdx != null ? routes[selectedIdx] : null;
    if (selected) {
      selected.sections.forEach((section, idx) => {
        const points = [
          [section.departure.place.location.lat, section.departure.place.location.lng],
          ...(section.intermediateStops || []).map((s) => [s.departure.place.location.lat, s.departure.place.location.lng]),
          [section.arrival.place.location.lat, section.arrival.place.location.lng],
        ];
        polylines.push({
          id: `section-${idx}`,
          positions: points,
          color: modeColor(section.transport?.mode),
          dashed: section.type === "pedestrian",
          weight: section.type === "pedestrian" ? 3 : 5,
        });
      });
    }

    setMapState({ markers, polylines, onMapClick: picking ? handleMapClick : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, picking, selectedIdx, routes]);

  return (
    <div className="nav-tab">
      <div className="nav-point-row">
        <span className="nav-point-label">{t("navOrigin")}</span>
        <span className="nav-point-value">{origin ? `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}` : t("navNotSet")}</span>
        <button type="button" className={picking === "origin" ? "active" : ""} onClick={() => setPicking("origin")}>
          {t("navPickOnMap")}
        </button>
        <button type="button" onClick={useMyLocation}>
          {t("navUseMyLocation")}
        </button>
      </div>

      <div className="nav-point-row">
        <span className="nav-point-label">{t("navDestination")}</span>
        <span className="nav-point-value">
          {destination ? `${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}` : t("navNotSet")}
        </span>
        <button type="button" className={picking === "destination" ? "active" : ""} onClick={() => setPicking("destination")}>
          {t("navPickOnMap")}
        </button>
      </div>

      {picking && <p className="hint-text">{t("navPickingHint")}</p>}

      <div className="nav-actions">
        <button type="button" disabled={!origin || !destination || loading} onClick={handlePlan}>
          {t("navPlanTrip")}
        </button>
        <button type="button" onClick={reset}>
          {t("navReset")}
        </button>
      </div>

      {loading && <p>{t("loading")}</p>}
      {error && (
        <p className="error-text">
          {t("errorPrefix")}
          {error}
        </p>
      )}

      <ul className="itinerary-list">
        {routes.map((route, idx) => (
          <li key={idx} className={idx === selectedIdx ? "selected" : ""}>
            <button type="button" onClick={() => setSelectedIdx(idx)}>
              <div className="itinerary-summary">
                <span className="itinerary-time">{Math.round(route.travel_time / 60)} {t("navMinutesUnit")}</span>
                <span className="itinerary-meta">
                  {clockOf(route.start_time)} → {clockOf(route.end_time)} · {t("navTransfers", { count: route.transfers })}
                  {route.total_price != null ? ` · $${route.total_price}` : ""}
                </span>
              </div>
              {idx === selectedIdx && (
                <ol className="itinerary-sections">
                  {route.sections.map((section, sIdx) => (
                    <li key={sIdx}>{sectionLine(section, t, i18n)}</li>
                  ))}
                </ol>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
