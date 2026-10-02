# ASTRA dev37.9.9.10 — Generic Realm cross-site validation / false-positive hardening

Baseline: live-accepted dev37.9.9.9 proof-scope semantics on top of dev37.9.9.8 generic inferred-open-space walkability.

This release does **not** change route generation, weighted-seed/exact shade search, terminal normalization, detour limits, exposure uncertainty, or comparator proof-scope. It hardens only the generic `inferred-open-space` classifier so that an open-space Realm chord cannot silently cross clearly non-free-space features merely because the enclosing park polygon itself is public.

## Generic inference hardening

`inferred-open-space` remains available only for conservative public-realm kinds (`public-park`, `public-village-green`) and still requires on-site confirmation. Before an unresolved Realm chord can be inferred as walkable, every leg is now additionally checked against inference-only hazard geometry parsed from the same OSM source snapshot.

Blocking area classes include restricted-access areas, sports pitches, formal gardens, dog parks, construction, cemeteries, industrial/military landuse, woods/wetlands, and non-pedestrian `area:highway` surfaces. Blocking linear separators include ordinary/higher motor roads, waterways, railways, cliffs, and hard linear barriers such as ditch/guard-rail/jersey barrier. Narrow exclusions are tested using exact boundary partitioning rather than coarse sampling. Endpoint-only boundary touches do not become fake interior crossings.

This evidence is **inference-only**. It never converts a route to source-verified pedestrian geometry, never mutates the production graph, and never replaces explicit mapped/official walking evidence. Missing or incomplete hazard geometry fails closed for inference.

## Verification

Offline regression checks: **256 PASS / 0 FAIL** when run with the dev37.9.9.9 handoff evidence:

- generic cross-site / false-positive controls: 41
- provenance / inferred-open-space controls: 65
- inferred-walkability comparator controls: 19
- proof-scope alignment controls: 26
- exact Xiaoqiao live-geometry replay: 1
- terminal continuity: 11
- endpoint normalization: 22
- terminal access safety: 22
- residual/comparator preservation: 32
- NLSC official geometry: 14
- display fallback: 1
- weighted-seed reproducibility: 2

The cross-site suite includes generic positive park/village-green cases and negative controls for roads, waterways, railways, hard barriers, narrow exclusion polygons, incomplete source geometry, disconnected/blocked areas, and a recorded Pingshi mapped-network witness. Production source is asserted to contain no Xiaoqiao/Pingshi coordinate, geometry-hash, or route-length branch.

## Preserved invariants

Unchanged: 8 m terminal gate, 10 m normalization offer hard maximum, 1.8 m Realm boundary policy, explicit consent/reference exclusion, dev37.9.9.8 weighted seed/exact search, source-supported vs inferred provenance accounting, detour policy, shade/unknown model, NLSC semantics, dev37.9.9.9 candidate-set/search-coverage proof separation, and production graph mutation policy.
