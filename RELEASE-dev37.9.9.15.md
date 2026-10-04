# ASTRA dev37.9.9.15 — candidate dedupe original-vertex coverage (PRE-LIVE)

Date: 2026-10-04

## Scope

This pre-live candidate fixes one generic route-candidate dedupe false positive in `src/route-exposure.js::geometryDuplicateEvidence()`.

The existing near-corridor dedupe samples route geometry at 8 m spacing. A short local excursion can place an original route vertex more than the existing 4 m corridor gate away from another route while all sampled points remain within 4 m, causing the distinct candidate to be labeled `geometry-proven-duplicate` and removed.

The repair requires every original route vertex to have a <=4 m coverage witness on the other route before duplicate status is allowed. Nearby segment projection is used as a positive witness optimization; when no nearby witness is found, the existing exhaustive nearest projection is retained. Bounding-box absence is never used as negative proof.

## Preserved semantics

- existing 4 m maximum-offset, 2.5 m mean-offset, 8 m distance-delta, endpoint and 8 m sampling policies remain unchanged
- near-corridor dedupe remains a heuristic; this is not an exact Hausdorff or topology-identity proof
- provider/graph input ordering and first-survivor behavior remain unchanged
- manual/fused protected candidates remain unchanged
- graph core remains sealed dev37.9.9.14
- mapped-cycle contraction and dev37.9.9.13 pedestrian-direction semantics remain unchanged
- Realm, terminal, explicit endpoint normalization, provenance, shade/unknown, detour and comparator rules remain unchanged

## Mainline offline verification

Applied to sealed dev37.9.9.14 with the accumulated regression environment:

- sealed baseline RED witness: 12 PASS / 10 FAIL, exit 1
- patched dedicated dedupe suite: 22 / 22 PASS
- accumulated integration: 19 / 19 `test-*.js` suites exit 0
- pedestrian direction: 38 / 38 PASS
- mapped-cycle contraction: 40 / 40 PASS
- mapped handoff: 18 / 18 PASS
- source scope: 34 / 34 PASS
- topology diversity: 38 / 38 PASS
- route core production SHA: `deab55d84822c28e32ffbdcbfbfbaea4d6588adc060cc42b8172d8cca561aa34`
- graph core SHA unchanged: `b39e343b4b0651d3af049350308ea4ab7b589617c308e18e5c9b04aaee889492`

Production modification is confined to `geometryDuplicateEvidence()` in `src/route-exposure.js`.

## Live gate

This package is PRE-LIVE. Browser acceptance must prove the generic vertex-excursion witness is no longer deduped, ordinary same/near-corridor controls still dedupe, and the original Xiaoqiao pipeline still performs its legitimate ~4–5 cm provider/graph dedupe without changing terminal, Realm or comparator semantics.
