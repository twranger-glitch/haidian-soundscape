#!/usr/bin/env python3
"""Build priority-region Terrarium surface XYZ tiles from Meta/WRI CHMv2 + terrain.

This is an offline/deployment tool, not browser code. It mirrors the v8.3 browser
semantics: CHMv2 values 1..254 m are added to a Terrarium ground DEM and encoded
back to 256x256 Terrarium PNGs.

Example (estimate only):
  python tools/build-prebuilt-surface-tiles.py \
    --bbox 22.98 120.17 23.04 120.25 --zooms 16,17 --dry-run

Actual generation needs network access to the public CHMv2 COGs and terrain XYZ.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window
import requests
from PIL import Image
from io import BytesIO

WEB_MERCATOR_MAX_LAT = 85.05112878


def lonlat_to_xyz(lat: float, lon: float, z: int) -> Tuple[int, int]:
    lat = max(-WEB_MERCATOR_MAX_LAT, min(WEB_MERCATOR_MAX_LAT, lat))
    n = 2 ** z
    x = int(math.floor(((lon + 180.0) / 360.0) * n))
    lat_rad = math.radians(lat)
    y = int(math.floor(((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0) * n))
    max_index = n - 1
    return max(0, min(max_index, x)), max(0, min(max_index, y))


def xyz_range_for_bbox(bbox: Tuple[float, float, float, float], z: int) -> Iterable[Tuple[int, int, int]]:
    south, west, north, east = bbox
    min_x, min_y = lonlat_to_xyz(north, west, z)
    max_x, max_y = lonlat_to_xyz(south, east, z)
    if min_x > max_x:
        min_x, max_x = max_x, min_x
    if min_y > max_y:
        min_y, max_y = max_y, min_y
    for x in range(min_x, max_x + 1):
        for y in range(min_y, max_y + 1):
            yield z, x, y


def tile_to_quadkey(x: int, y: int, z: int) -> str:
    digits: List[str] = []
    for i in range(z, 0, -1):
        digit = 0
        mask = 1 << (i - 1)
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        digits.append(str(digit))
    return "".join(digits)


def fill_template(template: str, z: int, x: int, y: int) -> str:
    return template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))


def decode_terrarium(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


def encode_terrarium(height: np.ndarray) -> Image.Image:
    h = np.clip(height.astype(np.float64), -32768.0, 32767.996)
    value = h + 32768.0
    r = np.floor(value / 256.0)
    g_float = value - r * 256.0
    g = np.floor(g_float)
    b = np.clip(np.rint((g_float - g) * 256.0), 0, 255)
    alpha = np.full_like(r, 255)
    rgba = np.stack([r, g, b, alpha], axis=-1).astype(np.uint8)
    return Image.fromarray(rgba, mode="RGBA")


class SurfaceBuilder:
    def __init__(
        self,
        cog_base: str,
        terrain_template: str,
        terrain_max_zoom: int,
        fallback_template: str | None,
        fallback_max_zoom: int,
        timeout: float,
    ) -> None:
        self.cog_base = cog_base.rstrip("/")
        self.terrain_template = terrain_template
        self.terrain_max_zoom = terrain_max_zoom
        self.fallback_template = fallback_template
        self.fallback_max_zoom = fallback_max_zoom
        self.timeout = timeout
        self.session = requests.Session()
        self._cogs: Dict[str, rasterio.io.DatasetReader] = {}
        self._terrain_images: Dict[str, Image.Image] = {}

    def close(self) -> None:
        for ds in self._cogs.values():
            try:
                ds.close()
            except Exception:
                pass
        self._cogs.clear()
        self.session.close()

    def _open_cog(self, quadkey: str):
        if quadkey not in self._cogs:
            url = f"{self.cog_base}/{quadkey}.tif"
            self._cogs[quadkey] = rasterio.open(url)
        return self._cogs[quadkey]

    def read_canopy(self, z: int, x: int, y: int) -> np.ndarray:
        if z < 10:
            return np.zeros((256, 256), dtype=np.float32)
        scale = 1 << (z - 10)
        parent_x = x // scale
        parent_y = y // scale
        quadkey = tile_to_quadkey(parent_x, parent_y, 10)
        ds = self._open_cog(quadkey)

        # Full-resolution coordinates. Rasterio/GDAL will choose a suitable overview
        # for the 256x256 out_shape when one is available.
        side = ds.width / scale
        px = (x % scale) * side
        py = (y % scale) * side
        arr = ds.read(
            1,
            window=Window(px, py, side, side),
            out_shape=(256, 256),
            resampling=Resampling.nearest,
            boundless=True,
            fill_value=0,
        ).astype(np.float32)
        return arr

    def _fetch_image(self, template: str, z: int, x: int, y: int) -> Image.Image:
        url = fill_template(template, z, x, y)
        cached = self._terrain_images.get(url)
        if cached is not None:
            return cached.copy()
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content)).convert("RGB")
        self._terrain_images[url] = image.copy()
        if len(self._terrain_images) > 64:
            self._terrain_images.pop(next(iter(self._terrain_images)))
        return image

    def _read_terrain_from(self, template: str, max_zoom: int, z: int, x: int, y: int) -> np.ndarray:
        dem_z = min(z, max_zoom)
        factor = 1 << (z - dem_z)
        parent_x = x // factor
        parent_y = y // factor
        image = self._fetch_image(template, dem_z, parent_x, parent_y)
        if factor > 1:
            crop = 256.0 / factor
            sx = (x % factor) * crop
            sy = (y % factor) * crop
            image = image.crop((sx, sy, sx + crop, sy + crop)).resize((256, 256), Image.Resampling.BILINEAR)
        elif image.size != (256, 256):
            image = image.resize((256, 256), Image.Resampling.BILINEAR)
        return decode_terrarium(image)

    def read_terrain(self, z: int, x: int, y: int) -> Tuple[np.ndarray, str]:
        try:
            return self._read_terrain_from(self.terrain_template, self.terrain_max_zoom, z, x, y), "primary"
        except Exception:
            if not self.fallback_template:
                raise
            return self._read_terrain_from(self.fallback_template, self.fallback_max_zoom, z, x, y), "fallback"

    def build(self, z: int, x: int, y: int) -> Tuple[Image.Image, str, bool]:
        canopy = self.read_canopy(z, x, y)
        ground, terrain_source = self.read_terrain(z, x, y)
        valid_canopy = (canopy > 0) & (canopy < 255)
        chm = np.where(valid_canopy, canopy, 0.0)
        return encode_terrarium(ground + chm), terrain_source, bool(np.any(valid_canopy))


def parse_zooms(raw: str) -> List[int]:
    values = sorted({int(v.strip()) for v in raw.split(",") if v.strip()})
    if not values:
        raise argparse.ArgumentTypeError("--zooms must contain at least one integer")
    if min(values) < 10 or max(values) > 22:
        raise argparse.ArgumentTypeError("zoom must be between 10 and 22")
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", nargs=4, type=float, metavar=("SOUTH", "WEST", "NORTH", "EAST"), required=True)
    parser.add_argument("--zooms", type=parse_zooms, default=parse_zooms("16,17"))
    parser.add_argument("--output", default="meta-dsm-prebuilt")
    parser.add_argument("--cog-base", default="https://data.source.coop/tge-labs/meta-chm-v2/chm")
    parser.add_argument("--terrain-template", default="https://haidian-dtm-proxy.yhzkiki.workers.dev/terrain/{z}/{x}/{y}.png")
    parser.add_argument("--terrain-max-zoom", type=int, default=13)
    parser.add_argument("--fallback-terrain-template", default="https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png")
    parser.add_argument("--fallback-terrain-max-zoom", type=int, default=15)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    south, west, north, east = map(float, args.bbox)
    if south >= north or west >= east:
        parser.error("bbox must satisfy SOUTH < NORTH and WEST < EAST")
    bbox = (south, west, north, east)
    tiles = [tile for z in args.zooms for tile in xyz_range_for_bbox(bbox, z)]
    counts = {str(z): sum(1 for tile in tiles if tile[0] == z) for z in args.zooms}

    print(f"bbox: {bbox}")
    print(f"zooms: {args.zooms}")
    print(f"tiles: {len(tiles)} ({counts})")
    if args.dry_run:
        return 0

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    builder = SurfaceBuilder(
        cog_base=args.cog_base,
        terrain_template=args.terrain_template,
        terrain_max_zoom=args.terrain_max_zoom,
        fallback_template=args.fallback_terrain_template or None,
        fallback_max_zoom=args.fallback_terrain_max_zoom,
        timeout=args.timeout,
    )
    built = skipped = failed = canopy_tiles = fallback_tiles = 0
    errors = []
    try:
        for index, (z, x, y) in enumerate(tiles, 1):
            dest = output / str(z) / str(x) / f"{y}.png"
            if dest.exists() and not args.overwrite:
                skipped += 1
                print(f"[{index}/{len(tiles)}] skip {z}/{x}/{y}")
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                image, terrain_source, has_canopy = builder.build(z, x, y)
                image.save(dest, format="PNG", optimize=True)
                built += 1
                canopy_tiles += int(has_canopy)
                fallback_tiles += int(terrain_source == "fallback")
                print(f"[{index}/{len(tiles)}] built {z}/{x}/{y} terrain={terrain_source} canopy={has_canopy}")
            except Exception as exc:
                failed += 1
                errors.append({"z": z, "x": x, "y": y, "error": str(exc)})
                print(f"[{index}/{len(tiles)}] FAILED {z}/{x}/{y}: {exc}")
    finally:
        builder.close()

    manifest = {
        "schema": 1,
        "kind": "haidian-chmv2-terrarium-surface",
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "zooms": args.zooms,
        "tileCountPlanned": len(tiles),
        "tileCountBuilt": built,
        "tileCountSkipped": skipped,
        "tileCountFailed": failed,
        "canopyTilesBuilt": canopy_tiles,
        "terrainFallbackTiles": fallback_tiles,
        "cogBase": args.cog_base,
        "terrainTemplate": args.terrain_template,
        "terrainMaxZoom": args.terrain_max_zoom,
        "fallbackTerrainTemplate": args.fallback_terrain_template,
        "fallbackTerrainMaxZoom": args.fallback_terrain_max_zoom,
        "errors": errors[:100],
    }
    (output / "coverage.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
