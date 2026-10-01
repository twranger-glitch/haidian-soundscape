# ASTRA dev37.9.7 — expanded NLSC geometry positive-evidence pilot

## Goal
Expand the already-live dev37.9.6 NLSC geometry-native caster pilot using additional official NLSC I3S geometry discovered around the remaining fused-route building-height unknown samples.

## Evidence behind this patch
The read-only dev37.9.7 diagnostic on live dev37.9.6 found:
- baseline fused unknown: 48.499 m / 38.799 s
- 10 remaining building-height-unknown segments
- 315 additional official NLSC geometry features decoded from 62 node groups
- 0 extraction errors and 0 missing node-index IDs
- 5/10 remaining segments became confirmed shade using exact NLSC geometry + official BUILD_H
- newly resolved shade: 23.948 m / 19.158 s
- projected fused unknown: 24.551 m / 19.641 s

## Patch
- Geometry pilot dataset expanded from 104 to 419 official NLSC features.
- New dataset file: `buildings/nlsc-official-geometry-pilot-2026-10-01.geojson`.
- `src/nlsc-official-geometry.js` updated only for version/cache URL.
- `index.html` cache-busting core query updated to `37.9.7`; visible UI version remains unchanged.

## Safety
- Positive caster evidence only.
- Absence is NOT evidence of sun.
- No completeness proof is claimed.
- Existing Overture/OSM features are retained.
- No nearest-centroid, mean-height, max-height, or fabricated-height heuristic.
- Candidate generation, Realm/search, comparison, fusion, route-exposure semantics, own-shade renderer, and source arbitration are unchanged from dev37.9.6.

## Acceptance
Live deployment is required before promoting dev37.9.7. dev37.9.6 remains the known-good fallback until the live acceptance script passes.
