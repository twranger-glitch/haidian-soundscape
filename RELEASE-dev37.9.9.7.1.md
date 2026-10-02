# ASTRA dev37.9.9.7.1 — exact partial provenance accounting

Baseline: live-deployed dev37.9.9.7. This is a narrow follow-up to Realm route provenance / walkability evidence reduction.

## What changed

- Keeps the dev37.9.9.7 source trust policy unchanged.
- A synthetic Realm edge is no longer all-or-nothing for evidence accounting. The post-search reducer partitions an edge only at exact boundaries/endpoints of already-approved pedestrian evidence, then reuses the same fail-closed segment classifier on every child interval.
- No proximity buffer, corridor tolerance, route snapping, park-membership inference, or source stitching across gaps was added. Numerical coincidence remains 1 mm only.
- Search graph, weighted seed, exact search, terminal policy, endpoint consent/reference semantics, shade/unknown model, detour and comparator rules are unchanged.

## Exact live min-sun geometry audit

The dev37.9.9.7 live browser export supplied the complete geometry for `graph-pedestrian-realm-min-sun`, geometry hash `g12a3dbe9`, at 2026-09-30 15:23 Asia/Taipei, 30% detour.

Against the saved OSM + official pedestrian snapshots:

- total: 283.73256472878285 m
- mapped path: 11.903650354080263 m
- source-supported official pedestrian surface: 35.61858610958563 m
- unresolved synthetic: 236.21032826511697 m
- synthetic ratio: 0.8325104610072097
- requires on-site path confirmation: true

Five exact child intervals are supported by NLMA sidewalk inventory polygons: four by feature `...:921` and one by `...:900`. The remaining park-interior geometry has no complete approved pedestrian source coverage and remains synthetic. The candidate therefore remains partial/ineligible; no comparator winner is created.

## Verification

160 regression checks PASS / 0 FAIL, plus 6 syntax checks PASS. The live geometry provenance replay is preserved under `tests/results/dev37.9.9.7.1/`.
