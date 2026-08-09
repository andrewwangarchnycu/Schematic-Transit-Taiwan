import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

// Default Leaflet marker icons reference bundler-specific asset URLs that
// break under Vite; point them at a CDN instead of shipping icon files.
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const coloredIconCache = {};
function coloredIcon(color) {
  if (!coloredIconCache[color]) {
    coloredIconCache[color] = L.divIcon({
      className: "colored-pin",
      html: `<span style="background:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }
  return coloredIconCache[color];
}

const TAIWAN_CENTER = [23.7, 120.9];

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds.pad(0.2), { maxZoom: 16 });
  }, [points, map]);
  return null;
}

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// markers: [{ id, lat, lng, label?, color?, onClick? }]
// polylines: [{ id, positions: [[lat,lng],...], color?, dashed?, onClick? }]
// onMapClick: ({lat,lng}) => void, enables click-to-pick when set
export default function MapView({ markers = [], polylines = [], onMapClick }) {
  const fitPoints = useMemo(
    () => [...markers.map((m) => [m.lat, m.lng]), ...polylines.flatMap((p) => p.positions)],
    [markers, polylines]
  );

  return (
    <MapContainer center={TAIWAN_CENTER} zoom={8} className="map-view">
      <TileLayer
        attribution='Map <a href="https://memomaps.de/">memomaps.de</a> <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png"
        maxZoom={18}
      />
      <FitBounds points={fitPoints} />
      {onMapClick && <ClickHandler onMapClick={onMapClick} />}
      {polylines.map((p) => (
        <Polyline
          key={p.id}
          positions={p.positions}
          pathOptions={{
            color: p.color || "#1e3a5f",
            weight: p.weight || 4,
            dashArray: p.dashed ? "6,6" : null,
            opacity: p.opacity ?? 0.9,
          }}
          eventHandlers={p.onClick ? { click: p.onClick } : undefined}
        />
      ))}
      {markers.map((m) => (
        <Marker
          key={m.id}
          position={[m.lat, m.lng]}
          icon={m.color ? coloredIcon(m.color) : defaultIcon}
          eventHandlers={m.onClick ? { click: m.onClick } : undefined}
        >
          {m.label && <Popup>{m.label}</Popup>}
        </Marker>
      ))}
    </MapContainer>
  );
}
