# ASTRA dev37.9.9.14 — mapped-walk cycle contraction preservation (PRE-LIVE)

Date: 2026-10-04

## Scope

This pre-live candidate fixes a generic representation defect in `src/pedestrian-graph-routing.js::contractGraph()`.

The sealed dev37.9.9.13 graph could admit complete mapped source geometry for a pure ring, figure-eight lobe, lollipop loop, or other closed degree-2 chain, mark all raw source segments visited during contraction, and then discard the resulting chain because its contracted endpoints were identical. Downstream refinement and mapped-walk routing therefore saw no usable cycle edge even though source geometry existed.

The repair retains one additional **existing raw source vertex** on each self-returning maximal chain. Normal contraction then emits distinct-endpoint source polylines along the original geometry. It does not preserve unsupported self-loops and does not synthesize straight chords.

## Preserved semantics

- dev37.9.9.13 walking-direction preservation remains authoritative.
- `oneway:foot=yes|1|true` and `oneway:foot=-1|reverse` remain directionally enforced.
- reverse Dijkstra still uses incoming traversal; no routable reverse arcs are fabricated.
- ordinary acyclic degree-2 contraction remains active.
- bounded-Yen policy, caps, detour semantics and non-exhaustive proof flags are unchanged.
- Realm, terminal, endpoint normalization, provenance, shade/unknown, comparator and route-exposure dedupe are unchanged.
- source acquisition is unchanged; only cycles already present in admitted source topology can be restored.

## Mainline offline verification

The Sol 6.1 patch was independently applied to the sealed dev37.9.9.13 production graph and the complete accumulated regression environment.

- 18 / 18 test suites exit 0
- prior sealed baseline regressions remain PASS
- new mapped-cycle-contraction suite: 40 / 40 PASS
- red witness on sealed dev37.9.9.13: 7 PASS / 33 FAIL
- patched figure-eight observation: rawSegments=8, contractedEdges=4, mapped candidates=4
- three-parallel control remains rawSegments=6, contractedEdges=3, mapped candidates=3
- independent randomized directed-cycle stress: 250 cases / 16,597 all-pairs checks PASS
- production diff is confined to `contractGraph()`; route core remains dev37.9.9.11

## Live gate

This package is PRE-LIVE. It must pass a browser generic cycle representation gate plus the original Xiaoqiao preservation replay before sealing.
