import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./CitySelect.jsx";
import SearchBar from "./SearchBar.jsx";
import StopList from "./StopList.jsx";
import StopDetail from "./StopDetail.jsx";
import NearbyCard from "./NearbyCard.jsx";
import { searchStations, getNearby, geocodeAddress } from "../api/client.js";

const MODE_MARKER_COLOR = {
  bus: "#3457ea",
  thsr: "#e53935",
  tra: "#8e24aa",
  metro: "#1f9d55",
  bike: "#f39c12",
};

export default function StationsTab({ setMapState, onRouteClick }) {
  const { t, i18n } = useTranslation();
  const [city, setCity] = useState("");
  const [results, setResults] = useState([]);
  const [nearbyItems, setNearbyItems] = useState(null);
  const [addressQuery, setAddressQuery] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(keyword) {
    if (!city) {
      setError(t("selectCity"));
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedStation(null);
    setNearbyItems(null);
    setAddressQuery(null);
    try {
      const found = await searchStations(city, keyword);
      if (found.length > 0) {
        setResults(found);
        return;
      }
      // No stop-name match -- try the query as an address/landmark and
      // show what's nearby, instead of just reporting nothing found.
      setResults([]);
      const geo = await geocodeAddress(keyword);
      if (!geo) {
        setError(t("addressNotFound"));
        return;
      }
      const items = await getNearby(geo.lat, geo.lng, city);
      setNearbyItems(items.filter((item) => !item.error));
      setAddressQuery(keyword);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleNearby() {
    if (!city) {
      // Bus/YouBike are city-partitioned in TDX and skipped without one,
      // so without a city the search only checks nationwide TRA/THSR/Metro
      // stations -- it resolves almost instantly and, most places in
      // Taiwan, with zero results, which reads as a broken/premature
      // "no results" rather than what it actually is (a real but narrow
      // search). Require a city so the full search always runs.
      setError(t("selectCity"));
      return;
    }
    if (!navigator.geolocation) {
      setError(t("navLocationFailed"));
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedStation(null);
    setResults([]);
    setNearbyItems(null);
    setAddressQuery(null);
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
              <>
                {addressQuery && <p className="hint-text">{t("addressSearchResultsFor", { query: addressQuery })}</p>}
                <ul className="info-card-list">
                  {nearbyItems.map((item) => (
                    <NearbyCard key={`${item.mode}-${item.id}`} item={item} onSelectBus={setSelectedStation} />
                  ))}
                </ul>
              </>
            )
          )}

          {!loading && !nearbyItems && <StopList results={results} onSelect={setSelectedStation} />}
        </>
      )}
      {selectedStation && (
        <StopDetail
          city={city}
          station={selectedStation}
          onBack={() => setSelectedStation(null)}
          onRouteClick={(routeId, routeName) => onRouteClick({ city, routeId, routeName })}
        />
      )}
    </>
  );
}
