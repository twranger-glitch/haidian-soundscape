#!/usr/bin/env python3
"""Download OSM building ways + multipolygon relations for an offline bbox fallback.

This is intentionally a *build-time* helper, not a browser runtime dependency.
It reconstructs relation polygons from Overpass member geometries so large
schools/complexes mapped as multipolygons are not silently dropped.
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request

from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import polygonize, unary_union


def parse_height(tags, storey=3.1):
    try:
        raw = str(tags.get("height", "")).lower().strip()
        if raw:
            x = float(raw.replace(",", ".").split()[0])
            if x > 0:
                return (x * 0.3048 if ("ft" in raw or "'" in raw) else x), "OSM height"
    except Exception:
        pass
    try:
        n = float(str(tags.get("building:levels", "")).replace(",", "."))
        if n > 0:
            return n * storey, f"OSM building:levels × {storey:g} m"
    except Exception:
        pass
    return None, "missing upstream height"


def closed_way_geometry(points):
    ring = [[p["lon"], p["lat"]] for p in points or [] if "lon" in p and "lat" in p]
    if len(ring) < 3:
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    try:
        poly = Polygon(ring)
        if not poly.is_valid:
            poly = poly.buffer(0)
        return poly if not poly.is_empty and poly.geom_type in ("Polygon", "MultiPolygon") else None
    except Exception:
        return None


def relation_geometry(element):
    outer_lines, inner_lines = [], []
    for member in element.get("members") or []:
        pts = member.get("geometry") or []
        coords = [(p["lon"], p["lat"]) for p in pts if "lon" in p and "lat" in p]
        if len(coords) < 2:
            continue
        line = LineString(coords)
        if member.get("role") == "inner":
            inner_lines.append(line)
        else:
            outer_lines.append(line)
    if not outer_lines:
        return None
    try:
        outer = unary_union(list(polygonize(unary_union(outer_lines))))
        if outer.is_empty:
            return None
        if inner_lines:
            inner = unary_union(list(polygonize(unary_union(inner_lines))))
            if not inner.is_empty:
                outer = outer.difference(inner)
        if not outer.is_valid:
            outer = outer.buffer(0)
        if outer.is_empty or outer.geom_type not in ("Polygon", "MultiPolygon"):
            return None
        return outer
    except Exception:
        return None


def feature_from_element(el, storey):
    tags = el.get("tags") or {}
    h, hs = parse_height(tags, storey)
    if el.get("type") == "way":
        geom = closed_way_geometry(el.get("geometry"))
    elif el.get("type") == "relation":
        geom = relation_geometry(el)
    else:
        geom = None
    if geom is None:
        return None
    props = {
        "osm_id": el.get("id"),
        "osm_type": el.get("type"),
        "name": tags.get("name:zh") or tags.get("name"),
        "height": h,
        "height_source": hs,
        "building:levels": tags.get("building:levels"),
        "building": tags.get("building"),
        "building:use": tags.get("building:use"),
        "amenity": tags.get("amenity"),
    }
    return {"type": "Feature", "geometry": mapping(geom), "properties": props}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", required=True, help="west,south,east,north")
    ap.add_argument("--out", required=True)
    ap.add_argument("--endpoint", default="https://overpass-api.de/api/interpreter")
    ap.add_argument("--storey-height", type=float, default=3.1)
    ap.add_argument("--timeout", type=int, default=90)
    a = ap.parse_args()
    w, s, e, n = [float(x) for x in a.bbox.split(",")]
    q = (
        f"[out:json][timeout:{max(20, min(180, a.timeout))}];"
        f"(way[\"building\"]({s},{w},{n},{e});relation[\"building\"]({s},{w},{n},{e}););"
        "out body geom;"
    )
    url = a.endpoint + "?data=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={"User-Agent": "haidian-soundscape-building-pipeline/8.5.1"})
    with urllib.request.urlopen(req, timeout=a.timeout + 15) as r:
        data = json.load(r)
    feats = []
    relation_count = 0
    for el in data.get("elements", []):
        feat = feature_from_element(el, a.storey_height)
        if feat:
            feats.append(feat)
            if el.get("type") == "relation":
                relation_count += 1
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps({"features": len(feats), "relations_reconstructed": relation_count, "out": a.out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
