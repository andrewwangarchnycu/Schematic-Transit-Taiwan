"""
TDX Taichung Bus -> Grid-Simplified Metro-Style Schematic Map (PyQGIS)
========================================================================

What this does
---------------
1. Authenticates against TDX (TDX MOTC Open Data) using OAuth2 client-credentials.
2. Downloads all bus stations for Taichung City (Bus/Station/City/Taichung)
   and all route stop-sequences (Bus/StopOfRoute/City/Taichung).
3. Reprojects every station to a metric CRS (EPSG:3826, TWD97 TM2), then
   snaps each station onto a regular grid (GRID_CELL_M metres) -- this is
   the "simplification" step: many physically-close stops collapse onto
   the same grid node, same as a real metro-diagram generalises geography.
4. For each route direction, walks the ordered stop list, maps every stop
   to its grid node, drops consecutive duplicates, and connects remaining
   nodes with octilinear (0/45/90-degree) connector segments -- the classic
   "metro map" look -- instead of straight great-circle-ish polylines.
5. Writes two layers into a GeoPackage (stations_grid, routes_schematic)
   and adds them to the current QGIS project with metro-style symbology:
   colored line per route (stable color hash) and station dots sized up
   at interchange stations (stations touched by >1 route).

Requirements
-------------
- Run inside the QGIS Python console (Plugins > Python Console) or via
  `qgis_process`/OSGeo4W shell with `qgis.core` importable. This script
  uses QgsVectorLayer / QgsCoordinateTransform / QgsVectorFileWriter,
  which only exist inside a QGIS Python environment.
- A TDX account + registered application (Client ID / Secret) from
  https://tdx.transportdata.tw/ (member center -> application management).
  Free tier is enough; put the credentials into CONFIG below or set the
  TDX_CLIENT_ID / TDX_CLIENT_SECRET environment variables before launching
  QGIS.

How to run
-----------
1. Fill in CONFIG (client id/secret, output path, grid cell size).
2. Open QGIS -> Python Console -> Show Editor -> load this file -> Run.
   Or in the console:  exec(open(r"tdx_taichung_bus_schematic.py", encoding="utf-8").read())
3. Two layers appear in the active project: "stations_grid" and
   "routes_schematic", both also saved to CONFIG["output_gpkg"].

Notes / limits
----------------
- TDX paginates with $top/$skip; this script loops until a short page
  is returned. Default $top=1000, well within TDX's per-call cap.
- Raw API responses are cached to JSON next to this script so re-runs
  (e.g. while tuning GRID_CELL_M) do not re-hit the API every time.
  Delete the cache files (or set CONFIG["use_cache"]=False) to refresh.
- Octilinear routing here uses a single-bend heuristic per segment pair
  (diagonal-then-straight), which is a good approximation for a script
  of this size. For production-grade schematic layout you would run a
  proper mixed-integer/gradient octilinear layout solver afterwards.
"""

import os
import json
import math
import hashlib
import urllib.request
import urllib.parse
import urllib.error

from qgis.core import (
    QgsProject,
    QgsVectorLayer,
    QgsField,
    QgsFields,
    QgsFeature,
    QgsGeometry,
    QgsPointXY,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsVectorFileWriter,
    QgsCategorizedSymbolRenderer,
    QgsRendererCategory,
    QgsLineSymbol,
    QgsMarkerSymbol,
    QgsSymbol,
    QgsWkbTypes,
    NULL,
)
from qgis.PyQt.QtCore import QVariant
from qgis.PyQt.QtGui import QColor


# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
CONFIG = {
    "client_id": os.environ.get("TDX_CLIENT_ID", "YOUR_TDX_CLIENT_ID"),
    "client_secret": os.environ.get("TDX_CLIENT_SECRET", "YOUR_TDX_CLIENT_SECRET"),
    "city": "Taichung",
    "auth_url": "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    "api_base": "https://tdx.transportdata.tw/api/basic/v2",
    "page_size": 1000,

    # working dir for cached raw JSON + output GeoPackage
    "work_dir": os.path.dirname(os.path.abspath(__file__)),
    "output_gpkg": os.path.join(os.path.dirname(os.path.abspath(__file__)), "taichung_bus_schematic.gpkg"),
    "use_cache": True,

    # metric CRS used for grid snapping (TWD97 / TM2 zone 121 -> metres)
    "metric_epsg": 3826,
    "wgs84_epsg": 4326,

    # simplification grid cell size, in metres. Bigger = coarser/simpler map.
    "grid_cell_m": 300,

    # only draw one direction (0) per route to avoid overlapping duplicate
    # lines for the round trip; set False to draw both directions.
    "only_direction_0": True,
}


# ---------------------------------------------------------------------------
# TDX HTTP helpers
# ---------------------------------------------------------------------------
def get_tdx_token(cfg):
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["auth_url"],
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"TDX auth failed ({e.code}): {e.read().decode('utf-8', 'ignore')}") from e
    return payload["access_token"]


