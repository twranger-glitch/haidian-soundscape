#!/usr/bin/env python3
"""Build resumable city/Taiwan-scale versioned Overture building tiles.

The script intentionally processes coarse ownership cells instead of loading all
of Taiwan into memory. Each cell is downloaded with a context buffer, normalized
and conflated by build-building-tiles.py, then only features whose centroids fall
inside the ownership cell are appended to the final z16 dataset.

Requirements for a live build:
  * Python packages already required by build-building-tiles.py (shapely, pyproj)
  * DuckDB CLI with the spatial/httpfs extensions available
  * network access to the public Overture S3 release

`--plan-only` needs neither DuckDB nor network and is useful in CI/review.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

PRESETS: dict[str, list[dict[str, Any]]] = {
    "haidian-smoke": [
        {"id": "haidian", "label": "海佃測試區", "aoi": [120.175, 23.015, 120.235, 23.075]},
    ],
    "tainan-metro": [
        {"id": "tainan-metro", "label": "臺南都會區", "aoi": [120.05, 22.90, 120.42, 23.23]},
    ],
    "tainan-city": [
        {"id": "tainan-city", "label": "臺南市", "aoi": [120.00, 22.82, 120.72, 23.42]},
    ],
    "taiwan": [
        {"id": "taiwan-main", "label": "臺灣本島與近海島嶼", "aoi": [119.90, 21.70, 122.10, 25.60]},
        {"id": "penghu", "label": "澎湖", "aoi": [119.10, 22.90, 119.90, 24.10]},
        {"id": "kinmen", "label": "金門", "aoi": [118.10, 24.30, 118.55, 24.55]},
        {"id": "wuqiu", "label": "烏坵", "aoi": [119.38, 24.92, 119.52, 25.05]},
        {"id": "matsu-main", "label": "馬祖主要島嶼", "aoi": [119.85, 25.90, 120.10, 26.30]},
        {"id": "dongyin", "label": "東引", "aoi": [120.40, 26.30, 120.55, 26.45]},
    ],
}


def tile_bounds(x: int, y: int, z: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    lat = max(-85.05112878, min(85.05112878, lat))
    y = int(math.floor((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n))
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def intersect(a: list[float], b: tuple[float, float, float, float]) -> list[float] | None:
    w = max(a[0], b[0]); s = max(a[1], b[1]); e = min(a[2], b[2]); n = min(a[3], b[3])
    return [w, s, e, n] if w < e and s < n else None


def cells_for_regions(regions: list[dict[str, Any]], grid_zoom: int) -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for region in regions:
        aoi = [float(v) for v in region["aoi"]]
        x0, y1 = lonlat_to_tile(aoi[0], aoi[1], grid_zoom)
        x1, y0 = lonlat_to_tile(aoi[2], aoi[3], grid_zoom)
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                owner = intersect(aoi, tile_bounds(x, y, grid_zoom))
                if not owner:
                    continue
                key = (str(region["id"]), x, y)
                if key in seen:
                    continue
                seen.add(key)
                cells.append({"id": f"{region['id']}-z{grid_zoom}-{x}-{y}", "region_id": region["id"], "x": x, "y": y, "owner_bbox": owner})
    cells.sort(key=lambda row: (row["region_id"], row["y"], row["x"]))
    return cells


def expand_bbox(aoi: list[float], buffer_m: float) -> list[float]:
    center_lat = (aoi[1] + aoi[3]) / 2
    lat_pad = buffer_m / 111320.0
    lon_pad = buffer_m / (111320.0 * max(0.2, math.cos(math.radians(center_lat))))
    return [aoi[0] - lon_pad, aoi[1] - lat_pad, aoi[2] + lon_pad, aoi[3] + lat_pad]


def q(value: str) -> str:
    return value.replace("'", "''")


def parquet_schema(path: Path) -> dict[str, str]:
    """Return DuckDB-visible columns for a local Parquet cache.

    Overture fields are optional and an all-null optional field can be absent from
    the physical Parquet schema for a particular release/partition.  Never bind
    optional columns before checking the actual file schema.
    """
    try:
        import duckdb
    except Exception as exc:
        raise RuntimeError("The Python package 'duckdb' is required to inspect the Overture cache schema") from exc
    con = duckdb.connect()
    try:
        rows = con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{q(str(path.resolve()))}')"
        ).fetchall()
    finally:
        con.close()
    return {str(row[0]): str(row[1]) for row in rows}


def _quoted_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _optional_column(schema: dict[str, str], name: str, sql_type: str) -> str:
    if name in schema:
        return _quoted_ident(name)
    return f"CAST(NULL AS {sql_type}) AS {_quoted_ident(name)}"


def overture_cell_select_columns(kind: str, schema: dict[str, str]) -> str:
    """Flatten only the scalar properties used by the tile builder.

    The regional cache deliberately keeps the complete Overture feature (SELECT
    *).  Here we project a stable, GeoJSON-friendly subset and synthesize NULLs
    for optional columns that are physically absent.  This prevents DuckDB
    BinderException failures such as `Referenced table names not found`.
    """
    fields: list[str] = []
    for required in ("id",):
        if required not in schema:
            raise RuntimeError(f"Overture {kind} cache is missing required column: {required}")
        fields.append(_quoted_ident(required))

    # `names` is optional.  In Overture it is a struct when present; only its
    # primary label is useful to this shadow pipeline.
    if "names" in schema and "STRUCT" in schema["names"].upper():
        fields.append("CAST(struct_extract(\"names\", 'primary') AS VARCHAR) AS \"name\"")
    else:
        fields.append('CAST(NULL AS VARCHAR) AS "name"')

    if kind == "building":
        fields.extend([
            _optional_column(schema, "subtype", "VARCHAR"),
            _optional_column(schema, "class", "VARCHAR"),
        ])
    else:
        fields.append(_optional_column(schema, "building_id", "VARCHAR"))

    for name, sql_type in (
        ("height", "DOUBLE"),
        ("num_floors", "INTEGER"),
        ("min_height", "DOUBLE"),
        ("min_floor", "INTEGER"),
        ("roof_height", "DOUBLE"),
        ("is_underground", "BOOLEAN"),
    ):
        fields.append(_optional_column(schema, name, sql_type))

    if kind == "building":
        fields.append(_optional_column(schema, "has_parts", "BOOLEAN"))

    if "geometry" not in schema:
        raise RuntimeError(f"Overture {kind} cache is missing required column: geometry")
    fields.append('"geometry"')
    return ",\n          ".join(fields)


def overture_region_cache_sql(release: str, kind: str, bbox: list[float], output: Path) -> str:
    """One remote Overture scan per coverage region, saved as local GeoParquet."""
    w, s, e, n = bbox
    root = f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type={kind}/*.parquet"
    return f"""
