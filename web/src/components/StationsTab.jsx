import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./CitySelect.jsx";
import SearchBar from "./SearchBar.jsx";
import StopList from "./StopList.jsx";
import StopDetail from "./StopDetail.jsx";
import { searchStations } from "../api/client.js";

export default function StationsTab({ setMapState }) {
  const { t, i18n } = useTranslation();
  const [city, setCity] = useState("");
  const [results, setResults] = useState([]);
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
    searchStations(city, keyword)
      .then(setResults)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
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
  }, [results, i18n.language, setMapState]);

  return (
    <>
      {!selectedStation && (
        <>
          <CitySelect value={city} onChange={setCity} />
          <SearchBar disabled={!city} onSearch={handleSearch} />
          {loading && <p>{t("loading")}</p>}
          {error && <p className="error-text">{t("errorPrefix")}{error}</p>}
          {!loading && <StopList results={results} onSelect={setSelectedStation} />}
        </>
      )}
      {selectedStation && (
        <StopDetail city={city} station={selectedStation} onBack={() => setSelectedStation(null)} />
      )}
    </>
  );
}
