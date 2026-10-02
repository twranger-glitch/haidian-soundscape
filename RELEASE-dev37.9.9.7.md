# ASTRA dev37.9.9.7 — Realm route provenance / walkability evidence reduction

This release integrates the independently reviewed dev37.9.9.7 Sol patch on top of the live-accepted dev37.9.9.6.2 baseline.

## Scope

- Post-search, segment-level provenance reduction only. Search graph, shade costs, candidate generation, weighted seed, exact search, terminal gates, detour and comparator semantics are unchanged.
- Synthetic Realm segments can become `source-supported-pedestrian-geometry` only when one connected source component fully covers every leg and pedestrian access is explicit.
- Accepted evidence is limited to explicit OSM pedestrian line/surface geometry or official inventory geometry with `pedestrianAllowed=true`, `officialInventory=true`, source identity, complete geometry and compatible grade/access.
- Generic park containment, proximity, nearby `sidewalk=both`, provider snap, absence of barriers, terminal permission and the manual benchmark are not proof.
- New accounting keeps `mappedPathM`, `sourceSupportedM` and remaining `syntheticM` disjoint. Any unresolved synthetic distance retains `requiresOnSitePathConfirmation=true`.

## Verification before deployment

The supplied patch baseline hash matched the authoritative dev37.9.9.6.2 handoff. ZIP CRC, entry set, per-file SHA-256 and production source hash were independently checked. A fresh apply reproduced the supplied offline controls: 50 new provenance checks, 104 preserved regression checks and 5 syntax checks, all PASS. The real-source snapshot audit remains conservative: only 3 of 309 audited synthetic graph edges had full official coverage; these are graph-edge observations and are not claimed to belong to the 283.73 m min-sun route.

The specified 283.7325647287831 m live min-sun route was NOT reproduced by the supplied Node replay, so dev37.9.9.7 does not claim its blocker is solved. Live GitHub Pages acceptance must capture the actual min-sun candidate geometry/provenance after deployment.

## Cache wiring

- `src/pedestrian-graph-routing.js`: `core=37.9.9.7`
- `src/route-exposure.js`: preserved at `core=37.9.9.6.1`
- building/NLSC/shade cache keys unchanged.
