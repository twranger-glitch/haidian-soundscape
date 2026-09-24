/*
 * Haidian Soundscape — Nationwide Regression Matrix v9.0.0-dev34.5 — Connectivity-aware Endpoint Snap
 *
 * Developer-only regression harness. It never mutates the active production graph,
 * never changes the route winner, and never runs automatically during normal A→B.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev34.5";
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
    graphLoadStages: Array.isArray(rootConfig.nationwideTiles?.graphLoadStages) && rootConfig.nationwideTiles.graphLoadStages.length
      ? rootConfig.nationwideTiles.graphLoadStages
      : [{ marginM: 220, ring: 0 }, { marginM: 520, ring: 0 }, { marginM: 850, ring: 0 }, { marginM: 850, ring: 1 }],
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
    let hgr2Error = null;
    if (preferHgr2 && manifest?.graph2 && tileApi?._internals?.graph2Grid && tileApi?._internals?.tileIdsForBBoxGrid) {
      try {
        const grid = tileApi._internals.graph2Grid(manifest);
        const allIds = tileApi._internals.tileIdsForBBoxGrid(bbox, grid, options.ring ?? config.graphRing);
        const ids = allIds.filter((id) => Boolean(tileApi._internals.graph2PathFor?.(id, manifest)));
        if (ids.length > Number(options.maxTiles ?? config.maxGraphTiles)) throw new Error(`HGR2 regression request too broad: ${ids.length}`);
        const tiles = [];
        for (const id of ids) {
          const path = tileApi._internals.graph2PathFor(id, manifest);
          const url = tileApi?._internals?.resolveUrl ? tileApi._internals.resolveUrl(path, baseUrl) : new URL(path, baseUrl).href;
          try {
            const buf = await fetchBuffer(path, baseUrl, tileApi, options.requestTimeoutMs ?? config.requestTimeoutMs);
            tiles.push(tileApi.decodeHgr2(buf));
          } catch (error) {
            throw new Error(`HGR2 tile ${id} fetch/decode failed: ${String(error?.message || error)} @ ${url}`);
          }
        }
        if (tiles.length) return { available: true, backend: "nationwide-hgr2", bbox, requestedTileCount: allIds.length, loadedTileIds: ids, loadedTileCount: ids.length, graph: tileApi.mergeGraph2Tiles(tiles), hgr2Fallback: false, hgr2Error: null, productionGraphMutated: false };
      } catch (error) {
        hgr2Error = String(error?.message || error);
        if (options.fallbackToHgr1OnHgr2Error === false) throw error;
      }
    }
    const allIds = tileApi.tileIdsForBBox(bbox, { ring: options.ring ?? config.graphRing, manifest });
    const ids = allIds.filter((id) => Boolean(tileApi._internals.graphPathFor?.(id, manifest)));
    if (ids.length > Number(options.maxTiles ?? config.maxGraphTiles)) throw new Error(`HGR1 regression request too broad: ${ids.length}`);
    const tiles = [];
    try {
      for (const id of ids) {
        const path = tileApi._internals.graphPathFor(id, manifest);
        const url = tileApi?._internals?.resolveUrl ? tileApi._internals.resolveUrl(path, baseUrl) : new URL(path, baseUrl).href;
        try {
          const buf = await fetchBuffer(path, baseUrl, tileApi, options.requestTimeoutMs ?? config.requestTimeoutMs);
          tiles.push(tileApi.decodeHgr(buf));
        } catch (error) {
          throw new Error(`HGR1 tile ${id} fetch/decode failed: ${String(error?.message || error)} @ ${url}`);
        }
      }
    } catch (error) {
      if (hgr2Error) throw new Error(`HGR2 failed (${hgr2Error}); HGR1 fallback failed (${String(error?.message || error)})`);
      throw error;
    }
    return { available: tiles.length > 0, backend: "nationwide-hgr1", bbox, requestedTileCount: allIds.length, loadedTileIds: ids, loadedTileCount: ids.length, graph: tileApi.mergeGraphTiles(tiles), hgr2Fallback: Boolean(hgr2Error), hgr2Error, productionGraphMutated: false };
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
  function productionParityTopologyPath(graph, a, b, backend = null) {
    const legacy = shortestPath(graph, a, b);
    const internals = window.HaidianPedestrianGraph?._internals || {};
    const snapPointIntoFineGraph = internals.snapPointIntoFineGraph;
    const dijkstraTimes = internals.dijkstraTimes;
    const reconstructDijkstra = internals.reconstructDijkstra;
    const subsetExistingFineGraph = internals.subsetExistingFineGraph;
    const externalGraphToFineGraph = internals.externalGraphToFineGraph;
    const graphForConnectedEndpointSnap = internals.graphForConnectedEndpointSnap;
    if (typeof snapPointIntoFineGraph !== 'function' || typeof dijkstraTimes !== 'function') {
      return Object.assign({}, legacy, {
        probeMode: 'legacy-node-fallback',
        legacyNodeConnected: Boolean(legacy?.available),
        legacySnapA: Number.isFinite(Number(legacy?.snapA)) ? Number(legacy.snapA) : null,
        legacySnapB: Number.isFinite(Number(legacy?.snapB)) ? Number(legacy.snapB) : null,
        parityUnavailable: true
      });
    }
    let working = null;
    try {
      const isHgr2 = graph?.preRefinedFineGraph === true || graph?.hgr2 === true || String(backend || '').includes('hgr2');
      if (isHgr2 && typeof subsetExistingFineGraph === 'function') {
        working = subsetExistingFineGraph(graph, new Set(graph?.edges?.keys?.() || []));
      } else if (typeof externalGraphToFineGraph === 'function') {
        working = externalGraphToFineGraph(graph, { skipRefinement: true });
      }
      if (!working?.edges?.size) {
        return {
          available: false, reason: 'parity-working-graph-empty', probeMode: 'production-parity-edge',
          legacyNodeConnected: Boolean(legacy?.available),
          legacySnapA: Number.isFinite(Number(legacy?.snapA)) ? Number(legacy.snapA) : null,
          legacySnapB: Number.isFinite(Number(legacy?.snapB)) ? Number(legacy.snapB) : null
        };
      }
      const snapMaxM = Math.max(1, Number(rootConfig.graphRouting?.snapMaxM ?? 120) || 120);
      let endpointSnapPlan = null;
      if (typeof graphForConnectedEndpointSnap === 'function') {
        const selection = graphForConnectedEndpointSnap(working, a, b, snapMaxM, { connectivitySnapFallbackEnabled:true });
        endpointSnapPlan = selection?.plan || null;
        if (endpointSnapPlan && endpointSnapPlan.available === false) {
          return {
            available:false, reason:endpointSnapPlan.reason || 'no-common-snap-component', probeMode:'production-parity-edge',
            snapA:Number.isFinite(Number(endpointSnapPlan.nearestA)) ? Number(endpointSnapPlan.nearestA) : null,
            snapB:Number.isFinite(Number(endpointSnapPlan.nearestB)) ? Number(endpointSnapPlan.nearestB) : null,
            connectivitySnapPlan:endpointSnapPlan,
            legacyNodeConnected:Boolean(legacy?.available),
            legacySnapA:Number.isFinite(Number(legacy?.snapA)) ? Number(legacy.snapA) : null,
            legacySnapB:Number.isFinite(Number(legacy?.snapB)) ? Number(legacy.snapB) : null
          };
        }
        if (selection?.graph?.edges?.size) working = selection.graph;
      }
      const snapA = snapPointIntoFineGraph(working, a, 'regression-A', snapMaxM);
      const snapB = snapPointIntoFineGraph(working, b, 'regression-B', snapMaxM);
      if (!snapA || !snapB) {
        return {
          available: false, reason: 'parity-edge-snap-failed', probeMode: 'production-parity-edge',
          connectivitySnapPlan:endpointSnapPlan,
          snapA: snapA?.distanceM ?? null, snapB: snapB?.distanceM ?? null,
          snapTypeA: snapA?.snapType || null, snapTypeB: snapB?.snapType || null,
          legacyNodeConnected: Boolean(legacy?.available),
          legacySnapA: Number.isFinite(Number(legacy?.snapA)) ? Number(legacy.snapA) : null,
          legacySnapB: Number.isFinite(Number(legacy?.snapB)) ? Number(legacy.snapB) : null
        };
      }
      const speedMps = 1.25;
      const d = dijkstraTimes(working, snapA.id, speedMps, false);
      const seconds = Number(d?.dist?.get?.(String(snapB.id)));
      if (!Number.isFinite(seconds)) {
        return {
          available: false, reason: 'disconnected', probeMode: 'production-parity-edge',
          connectivitySnapPlan:endpointSnapPlan,
          snapA: Number(snapA.distanceM || 0), snapB: Number(snapB.distanceM || 0),
          snapTypeA: snapA.snapType || null, snapTypeB: snapB.snapType || null,
          reachableNodes: Number(d?.dist?.size || 0),
          legacyNodeConnected: Boolean(legacy?.available),
          legacySnapA: Number.isFinite(Number(legacy?.snapA)) ? Number(legacy.snapA) : null,
          legacySnapB: Number.isFinite(Number(legacy?.snapB)) ? Number(legacy.snapB) : null
        };
      }
      const route = typeof reconstructDijkstra === 'function' ? reconstructDijkstra(working, d.prev, snapA.id, snapB.id) : null;
      return {
        available: true, reason: null, probeMode: 'production-parity-edge',
        connectivitySnapPlan:endpointSnapPlan,
        distanceM: Number(route?.distanceM ?? (seconds * speedMps)),
        snapA: Number(snapA.distanceM || 0), snapB: Number(snapB.distanceM || 0),
        snapTypeA: snapA.snapType || null, snapTypeB: snapB.snapType || null,
        reachableNodes: Number(d?.dist?.size || 0),
        edgeIds: safeArray(route?.edgeIds),
        points: safeArray(route?.points).length >= 2 ? route.points : [asPoint(a), asPoint(b)].filter(Boolean),
        legacyNodeConnected: Boolean(legacy?.available),
        legacySnapA: Number.isFinite(Number(legacy?.snapA)) ? Number(legacy.snapA) : null,
        legacySnapB: Number.isFinite(Number(legacy?.snapB)) ? Number(legacy.snapB) : null
      };
    } catch (error) {
      return {
        available: false, reason: `parity-probe-error: ${String(error?.message || error)}`, probeMode: 'production-parity-edge',
        legacyNodeConnected: Boolean(legacy?.available),
        legacySnapA: Number.isFinite(Number(legacy?.snapA)) ? Number(legacy.snapA) : null,
        legacySnapB: Number.isFinite(Number(legacy?.snapB)) ? Number(legacy.snapB) : null
      };
    }
  }

  function syntheticExistingEdgeFeature(graph) {
    const edge = Array.from(graph?.edges?.values?.() || []).find((e) => safeArray(e?.geometry).length >= 2);
    if (!edge) return null;
    return { type: "Feature", id: "dev34-existing-edge", geometry: { type: "LineString", coordinates: edge.geometry.map((p) => [Number(p.lng), Number(p.lat)]) }, properties: { source: "nlma-sidewalk", sourceKey: "nlma-sidewalk", sourceFeatureId: "dev34-existing-edge", pedestrianAllowed: true, officialInventory: true } };
  }

  function normalizedGraphLoadStages(options = {}) {
    const raw = safeArray(options.graphLoadStages || config.graphLoadStages || rootConfig.nationwideTiles?.graphLoadStages);
    const fallback = [{ marginM: 220, ring: 0 }, { marginM: 520, ring: 0 }, { marginM: 850, ring: 0 }, { marginM: 850, ring: 1 }];
    return (raw.length ? raw : fallback).map((stage, index) => ({
      stage: index + 1,
      marginM: Math.max(0, Number(stage?.marginM ?? 220) || 0),
      ring: Math.max(0, Number(stage?.ring ?? 0) || 0)
    }));
  }

  async function loadGraphStaged(a, b, env, options = {}) {
    const attempts = [];
    let lastLoad = null, lastPath = null;

    async function probe(stage, preferHgr2, connectivityFallback = false) {
      let load = null, path = null, error = null;
      try {
        load = await loadGraphIndependent([a, b], env, {
          preferHgr2,
          // dev34.5: if this is the explicit connectivity fallback, do not let the
          // HGR1 probe bounce back into HGR2. The first probe still keeps the
          // dev34.2 fetch/decode -> HGR1 failover behavior.
          fallbackToHgr1OnHgr2Error: preferHgr2,
          marginM: stage.marginM,
          ring: stage.ring,
          maxTiles: options.maxGraphTiles ?? config.maxGraphTiles,
          requestTimeoutMs: options.requestTimeoutMs ?? config.requestTimeoutMs
        });
        if (load?.available && load?.graph?.edges?.size) path = productionParityTopologyPath(load.graph, a, b, load.backend);
      } catch (e) {
        error = String(e?.message || e);
      }
      const connected = Boolean(path?.available) && Number(path?.snapA) <= Number(config.snapToleranceM) && Number(path?.snapB) <= Number(config.snapToleranceM);
      const requestedBackend = preferHgr2 ? 'hgr2' : 'hgr1';
      attempts.push({
        stage: stage.stage, marginM: stage.marginM, ring: stage.ring,
        requestedBackend,
        connectivityFallback: Boolean(connectivityFallback),
        backend: load?.backend || null,
        hgr2Fallback: Boolean(load?.hgr2Fallback),
        hgr2Error: load?.hgr2Error || null,
        available: Boolean(load?.available),
        loadedTileCount: Number(load?.loadedTileCount || 0),
        nodeCount: Number(load?.graph?.nodes?.size || 0),
        edgeCount: Number(load?.graph?.edges?.size || 0),
        connected,
        routeDistanceM: Number.isFinite(Number(path?.distanceM)) ? Number(path.distanceM) : null,
        snapA: Number.isFinite(Number(path?.snapA)) ? Number(path.snapA) : null,
        snapB: Number.isFinite(Number(path?.snapB)) ? Number(path.snapB) : null,
        snapTypeA: path?.snapTypeA || null,
        snapTypeB: path?.snapTypeB || null,
        probeMode: path?.probeMode || null,
        reachableNodes: Number.isFinite(Number(path?.reachableNodes)) ? Number(path.reachableNodes) : null,
        connectivitySnapFallbackUsed: path?.connectivitySnapPlan?.fallbackUsed === true,
        connectivitySnapNearestA: Number.isFinite(Number(path?.connectivitySnapPlan?.nearestA)) ? Number(path.connectivitySnapPlan.nearestA) : null,
        connectivitySnapNearestB: Number.isFinite(Number(path?.connectivitySnapPlan?.nearestB)) ? Number(path.connectivitySnapPlan.nearestB) : null,
        connectivitySnapSelectedA: Number.isFinite(Number(path?.connectivitySnapPlan?.selectedA)) ? Number(path.connectivitySnapPlan.selectedA) : null,
        connectivitySnapSelectedB: Number.isFinite(Number(path?.connectivitySnapPlan?.selectedB)) ? Number(path.connectivitySnapPlan.selectedB) : null,
        connectivitySnapComponentEdges: Number.isFinite(Number(path?.connectivitySnapPlan?.componentEdgeCount)) ? Number(path.connectivitySnapPlan.componentEdgeCount) : null,
        connectivitySnapComponentNodes: Number.isFinite(Number(path?.connectivitySnapPlan?.componentNodeCount)) ? Number(path.connectivitySnapPlan.componentNodeCount) : null,
        legacyNodeConnected: path?.legacyNodeConnected === true,
        legacySnapA: Number.isFinite(Number(path?.legacySnapA)) ? Number(path.legacySnapA) : null,
        legacySnapB: Number.isFinite(Number(path?.legacySnapB)) ? Number(path.legacySnapB) : null,
        reason: error || path?.reason || (!load?.available ? load?.reason || 'graph-unavailable' : null)
      });
      if (load) lastLoad = load;
      if (path) lastPath = path;
      return { load, path, connected, error };
    }

    for (const stage of normalizedGraphLoadStages(options)) {
      const primary = await probe(stage, true, false);
      if (primary.connected) return { available: true, graphLoad: primary.load, path: primary.path, stage, attempts, productionGraphMutated: false };

      // dev34.5: HGR2 being fetchable is not the same as HGR2 being connected
      // for the current core window. Before widening the window, try the mature
      // HGR1 graph over the exact same bbox. This is a backend fallback only;
      // it does not change costs, detour limits, evidence, or production graph.
      if (primary.load?.backend === 'nationwide-hgr2') {
        const hgr1 = await probe(stage, false, true);
        if (hgr1.connected) return { available: true, graphLoad: hgr1.load, path: hgr1.path, stage, attempts, productionGraphMutated: false };
      }
    }
    return { available: false, graphLoad: lastLoad, path: lastPath, attempts, reason: lastPath?.reason || lastLoad?.reason || 'staged-graph-connectivity-failed', productionGraphMutated: false };
  }

  async function runCase(testCase, env, options = {}) {
    const started = nowMs(), checks = [], a = asPoint(testCase.a), b = asPoint(testCase.b);
    const required = testCase.required !== false;
    const staged = await loadGraphStaged(a, b, env, options);
    const graphLoad = staged.graphLoad;
    const path = staged.path || { available: false, reason: staged.reason || "disconnected" };
    const attemptText = safeArray(staged.attempts).map((x) => {
      const requested = x.requestedBackend ? `-${String(x.requestedBackend).toUpperCase()}` : '';
      const backend = x.backend ? `/${x.backend.replace('nationwide-', '')}` : '';
      const fallback = x.hgr2Fallback ? ` fetch-fallback(${x.hgr2Error || 'HGR2 error'})` : '';
      const connectivity = x.connectivityFallback ? ' connectivity-fallback' : '';
      const snaps = Number.isFinite(Number(x.snapA)) || Number.isFinite(Number(x.snapB)) ? ` snap ${Number(x.snapA || 0).toFixed(1)}/${Number(x.snapB || 0).toFixed(1)}m${x.snapTypeA || x.snapTypeB ? `(${x.snapTypeA || '?'}→${x.snapTypeB || '?'})` : ''}` : '';
      const legacy = x.probeMode === 'production-parity-edge' ? ` legacy-node=${x.legacyNodeConnected ? 'connected' : 'disconnected'}` : '';
      const reach = Number.isFinite(Number(x.reachableNodes)) ? ` reach=${Math.round(Number(x.reachableNodes))}` : '';
      const snapFallback = x.connectivitySnapFallbackUsed
        ? ` snap-rescue ${Number(x.connectivitySnapNearestA || 0).toFixed(1)}/${Number(x.connectivitySnapNearestB || 0).toFixed(1)}→${Number(x.connectivitySnapSelectedA || 0).toFixed(1)}/${Number(x.connectivitySnapSelectedB || 0).toFixed(1)}m c=${Math.round(Number(x.connectivitySnapComponentNodes || 0))}n/${Math.round(Number(x.connectivitySnapComponentEdges || 0))}e`
        : '';
      return `S${x.stage}${requested}:${x.loadedTileCount}t/${x.nodeCount}n/${x.edgeCount}e${backend} ${x.connected ? "connected" : (x.reason || "no-route")}${snaps}${snapFallback}${reach}${legacy}${fallback}${connectivity}`;
    }).join(" | ");
    if (!graphLoad?.available) {
      checks.push(assert("graph-availability", !required || testCase.scopeProbe, attemptText || staged.reason || "no graph", required ? "required" : "informational"));
      return { id: testCase.id, label: testCase.label, region: testCase.region, required, pass: checks.every((x) => x.severity !== "required" || x.pass), checks, graph: { available: false, attempts: staged.attempts }, elapsedMs: nowMs() - started };
    }
    const fpBefore = graphFingerprint(graphLoad.graph);
    checks.push(assert("graph-availability", true, `${graphLoad.backend} ${graphLoad.loadedTileCount} tiles; ${attemptText}`));
    checks.push(assert("graph-production-lock", graphLoad.graph?.productionGraphMutated !== true, "productionGraphMutated=false"));
    checks.push(assert("graph-connectivity", staged.available, staged.available ? `stage ${staged.stage.stage}; ${Math.round(path.distanceM)}m; snap ${path.snapA.toFixed(1)}/${path.snapB.toFixed(1)}m` : attemptText || path.reason));
    if (!staged.available) {
      return {
        id: testCase.id, label: testCase.label, region: testCase.region, required,
        pass: checks.every((x) => x.severity !== "required" || x.pass), checks,
        graph: { available: true, backend: graphLoad.backend, loadedTileCount: graphLoad.loadedTileCount, nodes: graphLoad.graph.nodes.size, edges: graphLoad.graph.edges.size, attempts: staged.attempts },
        elapsedMs: nowMs() - started
      };
    }
    const corridor = path.points.length >= 2 ? path.points : [a, b];
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
      const hgr1Path = hgr1.available ? productionParityTopologyPath(hgr1.graph, a, b, hgr1.backend) : { available: false };
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
      graph: { backend: graphLoad.backend, hgr2Fallback:Boolean(graphLoad.hgr2Fallback), hgr2Error:graphLoad.hgr2Error || null, loadedTileCount: graphLoad.loadedTileCount, nodes: graphLoad.graph.nodes.size, edges: graphLoad.graph.edges.size, stage: staged.stage?.stage || null, marginM: staged.stage?.marginM ?? null, ring: staged.stage?.ring ?? null, attempts: staged.attempts },
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
  window.HaidianNationwideRegression = { version: VERSION, get config() { return Object.assign({}, config); }, runMatrix, getState, _internals: { graphFingerprint, shortestPath, productionParityTopologyPath, loadGraphIndependent, loadEvidenceIndependent, syntheticExistingEdgeFeature, normalizedGraphLoadStages, loadGraphStaged, runCase } };
})();
