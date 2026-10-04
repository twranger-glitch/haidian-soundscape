# ASTRA dev37.9.9.13 — live acceptance

Date: 2026-10-04

## Wiring

- graph core: `37.9.9.13`
- route core: `37.9.9.11`
- visible version remains `v9.0.0-dev37.8`

## Generic pedestrian direction gate

PASS.

### `oneway:foot=yes`
- raw forward: true
- raw reverse: false
- contracted forward: true
- contracted reverse: false
- refined forward: true
- refined reverse: false
- reverse bound A→B: true
- reverse bound B→A: false
- mapped forward available: true
- mapped reverse available: false (`mapped-lines-disconnected`)

### `oneway:foot=-1`
- raw forward: false
- raw reverse: true
- contracted forward: false
- contracted reverse: true
- refined forward: false
- refined reverse: true
- reverse bound A→B: false
- reverse bound B→A: true
- mapped forward available: false
- mapped reverse available: true

### motor-only `oneway=yes`
Pedestrian routing remains bidirectional at raw, contracted, refined, reverse-bound, and mapped-walk stages.

## Xiaoqiao preservation replay

Original A/B were replayed without accepting the 8–10 m explicit endpoint-normalization offer.

- elapsed: 9010.9 ms
- snap A gap: 4.069282876445108 m
- snap B gap: 9.907564784213214 m
- HGR2 selected graph: 52 nodes / 52 edges
- fastest: 320.40162376093997 m
- min-sun route geometry: same 320.40162376093997 m
- bounded-Yen: 19 probes, 1 distinct alternative, 446 expanded states, 1011 edge scans
- termination: `frontier-exhausted`
- complete: true
- exhaustive: false
- productionGraphMutated: false
- mapped-walk: `endpoint-outside-mapped-path`
- Realm: `unmapped-terminal-access`
- pipeline: 2 input / 2 quality / 2 walkability / 2 detour / 2 scored / 2 eligible / 0 reliable
- comparator remains `incomplete-source`, no selected winner
- endpoint-normalization offer remains explicit-only; gap 9.880079907779448 m, connectorVerified=false, referenceExcludedFromRoute=true, hardMaximumM=10

## Seal decision

PASS. The live direction-specific safety gate and the Xiaoqiao preservation replay both pass. dev37.9.9.13 is accepted as the new sealed graph baseline with route core 37.9.9.11 unchanged.
