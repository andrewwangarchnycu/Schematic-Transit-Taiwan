import { useState } from "react";
import { useTranslation } from "react-i18next";
import TabNav from "./components/TabNav.jsx";
import StationsTab from "./components/StationsTab.jsx";
import LinesTab from "./components/LinesTab.jsx";
import NavigationTab from "./components/NavigationTab.jsx";
import SchematicTab from "./components/SchematicTab.jsx";
import FavoritesTab from "./components/FavoritesTab.jsx";
import MapView from "./components/MapView.jsx";
import LangToggle from "./components/LangToggle.jsx";
import SplitPanel from "./components/SplitPanel.jsx";
import { getHome } from "./utils/personalization.js";

const EMPTY_MAP_STATE = { markers: [], polylines: [], onMapClick: null };

export default function App() {
  const { t } = useTranslation();
  const home = getHome();
  const [activeTab, setActiveTab] = useState(home?.tab || "stations");
  const [mapState, setMapState] = useState(EMPTY_MAP_STATE);
  // { city, routeId?, routeName?, keyword? } -- set by StopDetail/NavigationTab
  // when the user clicks a route name, consumed once by LinesTab to jump
  // straight to that route's detail view.
  const [pendingRoute, setPendingRoute] = useState(null);
  // { city, station } -- set by FavoritesTab when the user picks a saved or
  // recent stop, consumed once by StationsTab to jump straight to it.
  const [pendingStation, setPendingStation] = useState(null);

  function navigateToRoute(payload) {
    setPendingRoute(payload);
    setActiveTab("lines");
  }

  function navigateToStation(payload) {
    setPendingStation(payload);
    setActiveTab("stations");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{t("appTitle")}</h1>
        <LangToggle />
      </header>

      <TabNav active={activeTab} onChange={setActiveTab} />

      <div className="app-body">
        {activeTab === "schematic" && <SchematicTab />}
        {activeTab === "favorites" && (
          <FavoritesTab onOpenStop={navigateToStation} onOpenRoute={navigateToRoute} />
        )}
        {activeTab !== "schematic" && activeTab !== "favorites" && (
          <SplitPanel
            side={
              <>
                {activeTab === "stations" && (
                  <StationsTab
                    setMapState={setMapState}
                    onRouteClick={navigateToRoute}
                    initialCity={home?.city}
                    pendingStation={pendingStation}
                    onConsumePendingStation={() => setPendingStation(null)}
                  />
                )}
                {activeTab === "lines" && (
                  <LinesTab
                    setMapState={setMapState}
                    pendingRoute={pendingRoute}
                    onConsumePendingRoute={() => setPendingRoute(null)}
                    initialCity={home?.city}
                  />
                )}
                {activeTab === "navigation" && <NavigationTab setMapState={setMapState} onRouteClick={navigateToRoute} />}
              </>
            }
            main={<MapView {...mapState} />}
          />
        )}
      </div>
    </div>
  );
}
