import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./CitySelect.jsx";
import SearchBar from "./SearchBar.jsx";
import StopList from "./StopList.jsx";
import StopDetail from "./StopDetail.jsx";
import NearbyCard from "./NearbyCard.jsx";
import { searchStations, getNearby } from "../api/client.js";

const MODE_MARKER_COLOR = {
  bus: "#3457ea",
  thsr: "#e53935",
  tra: "#8e24aa",
  metro: "#1f9d55",
  bike: "#f39c12",
};

export default function StationsTab({ setMapState }) {
  const { t, i18n } = useTranslation();
  const [city, setCity] = useState("");
  const [results, setResults] = useState([]);
  const [nearbyItems, setNearbyItems] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleSearch(keyword) {
    if (!city) {
      setError(t("selectCity"));
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedStation(null);
    setNearbyItems(null);
    searchStations(city, keyword)
      .then(setResults)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function handleNearby() {
    if (!navigator.geolocation) {
      setError(t("navLocationFailed"));
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedStation(null);
    setResults([]);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        getNearby(pos.coords.latitude, pos.coords.longitude, city)
          .then((items) => setNearbyItems(items.filter((item) => !item.error)))
          .catch((err) => setError(err.message))
          .finally(() => setLoading(false));
      },
      () => {
        setError(t("navLocationFailed"));
        setLoading(false);
      }
    );
  }

  useEffect(() => {
    if (nearbyItems) {
      const markers = nearbyItems
        .filter((item) => item.lat != null)
        .map((item) => ({
          id: `${item.mode}-${item.id}`,
          lat: item.lat,
          lng: item.lng,
          label: item.name,
          color: MODE_MARKER_COLOR[item.mode],
          onClick: item.mode === "bus" ? () => setSelectedStation(item.station) : undefined,
        }));
      setMapState({ markers, polylines: [] });
      return;
    }
    const markers = results
      .filter((s) => s.StationPosition)
      .map((s) => ({
        id: s.StationID,
        lat: s.StationPosition.PositionLat,
        lng: s.StationPosition.PositionLon,
        label: i18n.language === "zh-TW" ? s.StationName?.Zh_tw : s.StationName?.En || s.StationName?.Zh_tw,
        onClick: () => setSelectedStation(s),
      }));
    setMapState({ markers, polylines: [] });
  }, [results, nearbyItems, i18n.language, setMapState]);

  return (
    <>
      {!selectedStation && (
        <>
          <CitySelect value={city} onChange={setCity} />
          <SearchBar disabled={!city} onSearch={handleSearch} />
          <div className="nearby-actions">
            <button type="button" disabled={loading} onClick={handleNearby}>
              {t("nearbyButton")}
            </button>
          </div>

          {loading && <p>{t("loading")}</p>}
          {error && (
            <p className="error-text">
              {t("errorPrefix")}
              {error}
            </p>
          )}

          {!loading && nearbyItems && (
            nearbyItems.length === 0 ? (
              <p className="hint-text">{t("nearbyEmpty")}</p>
            ) : (
              <ul className="info-card-list">
                {nearbyItems.map((item) => (
                  <NearbyCard key={`${item.mode}-${item.id}`} item={item} onSelectBus={setSelectedStation} />
                ))}
              </ul>
            )
          )}

          {!loading && !nearbyItems && <StopList results={results} onSelect={setSelectedStation} />}
        </>
      )}
      {selectedStation && (
        <StopDetail city={city} station={selectedStation} onBack={() => setSelectedStation(null)} />
      )}
    </>
  );
}
