# ASTRA dev37.9.9.6 — terminal handoff continuity

Baseline: live dev37.9.8.5 plus the reviewed-but-not-yet-deployed dev37.9.9.4 conservative Realm terminal-access safety patch.

## Production behavior
- Keeps the existing <=8 m unproven terminal connector policy and the existing 1.8 m Realm boundary tolerance unchanged.
- When a rejected 8–10 m Realm terminal has a source-complete, pedestrian-compatible mapped-line anchor, the graph layer may expose a **normalization offer only**. The offer is not a connector and does not create a route.
- Exact user A/B remains the default. Only explicit user confirmation changes the routing endpoint to the mapped anchor.
- After confirmation, the original point remains visible as a reference; the original-to-anchor gap is labelled unverified and contributes zero route distance, time, shade, detour, and comparator evidence.
- Stale/manual/provider geometries that include the excluded reference segment are rejected before scoring.

## Integration wiring
- `src/pedestrian-graph-routing.js` cache query is bumped from `core=37.9.7` to `core=37.9.9.6`. This deploys both the previously reviewed dev37.9.9.4 terminal safety changes already present in the development baseline and the dev37.9.9.6 normalization-offer logic.
- `src/route-exposure.js` cache query is bumped from `core=37.9.8.5` to `core=37.9.9.6`.
- `src/building-data-provider.js` remains `core=37.9.8.4`; NLSC geometry/renderer/shade integration remain `core=37.9.7`.
- Visible UI version remains `v9.0.0-dev37.8` by design.

## Safety invariants retained
- No 8 m -> 10 m permission widening.
- No enlargement of the 1.8 m Realm boundary tolerance.
- No hidden A/B substitution and no provider-derived endpoint treated as truth.
- private/access=no/foot=no, barrier, building, water and incomplete-source checks remain fail-closed.
- Synthetic Realm geometry remains partial / requires on-site path confirmation.
- No shade/unknown/NLSC/comparator semantic change and no fabricated winner when intervals overlap.
- No general HGR2/candidate-generation redesign.

## Integration verification before public deployment
- Fresh baseline apply: 101 PASS / 0 FAIL across terminal continuity, explicit normalization, Realm terminal safety, provider/residual/comparator preservation, NLSC official geometry and display fallback.
- JavaScript syntax: 6 PASS / 0 FAIL for the patch set; deploy acceptance script syntax also passes.
- Baseline red control for the new normalization suite remains 8 PASS / 13 expected FAIL.
- DEPLOY manifest, ZIP CRC, entry set, relative-path safety and per-file SHA-256 are verified during packaging.

Public GitHub Pages/live-browser/real-shade acceptance must be run after deployment; offline regression does not substitute for that acceptance.
