import { useState } from "react";
import { useTranslation } from "react-i18next";
import TabNav from "./components/TabNav.jsx";
import StationsTab from "./components/StationsTab.jsx";
import LinesTab from "./components/LinesTab.jsx";
import NavigationTab from "./components/NavigationTab.jsx";
import SchematicTab from "./components/SchematicTab.jsx";
import MapView from "./components/MapView.jsx";
import LangToggle from "./components/LangToggle.jsx";

const EMPTY_MAP_STATE = { markers: [], polylines: [], onMapClick: null };

export default function App() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("stations");
  const [mapState, setMapState] = useState(EMPTY_MAP_STATE);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{t("appTitle")}</h1>
        <LangToggle />
      </header>

      <TabNav active={activeTab} onChange={setActiveTab} />

      <div className="app-body">
        {activeTab === "schematic" ? (
          <SchematicTab />
        ) : (
          <>
            <aside className="side-panel">
              {activeTab === "stations" && <StationsTab setMapState={setMapState} />}
              {activeTab === "lines" && <LinesTab setMapState={setMapState} />}
              {activeTab === "navigation" && <NavigationTab setMapState={setMapState} />}
            </aside>
            <main className="map-panel">
              <MapView {...mapState} />
            </main>
          </>
        )}
      </div>
    </div>
  );
}
