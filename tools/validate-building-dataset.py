#!/usr/bin/env python3
"""Validate a published building dataset before changing BUILDING_DATA_VERSION."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def scan(root: Path, zoom: int) -> set[tuple[int, int]]:
    out: set[tuple[int, int]] = set()
    zdir = root / str(zoom)
    if not zdir.exists():
        return out
    for xdir in zdir.iterdir():
        if not xdir.is_dir() or not xdir.name.isdigit():
            continue
        x = int(xdir.name)
        for f in xdir.glob("*.geojson"):
            if f.stem.isdigit():
                out.add((x, int(f.stem)))
    return out


def decode(index: dict, zoom: int) -> set[tuple[int, int]]:
    out: set[tuple[int, int]] = set()
    if isinstance(index.get("tile_keys"), list):
        for key in index["tile_keys"]:
            parts = str(key).split("/")
            if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit() and parts[2].endswith(".geojson"):
                y = parts[2][:-8]
                if y.isdigit() and int(parts[0]) == zoom:
                    out.add((int(parts[1]), int(y)))
    for row in index.get("x_ranges") or []:
        if not isinstance(row, list) or len(row) < 3:
            continue
        x = int(row[0])
        for i in range(1, len(row) - 1, 2):
            y0, y1 = int(row[i]), int(row[i + 1])
            for y in range(min(y0, y1), max(y0, y1) + 1):
                out.add((x, y))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--sample", type=int, default=40, help="parse at most N evenly spaced tiles; 0 parses all")
    ap.add_argument("--max-tile-bytes", type=int, default=2_000_000)
    args = ap.parse_args()

    root = Path(args.root)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    index = json.loads((root / "tile-index.json").read_text(encoding="utf-8"))
    version = str(manifest.get("data_version") or "")
    zoom = int(manifest.get("tile_zoom") or index.get("tile_zoom") or 16)
    errors: list[str] = []
    warnings: list[str] = []

    if not version:
        errors.append("manifest data_version missing")
    if str(index.get("data_version") or "") != version:
        errors.append("manifest/index data_version mismatch")
    if int(index.get("tile_zoom") or -1) != zoom:
        errors.append("manifest/index tile_zoom mismatch")
    if not (manifest.get("coverage_regions") or manifest.get("aoi") or (manifest.get("latest_run") or {}).get("aoi")):
        errors.append("manifest coverage missing")

    actual = scan(root, zoom)
    indexed = decode(index, zoom)
    if actual != indexed:
        missing = sorted(actual - indexed)[:10]
        phantom = sorted(indexed - actual)[:10]
        errors.append(f"tile index mismatch: not-indexed={missing}, indexed-but-missing={phantom}")
    if int(index.get("tile_count") or -1) != len(actual):
        errors.append(f"tile_count {index.get('tile_count')} != actual {len(actual)}")
    if int(manifest.get("tile_count") or len(actual)) != len(actual):
        errors.append(f"manifest tile_count {manifest.get('tile_count')} != actual {len(actual)}")

    paths = sorted(root / str(zoom) / str(x) / f"{y}.geojson" for x, y in actual)
    if args.sample > 0 and len(paths) > args.sample:
        step = max(1, len(paths) // args.sample)
        paths = paths[::step][:args.sample]
    parsed = 0
    max_size = 0
    for path in paths:
        try:
            size = path.stat().st_size
            max_size = max(max_size, size)
            if size > args.max_tile_bytes:
                warnings.append(f"large tile {path.relative_to(root)}: {size} bytes")
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
                errors.append(f"invalid GeoJSON FeatureCollection: {path.relative_to(root)}")
            parsed += 1
        except Exception as exc:
            errors.append(f"cannot parse {path.relative_to(root)}: {exc}")

    result = {
        "ok": not errors,
        "data_version": version,
        "tile_zoom": zoom,
        "tile_count": len(actual),
        "feature_count": manifest.get("feature_count"),
        "coverage_region_count": len(manifest.get("coverage_regions") or []),
        "index_schema": index.get("schema"),
        "index_encoding": index.get("encoding", "tile-keys-v1"),
        "parsed_tile_count": parsed,
        "max_parsed_tile_bytes": max_size,
        "warnings": warnings[:20],
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["ok"] else 2)


if __name__ == "__main__":
    main()
