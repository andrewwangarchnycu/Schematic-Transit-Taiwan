import { useState } from "react";
import { useTranslation } from "react-i18next";
import CitySelect from "./CitySelect.jsx";
import {
  getFavoriteStops,
  getFavoriteRoutes,
  toggleFavoriteStop,
  toggleFavoriteRoute,
  getRecentStops,
  getRecentRoutes,
  clearRecentStops,
  clearRecentRoutes,
  getHome,
  setHome,
} from "../utils/personalization.js";

const HOME_TABS = ["stations", "lines", "navigation", "schematic"];

function localized(field, lang) {
  return lang === "zh-TW" ? field?.Zh_tw : field?.En || field?.Zh_tw;
}

export default function FavoritesTab({ onOpenStop, onOpenRoute }) {
  const { t, i18n } = useTranslation();
  const [favStops, setFavStops] = useState(getFavoriteStops);
  const [favRoutes, setFavRoutes] = useState(getFavoriteRoutes);
  const [recentStops, setRecentStops] = useState(getRecentStops);
  const [recentRoutes, setRecentRoutes] = useState(getRecentRoutes);
  const home = getHome();
  const [homeTab, setHomeTab] = useState(home?.tab || "stations");
  const [homeCity, setHomeCity] = useState(home?.city || "");
  const [saved, setSaved] = useState(false);

  function removeFavStop(city, stationId) {
    const entry = favStops.find((f) => f.city === city && f.station.StationID === stationId);
    if (entry) setFavStops(toggleFavoriteStop(city, entry.station));
  }

  function removeFavRoute(city, routeId) {
    setFavRoutes(toggleFavoriteRoute(city, routeId));
  }

  function saveHome() {
    setHome({ tab: homeTab, city: homeCity || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="favorites-tab">
      <section className="favorites-section">
        <h2>{t("favoritesHomeTitle")}</h2>
        <div className="favorites-home-row">
          <select value={homeTab} onChange={(e) => setHomeTab(e.target.value)} aria-label={t("favoritesHomeTab")}>
            {HOME_TABS.map((key) => (
              <option key={key} value={key}>
                {t(`tab${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
              </option>
            ))}
          </select>
          <CitySelect value={homeCity} onChange={setHomeCity} />
          <button type="button" onClick={saveHome}>
            {t("favoritesHomeSave")}
          </button>
          {saved && <span className="hint-text">{t("favoritesHomeSaved")}</span>}
        </div>
      </section>

      <section className="favorites-section">
        <h2>{t("favoritesStopsTitle")}</h2>
        {favStops.length === 0 ? (
          <p className="hint-text">{t("favoritesEmpty")}</p>
        ) : (
          <ul className="favorites-list">
            {favStops.map((f) => (
              <li key={`${f.city}-${f.station.StationID}`}>
                <button type="button" className="favorites-item-button" onClick={() => onOpenStop({ city: f.city, station: f.station })}>
                  {localized(f.station.StationName, i18n.language)}
                </button>
                <button
                  type="button"
                  className="favorite-star favorite-star-active"
                  aria-label={t("removeFromFavorites")}
                  onClick={() => removeFavStop(f.city, f.station.StationID)}
                >
                  ★
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="favorites-section">
        <h2>{t("favoritesRoutesTitle")}</h2>
        {favRoutes.length === 0 ? (
          <p className="hint-text">{t("favoritesEmpty")}</p>
        ) : (
          <ul className="favorites-list">
            {favRoutes.map((f) => (
              <li key={`${f.city}-${f.routeId}`}>
                <button type="button" className="favorites-item-button" onClick={() => onOpenRoute({ city: f.city, routeId: f.routeId, routeName: f.routeName })}>
                  {f.routeName}
                </button>
                <button
                  type="button"
                  className="favorite-star favorite-star-active"
                  aria-label={t("removeFromFavorites")}
                  onClick={() => removeFavRoute(f.city, f.routeId)}
                >
                  ★
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="favorites-section">
        <div className="favorites-section-header">
          <h2>{t("recentStopsTitle")}</h2>
          {recentStops.length > 0 && (
            <button type="button" className="timetable-link" onClick={() => { clearRecentStops(); setRecentStops([]); }}>
              {t("clearRecents")}
            </button>
          )}
        </div>
        {recentStops.length === 0 ? (
          <p className="hint-text">{t("recentEmpty")}</p>
        ) : (
          <ul className="favorites-list">
            {recentStops.map((r) => (
              <li key={`${r.city}-${r.station.StationID}`}>
                <button type="button" className="favorites-item-button" onClick={() => onOpenStop({ city: r.city, station: r.station })}>
                  {localized(r.station.StationName, i18n.language)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="favorites-section">
        <div className="favorites-section-header">
          <h2>{t("recentRoutesTitle")}</h2>
          {recentRoutes.length > 0 && (
            <button type="button" className="timetable-link" onClick={() => { clearRecentRoutes(); setRecentRoutes([]); }}>
              {t("clearRecents")}
            </button>
          )}
        </div>
        {recentRoutes.length === 0 ? (
          <p className="hint-text">{t("recentEmpty")}</p>
        ) : (
          <ul className="favorites-list">
            {recentRoutes.map((r) => (
              <li key={`${r.city}-${r.routeId}`}>
                <button type="button" className="favorites-item-button" onClick={() => onOpenRoute({ city: r.city, routeId: r.routeId, routeName: r.routeName })}>
                  {r.routeName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
