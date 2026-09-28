# ASTRA dev37.7 regional OSM building snapshots

These are five bounded snapshots, not nationwide data and not a survey of all actual buildings. Existing Tainan Overture/OSM service and its manifest/index remain unchanged.

| Region | OSM footprint features | Unknown height | Tiles | Geometry status |
|---|---:|---:|---:|---|
| Chenggong | 51 | 42 | 15 | downloaded geometry complete |
| Hualien | 8,634 | 8,156 | 28 | incomplete: 4 invalid source ways |
| Alishan | 92 | 91 | 10 | downloaded geometry complete |
| Magong | 254 | 197 | 19 | downloaded geometry complete |
| Tokyo | 8,273 | 7,207 | 42 | downloaded geometry complete |

`dev37.7/manifest.json` is authoritative for AOI, capture time, source URL/request list, source SHA256, geometry issues, tile index and each tile checksum. Some features cross tile boundaries and are deduplicated by `building_uid` at runtime. Coverage ends at the specified AOI. Empty unlisted tiles inside a complete AOI mean no mapped features, not proof that no real building exists. Missing geometry, unavailable tiles, missing height and outside-AOI results stay partial.

Source: © OpenStreetMap contributors, ODbL 1.0. Attribution and license: https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/ . The derived building database remains available in these GeoJSON tiles under ODbL 1.0. Retain attribution when redistributing. This does not alter existing Meta CHMv2 or Tainan source licenses.

The full handoff includes raw OSM responses, individual relation/way completion responses, actual HTTP metadata and conversion issues at `evidence/dev37.7/osm/` and `evidence/dev37.7/building-conversion.json`. Rebuild with `node scripts/build-dev37-7-regional.js` from the full handoff root. Network recapture is a separate explicit step (`capture-dev37-7-osm.js`, `capture-dev37-7-osm-split.js`, `complete-dev37-7-sources.js`); record changed upstream data and hashes rather than claiming bit-identical recapture.

Height `direct` means an explicit OSM tag, not independently surveyed accuracy. `floors-derived` uses mapped floors × 3.1 m. Unknown values remain unknown, even if a default column is drawn for context. `min_height` is the prism base and `height` its total top elevation above ground; do not add the base or `roof:height` again. Polygon holes, multiple outer rings and source IDs are preserved. Invalid rings are omitted with a counted, visible incomplete status; a courtyard is never filled by separately drawing its relation member ways.

Files are static, same-origin assets for GitHub Pages. Runtime prioritizes these indexed regional tiles, then the existing Tainan pipeline, then a bounded OSM fallback outside coverage. Do not replace the existing `DEPLOY/data` production graph with these building files.
