#!/usr/bin/env python3
"""Create a scalable inventory for versioned GeoJSON building tiles.

Schema 1 stores every `z/x/y.geojson` key and is convenient for small pilots.
Schema 2 (`x-y-ranges-v1`) groups consecutive y values by x and stays compact
for city/Taiwan-scale publications. The v8.7 client accepts both schemas.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Iterable

TILE_RE = re.compile(r"^(\d+)\.geojson$")


def scan_tiles(root: Path, zoom: int) -> list[tuple[int, int]]:
    zdir = root / str(zoom)
    if not zdir.is_dir():
        raise SystemExit(f"tile zoom directory not found: {zdir}")
    out: list[tuple[int, int]] = []
    for xdir in zdir.iterdir():
        if not xdir.is_dir() or not xdir.name.isdigit():
            continue
        x = int(xdir.name)
        for path in xdir.iterdir():
            m = TILE_RE.match(path.name)
            if m:
                out.append((x, int(m.group(1))))
    out.sort()
    return out


def ranges(values: Iterable[int]) -> list[tuple[int, int]]:
    vals = sorted(set(values))
    if not vals:
        return []
    out: list[tuple[int, int]] = []
    start = prev = vals[0]
    for value in vals[1:]:
        if value == prev + 1:
            prev = value
            continue
        out.append((start, prev))
        start = prev = value
    out.append((start, prev))
    return out


def build_compact(tiles: list[tuple[int, int]]) -> list[list[int]]:
    by_x: dict[int, list[int]] = {}
    for x, y in tiles:
        by_x.setdefault(x, []).append(y)
    rows: list[list[int]] = []
    for x in sorted(by_x):
        row = [x]
        for y0, y1 in ranges(by_x[x]):
            row.extend([y0, y1])
        rows.append(row)
    return rows


def read_feature_count(root: Path) -> int | None:
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    for key in ("feature_count", "final_feature_count"):
        value = data.get(key)
        try:
            return int(value)
        except (TypeError, ValueError):
            pass
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="dataset directory containing <zoom>/<x>/<y>.geojson")
    ap.add_argument("--zoom", type=int, default=16)
    ap.add_argument("--data-version", required=True)
    ap.add_argument("--output", help="default: <root>/tile-index.json")
    ap.add_argument("--encoding", choices=("compact", "legacy"), default="compact")
    ap.add_argument("--feature-count", type=int)
    args = ap.parse_args()

    root = Path(args.root)
    tiles = scan_tiles(root, args.zoom)
    feature_count = args.feature_count if args.feature_count is not None else read_feature_count(root)

    if args.encoding == "legacy":
        payload = {
            "schema": 1,
            "data_version": args.data_version,
            "tile_zoom": args.zoom,
            "tile_count": len(tiles),
            "feature_count": feature_count,
            "tile_keys": [f"{args.zoom}/{x}/{y}.geojson" for x, y in tiles],
        }
    else:
        payload = {
            "schema": 2,
            "encoding": "x-y-ranges-v1",
            "data_version": args.data_version,
            "tile_zoom": args.zoom,
            "tile_count": len(tiles),
            "feature_count": feature_count,
            "x_ranges": build_compact(tiles),
        }

    output = Path(args.output) if args.output else root / "tile-index.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "schema": payload["schema"],
        "encoding": payload.get("encoding", "tile-keys-v1"),
        "tile_count": len(tiles),
        "bytes": output.stat().st_size,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