INSTALL spatial;
INSTALL httpfs;
LOAD spatial;
LOAD httpfs;
SET s3_region='us-west-2';
COPY (
  SELECT *
  FROM read_parquet('{q(root)}', union_by_name=true, filename=true, hive_partitioning=false)
  WHERE bbox.xmax >= {w:.10f} AND bbox.xmin <= {e:.10f}
    AND bbox.ymax >= {s:.10f} AND bbox.ymin <= {n:.10f}
) TO '{q(str(output.resolve()))}' (FORMAT PARQUET, COMPRESSION ZSTD);
""".strip()


def overture_cell_geojson_sql(cache_path: Path, kind: str, bbox: list[float], output: Path) -> str:
    """Fast local per-cell extraction from a cached regional GeoParquet."""
    w, s, e, n = bbox
    schema = parquet_schema(cache_path)
    cols = overture_cell_select_columns(kind, schema)
    return f"""
INSTALL spatial;
LOAD spatial;
COPY (
  SELECT {cols}
  FROM read_parquet('{q(str(cache_path.resolve()))}')
  WHERE bbox.xmax >= {w:.10f} AND bbox.xmin <= {e:.10f}
    AND bbox.ymax >= {s:.10f} AND bbox.ymin <= {n:.10f}
) TO '{q(str(output.resolve()))}'
WITH (FORMAT GDAL, DRIVER 'GeoJSON', SRS 'EPSG:4326');
""".strip()


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def duckdb_python_available() -> bool:
    try:
        import duckdb  # noqa: F401
        return True
    except Exception:
        return False


def execute_duckdb(sql: str, cli: str) -> None:
    """Prefer the Python DuckDB package; fall back to a CLI binary."""
    try:
        import duckdb
    except Exception:
        duckdb = None
    if duckdb is not None:
        print("+ duckdb (python API)", flush=True)
        con = duckdb.connect()
        try:
            con.execute(sql)
        finally:
            con.close()
        return
    if shutil.which(cli) is None:
        raise RuntimeError(
            f"DuckDB is unavailable. Install the Python package 'duckdb' or provide --duckdb {cli!r}."
        )
    run([cli, "-c", sql])


def add_counts(target: dict[str, int], source: dict[str, Any]) -> None:
    for k, v in source.items():
        try:
            target[k] = target.get(k, 0) + int(v)
        except (TypeError, ValueError):
            pass


def aggregate_manifest(root: Path, *, preset: str, regions: list[dict[str, Any]], release: str,
                       data_version: str, grid_zoom: int, tile_zoom: int, buffer_m: float,
                       cells_requested: int, cells_completed: int, started_at: str) -> dict[str, Any]:
    source_counts: dict[str, int] = {}
    quality_counts: dict[str, int] = {}
    part_counts: dict[str, int] = {}
    feature_count = 0
    manifests = sorted((root / "cell-manifests").glob("*.json")) if (root / "cell-manifests").exists() else []
    for path in manifests:
        try:
            m = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        feature_count += int(m.get("final_feature_count") or 0)
        add_counts(source_counts, m.get("final_source_counts") or {})
        add_counts(quality_counts, m.get("final_height_quality") or {})
        add_counts(part_counts, m.get("overture_parts") or {})
    tile_paths = list((root / str(tile_zoom)).glob("*/*.geojson")) if (root / str(tile_zoom)).exists() else []
    total_bytes = sum(p.stat().st_size for p in tile_paths)
    overall = [
        min(float(r["aoi"][0]) for r in regions),
        min(float(r["aoi"][1]) for r in regions),
        max(float(r["aoi"][2]) for r in regions),
        max(float(r["aoi"][3]) for r in regions),
    ]
    built_at = dt.datetime.now(dt.timezone.utc).isoformat()
    coverage_regions = [
        {"id": r["id"], "label": r.get("label", ""), "aoi": [float(v) for v in r["aoi"]]}
        for r in regions
    ]
    return {
        "schema": 2,
        "data_version": data_version,
        "built_at_utc": built_at,
        "tile_zoom": tile_zoom,
        "grid_zoom": grid_zoom,
        "buffer_m": buffer_m,
        "aoi": overall,
        "coverage_regions": coverage_regions,
        "source_priority": ["NLSC", "Overture", "OSM"],
        "nlsc_status": "pending-authenticated-source",
        "source_versions": {"NLSC": "not-ingested", "Overture": release, "OSM": "Overture-integrated + live-fallback"},
        "final_source_counts": source_counts,
        "final_height_quality": quality_counts,
        "overture_parts": part_counts,
        "feature_count": feature_count,
        "tile_count": len(tile_paths),
        "bytes": total_bytes,
        "cell_manifest_count": len(manifests),
        "latest_run": {
            "started_at_utc": started_at,
            "built_at_utc": built_at,
            "preset": preset,
            "aoi": overall,
            "coverage_regions": coverage_regions,
            "grid_zoom": grid_zoom,
            "tile_zoom": tile_zoom,
            "buffer_m": buffer_m,
            "overture_releases_seen": [release],
            "cells_requested": cells_requested,
            "cells_completed": cells_completed,
            "cells_failed": max(0, cells_requested - cells_completed),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", choices=tuple(PRESETS), default="taiwan")
    ap.add_argument("--overture-release", default="2026-08-19.0")
    ap.add_argument("--data-version", help="default: <release>-overture-<preset>-v1")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache-dir", help="local regional Overture GeoParquet cache; default next to --out")
    ap.add_argument("--grid-zoom", type=int, default=11)
    ap.add_argument("--tile-zoom", type=int, default=16)
    ap.add_argument("--buffer-m", type=float, default=1400.0, help="context buffer around each ownership cell")
    ap.add_argument("--duckdb", default="duckdb", help="DuckDB CLI executable")
    ap.add_argument("--skip-parts", action="store_true")
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--max-cells", type=int, help="debug/smoke limit")
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    regions = PRESETS[args.preset]
    cells = cells_for_regions(regions, args.grid_zoom)
    if args.max_cells is not None:
        cells = cells[:max(0, args.max_cells)]
    data_version = args.data_version or f"{args.overture_release}-overture-{args.preset}-v1"
    plan = {
        "preset": args.preset,
        "overture_release": args.overture_release,
        "data_version": data_version,
        "grid_zoom": args.grid_zoom,
        "tile_zoom": args.tile_zoom,
        "buffer_m": args.buffer_m,
        "coverage_regions": regions,
        "cell_count": len(cells),
        "cells": cells,
    }
    if args.plan_only:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return

    if not duckdb_python_available() and shutil.which(args.duckdb) is None:
        raise SystemExit(
            f"DuckDB is not installed. Install the Python package 'duckdb', provide --duckdb, or use --plan-only."
        )

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cache_dir = Path(args.cache_dir) if args.cache_dir else out.parent / f".overture-cache-{args.preset}-{args.overture_release}"
    cache_dir.mkdir(parents=True, exist_ok=True)
    regions_by_id = {str(r["id"]): r for r in regions}
    state_path = out / "build-state.json"
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state.get("data_version") != data_version:
            raise SystemExit(f"existing build-state data_version {state.get('data_version')} != {data_version}")
    else:
        state = {"schema": 1, "data_version": data_version, "completed_cells": [], "failed_cells": {}}
    completed = set(state.get("completed_cells") or [])
    started_at = dt.datetime.now(dt.timezone.utc).isoformat()
    tool_dir = Path(__file__).resolve().parent
    builder = tool_dir / "build-building-tiles.py"
    indexer = tool_dir / "make-building-tile-index.py"

    regional_cache: dict[tuple[str, str], Path] = {}

    def ensure_region_cache(region_id: str, kind: str) -> Path:
        key = (region_id, kind)
        if key in regional_cache:
            return regional_cache[key]
        region = regions_by_id[region_id]
        path = cache_dir / f"{region_id}-{kind}.parquet"
        if not path.exists() or path.stat().st_size == 0:
            region_bbox = expand_bbox([float(v) for v in region["aoi"]], args.buffer_m)
            sql = overture_region_cache_sql(args.overture_release, kind, region_bbox, path)
            sql_path = cache_dir / f"{region_id}-{kind}.sql"
            sql_path.write_text(sql, encoding="utf-8")
            print(f"[source-cache] {region_id} {kind}", flush=True)
            execute_duckdb(sql, args.duckdb)
        regional_cache[key] = path
        return path

    temp_parent = Path(tempfile.mkdtemp(prefix="building-coverage-"))
    try:
        for i, cell in enumerate(cells, 1):
            cid = cell["id"]
            if cid in completed:
                print(f"[{i}/{len(cells)}] resume skip {cid}")
                continue
            print(f"[{i}/{len(cells)}] {cid}", flush=True)
            work = temp_parent / hashlib.sha1(cid.encode()).hexdigest()[:12]
            work.mkdir(parents=True, exist_ok=True)
            fetch_bbox = expand_bbox(cell["owner_bbox"], args.buffer_m)
            parent_geojson = work / "overture-building.geojson"
            part_geojson = work / "overture-building-part.geojson"
            try:
                building_cache = ensure_region_cache(str(cell["region_id"]), "building")
                building_sql = overture_cell_geojson_sql(building_cache, "building", fetch_bbox, parent_geojson)
                (work / "building.sql").write_text(building_sql, encoding="utf-8")
                execute_duckdb(building_sql, args.duckdb)
                if not args.skip_parts:
                    part_cache = ensure_region_cache(str(cell["region_id"]), "building_part")
                    part_sql = overture_cell_geojson_sql(part_cache, "building_part", fetch_bbox, part_geojson)
                    (work / "building-part.sql").write_text(part_sql, encoding="utf-8")
                    execute_duckdb(part_sql, args.duckdb)

                cmd = [
                    "python", str(builder),
                    "--overture", str(parent_geojson),
                    "--overture-version", args.overture_release,
                    "--out", str(out),
                    "--zoom", str(args.tile_zoom),
                    "--owner-bbox", ",".join(f"{v:.10f}" for v in cell["owner_bbox"]),
                    "--append",
                    "--fallback-profile", "taiwan-v1",
                ]
                if not args.skip_parts and part_geojson.exists():
                    cmd.extend(["--overture-parts", str(part_geojson)])
                run(cmd)
                completed.add(cid)
                state["completed_cells"] = sorted(completed)
                state.get("failed_cells", {}).pop(cid, None)
            except Exception as exc:
                state.setdefault("failed_cells", {})[cid] = str(exc)
                state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
                raise
            state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            if not args.keep_temp:
                shutil.rmtree(work, ignore_errors=True)

        manifest = aggregate_manifest(
            out, preset=args.preset, regions=regions, release=args.overture_release,
            data_version=data_version, grid_zoom=args.grid_zoom, tile_zoom=args.tile_zoom,
            buffer_m=args.buffer_m, cells_requested=len(cells), cells_completed=len(completed),
            started_at=started_at,
        )
        (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        run(["python", str(indexer), "--root", str(out), "--zoom", str(args.tile_zoom), "--data-version", data_version, "--feature-count", str(manifest["feature_count"])])
        deployment = {
            "schema": 2,
            "scope": args.preset,
            "building_data_version": data_version,
            "overture_release": args.overture_release,
            "required_worker_minimum": "v1.5.0-building-index-proxy",
            "worker_variables": {
                "BUILDING_DATA_VERSION": data_version,
                "BUILDING_CACHE_TTL_SECONDS": "2592000",
                "BUILDING_BROWSER_MAX_AGE_SECONDS": "86400",
                "BUILDING_UPSTREAM_TIMEOUT_MS": "8000",
            },
        }
        (out / "deployment-info.json").write_text(json.dumps(deployment, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"ok": True, "out": str(out), "manifest": manifest, "deployment": deployment}, ensure_ascii=False, indent=2))
    finally:
        if not args.keep_temp:
            shutil.rmtree(temp_parent, ignore_errors=True)


if __name__ == "__main__":
    main()
