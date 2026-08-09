import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapContainer, TileLayer, LayersControl, Marker, Popup, Polyline, useMap, useMapEvents } from "react-leaflet";
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

function userLocationIcon(heading) {
  const arrow = heading != null ? `<div class="user-heading" style="transform:rotate(${heading}deg)"></div>` : "";
  return L.divIcon({
    className: "user-location-icon",
    html: `<div class="user-location-dot"></div>${arrow}`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
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
  const { t } = useTranslation();
  const fitPoints = useMemo(
    () => [...markers.map((m) => [m.lat, m.lng]), ...polylines.flatMap((p) => p.positions)],
    [markers, polylines]
  );

  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const watchIdRef = useRef(null);

  // Stable across renders so add/removeEventListener target the same
  // function reference; relies on setUserLocation's functional-update form
  // rather than closing over state directly.
  const handleOrientation = useCallback((event) => {
    let heading = null;
    if (typeof event.webkitCompassHeading === "number") {
      heading = event.webkitCompassHeading; // iOS Safari: already clockwise from North
    } else if (event.alpha != null) {
      heading = 360 - event.alpha; // Android/other: alpha is counter-clockwise from North
    }
    if (heading != null) {
      setUserLocation((prev) => (prev ? { ...prev, heading } : prev));
    }
  }, []);

  const stopLocating = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    window.removeEventListener("deviceorientationabsolute", handleOrientation);
    window.removeEventListener("deviceorientation", handleOrientation);
    setLocating(false);
    setUserLocation(null);
  }, [handleOrientation]);

  const startLocating = useCallback(async () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation((prev) => ({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? prev?.heading ?? null,
        }));
      },
      () => setLocating(false),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    // iOS 13+ requires an explicit user-gesture permission prompt for
    // device orientation; other browsers just start firing the event.
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state === "granted") window.addEventListener("deviceorientation", handleOrientation);
      } catch {
        // heading just won't be available; the position dot alone still works
      }
    } else {
      window.addEventListener("deviceorientationabsolute", handleOrientation);
      window.addEventListener("deviceorientation", handleOrientation);
    }
  }, [handleOrientation]);

  useEffect(() => stopLocating, [stopLocating]);

  return (
    <div className="map-view-wrapper">
      <MapContainer center={TAIWAN_CENTER} zoom={8} className="map-view">
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OSM Transport">
            <TileLayer
              attribution='Map <a href="https://memomaps.de/">memomaps.de</a> <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png"
              maxZoom={18}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Grayscale">
            <TileLayer
              className="tile-grayscale"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OSM Standard">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
        </LayersControl>

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
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon(userLocation.heading)} zIndexOffset={1000} />
        )}
      </MapContainer>

      <button
        type="button"
        className={`locate-control ${locating ? "active" : ""}`}
        onClick={locating ? stopLocating : startLocating}
        title={t("locateMe")}
        aria-label={t("locateMe")}
      >
        ◉
      </button>
    </div>
  );
}
