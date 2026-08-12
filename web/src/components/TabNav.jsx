import { useTranslation } from "react-i18next";

const TABS = [
  { key: "stations", labelKey: "tabStations" },
  { key: "lines", labelKey: "tabLines" },
  { key: "navigation", labelKey: "tabNavigation" },
  { key: "schematic", labelKey: "tabSchematic" },
  { key: "favorites", labelKey: "tabFavorites" },
];

export default function TabNav({ active, onChange }) {
  const { t } = useTranslation();
  return (
    <nav className="tab-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={active === tab.key ? "active" : ""}
          onClick={() => onChange(tab.key)}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </nav>
  );
}
