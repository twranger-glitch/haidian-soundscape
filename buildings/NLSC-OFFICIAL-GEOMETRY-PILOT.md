# NLSC official geometry-native caster pilot — dev37.9.6

This pilot adds a small same-origin set of official NLSC I3S building geometries with reported `BUILD_H` values as **additive positive caster evidence**.

## Safety semantics
- Existing Overture/OSM features are retained; this source does not replace them.
- The local geometry snapshot is partial and is **not** a completeness proof.
- Absence of an NLSC feature is never interpreted as open sky or direct sun.
- A route sample can only improve from unknown to shade when the existing shade engine positively confirms shade from an NLSC geometry feature with known official height.
- No nearest-centroid, average-height, max-height, or fabricated-height heuristic is used.
- Candidate generation, Realm search, route comparison, and uncertainty-bound logic are unchanged.

## Pilot dataset
- File: `nlsc-official-geometry-pilot-2026-09-30.geojson`
- Features: 104
- Source: NLSC I3S public 3D building service
- Geometry source: decoded I3S feature mesh / `faceRange`, then exact triangle union to building polygons
- Height source: NLSC `BUILD_H`
- Snapshot captured: 2026-09-30T15:51:50.671Z
- Coverage semantics: `local-pilot-positive-evidence-only`

## Pre-deploy impact diagnostic
Against the dev37.9.5 fused-route diagnostic capture:
- baseline building-unknown distance: 198.085 m
- positively confirmed NLSC shade: 154.174 m across 35 of 44 building-unknown segments
- projected remaining unknown: 43.912 m
- no diagnostic errors

These figures are acceptance evidence for the pilot integration, not a promise that every live rerun will produce identical route geometry or totals.
