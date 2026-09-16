#!/usr/bin/env python3
"""Offline handoff gate for the Haidian map-data update registry.

This script does not contact the network. It checks whether the handoff registry
contains required maintenance metadata and whether scheduled checks are overdue.
Run from the handoff root:

    python tools/check-data-freshness.py

Use --as-of YYYY-MM-DD for reproducible reports.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "data" / "data-update-registry.json"
REPORT = ROOT / "evidence" / "data-freshness" / "latest-report.txt"


def parse_date(value):
    if not value:
        return None
    return dt.date.fromisoformat(value)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--as-of", default=dt.date.today().isoformat())
    args = ap.parse_args()
    as_of = dt.date.fromisoformat(args.as_of)

    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    problems = []
    warnings = []
    lines = [
        "Haidian Soundscape — data freshness handoff check",
        f"As of: {as_of.isoformat()}",
        f"Registry audit date: {data.get('audit_date', 'UNKNOWN')}",
        "",
    ]

    required = data.get("policy", {}).get("required_files", [])
    for rel in required:
        p = ROOT / rel
        if not p.exists() and rel != "evidence/data-freshness/latest-report.txt":
            problems.append(f"missing required handoff file: {rel}")

    for item in data.get("datasets", []):
        iid = item.get("id", "<missing-id>")
        name = item.get("name", iid)
        status = item.get("status", "unknown")
        interval = item.get("check_every_days")
        last = parse_date(item.get("last_source_metadata_check"))
        if last is None:
            last = parse_date(item.get("last_inventory_audit"))
            basis = "inventory"
        else:
            basis = "source"

        state = "OK"
        note = ""
        if status.startswith("planned") or status == "planned-not-deployed":
            state = "PLAN"
            note = "not deployed yet"
        elif interval:
            if last is None:
                state = "WARN"
                note = "no check date recorded"
                warnings.append(f"{iid}: no check date recorded")
            else:
                due = last + dt.timedelta(days=int(interval))
                if as_of > due:
                    state = "DUE"
                    note = f"{basis} check overdue since {due.isoformat()}"
                    problems.append(f"{iid}: check overdue since {due.isoformat()}")
                else:
                    note = f"next {basis} check by {due.isoformat()}"
        else:
            state = "MANUAL"
            note = "event/editorial driven"

        baseline = item.get("baseline_state")
        if baseline and ("unknown" in baseline or "needs" in baseline):
            warnings.append(f"{iid}: baseline warning — {baseline}")
            if state == "OK":
                state = "WARN"
                note = (note + "; " if note else "") + baseline

        lines.append(f"[{state:6}] {name} ({iid}) — {note}")

    lines += ["", f"Problems: {len(problems)}", f"Warnings: {len(warnings)}"]
    if problems:
        lines.append("\nPROBLEMS")
        lines.extend(f"- {x}" for x in problems)
    if warnings:
        lines.append("\nWARNINGS")
        lines.extend(f"- {x}" for x in warnings)

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    # Existing unknown baselines are warnings, not hard failures. Date-overdue or
    # missing mandatory registry files are hard failures.
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
