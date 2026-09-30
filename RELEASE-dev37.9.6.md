# ASTRA dev37.9.6 — NLSC geometry-native positive caster pilot

## Purpose
Formalize the successful dev37.9.5 geometry impact diagnostic as a minimal additive source integration.

## Changed
- Added `src/nlsc-official-geometry.js`.
- Added a 104-feature local NLSC geometry + official-height pilot dataset.
- `shademap-integration.js` now appends validated NLSC geometry features to the precision building set when they overlap the requested bbox.
- Added runtime diagnostics under `officialGeometryEnrichment`.
- Updated cache-busting core query to `37.9.6` while leaving the visible UI version unchanged.

## Intentionally unchanged
- Candidate generation
- Pedestrian graph / Realm search
- Experimental fusion routing
- Route comparison / uncertainty proof
- Own-shade renderer
- Building-data-provider merge semantics

## Safety
The NLSC pilot is positive evidence only. It never proves source completeness, never turns absence into sun, never removes baseline features, and fails open to the dev37.9.5 behavior if the geometry dataset cannot load.
