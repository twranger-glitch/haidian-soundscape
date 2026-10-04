# ASTRA dev37.9.9.13 — pedestrian direction preservation

Date: 2026-10-04

## Scope

This pre-live candidate fixes a generic pedestrian-direction safety defect in `src/pedestrian-graph-routing.js`.

The raw OSM graph already respected walking-specific `oneway:foot`, but several downstream graph transformations reconstructed endpoint pairs as bidirectional and reverse-distance searches traversed outgoing rather than incoming arcs. This could make an explicitly illegal reverse mapped-walk route appear available and could make asymmetric to-B detour bounds incorrect.

The patch preserves actual directed adjacency through contraction, refinement, snapping/splitting, subset/clone/rescue graph copies, HGR2 geometry reconciliation, reverse Dijkstra bounds, detour eligibility, and the existing bounded topology-alternative pipeline.

## Direction semantics

- `oneway:foot=yes|1|true`: only OSM node order is routable.
- `oneway:foot=-1|reverse`: only reverse OSM node order is routable.
- ordinary pedestrian ways remain bidirectional.
- motor-only `oneway=yes` is not promoted to a pedestrian restriction.
- reverse-distance bounds use a temporary incoming/transposed traversal view; no reverse production arcs are fabricated.

## Explicit non-goals

No changes to:

- Realm safety/provenance or inferred-open-space policy
- terminal 8 m automatic gate or explicit 8–10 m normalization policy
- endpoint-reference accounting
- shade/unknown semantics
- comparator or winner rules
- detour cap/slack policy
- source acquisition scope
- route-exposure dedupe
- dev37.9.9.12 bounded-Yen design
- mapped-walk figure-eight / pure-cycle contraction loss

## Mainline validation before live deploy

The Sol patch was applied to the complete sealed test environment with the dev37.9.9.12 graph baseline and dev37.9.9.11 route baseline.

- 17 / 17 test suites exit 0
- 384 checks/cases PASS / 0 FAIL
- direction-preservation generic suite: 38 / 38 PASS
- mapped-handoff controls: 18 / 18 PASS
- source-scope audit: 34 / 34 PASS
- topology-diversity suite: 38 / 38 PASS
- complete Realm / terminal / provenance / comparator / distance suites PASS
- the residual-caster preservation hash gate was narrowed only for the 12 intentionally modified direction-related graph functions; all unrelated frozen functions remain protected and all semantic checks pass

Live website acceptance is still required. This package is a PRE-LIVE candidate and must not be treated as sealed until the direction-specific live gate and Xiaoqiao preservation replay pass.
