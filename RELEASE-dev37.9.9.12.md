# ASTRA dev37.9.9.12 — bounded topology candidate diversity

Date: 2026-10-04

## Scope

This pre-live candidate changes only the source-graph topology alternative enumerator in `src/pedestrian-graph-routing.js`.

The previous generator removed one edge from the source-fastest route per probe and reran a shortest path. On generic multi-corridor graphs this repeatedly rediscovered the same deviation and could stop after one distinct alternative even when additional safe, loopless, detour-valid source paths existed.

The new implementation uses a bounded Yen/spur-style enumeration over the existing directed source adjacency. It does not create nodes, edges, connectors, walking surfaces, or Realm geometry. It retains the existing source-fastest detour cap and existing access/synthetic guards.

## Explicit non-goals

No changes to:

- Realm / terminal / normalization policy
- provenance or distance accounting
- walkability eligibility
- shade model, unknown handling, min-sun search, or comparator winner semantics
- route-exposure dedupe policy
- mapped-walk contraction
- source acquisition or graph scope

This release does **not** claim exhaustive K-best coverage or global minimum-sun proof. Topology diagnostics explicitly keep `exhaustive=false`, `physicalGlobalOptimal=false`, and `shadeSearchProof=false`.

## Bounds

Default bounds remain finite: 4 alternatives, 48 spur probes, 600 ms cooperative budget, plus expanded-state, adjacency-scan, path-edge, and geometry-point caps. Hard maxima remain finite.

## Validation before live deploy

Mainline integration against the complete dev37.9.9.11 sealed test fixture set:

- 14/14 test suites exit 0
- 256 existing numeric checks PASS
- 38 new topology-diversity checks PASS
- total 294 PASS / 0 FAIL
- the three suites blocked in the Sol work package were restored from the sealed handoff and all pass

Live website acceptance is still required. This package is a pre-live candidate, not a sealed release.
