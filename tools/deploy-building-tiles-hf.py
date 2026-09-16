#!/usr/bin/env python3
"""Upload a validated building-tile build to a Hugging Face dataset repo.

Repository layout:
  buildings/<version>/manifest.json
  buildings/<version>/16/<x>/<y>.geojson
  buildings/<version>/cell-manifests/*.json
  buildings/latest.json   (informational pointer only; runtime uses explicit version)

The production Worker is configured with BUILDING_HF_BASE_URL ending at
`.../resolve/main/buildings` plus BUILDING_DATA_VERSION=<version>.

This uploader never requires Cloudflare R2 or payment credentials.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
REPO_RE = re.compile(r"^[^/\s]+/[^/\s]+$")


def parse_bool(value: str) -> bool:
    v = str(value).strip().lower()
    if v in {"1", "true", "yes", "y", "on"}:
        return True
    if v in {"0", "false", "no", "n", "off", ""}:
        return False
    raise argparse.ArgumentTypeError(f"invalid boolean: {value}")


def build_files(build_dir: Path) -> tuple[int, int, list[Path]]:
    manifest = build_dir / "manifest.json"
    if not manifest.is_file():
        raise SystemExit("FAIL: build directory is missing manifest.json")
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"FAIL: manifest.json is invalid: {exc}") from exc

    zoom = int(data.get("tile_zoom") or (data.get("tiles") or {}).get("zoom") or 16)
    tiles = sorted((build_dir / str(zoom)).glob("*/*.geojson"))
    if not tiles:
        raise SystemExit(f"FAIL: no z{zoom} building tiles found")

    files: list[Path] = [manifest, *tiles]
    cell_dir = build_dir / "cell-manifests"
    if cell_dir.is_dir():
        files.extend(sorted(p for p in cell_dir.glob("*.json") if p.is_file()))
    return zoom, len(tiles), files


def safe_link_or_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def relative_to_build(src: Path, build_dir: Path) -> Path:
    return src.relative_to(build_dir)


def make_plan(build_dir: Path, repo_id: str, version: str, private: bool, large_threshold: int) -> dict:
    zoom, tile_count, files = build_files(build_dir)
    total_bytes = sum(p.stat().st_size for p in files)
    mode = "large-folder" if len(files) >= large_threshold else "upload-folder"
    return {
        "ok": True,
        "repo_id": repo_id,
        "repo_type": "dataset",
        "private": private,
        "version": version,
        "path_in_repo": f"buildings/{version}",
        "zoom": zoom,
        "tile_count": tile_count,
        "file_count": len(files),
        "bytes": total_bytes,
        "upload_mode": mode,
        "worker_base_url": f"https://huggingface.co/datasets/{repo_id}/resolve/main/buildings",
        "worker_data_version": version,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("build_dir")
    ap.add_argument("--repo-id", required=True, help="Hugging Face dataset repo, e.g. owner/haidian-building-tiles")
    ap.add_argument("--version", required=True, help="Immutable building dataset version path")
    ap.add_argument("--private", type=parse_bool, default=False, help="Create repo as private when it does not exist")
    ap.add_argument("--token-env", default="HF_TOKEN", help="Environment variable containing a HF write token")
    ap.add_argument("--large-folder-threshold", type=int, default=5000, help="Use resumable upload_large_folder at/above this file count")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    build_dir = Path(args.build_dir).resolve()
    repo_id = args.repo_id.strip()
    version = args.version.strip()
    if not build_dir.is_dir():
        raise SystemExit(f"FAIL: build directory not found: {build_dir}")
    if not REPO_RE.fullmatch(repo_id):
        raise SystemExit("FAIL: --repo-id must look like owner/repository")
    if not VERSION_RE.fullmatch(version):
        raise SystemExit("FAIL: --version may contain only letters, numbers, dot, underscore and hyphen")
    if args.large_folder_threshold < 1:
        raise SystemExit("FAIL: --large-folder-threshold must be >= 1")

    plan = make_plan(build_dir, repo_id, version, args.private, args.large_folder_threshold)
    if args.dry_run:
        print(json.dumps({**plan, "dry_run": True}, ensure_ascii=False, indent=2))
        return

    token = str(os.environ.get(args.token_env, "")).strip()
    if not token:
        raise SystemExit(f"FAIL: missing Hugging Face write token in environment variable {args.token_env}")

    try:
        from huggingface_hub import HfApi
    except Exception as exc:
        raise SystemExit("FAIL: install huggingface_hub before deployment") from exc

    api = HfApi(token=token)
    api.create_repo(repo_id=repo_id, repo_type="dataset", private=args.private, exist_ok=True)

    _, _, files = build_files(build_dir)
    commit_message = f"Publish ShadeMap building tiles {version}"
    if plan["upload_mode"] == "upload-folder":
        api.upload_folder(
            repo_id=repo_id,
            repo_type="dataset",
            folder_path=str(build_dir),
            path_in_repo=f"buildings/{version}",
            allow_patterns=["manifest.json", "16/**", "cell-manifests/**"],
            commit_message=commit_message,
        )
    else:
        # upload_large_folder has robust resumability for very large file counts but
        # uploads from repo-root layout. Stage hardlinks/copies to avoid duplicating
        # large tile content when the filesystem supports hardlinks.
        with tempfile.TemporaryDirectory(prefix="haidian-hf-stage-") as td:
            stage = Path(td)
            version_root = stage / "buildings" / version
            for src in files:
                safe_link_or_copy(src, version_root / relative_to_build(src, build_dir))
            api.upload_large_folder(
                repo_id=repo_id,
                repo_type="dataset",
                folder_path=str(stage),
                num_workers=min(16, max(2, (os.cpu_count() or 4))),
                print_report=True,
            )

    pointer = {
        "schema": 1,
        "version": version,
        "updated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "path": f"buildings/{version}",
        "manifest": f"buildings/{version}/manifest.json",
        "runtime_note": "Informational only. Production Worker must pin BUILDING_DATA_VERSION explicitly.",
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as tf:
        json.dump(pointer, tf, ensure_ascii=False, indent=2)
        tf.write("\n")
        pointer_path = tf.name
    try:
        api.upload_file(
            repo_id=repo_id,
            repo_type="dataset",
            path_or_fileobj=pointer_path,
            path_in_repo="buildings/latest.json",
            commit_message=f"Update building latest pointer to {version}",
        )
    finally:
        try:
            os.unlink(pointer_path)
        except OSError:
            pass

    print(json.dumps({**plan, "dry_run": False, "uploaded": True}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
