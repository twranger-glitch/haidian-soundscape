#!/usr/bin/env python3
"""Build lightweight, provenance-preserving GeoJSON building tiles.

Taiwan project source priority:
  NLSC > Overture > OSM

The builder is intentionally an *offline* conflation step. It accepts ordinary
GeoJSON FeatureCollections, normalizes height/provenance, composes Overture
building parts without double-extruding the parent footprint, removes lower-
priority duplicates, estimates only otherwise-missing heights with explicitly
labelled inference, and writes versionable Web-Mercator XYZ GeoJSON tiles.

Buildings intersecting multiple z16 tiles are repeated as full footprints;
the browser de-duplicates them by `building_uid`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

PRIORITY = {"NLSC": 0, "Overture": 1, "OSM": 2}
DEFAULT_STOREY_HEIGHT_M = 3.1
DEFAULT_FALLBACK_HEIGHT_M = 3.1
WGS84_TO_WEBMERC = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform


@dataclass
class Building:
    feature: dict[str, Any]
    geom_wgs84: Any
    geom_m: Any
    source: str
    upstream_id: str
    feature_kind: str = "building"
    parent_id: str | None = None


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        raw = str(v).replace(",", ".").strip().lower()
        if not raw:
            return None
        token = raw.split()[0]
        x = float(token)
        if not math.isfinite(x):
            return None
        if ("ft" in raw or "'" in raw) and x > 0:
            x *= 0.3048
        return x
    except Exception:
        return None


def _canonical_name(props: dict[str, Any]) -> str:
    for key in ("name:zh", "name", "NAME"):
        value = props.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    names = props.get("names")
    if isinstance(names, dict):
        primary = names.get("primary")
        if isinstance(primary, str):
            return primary
        if isinstance(primary, dict):
            for key in ("zh", "local", "en"):
                value = primary.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    value = props.get("names.primary")
    return value.strip() if isinstance(value, str) else ""


def _source_datasets(props: dict[str, Any]) -> list[str]:
    out: list[str] = []
    sources = props.get("sources")
    if isinstance(sources, list):
        for src in sources:
            if isinstance(src, dict):
                ds = src.get("dataset") or src.get("provider")
                if ds and str(ds) not in out:
                    out.append(str(ds))
    return out[:8]


def _pick_height(props: dict[str, Any], source: str, storey_height: float) -> tuple[float | None, str, str]:
    # Direct total height is best. Overture defines `height` as bottom-to-top.
    for key in ("height", "render_height", "HEIGHT", "Height", "building_height", "BUILDING_HEIGHT", "H", "h"):
        h = _num(props.get(key))
        if h and h > 0:
            return h, f"{source} direct height:{key}", "direct"

    # Floors are an explicit but approximate height source.
    for key in ("num_floors", "building:levels", "levels", "floor", "floors", "FLOORS", "FloorCount"):
        n = _num(props.get(key))
        if n and n > 0:
            return n * storey_height, f"{source} {key} × {storey_height:g} m", "floors-derived"

    return None, "missing upstream height", "missing"


def _upstream_id(props: dict[str, Any], source: str, idx: int) -> str:
    for key in ("source_id", "id", "ID", "gid", "GID", "building_id", "osm_id", "OBJECTID", "FID", "uid"):
        v = props.get(key)
        if v not in (None, ""):
            return str(v)
    return f"row-{idx}"


def _make_uid(source: str, upstream_id: str, geom: Any, suffix: str = "") -> str:
    seed = f"{source}:{upstream_id}:{suffix}:{geom.wkb_hex[:384]}"
    return f"{source.lower()}-{hashlib.sha1(seed.encode('utf-8')).hexdigest()[:16]}"


def _normalized_properties(
    props: dict[str, Any], source: str, source_version: str, upstream_id: str,
    height: float | None, height_source: str, height_quality: str,
    feature_kind: str, parent_id: str | None,
) -> dict[str, Any]:
    min_height = _num(props.get("min_height"))
    if min_height is None:
        min_floor = _num(props.get("min_floor"))
        if min_floor and min_floor > 0:
            min_height = min_floor * DEFAULT_STOREY_HEIGHT_M
    roof_height = _num(props.get("roof_height"))
    subtype = props.get("subtype") or props.get("building") or props.get("building:use") or ""
    klass = props.get("class") or props.get("amenity") or ""
    # Overture `height` is the vertical thickness from the feature's lowest
    # point to highest point, while `min_height` is the altitude of its bottom
    # above ground. ShadeMap's public GeoJSON interface exposes a top/extrusion
    # height but no documented min-height input, so use the top elevation for
    # shadow casting and retain the original source thickness separately.
    source_height = float(height) if height is not None else None
    top_height = (source_height + float(min_height or 0)) if source_height is not None else None
    effective_height_source = height_source
    if source_height is not None and min_height and min_height > 0:
        effective_height_source = f"{height_source}; top = source height + min_height"
    p = {
        "height": round(top_height, 3) if top_height is not None else None,
        "render_height": round(top_height, 3) if top_height is not None else None,
        "source_height_m": round(source_height, 3) if source_height is not None else None,
        "height_source": effective_height_source,
        "height_quality": height_quality,
        "building_source": source,
        "source_id": f"{source}:{upstream_id}",
        "source_version": source_version or "unknown",
        "upstream_id": upstream_id,
        "feature_kind": feature_kind,
        "name": _canonical_name(props),
        "subtype": str(subtype) if subtype is not None else "",
        "class": str(klass) if klass is not None else "",
        "min_height": round(float(min_height), 3) if min_height is not None and min_height >= 0 else 0,
        "roof_height": round(float(roof_height), 3) if roof_height is not None and roof_height >= 0 else 0,
        "is_underground": bool(props.get("is_underground") is True),
        "has_parts": bool(props.get("has_parts") is True),
        "parent_id": parent_id or "",
    }
    datasets = _source_datasets(props)
    if datasets:
        p["source_datasets"] = datasets
    return p


def load_source(
    path: str | None, source: str, source_version: str, storey_height: float,
    feature_kind: str = "building",
) -> list[Building]:
    if not path:
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    features = data.get("features", []) if isinstance(data, dict) else []
    out: list[Building] = []
    for idx, raw in enumerate(features):
        if not isinstance(raw, dict):
            continue
        geom_json = raw.get("geometry")
        if not geom_json or geom_json.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        try:
            geom = shape(geom_json)
            if geom.is_empty:
                continue
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
                continue
        except Exception:
            continue
        props = dict(raw.get("properties") or {})
        # Some GeoJSON encoders preserve the source feature identifier at the
        # top-level Feature `id` rather than copying it into properties. Keep it
        # so Overture GERS/building IDs remain stable through the pipeline.
        if props.get("id") in (None, "") and raw.get("id") not in (None, ""):
            props["id"] = raw.get("id")
        if props.get("is_underground") is True:
            continue
        height, height_source, height_quality = _pick_height(props, source, storey_height)
        uid = _upstream_id(props, source, idx)
        parent_id = str(props.get("building_id")) if props.get("building_id") not in (None, "") else None
        normalized_props = _normalized_properties(
            props, source, source_version, uid, height, height_source, height_quality,
            feature_kind, parent_id,
        )
        normalized_props["building_uid"] = _make_uid(source, uid, geom, feature_kind)
        feature = {"type": "Feature", "geometry": mapping(geom), "properties": normalized_props}
        out.append(Building(feature, geom, transform(WGS84_TO_WEBMERC, geom), source, uid, feature_kind, parent_id))
    return out


def _clone_with_geometry(building: Building, geom: Any, kind: str, suffix: str) -> Building:
    props = dict(building.feature.get("properties") or {})
    props["feature_kind"] = kind
    props["building_uid"] = _make_uid(building.source, building.upstream_id, geom, suffix)
    feature = {"type": "Feature", "geometry": mapping(geom), "properties": props}
    return Building(feature, geom, transform(WGS84_TO_WEBMERC, geom), building.source, building.upstream_id, kind, building.parent_id)


def compose_overture_parts(parents: list[Building], parts: list[Building], remainder_min_fraction: float = 0.03) -> tuple[list[Building], dict[str, int]]:
    """Use building parts where available without retaining the overlapping parent shell.

    Parent area not covered by parts is retained as a `building_remainder`, so a
    partially mapped building does not acquire a hole in its shadow footprint.
    """
    stats = {"parents_with_parts": 0, "parts_used": 0, "remainders_created": 0, "orphan_parts": 0}
    parent_by_id = {b.upstream_id: b for b in parents}
    parts_by_parent: dict[str, list[Building]] = {}
    orphans: list[Building] = []
    for part in parts:
        if part.parent_id and part.parent_id in parent_by_id:
            parts_by_parent.setdefault(part.parent_id, []).append(part)
        else:
            orphans.append(part)
            stats["orphan_parts"] += 1

    out: list[Building] = []
    for parent in parents:
        children = parts_by_parent.get(parent.upstream_id, [])
        if not children:
            out.append(parent)
            continue
        stats["parents_with_parts"] += 1
        valid_children: list[Building] = []
        child_geoms = []
        for child in children:
            inter = child.geom_wgs84.intersection(parent.geom_wgs84)
            if inter.is_empty:
                continue
            if not inter.is_valid:
                inter = inter.buffer(0)
            if inter.is_empty or inter.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            c = _clone_with_geometry(child, inter, "building_part", "part")
            valid_children.append(c)
            child_geoms.append(inter)
        if not valid_children:
            out.append(parent)
            continue
        out.extend(valid_children)
        stats["parts_used"] += len(valid_children)

        covered = unary_union(child_geoms)
        remainder = parent.geom_wgs84.difference(covered)
        if not remainder.is_empty and parent.geom_wgs84.area > 0:
            frac = remainder.area / parent.geom_wgs84.area
            if frac >= remainder_min_fraction:
                if not remainder.is_valid:
                    remainder = remainder.buffer(0)
                if not remainder.is_empty and remainder.geom_type in ("Polygon", "MultiPolygon"):
                    out.append(_clone_with_geometry(parent, remainder, "building_remainder", "remainder"))
                    stats["remainders_created"] += 1
    # Keep orphan parts: they can still be valid caster geometry even if the
    # parent fell outside a clipped extract.
    out.extend(orphans)
    return out, stats


def overlap_duplicate(lower: Building, higher: Building, iou_threshold: float, containment_threshold: float) -> bool:
    a, b = lower.geom_m, higher.geom_m
    if not a.intersects(b):
        return False
    inter = a.intersection(b).area
    if inter <= 0:
        return False
    union = a.area + b.area - inter
    iou = inter / union if union > 0 else 0
    contained = inter / min(a.area, b.area) if min(a.area, b.area) > 0 else 0
    return iou >= iou_threshold or contained >= containment_threshold


def conflate(groups: list[list[Building]], iou_threshold: float, containment_threshold: float) -> tuple[list[Building], dict[str, int]]:
    accepted: list[Building] = []
    stats = {"NLSC": 0, "Overture": 0, "OSM": 0, "duplicates_removed": 0}
    for group in groups:
        if not group:
            continue
        if not accepted:
            accepted.extend(group)
            for b in group:
                stats[b.source] += 1
            continue
        tree = STRtree([b.geom_m for b in accepted])
        for candidate in group:
            duplicate = False
            for idx in tree.query(candidate.geom_m):
                higher = accepted[int(idx)]
                if PRIORITY[higher.source] <= PRIORITY[candidate.source] and overlap_duplicate(candidate, higher, iou_threshold, containment_threshold):
                    duplicate = True
                    break
            if duplicate:
                stats["duplicates_removed"] += 1
                continue
            accepted.append(candidate)
            stats[candidate.source] += 1
            tree = STRtree([b.geom_m for b in accepted])
    return accepted, stats


def _semantic_height(props: dict[str, Any], area_m2: float, fallback_height: float, profile: str) -> tuple[float, str]:
    if profile != "taiwan-v1":
        return fallback_height, f"fallback {fallback_height:g} m"
    text = " ".join(str(props.get(k) or "") for k in ("subtype", "class", "name")).lower()
    # Explicit small ancillary structures first.
    if any(k in text for k in ("shed", "garage", "carport", "hut", "storage")):
        return 3.1, "Taiwan heuristic: small ancillary structure"
    if any(k in text for k in ("warehouse", "industrial", "factory")):
        return 7.0, "Taiwan heuristic: industrial/warehouse"
    if any(k in text for k in ("education", "school", "college", "university", "civic", "public")):
        return 12.4, "Taiwan heuristic: education/public building"
    if any(k in text for k in ("commercial", "office", "retail", "hospital", "hotel")):
        return 12.4, "Taiwan heuristic: commercial/institutional building"
    if any(k in text for k in ("apartments", "residential", "house", "detached", "terrace")):
        return 9.3, "Taiwan heuristic: residential building"
    # Generic footprint prior. This is deliberately conservative and is marked
    # as inferred, never as measured.
    if area_m2 < 35:
        return 3.1, "Taiwan heuristic: very small footprint"
    if area_m2 < 180:
        return 9.3, "Taiwan heuristic: typical low-rise footprint"
    if area_m2 < 1200:
        return 9.3, "Taiwan heuristic: medium footprint"
    return 12.4, "Taiwan heuristic: large footprint"


def infer_missing_heights(
    buildings: list[Building], fallback_height: float, profile: str,
    radius_m: float = 180.0, min_neighbors: int = 3,
) -> dict[str, int]:
    stats = {"direct": 0, "floors-derived": 0, "context-inferred": 0, "heuristic": 0, "fallback": 0}
    known: list[Building] = []
    for b in buildings:
        q = (b.feature.get("properties") or {}).get("height_quality")
        if q in ("direct", "floors-derived"):
            known.append(b)
            stats[q] += 1
    known_points = [b.geom_m.centroid for b in known]
    tree = STRtree(known_points) if known_points else None

    for b in buildings:
        props = b.feature.get("properties") or {}
        if props.get("height") is not None and props.get("height_quality") in ("direct", "floors-derived"):
            continue
        chosen: float | None = None
        source = ""
        if tree is not None and radius_m > 0:
            center = b.geom_m.centroid
            vals = []
            for idx in tree.query(center.buffer(radius_m)):
                kb = known[int(idx)]
                if center.distance(known_points[int(idx)]) > radius_m:
                    continue
                kh = _num((kb.feature.get("properties") or {}).get("height"))
                if kh and 2.5 <= kh <= 80:
                    vals.append(kh)
            if len(vals) >= min_neighbors:
                chosen = max(3.1, min(30.0, statistics.median(vals)))
                source = f"local median of {len(vals)} nearby known building heights"
                props["height_quality"] = "context-inferred"
                stats["context-inferred"] += 1
        if chosen is None:
            chosen, source = _semantic_height(props, b.geom_m.area, fallback_height, profile)
            if profile == "taiwan-v1":
                props["height_quality"] = "heuristic"
                stats["heuristic"] += 1
            else:
                props["height_quality"] = "fallback"
                stats["fallback"] += 1
        props["height"] = round(float(chosen), 3)
        props["render_height"] = round(float(chosen), 3)
        props["height_source"] = source
    return stats


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    lat = max(-85.05112878, min(85.05112878, lat))
    lat_rad = math.radians(lat)
    y = int(math.floor((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n))
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tile_bounds(x: int, y: int, z: int):
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return box(west, south, east, north)


def write_tiles(buildings: list[Building], out_dir: Path, zoom: int, append: bool = False) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    buckets: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for b in buildings:
        minx, miny, maxx, maxy = b.geom_wgs84.bounds
        x0, y1 = lonlat_to_tile(minx, miny, zoom)
        x1, y0 = lonlat_to_tile(maxx, maxy, zoom)
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                if not b.geom_wgs84.intersects(tile_bounds(x, y, zoom)):
                    continue
                buckets.setdefault((x, y), []).append(b.feature)

    total_bytes = 0
    max_tile_bytes = 0
    max_tile_features = 0
    for (x, y), feats in buckets.items():
        path = out_dir / str(zoom) / str(x) / f"{y}.geojson"
        path.parent.mkdir(parents=True, exist_ok=True)
        if append and path.exists():
            try:
                existing = json.loads(path.read_text(encoding="utf-8")).get("features", [])
            except Exception:
                existing = []
            merged = {}
            for f in existing + feats:
                pr = f.get("properties") or {}
                uid = pr.get("building_uid") or hashlib.sha1(json.dumps(f.get("geometry"), sort_keys=True).encode()).hexdigest()
                merged[uid] = f
            feats = list(merged.values())
        payload = {"type": "FeatureCollection", "features": feats}
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        path.write_bytes(raw)
        total_bytes += len(raw)
        max_tile_bytes = max(max_tile_bytes, len(raw))
        max_tile_features = max(max_tile_features, len(feats))
    if append:
        all_tiles = list((out_dir / str(zoom)).glob("*/*.geojson")) if (out_dir / str(zoom)).exists() else []
        total_dataset_bytes = sum(x.stat().st_size for x in all_tiles)
        tile_count = len(all_tiles)
    else:
        total_dataset_bytes = total_bytes
        tile_count = len(buckets)
    return {
        "zoom": zoom,
        "tile_count": tile_count,
        "bytes": total_dataset_bytes,
        "touched_tile_count": len(buckets),
        "max_tile_bytes": max_tile_bytes,
        "max_tile_features": max_tile_features,
        "feature_count": len(buildings),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--nlsc", help="NLSC-derived footprint GeoJSON")
    ap.add_argument("--overture", help="Overture building GeoJSON")
    ap.add_argument("--overture-parts", help="Overture building_part GeoJSON")
    ap.add_argument("--osm", help="OSM fallback GeoJSON")
    ap.add_argument("--nlsc-version", default="unknown")
    ap.add_argument("--overture-version", default="unknown")
    ap.add_argument("--osm-version", default="unknown")
    ap.add_argument("--out", required=True)
    ap.add_argument("--zoom", type=int, default=16)
    ap.add_argument("--storey-height", type=float, default=DEFAULT_STOREY_HEIGHT_M)
    ap.add_argument("--fallback-height", type=float, default=DEFAULT_FALLBACK_HEIGHT_M)
    ap.add_argument("--fallback-profile", choices=("constant", "taiwan-v1"), default="taiwan-v1")
    ap.add_argument("--inference-radius-m", type=float, default=180.0)
    ap.add_argument("--inference-min-neighbors", type=int, default=3)
    ap.add_argument("--iou", type=float, default=0.45)
    ap.add_argument("--containment", type=float, default=0.80)
    ap.add_argument("--part-remainder-min-fraction", type=float, default=0.03)
    ap.add_argument("--owner-bbox", help="west,south,east,north; keep only centroids inside this ownership cell after buffered conflation")
    ap.add_argument("--append", action="store_true", help="append/de-duplicate into an existing tile directory")
    args = ap.parse_args()

    if not (args.nlsc or args.overture or args.overture_parts or args.osm):
        ap.error("at least one source file is required")

    nlsc = load_source(args.nlsc, "NLSC", args.nlsc_version, args.storey_height)
    overture_parents = load_source(args.overture, "Overture", args.overture_version, args.storey_height, "building")
    overture_parts = load_source(args.overture_parts, "Overture", args.overture_version, args.storey_height, "building_part")
    overture, part_stats = compose_overture_parts(
        overture_parents, overture_parts, max(0.0, min(1.0, args.part_remainder_min_fraction))
    ) if overture_parts else (overture_parents, {"parents_with_parts": 0, "parts_used": 0, "remainders_created": 0, "orphan_parts": 0})
    osm = load_source(args.osm, "OSM", args.osm_version, args.storey_height)

    merged, stats = conflate([nlsc, overture, osm], args.iou, args.containment)
    height_stats = infer_missing_heights(
        merged, args.fallback_height, args.fallback_profile,
        radius_m=max(0.0, args.inference_radius_m),
        min_neighbors=max(1, args.inference_min_neighbors),
    )
    owner_bbox = None
    if args.owner_bbox:
        w, s, e, n = [float(v) for v in args.owner_bbox.split(",")]
        owner_bbox = (w, s, e, n)
        def owned(b):
            c = b.geom_wgs84.centroid
            # Half-open east/north prevents duplicate ownership on exact grid boundaries.
            return w <= c.x < e and s <= c.y < n
        merged = [b for b in merged if owned(b)]
    final_source_counts = {"NLSC": 0, "Overture": 0, "OSM": 0}
    final_height_quality = {}
    for b in merged:
        final_source_counts[b.source] = final_source_counts.get(b.source, 0) + 1
        q = str((b.feature.get("properties") or {}).get("height_quality") or "unknown")
        final_height_quality[q] = final_height_quality.get(q, 0) + 1
    out = Path(args.out)
    tile_stats = write_tiles(merged, out, args.zoom, append=args.append)
    manifest = {
        "schema": 2,
        "source_priority": ["NLSC", "Overture", "OSM"],
        "source_versions": {
            "NLSC": args.nlsc_version,
            "Overture": args.overture_version,
            "OSM": args.osm_version,
        },
        "normalization": {
            "storey_height_m": args.storey_height,
            "fallback_height_m": args.fallback_height,
            "fallback_profile": args.fallback_profile,
            "inference_radius_m": args.inference_radius_m,
            "inference_min_neighbors": args.inference_min_neighbors,
            "dedupe_iou_threshold": args.iou,
            "dedupe_containment_threshold": args.containment,
            "part_remainder_min_fraction": args.part_remainder_min_fraction,
        },
        "overture_parts": part_stats,
        "accepted": stats,
        "height_quality": height_stats,
        "final_source_counts": final_source_counts,
        "final_height_quality": final_height_quality,
        "final_feature_count": len(merged),
        "owner_bbox": list(owner_bbox) if owner_bbox else None,
        "append": bool(args.append),
        "tiles": tile_stats,
    }
    # In append mode, keep per-cell manifests so the orchestrator can audit every
    # source request without overwriting prior cell evidence.
    if args.append and owner_bbox:
        key = hashlib.sha1(args.owner_bbox.encode("utf-8")).hexdigest()[:12]
        mdir = out / "cell-manifests"
        mdir.mkdir(parents=True, exist_ok=True)
        (mdir / f"{key}.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
