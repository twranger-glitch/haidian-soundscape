#!/usr/bin/env python3
"""Pre-deploy verifier for Haidian ShadeMap v8.5.3.

Run from a checked-out haidian-soundscape repository after copying the v8.5.3
files and applying the Esri host patch. This script does not need network access.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import sys


def read(path: Path) -> str:
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".", help="Path to haidian-soundscape checkout")
    ap.add_argument("--json", action="store_true", help="Emit JSON summary")
    args = ap.parse_args()
    root = Path(args.repo).resolve()

    src_p = root / "src" / "shademap-integration.js"
    cfg_p = root / "config.shademap.template.js"
    idx_p = root / "index.html"
    wf_p = root / ".github" / "workflows" / "build-building-data.yml"
    tools = [
        root / "tools" / "build-building-region.py",
        root / "tools" / "build-building-tiles.py",
        root / "tools" / "check-building-dataset.py",
        root / "tools" / "deploy-building-tiles-hf.py",
        root / "tools" / "fetch-osm-building-fallback.py",
        root / "tools" / "fetch-overture-buildings.sh",
    ]
    src, cfg, idx, wf = map(read, [src_p, cfg_p, idx_p, wf_p])

    checks: list[tuple[str, bool, str]] = []
    def ck(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, bool(ok), detail))

    ck("v8.5.3 ShadeMap runtime installed", "live integration v8.5.3" in src, str(src_p))
    ck("production building mode remains OSM", bool(re.search(r'buildingMode:\s*["\']osm["\']', cfg)), str(cfg_p))
    ck("safe pilot query gate configured", "buildingPilotQueryParam: \"buildingPipeline\"" in cfg and "buildingPilotQueryValue: \"1\"" in cfg, str(cfg_p))
    ck("effective building mode pilot logic installed", "function effectiveBuildingMode()" in src and "buildingPilotRequested() ? \"pipeline\" : config.buildingMode" in src, str(src_p))
    ck("building Worker URL configured", "haidian-dtm-proxy.yhzkiki.workers.dev/buildings/{z}/{x}/{y}.geojson" in cfg, str(cfg_p))
    ck("Esri satellite overzoom z19→z20 applied", "maxNativeZoom: 19, maxZoom: 20" in idx and "World_Imagery/MapServer/tile" in idx, str(idx_p))
    ck("ShadeMap config script still loaded by host", "config.shademap.js" in idx, str(idx_p))
    ck("ShadeMap integration script still loaded by host", "src/shademap-integration.js" in idx, str(idx_p))
    ck("building GitHub Action installed", wf_p.is_file() and "haidian-smoke" in wf and "deploy_hf" in wf, str(wf_p))
    ck("building workflow is HF-only", "HF_TOKEN" in wf and "BUILDING_HF_BASE_URL" in wf and "R2_" not in wf and "AWS_ACCESS_KEY_ID" not in wf, str(wf_p))
    ck("workflow verifies public HF manifest", "Verify public Hugging Face manifest" in wf, str(wf_p))
    ck("all building pipeline tools installed", all(p.is_file() for p in tools), ", ".join(str(p.name) for p in tools if not p.is_file()))
    ck("ShadeMap API key placeholder preserved", cfg.count("__SHADEMAP_API_KEY_JSON__") == 1, str(cfg_p))

    # Guard against accidentally committing a rendered secret-bearing config.
    rendered = root / "config.shademap.js"
    ck("rendered config.shademap.js is not committed in checkout", not rendered.exists(), "Expected only GitHub Pages build artifact, not repository file")

    passed = sum(1 for _, ok, _ in checks if ok)
    failed = len(checks) - passed
    out = {
        "schema": 1,
        "repo": str(root),
        "version": "v8.5.3",
        "passed": passed,
        "failed": failed,
        "checks": [{"name": n, "ok": ok, "detail": d} for n, ok, d in checks],
        "pilot_url_suffix": "?buildingPipeline=1",
        "production_switch_required": False,
    }
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for n, ok, d in checks:
            print(("PASS" if ok else "FAIL") + ": " + n + (f" — {d}" if (d and not ok) else ""))
        print(f"TOTAL: {passed} PASS / {failed} FAIL")
        if failed == 0:
            print("READY: repository-side v8.5.3 files are internally consistent. Production still remains buildingMode=\"osm\".")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
