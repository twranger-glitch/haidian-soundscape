#!/usr/bin/env python3
"""Orchestrate a scalable Overture -> OSM fallback building build by ownership cells.

The command downloads buffered source data per coarse XYZ cell, conflates it,
keeps only features whose centroid belongs to that cell, and appends them into
shared z16 output tiles. This avoids loading an entire Taiwan building dataset
into memory and makes failed cells individually retryable.

NLSC is intentionally a future higher-priority adapter. The output schema is
already compatible with inserting NLSC before Overture later.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

PRESETS = {
    # Mainland Taiwan. Offshore counties are separate to avoid large empty-ocean builds.
    "taiwan-main": (120.00, 21.82, 122.10, 25.48),
    "tainan": (120.00, 22.85, 120.68, 23.42),
    # Haidian Elementary / Annan development-smoke area; intentionally larger than one campus.
    "haidian-smoke": (120.175, 23.015, 120.235, 23.075),
    "penghu": (119.20, 23.15, 119.80, 23.85),
    "kinmen": (118.15, 24.30, 118.58, 24.60),
    "matsu": (119.85, 25.85, 120.55, 26.40),
}


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    lat = max(-85.05112878, min(85.05112878, lat))
    y = int(math.floor((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n))
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tile_bounds(x: int, y: int, z: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def intersect_bbox(a, b):
    w, s, e, n = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    return (w, s, e, n) if w < e and s < n else None


def pad_bbox(b, meters: float):
    w, s, e, n = b
    mid = (s + n) / 2
    lat_pad = meters / 111320.0
    lon_pad = meters / (111320.0 * max(0.2, math.cos(math.radians(mid))))
    return w - lon_pad, s - lat_pad, e + lon_pad, n + lat_pad


def fmt_bbox(b):
    return ",".join(f"{v:.8f}" for v in b)


def enumerate_cells(aoi, z):
    w, s, e, n = aoi
    x0, y1 = lonlat_to_tile(w, s, z)
    x1, y0 = lonlat_to_tile(e, n, z)
    cells = []
    for x in range(min(x0, x1), max(x0, x1) + 1):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            owner = intersect_bbox(tile_bounds(x, y, z), aoi)
            if owner:
                cells.append((x, y, owner))
    return cells


def run(cmd, cwd=None):
    print("+", " ".join(str(x) for x in cmd), flush=True)
    subprocess.run([str(x) for x in cmd], cwd=cwd, check=True)


def aggregate_manifests(out: Path, meta: dict):
    source = {"NLSC": 0, "Overture": 0, "OSM": 0}
    height = {}
    parts = {"parents_with_parts": 0, "parts_used": 0, "remainders_created": 0, "orphan_parts": 0}
    cell_files = sorted((out / "cell-manifests").glob("*.json")) if (out / "cell-manifests").exists() else []
    feature_count = 0
    releases = set()
    osm_versions = set()
    for p in cell_files:
        m = json.loads(p.read_text(encoding="utf-8"))
        for k, v in (m.get("final_source_counts") or {}).items():
            source[k] = source.get(k, 0) + int(v or 0)
        for k, v in (m.get("final_height_quality") or {}).items():
            height[k] = height.get(k, 0) + int(v or 0)
        for k, v in (m.get("overture_parts") or {}).items():
            parts[k] = parts.get(k, 0) + int(v or 0)
        sv = m.get("source_versions") or {}
        if sv.get("Overture") and sv.get("Overture") != "unknown": releases.add(str(sv.get("Overture")))
        if sv.get("OSM") and sv.get("OSM") != "unknown": osm_versions.add(str(sv.get("OSM")))
        feature_count += int(m.get("final_feature_count") or 0)
    tiles = list((out / str(meta["tile_zoom"])).glob("*/*.geojson")) if (out / str(meta["tile_zoom"])).exists() else []
    runs_path = out / "build-runs.jsonl"
    runs = []
    if runs_path.exists():
        for line in runs_path.read_text(encoding="utf-8").splitlines():
            try: runs.append(json.loads(line))
            except Exception: pass
    meta.update({
        "schema": 1,
        "source_priority": ["NLSC", "Overture", "OSM"],
        "nlsc_status": "pending-authenticated-source",
        "overture_releases_seen": sorted(releases) or meta.get("overture_releases_seen", []),
        "osm_snapshot_dates_seen": sorted(osm_versions),
        "build_runs": runs,
        "final_source_counts": source,
        "final_height_quality": height,
        "overture_parts": parts,
        "feature_count": feature_count,
        "tile_count": len(tiles),
        "bytes": sum(p.stat().st_size for p in tiles),
        "cell_manifest_count": len(cell_files),
    })
    (out / "manifest.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def main():
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--preset", choices=sorted(PRESETS))
    group.add_argument("--bbox", help="west,south,east,north")
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--grid-zoom", type=int, default=11)
    ap.add_argument("--tile-zoom", type=int, default=16)
    ap.add_argument("--buffer-m", type=float, default=250.0)
    ap.add_argument("--skip-osm", action="store_true")
    ap.add_argument("--max-cells", type=int, default=0, help="development guard; 0 means all")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--fallback-profile", choices=("constant", "taiwan-v1"), default="taiwan-v1")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    fetch_overture = root / "tools" / "fetch-overture-buildings.sh"
    fetch_osm = root / "tools" / "fetch-osm-building-fallback.py"
    builder = root / "tools" / "build-building-tiles.py"
    aoi = PRESETS[args.preset] if args.preset else tuple(float(x) for x in args.bbox.split(","))
    if len(aoi) != 4:
        ap.error("bbox must have four numbers")

    out = Path(args.out).resolve()
    work = Path(args.work).resolve()
    if out.exists() and not args.resume:
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)

    cells = enumerate_cells(aoi, args.grid_zoom)
    if args.max_cells > 0:
        cells = cells[:args.max_cells]
    failures = []
    releases = set()
    completed = 0
    osm_version = dt.datetime.now(dt.timezone.utc).date().isoformat()

    for ordinal, (x, y, owner) in enumerate(cells, 1):
        key = f"z{args.grid_zoom}-{x}-{y}"
        cdir = work / key
        cdir.mkdir(parents=True, exist_ok=True)
        done = cdir / "DONE"
        if args.resume and done.exists():
            print(f"[{ordinal}/{len(cells)}] resume skip {key}")
            completed += 1
            continue
        fetch_bbox = pad_bbox(owner, max(0.0, args.buffer_m))
        buildings = cdir / "overture-buildings.geojson"
        parts = cdir / "overture-parts.geojson"
        ometa = cdir / "overture-meta.json"
        osm = cdir / "osm.geojson"
        try:
            run([fetch_overture, *[f"{v:.8f}" for v in fetch_bbox], buildings, parts, ometa])
            overture_meta = json.loads(ometa.read_text(encoding="utf-8"))
            release = str(overture_meta.get("release") or "latest-at-build-time")
            releases.add(release)
            if not args.skip_osm:
                run([sys.executable, fetch_osm, "--bbox", fmt_bbox(fetch_bbox), "--out", osm])
            cmd = [
                sys.executable, builder,
                "--overture", buildings,
                "--overture-parts", parts,
                "--overture-version", release,
                "--osm-version", osm_version,
                "--out", out,
                "--zoom", str(args.tile_zoom),
                "--owner-bbox", fmt_bbox(owner),
                "--append",
                "--fallback-profile", args.fallback_profile,
            ]
            if not args.skip_osm:
                cmd += ["--osm", osm]
            run(cmd)
            done.write_text(dt.datetime.now(dt.timezone.utc).isoformat(), encoding="utf-8")
            completed += 1
        except Exception as exc:
            failures.append({"cell": key, "error": str(exc), "owner_bbox": owner, "fetch_bbox": fetch_bbox})
            print(f"ERROR {key}: {exc}", file=sys.stderr)

    run_record = {
        "built_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "aoi": list(aoi),
        "preset": args.preset,
        "grid_zoom": args.grid_zoom,
        "tile_zoom": args.tile_zoom,
        "buffer_m": args.buffer_m,
        "overture_releases_seen": sorted(releases),
        "osm_snapshot_date": None if args.skip_osm else osm_version,
        "cells_requested": len(cells),
        "cells_completed": completed,
        "cells_failed": len(failures),
        "failures": failures,
    }
    with (out / "build-runs.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(run_record, ensure_ascii=False) + "\n")
    meta = aggregate_manifests(out, {
        "built_at_utc": run_record["built_at_utc"],
        "grid_zoom": args.grid_zoom,
        "tile_zoom": args.tile_zoom,
        "buffer_m": args.buffer_m,
        "latest_run": run_record,
    })
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
