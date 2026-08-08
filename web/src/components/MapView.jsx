import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useTranslation } from "react-i18next";

// Default Leaflet marker icons reference bundler-specific asset URLs that
// break under Vite; point them at a CDN instead of shipping icon files.
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const TAIWAN_CENTER = [23.7, 120.9];

function FitToResults({ stations }) {
  const map = useMap();
  useEffect(() => {
    if (stations.length === 0) return;
    const bounds = L.latLngBounds(
      stations.map((s) => [s.StationPosition.PositionLat, s.StationPosition.PositionLon])
    );
    map.fitBounds(bounds.pad(0.2), { maxZoom: 16 });
  }, [stations, map]);
  return null;
}

export default function MapView({ results, selectedStation, onSelect }) {
  const { i18n } = useTranslation();

  return (
    <MapContainer center={TAIWAN_CENTER} zoom={8} className="map-view">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToResults stations={results} />
      {results.map((station) => {
        const name =
          i18n.language === "zh-TW" ? station.StationName?.Zh_tw : station.StationName?.En || station.StationName?.Zh_tw;
        const isSelected = selectedStation && selectedStation.StationID === station.StationID;
        return (
          <Marker
            key={station.StationID}
            position={[station.StationPosition.PositionLat, station.StationPosition.PositionLon]}
            icon={defaultIcon}
            eventHandlers={{ click: () => onSelect(station) }}
            opacity={isSelected ? 1 : 0.85}
          >
            <Popup>{name}</Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
