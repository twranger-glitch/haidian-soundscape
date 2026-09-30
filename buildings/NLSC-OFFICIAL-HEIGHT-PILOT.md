# NLSC official building-height pilot — dev37.9.5

This diagnostic pilot adds a local, static snapshot of NLSC I3S 3D-building height evidence to the existing building geometry pipeline.

## Scope
- Geometry remains from the existing Overture/OSM precision provider.
- NLSC contributes height evidence only.
- The pilot snapshot covers only the exported local bbox; it is not a Taiwan-wide completeness source.
- A height is attached only when exactly one NLSC official centroid falls inside exactly one eligible source-footprint polygon.
- Ambiguous matches, generalized geometry, and direct-height conflicts fail closed.
- Existing direct/reported heights are never overwritten.
- NLSC floor-count-derived evidence stays `floors-derived`; it is never promoted to direct/reported.

## Pilot snapshot
- Source: NLSC I3S public 3D building service
- Layer: 3 (`112_D`)
- Source snapshot created: 2026-09-30T14:13:27.978Z
- Evidence rows: 2,824
- Export conflicts: 0
- All current pilot rows carry `H_SOURCE=0` and `H_EXTRAC=0` in the exported source snapshot.

This file documents a diagnostic source-enrichment experiment. It does not claim source completeness outside the stored bbox.
