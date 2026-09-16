#!/usr/bin/env python3
"""Apply v8.5.3 GitHub-side files to a local haidian-soundscape checkout.

Production stays on buildingMode="osm". The hosted pipeline is opt-in with
?buildingPipeline=1 until A/B validation is accepted.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import time

ESRI_OLD = "var esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19, zIndex: 1 });"
ESRI_NEW = "var esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxNativeZoom: 19, maxZoom: 20, zIndex: 1 });"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("repo", help="Path to local haidian-soundscape checkout")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-backup", action="store_true")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    payload = Path(__file__).resolve().parent.parent / "live-repo-overlay"
    if not (repo / "index.html").is_file():
        raise SystemExit(f"FAIL: {repo} does not look like haidian-soundscape (index.html missing)")
    if not payload.is_dir():
        raise SystemExit(f"FAIL: payload missing: {payload}")

    targets = [p for p in payload.rglob('*') if p.is_file()]
    backup = repo / f"_backup-before-v8.5.3-{time.strftime('%Y%m%d-%H%M%S')}"
    print(f"Repo: {repo}")
    print(f"Payload files: {len(targets)}")
    print("Production building mode will remain OSM.")

    if args.dry_run:
        for src in targets:
            print("COPY", src.relative_to(payload), "->", repo / src.relative_to(payload))
        print("PATCH index.html: Esri maxNativeZoom 19 / maxZoom 20")
        return

    if not args.no_backup:
        for src in targets:
            rel = src.relative_to(payload)
            dst = repo / rel
            if dst.is_file():
                b = backup / rel
                b.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst, b)
        idx_backup = backup / "index.html"
        idx_backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / "index.html", idx_backup)
        print(f"Backup: {backup}")

    for src in targets:
        rel = src.relative_to(payload)
        dst = repo / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        print("COPIED", rel)

    idx = repo / "index.html"
    text = idx.read_text(encoding="utf-8")
    if ESRI_NEW in text:
        print("Esri overzoom patch already present")
    elif ESRI_OLD in text:
        idx.write_text(text.replace(ESRI_OLD, ESRI_NEW, 1), encoding="utf-8")
        print("PATCHED index.html Esri z19 native -> z20 display overzoom")
    else:
        raise SystemExit("FAIL: expected Esri layer line not found; index.html was not modified. Inspect manually before committing.")

    preflight = repo / "tools" / "preflight-v853.py"
    print("Running preflight...")
    result = subprocess.run([sys.executable, str(preflight), "--repo", str(repo)], check=False)
    if result.returncode:
        raise SystemExit(result.returncode)
    print("DONE: repository-side v8.5.3 installed. HF/Worker deployment is still an explicit next step.")


if __name__ == "__main__":
    main()
