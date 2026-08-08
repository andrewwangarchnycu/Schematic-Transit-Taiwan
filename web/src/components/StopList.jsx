import { useTranslation } from "react-i18next";

export default function StopList({ results, onSelect }) {
  const { t, i18n } = useTranslation();

  if (results.length === 0) {
    return <p className="hint-text">{t("noResults")}</p>;
  }

  return (
    <ul className="stop-list">
      {results.map((station) => (
        <li key={station.StationID}>
          <button type="button" onClick={() => onSelect(station)}>
            <span className="stop-name">
              {i18n.language === "zh-TW" ? station.StationName?.Zh_tw : station.StationName?.En || station.StationName?.Zh_tw}
            </span>
            <span className="stop-route-count">
              {(station.Stops || []).length} {t("route")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
