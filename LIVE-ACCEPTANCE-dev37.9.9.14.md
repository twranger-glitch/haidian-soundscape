# ASTRA dev37.9.9.14 — live acceptance

Date: 2026-10-04

## Wiring

- graph: `src/pedestrian-graph-routing.js?v=9.0.0-dev37.8&core=37.9.9.14`
- route: `src/route-exposure.js?v=9.0.0-dev37.8&core=37.9.9.11`

## Generic mapped-cycle gate

Browser acceptance passed.

- three-parallel-source-paths: rawSegments=6, contractedEdges=3, candidateCount=3, no self-loops, productionGraphMutated=false
- two-loops-one-junction: rawSegments=8, contractedEdges=4, candidateCount=4, no self-loops, productionGraphMutated=false
- single-ring: rawSegments=4, contractedEdges=2, candidateCount=2, no self-loops
- acyclic degree-2 chain: rawSegments=3, contractedEdges=1, candidateCount=1
- directed ring forward: 79.91022654157473 m
- directed ring reverse legal long-wrap: 239.7302537365469 m
- directed cycle direction semantics preserved

Generic gate result: **PASS**.

## Xiaoqiao preservation replay

Original endpoints retained; the 8–10 m endpoint-normalization offer was not accepted.

- graph backend: nationwide-hgr2
- fineNodes=52 / fineEdges=52
- fastestDistanceM=320.40162376093997
- minSunDistanceM=320.40162376093997
- bounded-yen-spur: probes=19, candidateCount=1, distinctPathsAccepted=1, termination=frontier-exhausted, complete=true, exhaustive=false
- productionGraphMutated=false
- mapped walk remains `endpoint-outside-mapped-path`
- Realm remains rejected with `unmapped-terminal-access`
- pipeline remains input=2 / scored=2 / eligibleScored=2 / reliableScored=0
- comparator remains `incomplete-source`, valid=false, selected=null
- explicit normalization offer remains consent-only: gap 9.880079907779448 m, connectorVerified=false, referenceExcludedFromRoute=true, hardMaximumM=10

Xiaoqiao preservation result: **PASS**.

## Decision

`dev37.9.9.14` is accepted and sealed. The cycle representation repair restores source-backed closed topology without synthetic chords or unsupported self-loop edges and preserves all sealed direction, terminal, Realm, provenance, shade, detour and comparator semantics.