def tdx_get_paginated(cfg, token, path):
    """GET an OData bus endpoint, paging with $top/$skip until a short page."""
    results = []
    skip = 0
    top = cfg["page_size"]
    while True:
        qs = urllib.parse.urlencode({"$top": top, "$skip": skip, "$format": "JSON"})
        url = f"{cfg['api_base']}{path}?{qs}"
        req = urllib.request.Request(url, headers={"authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                page = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"TDX GET {path} failed ({e.code}): {e.read().decode('utf-8', 'ignore')}") from e
        if not page:
            break
        results.extend(page)
        if len(page) < top:
            break
        skip += top
    return results


def fetch_cached(cfg, token, cache_name, path):
    cache_path = os.path.join(cfg["work_dir"], cache_name)
    if cfg["use_cache"] and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    data = tdx_get_paginated(cfg, token, path)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


# ---------------------------------------------------------------------------
# Geometry helpers: reprojection, grid snap, octilinear connectors
# ---------------------------------------------------------------------------
def make_transform(cfg):
    src = QgsCoordinateReferenceSystem(f"EPSG:{cfg['wgs84_epsg']}")
    dst = QgsCoordinateReferenceSystem(f"EPSG:{cfg['metric_epsg']}")
    return QgsCoordinateTransform(src, dst, QgsProject.instance())


def lonlat_to_grid(lon, lat, transform, cell_size):
    pt = transform.transform(QgsPointXY(lon, lat))
    gx = round(pt.x() / cell_size)
    gy = round(pt.y() / cell_size)
    return gx, gy


def grid_to_metric_point(gx, gy, cell_size):
    return QgsPointXY(gx * cell_size, gy * cell_size)


def octilinear_path(p1, p2):
    """
    Return list of QgsPointXY from p1 to p2 (inclusive) using at most one
    bend, so every segment is aligned to a multiple of 45 degrees
    (0/45/90/135/...). p1, p2 are grid-index tuples (gx, gy), not metres.
    """
    x1, y1 = p1
    x2, y2 = p2
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 or dy == 0 or abs(dx) == abs(dy):
        return [p1, p2]
    step = min(abs(dx), abs(dy))
    sx = 1 if dx > 0 else -1
    sy = 1 if dy > 0 else -1
    bend = (x1 + step * sx, y1 + step * sy)
    return [p1, bend, p2]


def route_color(route_name):
    h = hashlib.md5(route_name.encode("utf-8")).hexdigest()
    return f"#{h[0:6]}"


def zh_name(name_field, fallback=""):
    if isinstance(name_field, dict):
        return name_field.get("Zh_tw") or name_field.get("En") or fallback
    return name_field or fallback


# ---------------------------------------------------------------------------
# Layer builders
# ---------------------------------------------------------------------------
def build_station_layer(cfg, stations, transform, route_count_by_station):
    fields = QgsFields()
    fields.append(QgsField("StationID", QVariant.String))
    fields.append(QgsField("StationName", QVariant.String))
    fields.append(QgsField("GridX", QVariant.Int))
    fields.append(QgsField("GridY", QVariant.Int))
    fields.append(QgsField("RouteCount", QVariant.Int))
    fields.append(QgsField("IsInterchange", QVariant.Bool))

    layer = QgsVectorLayer(f"Point?crs=EPSG:{cfg['metric_epsg']}", "stations_grid", "memory")
    dp = layer.dataProvider()
    dp.addAttributes(fields)
    layer.updateFields()

    seen_cells = {}  # (gx, gy) -> feature already created (merge stations sharing a grid cell)
    feats = []
    for st in stations:
        sid = st.get("StationID")
        name = zh_name(st.get("StationName"), sid)
        pos = st.get("StationPosition") or {}
        lon, lat = pos.get("PositionLon"), pos.get("PositionLat")
        if lon is None or lat is None:
            continue
        gx, gy = lonlat_to_grid(lon, lat, transform, cfg["grid_cell_m"])
        cell = (gx, gy)
        rcount = route_count_by_station.get(sid, 0)

        if cell in seen_cells:
            existing = seen_cells[cell]
            existing["RouteCount"] = max(existing["RouteCount"], rcount)
            existing["names"].add(name)
            continue

        seen_cells[cell] = {"StationID": sid, "names": {name}, "RouteCount": rcount, "gx": gx, "gy": gy}

    for cell, info in seen_cells.items():
        gx, gy = cell
        feat = QgsFeature(fields)
        feat.setGeometry(QgsGeometry.fromPointXY(grid_to_metric_point(gx, gy, cfg["grid_cell_m"])))
        merged_name = " / ".join(sorted(info["names"]))[:120]
        feat.setAttributes([
            info["StationID"],
            merged_name,
            gx,
            gy,
            info["RouteCount"],
            info["RouteCount"] > 1,
        ])
        feats.append(feat)

    dp.addFeatures(feats)
    layer.updateExtents()
    return layer


def build_route_layer(cfg, stop_of_route, station_grid_by_id, transform):
    fields = QgsFields()
    fields.append(QgsField("RouteID", QVariant.String))
    fields.append(QgsField("RouteName", QVariant.String))
    fields.append(QgsField("Direction", QVariant.Int))
    fields.append(QgsField("Color", QVariant.String))

    layer = QgsVectorLayer(f"LineString?crs=EPSG:{cfg['metric_epsg']}", "routes_schematic", "memory")
    dp = layer.dataProvider()
    dp.addAttributes(fields)
    layer.updateFields()

    feats = []
    for route in stop_of_route:
        direction = route.get("Direction", 0)
        if cfg["only_direction_0"] and direction != 0:
            continue

        route_name = zh_name(route.get("RouteName"), route.get("RouteID", ""))
        stops = sorted(route.get("Stops", []), key=lambda s: s.get("StopSequence", 0))

        grid_seq = []
        for stop in stops:
            sid = stop.get("StationID")
            cell = station_grid_by_id.get(sid)
            if cell is None:
                pos = stop.get("StopPosition") or {}
                lon, lat = pos.get("PositionLon"), pos.get("PositionLat")
                if lon is None or lat is None:
                    continue
                cell = lonlat_to_grid(lon, lat, transform, cfg["grid_cell_m"])
            if grid_seq and grid_seq[-1] == cell:
                continue  # skip consecutive duplicates on same grid node
            grid_seq.append(cell)

        if len(grid_seq) < 2:
            continue

        full_path = [grid_seq[0]]
        for a, b in zip(grid_seq[:-1], grid_seq[1:]):
            seg = octilinear_path(a, b)
            full_path.extend(seg[1:])

        points = [grid_to_metric_point(gx, gy, cfg["grid_cell_m"]) for gx, gy in full_path]
        feat = QgsFeature(fields)
        feat.setGeometry(QgsGeometry.fromPolylineXY(points))
        feat.setAttributes([
            route.get("RouteID", ""),
            route_name,
            direction,
            route_color(route_name),
        ])
        feats.append(feat)

    dp.addFeatures(feats)
    layer.updateExtents()
    return layer


# ---------------------------------------------------------------------------
# Styling
# ---------------------------------------------------------------------------
def style_route_layer(layer):
    categories = []
    seen = set()
    idx = layer.fields().indexOf("RouteName")
    for feat in layer.getFeatures():
        name = feat.attributes()[idx]
        if name in seen:
            continue
        seen.add(name)
        color = feat["Color"] or "#333333"
        symbol = QgsLineSymbol.createSimple({"line_width": "0.8", "capstyle": "round", "joinstyle": "round"})
        symbol.setColor(QColor(color))
        categories.append(QgsRendererCategory(name, symbol, name))
    renderer = QgsCategorizedSymbolRenderer("RouteName", categories)
    layer.setRenderer(renderer)


def style_station_layer(layer):
    normal = QgsMarkerSymbol.createSimple({"name": "circle", "size": "2.0", "color": "#ffffff", "outline_color": "#000000", "outline_width": "0.4"})
    interchange = QgsMarkerSymbol.createSimple({"name": "circle", "size": "3.6", "color": "#ffffff", "outline_color": "#000000", "outline_width": "0.8"})
    categories = [
        QgsRendererCategory(False, normal, "Station"),
        QgsRendererCategory(True, interchange, "Interchange"),
    ]
    renderer = QgsCategorizedSymbolRenderer("IsInterchange", categories)
    layer.setRenderer(renderer)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(cfg=CONFIG):
    token = get_tdx_token(cfg)

    stations = fetch_cached(cfg, token, "cache_stations.json", f"/Bus/Station/City/{cfg['city']}")
    stop_of_route = fetch_cached(cfg, token, "cache_stop_of_route.json", f"/Bus/StopOfRoute/City/{cfg['city']}")

    transform = make_transform(cfg)

    # how many distinct routes touch each StationID (drives interchange sizing)
    route_count_by_station = {}
    for route in stop_of_route:
        for stop in route.get("Stops", []):
            sid = stop.get("StationID")
            if sid:
                route_count_by_station.setdefault(sid, set()).add(route.get("RouteID"))
    route_count_by_station = {k: len(v) for k, v in route_count_by_station.items()}

    station_layer = build_station_layer(cfg, stations, transform, route_count_by_station)

    station_grid_by_id = {}
    for feat in station_layer.getFeatures():
        station_grid_by_id[feat["StationID"]] = (feat["GridX"], feat["GridY"])

    route_layer = build_route_layer(cfg, stop_of_route, station_grid_by_id, transform)

    style_station_layer(station_layer)
    style_route_layer(route_layer)

    save_opts = QgsVectorFileWriter.SaveVectorOptions()
    save_opts.driverName = "GPKG"
    save_opts.layerName = "routes_schematic"
    QgsVectorFileWriter.writeAsVectorFormatV3(route_layer, cfg["output_gpkg"], QgsProject.instance().transformContext(), save_opts)

    save_opts2 = QgsVectorFileWriter.SaveVectorOptions()
    save_opts2.driverName = "GPKG"
    save_opts2.layerName = "stations_grid"
    save_opts2.actionOnExistingFile = QgsVectorFileWriter.CreateOrOverwriteLayer
    QgsVectorFileWriter.writeAsVectorFormatV3(station_layer, cfg["output_gpkg"], QgsProject.instance().transformContext(), save_opts2)

    QgsProject.instance().addMapLayer(route_layer)
    QgsProject.instance().addMapLayer(station_layer)

    print(f"stations_grid: {station_layer.featureCount()} nodes")
    print(f"routes_schematic: {route_layer.featureCount()} route lines")
    print(f"Saved to {cfg['output_gpkg']}")


if __name__ == "__console__" or __name__ == "__main__":
    main()
