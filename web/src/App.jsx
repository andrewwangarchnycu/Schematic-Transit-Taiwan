import { useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./components/CitySelect.jsx";
import SearchBar from "./components/SearchBar.jsx";
import StopList from "./components/StopList.jsx";
import StopDetail from "./components/StopDetail.jsx";
import MapView from "./components/MapView.jsx";
import LangToggle from "./components/LangToggle.jsx";
import { searchStations } from "./api/client.js";

export default function App() {
  const { t } = useTranslation();
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{t("appTitle")}</h1>
        <LangToggle />
      </header>

      <div className="app-body">
        <aside className="side-panel">
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
        </aside>

        <main className="map-panel">
          <MapView results={results} selectedStation={selectedStation} onSelect={setSelectedStation} />
        </main>
      </div>
    </div>
  );
}
