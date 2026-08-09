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
  // { city, routeId?, routeName?, keyword? } -- set by StopDetail/NavigationTab
  // when the user clicks a route name, consumed once by LinesTab to jump
  // straight to that route's detail view.
  const [pendingRoute, setPendingRoute] = useState(null);

  function navigateToRoute(payload) {
    setPendingRoute(payload);
    setActiveTab("lines");
  }

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
              {activeTab === "stations" && <StationsTab setMapState={setMapState} onRouteClick={navigateToRoute} />}
              {activeTab === "lines" && (
                <LinesTab setMapState={setMapState} pendingRoute={pendingRoute} onConsumePendingRoute={() => setPendingRoute(null)} />
              )}
              {activeTab === "navigation" && <NavigationTab setMapState={setMapState} onRouteClick={navigateToRoute} />}
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
