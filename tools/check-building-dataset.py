#!/usr/bin/env python3
"""Validate a built ShadeMap building dataset before upload/deployment."""
from __future__ import annotations
import argparse, json, math
from pathlib import Path

ALLOWED_SOURCES={"NLSC","Overture","OSM"}
ALLOWED_GEOMS={"Polygon","MultiPolygon"}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('build_dir'); ap.add_argument('--max-tiles',type=int,default=0); a=ap.parse_args()
    root=Path(a.build_dir)
    manifest_path=root/'manifest.json'
    if not manifest_path.is_file(): raise SystemExit('FAIL: missing manifest.json')
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    z=int(manifest.get('tile_zoom') or (manifest.get('tiles') or {}).get('zoom') or 16)
    tiles=sorted((root/str(z)).glob('*/*.geojson'))
    if not tiles: raise SystemExit(f'FAIL: no z{z} building tiles')
    if a.max_tiles>0: tiles=tiles[:a.max_tiles]
    errors=[]; features=0; quality={}; sources={}; max_bytes=0; max_features=0
    for p in tiles:
        max_bytes=max(max_bytes,p.stat().st_size)
        try: fc=json.loads(p.read_text(encoding='utf-8'))
        except Exception as e:
            errors.append(f'{p}: invalid JSON: {e}'); continue
        fs=fc.get('features') if isinstance(fc,dict) else None
        if not isinstance(fs,list): errors.append(f'{p}: missing features array'); continue
        max_features=max(max_features,len(fs)); seen=set()
        for f in fs:
            features+=1
            g=(f or {}).get('geometry') or {}; pr=(f or {}).get('properties') or {}
            if g.get('type') not in ALLOWED_GEOMS: errors.append(f'{p}: invalid geometry {g.get("type")}')
            uid=pr.get('building_uid')
            if not uid: errors.append(f'{p}: missing building_uid')
            elif uid in seen: errors.append(f'{p}: duplicate uid {uid}')
            else: seen.add(uid)
            src=pr.get('building_source'); sources[src]=sources.get(src,0)+1
            if src not in ALLOWED_SOURCES: errors.append(f'{p}: invalid source {src}')
            h=pr.get('height')
            try: hv=float(h)
            except Exception: hv=float('nan')
            if not math.isfinite(hv) or hv<=0 or hv>500: errors.append(f'{p}: invalid height {h}')
            q=pr.get('height_quality') or 'unknown'; quality[q]=quality.get(q,0)+1
    print(json.dumps({
      'ok': not errors, 'tiles_checked':len(tiles),'feature_instances_checked':features,
      'sources':sources,'height_quality':quality,'max_tile_bytes':max_bytes,'max_tile_features':max_features,
      'errors':errors[:30]
    },ensure_ascii=False,indent=2))
    if errors: raise SystemExit(1)

if __name__=='__main__': main()
