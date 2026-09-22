/*
 * Haidian Soundscape — Taiwan Nationwide Tile Loader v9.0.0-dev28 Performance Pass
 *
 * Loads only the official GIS tiles needed near the active route.  Full national
 * archives stay on the dataset host (recommended: Hugging Face Dataset); the
 * browser consumes compact HDTL-v1 tiles and never parses the 95 MB+ archives.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev28";
  const DEFAULTS = {
    enabled: true,
    // Set huggingFaceRepo (e.g. "owner/taiwan-route-tiles") after publishing.
    // When empty, the bundled Haidian sample remains the offline regression source.
    huggingFaceRepo: "",
    huggingFaceRevision: "main",
    manifestUrl: "./data/nationwide-sample/manifest.json",
    datasetBaseUrl: "./data/nationwide-sample/",
    requestTimeoutMs: 15000,
    routeBufferM: 180,
    neighborRing: 0,
    maxTilesPerRequest: 96,
    attachToMultisource: true,
    cacheTiles: true
  };
  const globalConfig = window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {};
  const config = Object.assign({}, DEFAULTS, globalConfig.nationwideTiles || {});

  const state = {
    status: "idle",
    error: null,
    manifest: null,
    manifestUrl: null,
    baseUrl: null,
    tileCache: new Map(),
    graphTileCache: new Map(),
    lastLoad: null,
    lastGraphLoad: null
  };

  const MAGIC = "HDTL";
  const HEADER_BYTES = 40;
  const FEATURE_BYTES = 28;
  const COORD_SCALE = 1000000;

  function nowMs() {
    try { return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now(); }
    catch (_) { return Date.now(); }
  }
  function safeArray(value) { return Array.isArray(value) ? value : []; }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function timeoutFetch(url, options = {}) {
    const fetchImpl = options.fetchImpl || window.fetch?.bind(window);
    if (!fetchImpl) return Promise.reject(new Error("fetch unavailable"));
    const timeoutMs = Number(options.timeoutMs ?? config.requestTimeoutMs) || 15000;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    return fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined).finally(() => { if (timer) clearTimeout(timer); });
  }

  async function fetchJson(url, options = {}) {
    const response = await timeoutFetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
  }

  async function fetchArrayBuffer(url, options = {}) {
    const response = await timeoutFetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.arrayBuffer();
  }

  function dirnameUrl(url) {
    try { return new URL("./", url).href; }
    catch (_) {
      const text = String(url || "");
      const at = text.lastIndexOf("/");
      return at >= 0 ? text.slice(0, at + 1) : "./";
    }
  }

  function resolveUrl(path, base) {
    if (/^https?:\/\//i.test(String(path || ""))) return String(path);
    try { return new URL(String(path || ""), base || window.location?.href || "http://localhost/").href; }
    catch (_) { return `${String(base || "").replace(/\/?$/, "/")}${String(path || "").replace(/^\//, "")}`; }
  }

  function huggingFaceBaseUrl(repo = config.huggingFaceRepo, revision = config.huggingFaceRevision) {
    const id = String(repo || "").trim().replace(/^\/+|\/+$/g, "");
    if (!id) return null;
    const rev = encodeURIComponent(String(revision || "main").trim() || "main");
    return `https://huggingface.co/datasets/${id}/resolve/${rev}/`;
  }

  function effectiveDatasetBaseUrl(options = {}) {
    if (options.datasetBaseUrl) return String(options.datasetBaseUrl);
    const hf = huggingFaceBaseUrl(options.huggingFaceRepo ?? config.huggingFaceRepo, options.huggingFaceRevision ?? config.huggingFaceRevision);
    return hf || config.datasetBaseUrl;
  }

  function effectiveManifestUrl(options = {}) {
    if (options.manifestUrl) return String(options.manifestUrl);
    const hf = huggingFaceBaseUrl(options.huggingFaceRepo ?? config.huggingFaceRepo, options.huggingFaceRevision ?? config.huggingFaceRevision);
    return hf ? `${hf}manifest.json` : config.manifestUrl;
  }

  function grid(manifest = state.manifest) {
    const g = manifest?.grid || {};
    return {
      tileSizeDeg: Number(g.tileSizeDeg || 0.05),
      originLon: Number(g.originLon ?? 118),
      originLat: Number(g.originLat ?? 21)
    };
  }

  function tileXY(lon, lat, manifest = state.manifest) {
    const g = grid(manifest);
    const x = Math.floor((Number(lon) - g.originLon) / g.tileSizeDeg + 1e-12);
    const y = Math.floor((Number(lat) - g.originLat) / g.tileSizeDeg + 1e-12);
    return { x, y };
  }

  function axisId(value) { return value < 0 ? `m${String(Math.abs(value)).padStart(4, "0")}` : `p${String(value).padStart(4, "0")}`; }
  function tileId(x, y) { return `x${axisId(x)}_y${axisId(y)}`; }

  function parseAxis(text) {
    if (text[0] === "p") return Number(text.slice(1));
    if (text[0] === "m") return -Number(text.slice(1));
    throw new Error(`invalid tile axis: ${text}`);
  }

  function parseTileId(id) {
    const parts = String(id).split("_");
    if (parts.length !== 2 || parts[0][0] !== "x" || parts[1][0] !== "y") throw new Error(`invalid tile id: ${id}`);
    return { x: parseAxis(parts[0].slice(1)), y: parseAxis(parts[1].slice(1)) };
  }

  function tileBBox(id, manifest = state.manifest) {
    const { x, y } = typeof id === "string" ? parseTileId(id) : id;
    const g = grid(manifest);
    const west = g.originLon + x * g.tileSizeDeg;
    const south = g.originLat + y * g.tileSizeDeg;
    return [west, south, west + g.tileSizeDeg, south + g.tileSizeDeg];
  }

  function tileIdsForBBox(bbox, options = {}) {
    const [west, south, east, north] = safeArray(bbox).map(Number);
    if (![west, south, east, north].every(Number.isFinite) || west > east || south > north) return [];
    const ring = Math.max(0, Number(options.ring ?? config.neighborRing) || 0);
    const a = tileXY(west, south, options.manifest || state.manifest);
    const b = tileXY(east - 1e-12, north - 1e-12, options.manifest || state.manifest);
    const out = [];
    for (let y = a.y - ring; y <= b.y + ring; y++) {
      for (let x = a.x - ring; x <= b.x + ring; x++) out.push(tileId(x, y));
    }
    return out;
  }

  function routeBBox(points, marginM = config.routeBufferM) {
    const pts = safeArray(points).map((p) => ({ lat: Number(p?.lat ?? p?.[1]), lng: Number(p?.lng ?? p?.lon ?? p?.[0]) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!pts.length) return null;
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), midLat = (minLat + maxLat) / 2;
    const latPad = Math.max(0, Number(marginM) || 0) / 110540;
    const lonPad = Math.max(0, Number(marginM) || 0) / (111320 * Math.max(0.2, Math.cos(midLat * Math.PI / 180)));
    return [Math.min(...lngs) - lonPad, minLat - latPad, Math.max(...lngs) + lonPad, maxLat + latPad];
  }

  function readString(view, bytes, offsets, index) {
    if (index < 0 || index + 1 >= offsets.length) return "";
    const start = offsets[index], end = offsets[index + 1];
    return new TextDecoder("utf-8").decode(bytes.subarray(start, end));
  }

  function decodeHdt(input) {
    const buffer = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    if (buffer.byteLength < HEADER_BYTES) throw new Error("HDTL tile too short");
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== MAGIC) throw new Error(`invalid HDTL magic: ${magic}`);
    const version = view.getUint16(4, true);
    if (version !== 1) throw new Error(`unsupported HDTL version: ${version}`);
    const originLonE6 = view.getInt32(8, true), originLatE6 = view.getInt32(12, true);
    const coordCount = view.getUint32(16, true), partCount = view.getUint32(20, true), groupCount = view.getUint32(24, true);
    const featureCount = view.getUint32(28, true), stringCount = view.getUint32(32, true), stringBytes = view.getUint32(36, true);
    let pos = HEADER_BYTES;
    const coords = new Array(coordCount);
    for (let i = 0; i < coordCount; i++, pos += 8) {
      coords[i] = [(originLonE6 + view.getInt32(pos, true)) / COORD_SCALE, (originLatE6 + view.getInt32(pos + 4, true)) / COORD_SCALE];
    }
    const parts = new Array(partCount);
    for (let i = 0; i < partCount; i++, pos += 8) parts[i] = [view.getUint32(pos, true), view.getUint32(pos + 4, true)];
    const groups = new Array(groupCount);
    for (let i = 0; i < groupCount; i++, pos += 8) groups[i] = [view.getUint32(pos, true), view.getUint32(pos + 4, true)];
    const frecs = new Array(featureCount);
    for (let i = 0; i < featureCount; i++, pos += FEATURE_BYTES) {
      frecs[i] = {
        geomType: view.getUint8(pos), flags: view.getUint8(pos + 1), source: view.getUint16(pos + 2, true), facility: view.getUint16(pos + 4, true),
        fid: view.getUint32(pos + 8, true), name: view.getUint32(pos + 12, true), county: view.getUint32(pos + 16, true),
        groupStart: view.getUint32(pos + 20, true), groupCount: view.getUint16(pos + 24, true)
      };
    }
    const offsets = new Array(stringCount + 1);
    for (let i = 0; i <= stringCount; i++, pos += 4) offsets[i] = view.getUint32(pos, true);
    const stringBlob = u8.subarray(pos, pos + stringBytes);
    if (stringBlob.length !== stringBytes) throw new Error("truncated HDTL string table");
    const strings = new Array(stringCount);
    for (let i = 0; i < stringCount; i++) strings[i] = readString(view, stringBlob, offsets, i);
    const str = (i) => strings[i] || "";
    const partCoords = (idx) => {
      const p = parts[idx]; if (!p) return [];
      return coords.slice(p[0], p[0] + p[1]);
    };
    const features = [];
    for (const r of frecs) {
      const gs = groups.slice(r.groupStart, r.groupStart + r.groupCount);
      let geometry = null;
      if (r.geomType === 1) {
        const p = gs[0] ? partCoords(gs[0][0]) : []; geometry = { type: "Point", coordinates: p[0] || null };
      } else if (r.geomType === 2) {
        geometry = { type: "LineString", coordinates: gs[0] ? partCoords(gs[0][0]) : [] };
      } else if (r.geomType === 3) {
        const lines = []; for (const g of gs) for (let i = 0; i < g[1]; i++) lines.push(partCoords(g[0] + i));
        geometry = { type: "MultiLineString", coordinates: lines };
      } else if (r.geomType === 4) {
        const rings = []; if (gs[0]) for (let i = 0; i < gs[0][1]; i++) rings.push(partCoords(gs[0][0] + i));
        geometry = { type: "Polygon", coordinates: rings };
      } else if (r.geomType === 5) {
        const polys = []; for (const g of gs) { const rings = []; for (let i = 0; i < g[1]; i++) rings.push(partCoords(g[0] + i)); polys.push(rings); }
        geometry = { type: "MultiPolygon", coordinates: polys };
      }
      if (!geometry) continue;
      const sourceKey = str(r.source), fid = str(r.fid);
      features.push({
        type: "Feature", id: fid, geometry,
        properties: {
          source: sourceKey, sourceKey, sourceFeatureId: fid,
          facilityType: str(r.facility), name: str(r.name) || null, county: str(r.county) || null,
          pedestrianAllowed: (r.flags & 1) ? true : null,
          bicycleAllowed: (r.flags & 2) ? true : null,
          officialInventory: Boolean(r.flags & 4)
        }
      });
    }
    return { type: "FeatureCollection", features, metadata: { format: "HDTL-v1", coordCount, featureCount, stringCount } };
  }


  function decodeHgr(input) {
    const buffer = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    if (buffer.byteLength < HEADER_BYTES) throw new Error("HGR1 tile too short");
    const view = new DataView(buffer), u8 = new Uint8Array(buffer);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== "HGR1") throw new Error(`invalid HGR1 magic: ${magic}`);
    const version = view.getUint16(4, true);
    if (version !== 1) throw new Error(`unsupported HGR1 version: ${version}`);
    const originLonE6 = view.getInt32(8, true), originLatE6 = view.getInt32(12, true);
    const nodeCount = view.getUint32(16, true), edgeCount = view.getUint32(20, true), coordCount = view.getUint32(24, true);
    const stringCount = view.getUint32(28, true), stringBytes = view.getUint32(32, true);
    let pos = HEADER_BYTES;
    const nodeRaw = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++, pos += 12) nodeRaw[i] = { dx: view.getInt32(pos, true), dy: view.getInt32(pos + 4, true), sid: view.getUint32(pos + 8, true) };
    const edgeRaw = new Array(edgeCount);
    for (let i = 0; i < edgeCount; i++, pos += 28) edgeRaw[i] = {
      from: view.getUint32(pos, true), to: view.getUint32(pos + 4, true), distanceM: view.getFloat32(pos + 8, true),
      geomStart: view.getUint32(pos + 12, true), geomCount: view.getUint16(pos + 16, true), flags: view.getUint16(pos + 18, true),
      source: view.getUint32(pos + 20, true), roadClass: view.getUint32(pos + 24, true)
    };
    const coords = new Array(coordCount);
    for (let i = 0; i < coordCount; i++, pos += 8) coords[i] = [(originLonE6 + view.getInt32(pos, true)) / COORD_SCALE, (originLatE6 + view.getInt32(pos + 4, true)) / COORD_SCALE];
    const offsets = new Array(stringCount + 1);
    for (let i = 0; i <= stringCount; i++, pos += 4) offsets[i] = view.getUint32(pos, true);
    const blob = u8.subarray(pos, pos + stringBytes);
    if (blob.length !== stringBytes) throw new Error("truncated HGR1 string table");
    const decoder = new TextDecoder("utf-8"), strings = new Array(stringCount);
    for (let i = 0; i < stringCount; i++) strings[i] = decoder.decode(blob.subarray(offsets[i], offsets[i + 1]));
    const str = (i) => strings[i] || "";
    const nodes = nodeRaw.map((n) => ({ id: str(n.sid), lng: (originLonE6 + n.dx) / COORD_SCALE, lat: (originLatE6 + n.dy) / COORD_SCALE }));
    const edges = edgeRaw.map((e, index) => ({
      id: `${str(e.source)}:${nodes[e.from]?.id || e.from}>${nodes[e.to]?.id || e.to}:${index}`,
      from: nodes[e.from]?.id, to: nodes[e.to]?.id, distanceM: e.distanceM, sourceId: str(e.source), roadClass: str(e.roadClass),
      pedestrianAllowed: Boolean(e.flags & 1), bicycleAllowed: Boolean(e.flags & 2), experimental: Boolean(e.flags & 4),
      geometry: coords.slice(e.geomStart, e.geomStart + e.geomCount).map(([lng, lat]) => ({ lat, lng }))
    }));
    return { format: "HGR1", nodes, edges, metadata: { nodeCount, edgeCount, coordCount, stringCount } };
  }

  function graphPathFor(tileIdValue, manifest = state.manifest) {
    const rec = manifest?.tiles?.[tileIdValue];
    return rec?.graph?.path || rec?.graph || null;
  }

  async function loadGraphTile(tileIdValue, options = {}) {
    if (config.cacheTiles !== false && state.graphTileCache.has(tileIdValue)) return state.graphTileCache.get(tileIdValue);
    const manifest = state.manifest || await loadManifest(options);
    const path = graphPathFor(tileIdValue, manifest);
    if (!path) return null;
    const url = resolveUrl(path, options.datasetBaseUrl || state.baseUrl || effectiveDatasetBaseUrl(options));
    const decoded = decodeHgr(await fetchArrayBuffer(url, options));
    decoded.metadata = Object.assign({}, decoded.metadata, { tileId: tileIdValue, url });
    if (config.cacheTiles !== false) state.graphTileCache.set(tileIdValue, decoded);
    return decoded;
  }

  function mergeGraphTiles(tiles) {
    const nodes = new Map(), edges = new Map(), adjacency = new Map();
    for (const tile of safeArray(tiles)) {
      for (const n of safeArray(tile?.nodes)) if (n?.id && !nodes.has(n.id)) nodes.set(n.id, { id: n.id, lat: n.lat, lng: n.lng });
      for (const e0 of safeArray(tile?.edges)) {
        if (!e0?.from || !e0?.to) continue;
        const stable = `${e0.sourceId || ""}|${e0.from}|${e0.to}|${Math.round(Number(e0.distanceM || 0) * 10)}`;
        if (edges.has(stable)) continue;
        const e = Object.assign({}, e0, { id: stable });
        edges.set(stable, e);
        if (!adjacency.has(e.from)) adjacency.set(e.from, []);
        adjacency.get(e.from).push(stable);
      }
    }
    return { nodes, edges, adjacency, nationwideTileGraph: true, productionGraphMutated: false };
  }

  async function loadGraphForBBox(bbox, options = {}) {
    const started = nowMs();
    let t = nowMs();
    const manifest = state.manifest || await loadManifest(options);
    const manifestMs = nowMs() - t;
    const allIds = tileIdsForBBox(bbox, { ring: options.ring ?? config.neighborRing, manifest });
    const ids = allIds.filter((id) => Boolean(graphPathFor(id, manifest)));
    const maxTiles = Math.max(1, Number(options.maxTiles ?? config.maxTilesPerRequest) || 96);
    if (ids.length > maxTiles) throw new Error(`nationwide graph request too broad: ${ids.length} > ${maxTiles}`);
    t = nowMs();
    const graphTiles = (await Promise.all(ids.map((id) => loadGraphTile(id, options)))).filter(Boolean);
    const tileFetchMs = nowMs() - t;
    t = nowMs();
    const graph = mergeGraphTiles(graphTiles);
    const mergeMs = nowMs() - t;
    state.lastGraphLoad = { bbox: safeArray(bbox).map(Number), requestedTileCount:allIds.length, loadedTileIds: ids, loadedTileCount: ids.length, nodeCount: graph.nodes.size, edgeCount: graph.edges.size, performance:{ manifestMs, tileFetchMs, mergeMs, totalMs:nowMs()-started }, productionGraphMutated: false };
    return { available: ids.length > 0, graph, ...state.lastGraphLoad };
  }

  async function loadGraphForPolyline(points, options = {}) {
    const bbox = routeBBox(points, options.marginM ?? config.routeBufferM);
    if (!bbox) return { available: false, reason: "empty-polyline", productionGraphMutated: false };
    return loadGraphForBBox(bbox, options);
  }

  async function loadManifest(options = {}) {
    if (state.manifest && options.reload !== true) return state.manifest;
    if (!config.enabled) throw new Error("nationwide tiles disabled");
    state.status = "loading-manifest"; state.error = null;
    const url = effectiveManifestUrl(options);
    try {
      const manifest = await fetchJson(url, options);
      if (manifest?.schema !== "taiwan-route-tiles-v1") throw new Error(`unexpected nationwide manifest schema: ${manifest?.schema}`);
      state.manifest = manifest;
      state.manifestUrl = url;
      state.baseUrl = options.datasetBaseUrl || effectiveDatasetBaseUrl(options) || dirnameUrl(resolveUrl(url, window.location?.href));
      state.status = "ready";
      return manifest;
    } catch (error) {
      state.status = "error"; state.error = String(error?.message || error); throw error;
    }
  }

  function runtimePathFor(tileIdValue, manifest = state.manifest) {
    const rec = manifest?.tiles?.[tileIdValue];
    return rec?.runtime?.path || rec?.runtime || null;
  }

  async function loadTile(tileIdValue, options = {}) {
    if (config.cacheTiles !== false && state.tileCache.has(tileIdValue)) return state.tileCache.get(tileIdValue);
    const manifest = state.manifest || await loadManifest(options);
    const path = runtimePathFor(tileIdValue, manifest);
    if (!path) return null;
    const url = resolveUrl(path, options.datasetBaseUrl || state.baseUrl || effectiveDatasetBaseUrl(options));
    const decoded = decodeHdt(await fetchArrayBuffer(url, options));
    decoded.metadata = Object.assign({}, decoded.metadata, { tileId: tileIdValue, url });
    if (config.cacheTiles !== false) state.tileCache.set(tileIdValue, decoded);
    return decoded;
  }

  function dedupeFeatures(collections) {
    const out = [], seen = new Set();
    for (const fc of safeArray(collections)) {
      for (const f of safeArray(fc?.features)) {
        const p = f?.properties || {};
        const key = `${p.sourceKey || p.source || ""}|${f.id || p.sourceFeatureId || JSON.stringify(f.geometry)}`;
        if (seen.has(key)) continue;
        seen.add(key); out.push(f);
      }
    }
    return { type: "FeatureCollection", features: out };
  }

  function splitBySource(fc) {
    const groups = {};
    for (const f of safeArray(fc?.features)) {
      const key = f?.properties?.sourceKey || f?.properties?.source || "unknown";
      (groups[key] ||= []).push(f);
    }
    return Object.fromEntries(Object.entries(groups).map(([key, features]) => [key, { type: "FeatureCollection", features }]));
  }

  async function attachCollections(groups) {
    if (config.attachToMultisource === false) return false;
    const api = window.HaidianMultiSourceEvidence;
    if (!api?.setRuntimeSourceGeojson) return false;
    for (const [key, fc] of Object.entries(groups || {})) api.setRuntimeSourceGeojson(key, fc, { origin: "nationwide-tile-loader" });
    return true;
  }

  async function loadEvidenceForBBox(bbox, options = {}) {
    const manifest = state.manifest || await loadManifest(options);
    const allIds = tileIdsForBBox(bbox, { ring: options.ring ?? config.neighborRing, manifest });
    const ids = allIds.filter((id) => Boolean(manifest?.tiles?.[id]));
    const maxTiles = Math.max(1, Number(options.maxTiles ?? config.maxTilesPerRequest) || 96);
    if (ids.length > maxTiles) throw new Error(`nationwide tile request too broad: ${ids.length} > ${maxTiles}`);
    state.status = "loading-tiles"; state.error = null;
    try {
      const started = nowMs();
      let t = nowMs();
      const collections = (await Promise.all(ids.map((id) => loadTile(id, options)))).filter(Boolean);
      const tileFetchMs = nowMs() - t;
      t = nowMs();
      const merged = dedupeFeatures(collections);
      const bySource = splitBySource(merged);
      const attached = options.attach === false ? false : await attachCollections(bySource);
      const mergeAttachMs = nowMs() - t;
      state.lastLoad = { bbox: safeArray(bbox).map(Number), requestedTileCount: allIds.length, loadedTileIds: ids, loadedTileCount: ids.length, featureCount: merged.features.length, sourceCounts: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.features.length])), attached, performance:{tileFetchMs,mergeAttachMs,totalMs:nowMs()-started} };
      state.status = "ready";
      return { available: true, manifest, collection: merged, bySource, ...state.lastLoad };
    } catch (error) {
      state.status = "error"; state.error = String(error?.message || error); throw error;
    }
  }

  async function loadEvidenceForPolyline(points, options = {}) {
    const bbox = routeBBox(points, options.marginM ?? config.routeBufferM);
    if (!bbox) return { available: false, reason: "empty-polyline" };
    return loadEvidenceForBBox(bbox, options);
  }

  function clearCache() { state.tileCache.clear(); state.graphTileCache.clear(); }
  function getState() {
    return {
      version: VERSION, status: state.status, error: state.error,
      manifestLoaded: Boolean(state.manifest), manifestUrl: state.manifestUrl,
      baseUrl: state.baseUrl, cachedTileCount: state.tileCache.size, cachedGraphTileCount: state.graphTileCache.size,
      tileCount: Number(state.manifest?.summary?.tileCount || state.manifest?.tileCount || Object.keys(state.manifest?.tiles || {}).length || 0),
      lastLoad: clone(state.lastLoad), lastGraphLoad: clone(state.lastGraphLoad)
    };
  }

  window.HaidianNationwideTiles = {
    version: VERSION,
    get config() { return Object.assign({}, config); },
    loadManifest, loadTile, loadEvidenceForBBox, loadEvidenceForPolyline,
    loadGraphTile, loadGraphForBBox, loadGraphForPolyline, mergeGraphTiles,
    tileXY, tileId, parseTileId, tileBBox, tileIdsForBBox, routeBBox,
    decodeHdt, decodeHgr, dedupeFeatures, splitBySource, clearCache, getState,
    _internals: { resolveUrl, dirnameUrl, runtimePathFor, graphPathFor, huggingFaceBaseUrl, effectiveDatasetBaseUrl, effectiveManifestUrl }
  };
})();
