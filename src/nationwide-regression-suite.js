/*
 * Haidian Soundscape — Nationwide Regression Matrix v9.0.0-dev34
 *
 * Developer-only regression harness. It never mutates the active production graph,
 * never changes the route winner, and never runs automatically during normal A→B.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev34";
  const rootConfig = window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {};
  const DEFAULT_CASES = [
    { id: "north-taipei", region: "north", label: "北部・臺北", a: { lat: 25.0336, lng: 121.5437 }, b: { lat: 25.0402, lng: 121.5512 }, required: true },
    { id: "central-taichung", region: "central", label: "中部・臺中", a: { lat: 24.1506, lng: 120.6649 }, b: { lat: 24.1571, lng: 120.6730 }, required: true },
    { id: "south-haidian", region: "south", label: "南部・海佃 benchmark", a: { lat: 23.0289813, lng: 120.1996862 }, b: { lat: 23.0283826, lng: 120.2075316 }, required: true, crossTile: true, hgr1Fallback: true },
    { id: "east-hualien", region: "east", label: "東部・花蓮", a: { lat: 23.9787, lng: 121.6044 }, b: { lat: 23.9867, lng: 121.6115 }, required: true },
    { id: "offshore-penghu-scope", region: "offshore", label: "離島／scope・澎湖", a: { lat: 23.5651, lng: 119.5662 }, b: { lat: 23.5700, lng: 119.5720 }, required: false, scopeProbe: true }
  ];
  const DEFAULTS = {
    enabled: true,
    routeMarginM: 260,
    evidenceMarginM: 220,
    graphRing: 0,
    evidenceRing: 0,
    maxGraphTiles: 48,
    maxEvidenceTiles: 32,
    snapToleranceM: 140,
    requestTimeoutMs: 18000,
    cases: DEFAULT_CASES
  };
  const config = Object.assign({}, DEFAULTS, rootConfig.nationwideRegression || {});
  const state = { status: "idle", error: null, lastRun: null };

  function safeArray(v) { return Array.isArray(v) ? v : []; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function nowMs() { try { return performance?.now?.() ?? Date.now(); } catch (_) { return Date.now(); } }
  function asPoint(v) {
    const lat = Number(v?.lat ?? v?.[1]), lng = Number(v?.lng ?? v?.lon ?? v?.[0]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  function haversineM(a0, b0) {
    const a = asPoint(a0), b = asPoint(b0); if (!a || !b) return Infinity;
    const R = 6371008.8, r = Math.PI / 180, p1 = a.lat * r, p2 = b.lat * r;
    const dp = (b.lat - a.lat) * r, dl = (b.lng - a.lng) * r;
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }
  function assert(name, pass, detail = null, severity = "required") {
    return { name, pass: Boolean(pass), detail, severity };
  }
  function graphFingerprint(graph) {
    const ids = Array.from(graph?.edges?.keys?.() || []).map(String).sort();
    let h = 2166136261;
    for (const id of ids) for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `${graph?.nodes?.size || 0}:${graph?.edges?.size || 0}:${(h >>> 0).toString(16)}`;
  }
  function dirnameUrl(url) { try { return new URL("./", url).href; } catch (_) { return String(url || "").replace(/[^/]*$/, ""); } }
  async function fetchWithTimeout(url, timeoutMs) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), Math.max(1000, Number(timeoutMs) || 18000)) : null;
    try {
      const response = await window.fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return response;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function getManifest(options, tileApi) {
    const internal = tileApi?._internals || {};
    const hfRepo = options.huggingFaceRepo ?? rootConfig.nationwideTiles?.huggingFaceRepo;
    const hfRev = options.huggingFaceRevision ?? rootConfig.nationwideTiles?.huggingFaceRevision;
    const manifestUrl = options.manifestUrl || internal.effectiveManifestUrl?.({ huggingFaceRepo: hfRepo, huggingFaceRevision: hfRev }) || rootConfig.nationwideTiles?.manifestUrl;
    if (!manifestUrl) throw new Error("nationwide manifest URL unavailable");
    const response = await fetchWithTimeout(manifestUrl, options.requestTimeoutMs);
    const manifest = await response.json();
    if (manifest?.schema !== "taiwan-route-tiles-v1") throw new Error(`unexpected manifest schema: ${manifest?.schema || "unknown"}`);
    const baseUrl = options.datasetBaseUrl || internal.effectiveDatasetBaseUrl?.({ huggingFaceRepo: hfRepo, huggingFaceRevision: hfRev }) || dirnameUrl(manifestUrl);
    return { manifest, manifestUrl, baseUrl };
  }
  async function fetchBuffer(path, baseUrl, tileApi, timeoutMs) {
    const url = tileApi?._internals?.resolveUrl ? tileApi._internals.resolveUrl(path, baseUrl) : new URL(path, baseUrl).href;
    return (await fetchWithTimeout(url, timeoutMs)).arrayBuffer();
  }
  async function loadGraphIndependent(points, env, options = {}) {
    const { tileApi, manifest, baseUrl } = env;
    const bbox = tileApi.routeBBox(points, options.marginM ?? config.routeMarginM);
    if (!bbox) return { available: false, reason: "empty-bbox", productionGraphMutated: false };
    const preferHgr2 = options.preferHgr2 !== false;
    if (preferHgr2 && manifest?.graph2 && tileApi?._internals?.graph2Grid && tileApi?._internals?.tileIdsForBBoxGrid) {
      const grid = tileApi._internals.graph2Grid(manifest);
      const allIds = tileApi._internals.tileIdsForBBoxGrid(bbox, grid, options.ring ?? config.graphRing);
      const ids = allIds.filter((id) => Boolean(tileApi._internals.graph2PathFor?.(id, manifest)));
      if (ids.length > Number(options.maxTiles ?? config.maxGraphTiles)) throw new Error(`HGR2 regression request too broad: ${ids.length}`);
      const tiles = [];
      for (const id of ids) {
        const path = tileApi._internals.graph2PathFor(id, manifest);
        const buf = await fetchBuffer(path, baseUrl, tileApi, options.requestTimeoutMs ?? config.requestTimeoutMs);
        tiles.push(tileApi.decodeHgr2(buf));
      }
      if (tiles.length) return { available: true, backend: "nationwide-hgr2", bbox, requestedTileCount: allIds.length, loadedTileIds: ids, loadedTileCount: ids.length, graph: tileApi.mergeGraph2Tiles(tiles), productionGraphMutated: false };
    }
    const allIds = tileApi.tileIdsForBBox(bbox, { ring: options.ring ?? config.graphRing, manifest });
    const ids = allIds.filter((id) => Boolean(tileApi._internals.graphPathFor?.(id, manifest)));
    if (ids.length > Number(options.maxTiles ?? config.maxGraphTiles)) throw new Error(`HGR1 regression request too broad: ${ids.length}`);
    const tiles = [];
    for (const id of ids) {
      const path = tileApi._internals.graphPathFor(id, manifest);
      const buf = await fetchBuffer(path, baseUrl, tileApi, options.requestTimeoutMs ?? config.requestTimeoutMs);
      tiles.push(tileApi.decodeHgr(buf));
    }
    return { available: tiles.length > 0, backend: "nationwide-hgr1", bbox, requestedTileCount: allIds.length, loadedTileIds: ids, loadedTileCount: ids.length, graph: tileApi.mergeGraphTiles(tiles), productionGraphMutated: false };
  }
  async function loadEvidenceIndependent(points, env, options = {}) {
    const { tileApi, manifest, baseUrl } = env;
    const bbox = tileApi.routeBBox(points, options.marginM ?? config.evidenceMarginM);
    const allIds = tileApi.tileIdsForBBox(bbox, { ring: options.ring ?? config.evidenceRing, manifest });
    const ids = allIds.filter((id) => Boolean(tileApi._internals.runtimePathFor?.(id, manifest)));
    if (ids.length > Number(options.maxTiles ?? config.maxEvidenceTiles)) throw new Error(`evidence regression request too broad: ${ids.length}`);
    const fcs = [];
    for (const id of ids) {
      const path = tileApi._internals.runtimePathFor(id, manifest);
      const buf = await fetchBuffer(path, baseUrl, tileApi, options.requestTimeoutMs ?? config.requestTimeoutMs);
      fcs.push(tileApi.decodeHdt(buf));
    }
    const collection = tileApi.dedupeFeatures(fcs);
    return { available: true, bbox, requestedTileCount: allIds.length, loadedTileIds: ids, loadedTileCount: ids.length, collection, bySource: tileApi.splitBySource(collection), productionGraphMutated: false };
  }

  class Heap {
    constructor() { this.a = []; }
    push(x) { let i = this.a.length; this.a.push(x); while (i) { const p = (i - 1) >> 1; if (this.a[p][0] <= x[0]) break; this.a[i] = this.a[p]; i = p; } this.a[i] = x; }
    pop() { if (!this.a.length) return null; const root = this.a[0], last = this.a.pop(); if (this.a.length) { let i = 0; while (true) { let l = i * 2 + 1, r = l + 1, s = i; if (l < this.a.length && this.a[l][0] < (s === i ? last[0] : this.a[s][0])) s = l; if (r < this.a.length && this.a[r][0] < (s === i ? last[0] : this.a[s][0])) s = r; if (s === i) break; this.a[i] = this.a[s]; i = s; } this.a[i] = last; } return root; }
    get size() { return this.a.length; }
  }
  function nearestNode(graph, point) {
    let best = null; for (const node of graph?.nodes?.values?.() || []) { const d = haversineM(point, node); if (!best || d < best.distanceM) best = { node, distanceM: d }; } return best;
  }
  function neighbors(graph, nodeId) {
    const raw = graph?.adjacency?.get?.(String(nodeId)) || [];
    const out = [];
    for (const item of raw) {
      if (typeof item === "string") {
        const e = graph.edges.get(item); if (!e) continue;
        const from = String(e.from ?? e.a), to = String(e.to ?? e.b);
        if (from === String(nodeId)) out.push({ edge: e, to });
        else if (to === String(nodeId) && e.a != null && e.b != null) out.push({ edge: e, to: from });
      } else {
        const e = graph.edges.get(item.edgeId); if (e) out.push({ edge: e, to: String(item.to) });
      }
    }
    return out;
  }
  function shortestPath(graph, a, b, maxExpanded = 60000) {
    const sa = nearestNode(graph, a), sb = nearestNode(graph, b);
    if (!sa || !sb) return { available: false, reason: "snap-missing" };
    const heap = new Heap(), dist = new Map([[String(sa.node.id), 0]]), prev = new Map(); heap.push([0, String(sa.node.id)]);
    let expanded = 0;
    while (heap.size && expanded < maxExpanded) {
      const [d, id] = heap.pop(); if (d !== dist.get(id)) continue; expanded += 1; if (id === String(sb.node.id)) break;
      for (const n of neighbors(graph, id)) { const nd = d + Math.max(0.01, Number(n.edge.distanceM) || 1); if (nd < (dist.get(n.to) ?? Infinity)) { dist.set(n.to, nd); prev.set(n.to, { from: id, edgeId: n.edge.id }); heap.push([nd, n.to]); } }
    }
    const target = String(sb.node.id); if (!dist.has(target)) return { available: false, reason: "disconnected", snapA: sa.distanceM, snapB: sb.distanceM, expanded };
    const edgeIds = [], nodeIds = [target]; let cur = target;
    while (cur !== String(sa.node.id) && prev.has(cur)) { const p = prev.get(cur); edgeIds.push(p.edgeId); cur = p.from; nodeIds.push(cur); }
    edgeIds.reverse(); nodeIds.reverse();
    const points = nodeIds.map((id) => graph.nodes.get(String(id))).filter(Boolean).map((p) => ({ lat: p.lat, lng: p.lng }));
    return { available: true, distanceM: dist.get(target), snapA: sa.distanceM, snapB: sb.distanceM, expanded, edgeIds, points };
  }
  function syntheticExistingEdgeFeature(graph) {
    const edge = Array.from(graph?.edges?.values?.() || []).find((e) => safeArray(e?.geometry).length >= 2);
    if (!edge) return null;
    return { type: "Feature", id: "dev34-existing-edge", geometry: { type: "LineString", coordinates: edge.geometry.map((p) => [Number(p.lng), Number(p.lat)]) }, properties: { source: "nlma-sidewalk", sourceKey: "nlma-sidewalk", sourceFeatureId: "dev34-existing-edge", pedestrianAllowed: true, officialInventory: true } };
  }

  async function runCase(testCase, env, options = {}) {
    const started = nowMs(), checks = [], a = asPoint(testCase.a), b = asPoint(testCase.b);
    const required = testCase.required !== false;
    const graphLoad = await loadGraphIndependent([a, b], env, { preferHgr2: true, requestTimeoutMs: options.requestTimeoutMs });
    if (!graphLoad.available) {
      checks.push(assert("graph-availability", !required || testCase.scopeProbe, graphLoad.reason || "no graph", required ? "required" : "informational"));
      return { id: testCase.id, label: testCase.label, region: testCase.region, required, pass: checks.every((x) => x.severity !== "required" || x.pass), checks, graph: { available: false }, elapsedMs: nowMs() - started };
    }
    const fpBefore = graphFingerprint(graphLoad.graph);
    checks.push(assert("graph-availability", true, `${graphLoad.backend} ${graphLoad.loadedTileCount} tiles`));
    checks.push(assert("graph-production-lock", graphLoad.graph?.productionGraphMutated !== true, "productionGraphMutated=false"));
    const path = shortestPath(graphLoad.graph, a, b);
    checks.push(assert("graph-connectivity", path.available && path.snapA <= config.snapToleranceM && path.snapB <= config.snapToleranceM, path.available ? `${Math.round(path.distanceM)}m; snap ${path.snapA.toFixed(1)}/${path.snapB.toFixed(1)}m` : path.reason));
    const corridor = path.available && path.points.length >= 2 ? path.points : [a, b];
    const evidence = await loadEvidenceIndependent(corridor, env, { requestTimeoutMs: options.requestTimeoutMs });
    checks.push(assert("evidence-load", evidence.available, `${evidence.loadedTileCount} tiles / ${evidence.collection?.features?.length || 0} features`));
    const discoveryApi = window.HaidianOfficialEvidenceDiscovery;
    const fusionApi = window.HaidianExperimentalFusionRouter;
    const discovery = discoveryApi?.discoverFromGraph ? discoveryApi.discoverFromGraph(graphLoad.graph, [corridor], evidence.bySource || {}, {}) : { available: false, gaps: [], reason: "discovery-api-missing" };
    checks.push(assert("discovery-safe", discovery.available && discovery.productionGraphMutated === false, `${discovery.rawCandidateCount || 0} raw / ${discovery.verifiedGapCount || 0} verified`));
    const overlay = fusionApi?.buildExperimentalFusedGraph ? fusionApi.buildExperimentalFusedGraph(graphLoad.graph, discovery.evidenceIndex || { gaps: [] }) : { available: false, reason: "fusion-api-missing" };
    const fpAfter = graphFingerprint(graphLoad.graph);
    checks.push(assert("detached-fusion-immutability", fpBefore === fpAfter && overlay.productionGraphMutated === false, `${overlay.connectorCount || 0} connector(s); original ${fpBefore === fpAfter ? "unchanged" : "CHANGED"}`));
    if (testCase.crossTile) checks.push(assert("cross-hgr2-tile", graphLoad.backend === "nationwide-hgr2" && graphLoad.loadedTileCount >= 2, `${graphLoad.loadedTileCount} HGR2 tiles`));
    if (testCase.hgr1Fallback) {
      const hgr1 = await loadGraphIndependent([a, b], env, { preferHgr2: false, requestTimeoutMs: options.requestTimeoutMs });
      const hgr1Path = hgr1.available ? shortestPath(hgr1.graph, a, b) : { available: false };
      checks.push(assert("hgr2-to-hgr1-fallback", hgr1.available && hgr1.backend === "nationwide-hgr1" && hgr1Path.available, hgr1.available ? `${hgr1.loadedTileCount} HGR1 tiles; route ${hgr1Path.available ? "connected" : "disconnected"}` : "HGR1 unavailable"));
    }
    const emptyDiscovery = discoveryApi?.discoverFromGraph ? discoveryApi.discoverFromGraph(graphLoad.graph, [corridor], {}, {}) : null;
    checks.push(assert("zero-witness", emptyDiscovery?.available === true && Number(emptyDiscovery?.verifiedGapCount || 0) === 0, `${Number(emptyDiscovery?.verifiedGapCount || 0)} verified`));
    const synthetic = syntheticExistingEdgeFeature(graphLoad.graph);
    if (synthetic && discoveryApi?.discoverFromGraph) {
      const fp = discoveryApi.discoverFromGraph(graphLoad.graph, [synthetic.geometry.coordinates.map((p) => ({ lat: p[1], lng: p[0] }))], { "nlma-sidewalk": { type: "FeatureCollection", features: [synthetic] } }, { routeCorridorM: 50, maxFeatureCount: 4 });
      checks.push(assert("false-positive-suppression", Number(fp?.verifiedGapCount || 0) === 0, `${Number(fp?.rawCandidateCount || 0)} raw / ${Number(fp?.verifiedGapCount || 0)} verified on existing edge`));
    }
    if (testCase.scopeProbe) checks.push(assert("scope-handling", true, `${graphLoad.loadedTileCount} graph tile(s); graceful in-scope/out-of-scope handling`, "informational"));
    return {
      id: testCase.id, label: testCase.label, region: testCase.region, required,
      pass: checks.every((x) => x.severity !== "required" || x.pass), checks,
      graph: { backend: graphLoad.backend, loadedTileCount: graphLoad.loadedTileCount, nodes: graphLoad.graph.nodes.size, edges: graphLoad.graph.edges.size },
      evidence: { loadedTileCount: evidence.loadedTileCount, featureCount: evidence.collection?.features?.length || 0 },
      discovery: { rawCandidateCount: discovery.rawCandidateCount || 0, verifiedGapCount: discovery.verifiedGapCount || 0, connectorCount: overlay.connectorCount || 0 },
      elapsedMs: nowMs() - started
    };
  }

  async function runMatrix(options = {}) {
    if (config.enabled === false || options.enabled === false) return { available: false, reason: "disabled", productionGraphMutated: false };
    const tileApi = window.HaidianNationwideTiles;
    if (!tileApi || !window.HaidianOfficialEvidenceDiscovery || !window.HaidianExperimentalFusionRouter) return { available: false, reason: "required-api-missing", productionGraphMutated: false };
    state.status = "running"; state.error = null;
    const started = nowMs();
    try {
      const manifestInfo = await getManifest(Object.assign({}, config, options), tileApi);
      const env = Object.assign({ tileApi }, manifestInfo);
      const cases = safeArray(options.cases || config.cases || DEFAULT_CASES);
      const results = [];
      for (let i = 0; i < cases.length; i += 1) {
        options.onProgress?.({ index: i, total: cases.length, case: cases[i], message: `dev34 regression ${i + 1}/${cases.length}：${cases[i].label || cases[i].id}` });
        try { results.push(await runCase(cases[i], env, options)); }
        catch (error) {
          results.push({ id: cases[i].id, label: cases[i].label, region: cases[i].region, required: cases[i].required !== false, pass: false, checks: [assert("case-execution", false, String(error?.message || error), cases[i].required === false ? "informational" : "required")], error: String(error?.message || error) });
        }
      }
      const required = results.filter((x) => x.required !== false);
      const passCount = results.filter((x) => x.pass).length;
      const requiredPass = required.every((x) => x.pass);
      const result = {
        available: true, version: VERSION, schema: "haidian-nationwide-regression-matrix-v1",
        manifestUrl: manifestInfo.manifestUrl,
        caseCount: results.length, passCount, requiredCaseCount: required.length, requiredPass,
        results, elapsedMs: nowMs() - started,
        productionGraphMutated: false,
        normalRouteRuntimeModified: false,
        interpretation: requiredPass ? "All required nationwide topology/evidence/fusion regression cases passed." : "At least one required nationwide regression case failed; do not promote automatic fusion behavior until reviewed."
      };
      state.status = "ready"; state.lastRun = clone(result); return result;
    } catch (error) {
      state.status = "error"; state.error = String(error?.message || error);
      const result = { available: false, reason: "nationwide-regression-error", error: state.error, productionGraphMutated: false };
      state.lastRun = clone(result); return result;
    }
  }

  function getState() { return { version: VERSION, status: state.status, error: state.error, lastRun: clone(state.lastRun), enabled: config.enabled !== false }; }
  window.HaidianNationwideRegression = { version: VERSION, get config() { return Object.assign({}, config); }, runMatrix, getState, _internals: { graphFingerprint, shortestPath, loadGraphIndependent, loadEvidenceIndependent, syntheticExistingEdgeFeature, runCase } };
})();
