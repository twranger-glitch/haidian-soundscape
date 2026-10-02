# ASTRA dev37.9.9.6.2 — Realm shade-seed reproducibility

## Scope

This release addresses a live reproducibility defect observed after the dev37.9.9.6.1 terminal work was fully accepted. The exact normalized benchmark could sometimes produce only `graph-pedestrian-realm-fastest` before the 12 s Realm shade deadline, while another run in the same area had produced a strong Realm shade candidate close to the manually drawn route.

## Root cause

`realmWeightedShadeCandidate()` is a bounded heuristic seed generator, not an optimality proof. At a high-degree Realm start frontier it evaluated each expensive shade edge serially. In the live cold run, the seed expanded only 5 states / 52 edge evaluations before its seed window ended; the subsequent exact search also terminated on `realm-shade-time-budget`. No min-sun candidate had been generated, so dedupe/comparator/walkability were not the cause.

## Change

Only the bounded weighted seed now evaluates feasible outgoing edge shade costs with the existing bounded batch pool (`shadeEdgeBatchConcurrency`, hard-capped at 4). Results are applied to the heap in deterministic input order after the batch completes. The seed remains heuristic and cannot prove optimality.

The exact `searchMinSun()` implementation, uncertainty interval semantics, comparator proof, detour limit, terminal gate, endpoint normalization, Realm admission, NLSC/building/shade evidence semantics, and production graph mutation policy are unchanged. The 12 s overall Realm search budget is unchanged.

Additional seed diagnostics expose `edgeBatchConcurrency` and `maxBatch` in the existing Realm search profile.

## Regression evidence

`tests/test-realm-seed-reproducibility.js` contains two deterministic barrier controls:

- a synthetic high-degree graph;
- the acquired terminal-handoff OSM topology (492 nodes / 708 edges, start degree 23).

The dev37.9.9.6.1 baseline serial seed stalls on the first barrier-controlled edge in both controls (expected red). dev37.9.9.6.2 progresses concurrently and produces a bounded candidate in both controls. This test does not encode park names, coordinates, way IDs, manual route geometry, or a desired shade percentage.

All prior terminal, comparator, source, NLSC and display regressions remain required.

## Cache wiring

- `src/pedestrian-graph-routing.js`: `core=37.9.9.6.2`
- `src/route-exposure.js`: remains `core=37.9.9.6.1`
- building provider: remains `37.9.8.4`
- NLSC / own-shade / shade integration: remain `37.9.7`

## Live status

Public GitHub Pages verification of dev37.9.9.6.2 is **NOT RUN** until this deployment is uploaded. A live rerun must use the fixed benchmark departure and verify that any returned Realm shade candidate remains uncertainty-safe; no winner may be fabricated when source intervals overlap or when the candidate remains partial/synthetic.
