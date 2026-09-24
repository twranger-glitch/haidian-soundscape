/*
 * Haidian Soundscape — Local OSM Pedestrian Graph Routing v9.0.0-dev35.4 (dev32 correctness + dev34.5 connectivity locked + stable semantic shade warm cache)
 *
 * Purpose:
 * - fetch the local OpenStreetMap pedestrian network with Overpass;
 * - build a real walkable graph instead of guessing via-points;
 * - find the fastest path and a least-direct-sun path under a detour cap;
 * - reject loop tricks structurally by searching simple paths (no repeated nodes).
 *
 * This is a browser-side research prototype. It is intentionally bounded to a
 * small A→B corridor so it can run on GitHub Pages without a routing server.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev35.4";

  const DEFAULTS = {
    enabled: true,
    overpassEndpoints: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter"
    ],
    overpassTimeoutMs: 22000,
    bboxMarginM: 420,
    maxBboxSideM: 2800,
    snapMaxM: 120,
    snapEndpointToleranceM: 1.5,
    pedestrianSnapSlackM: 12,
    manualReplayCorridorM: 16,
    manualReplayMaxCorridorM: 36,
    manualReplayProgressBucketM: 10,
    manualReplayBacktrackToleranceM: 12,
    manualReplayGoalToleranceM: 28,
    manualReplayMinCoverage: 0.88,
    manualReplayFidelityThresholdM: 14,
    manualReplayDivergenceSampleM: 6,
    topologyBreakpointProbeM: 14,
    topologyBreakpointMaxCandidates: 8,
    endpointCounterfactualRadiusM: 24,
    endpointCounterfactualMaxCandidates: 8,
    maxRawNodes: 18000,
    maxContractedNodes: 5000,
    maxFineNodes: 12000,
    maxExpandedStates: 12000,
    maxShadeEdgeEvaluations: 1400,
    timeBucketSec: 30,
    shadeTimeBucketSec: 60,
    maxFineEdgeM: 85,
    pathMaxFineEdgeM: 55,
    maxLabelsPerState: 5, // legacy compatibility only; dev7 no longer truncates nondominated labels
    shadeSampleSpacingM: 18,
    shadeMaxSamplesPerEdge: 5,
    shadeReconcileSampleSpacingM: 10,
    shadeReconcileMismatchSec: 45,
    shadeReconcileTopEdges: 8,
    // dev19: diagnostic-only source-gap overlay. These joins are never written
    // into the production graph; they only test whether the raw OSM junction
    // gaps proven by dev17 are sufficient to explain the missing faithful route.
    sourceGapCounterfactualEnabled: true,
    sourceGapCounterfactualMaxGapM: 55,
    sourceGapCounterfactualStrictM: 14,
    // dev20.1: the graph API still supports the full dev19 causal rerun, but the
    // UI can defer it so the mature-engine benchmark becomes available quickly.
    deferSourceGapCounterfactual: false,
    // dev20: production connectors remain disabled.  The policy below only
    // classifies source gaps and permits live mature-engine corroboration.
    safeConnectorNearTouchM: 2.5,
    safeConnectorReviewGapM: 12,
    matureEngineCrossCheckEnabled: true,
    matureEngineTimeoutMs: 15000,
    matureEngineShapeMaxPoints: 180,
    valhallaBenchmarkEndpoint: "https://valhalla1.openstreetmap.de",
    valhallaClientId: "haidian-route-exposure-research",
    valhallaMinIntervalMs: 1100, // public FOSSGIS demo fair-use: <= 1 request/sec
    graphHopperBenchmarkEndpoint: "https://graphhopper.com/api/1",
    graphHopperApiKey: "",
    diagnosticMatchThresholdM: 16,
    diagnosticSampleSpacingM: 18,
    shadeConcurrency: 3,
    // dev32: deterministic temporal shade table on the pruned graph.
    temporalShadeTableEnabled: true,
    temporalShadeTableConcurrency: 8,
    temporalShadeTableMaxBucketsPerEdge: 8,
    temporalShadeTableMaxEvaluations: 1800,
    // dev35.2: safe cross-analysis warm reuse. Entries are namespaced by the
    // current ShadeMap route-model token + edge-sampling semantics, retained
    // only for reliable (non-partial) shade results, and bounded in-session.
    sessionShadeWarmCacheEnabled: true,
    sessionShadeWarmCacheTtlMs: 30 * 60 * 1000,
    sessionShadeWarmCacheMaxEntries: 5000,
    sessionShadeWarmCacheMaxNamespaces: 4,
    // dev32: replay the temporal winner at exact edge-midpoint times and expose
    // a bounded A/B correctness audit without changing production selection.
    candidateCorrectnessExactReplayEnabled: true,
    candidateCorrectnessExactReplayToleranceSec: 45,
    candidateCorrectnessAuditEnabled: true,
    // Fallback misses may still evaluate independent outgoing edges concurrently.
    shadeEdgeBatchConcurrency: 4,
    canopyTimeoutMs: 4200,
    progressEvery: 20,
    cooperativeYieldMs: 12,
    yieldEveryExpanded: 8,
    yieldEveryDijkstra: 180,
    // dev29: prune nationwide source edges that cannot participate in any path
    // under the active detour cap before expensive fine-edge splitting.
    externalGraphDetourPrune: true,
    externalGraphPruneSlackSec: 3
  };

  const globalConfig = window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {};
  const config = Object.assign({}, DEFAULTS, globalConfig.graphRouting || {});

  let lastDiagnostics = null;
  let lastGraphDebug = null;
  let lastRouteEdges = { fastest: new Set(), minSun: new Set() };
  const lastShadeDebug = new Map();
  const graphCache = new Map();
  // dev35.2: browser-session shade cache. Production searches still receive a
  // per-analysis Map; this store only seeds/commits reliable resolved values so
  // a transient canopy/building partial result can never poison a later query.
  const sessionShadeWarmCaches = new Map();
  let lastOrderedMapMatchFailure = null;

  function nowMs() {
    try { return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now(); }
    catch (_) { return Date.now(); }
  }

  function asLatLng(value) {
    if (!value) return null;
    const lat = Number(value.lat ?? value[0]);
    const lng = Number(value.lng ?? value.lon ?? value[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  function haversineM(a, b) {
    const A = asLatLng(a);
    const B = asLatLng(b);
    if (!A || !B) return Infinity;
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const p1 = A.lat * rad;
    const p2 = B.lat * rad;
    const dphi = (B.lat - A.lat) * rad;
    const dlambda = (B.lng - A.lng) * rad;
    const s = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }

  function routeDistanceM(points) {
    let total = 0;
    for (let i = 1; i < (points || []).length; i += 1) total += haversineM(points[i - 1], points[i]);
    return total;
  }

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function perfNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function yieldToBrowser() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function makeCooperativeYielder(options = {}) {
    const budgetMs = Math.max(4, Number(options.cooperativeYieldMs || config.cooperativeYieldMs || 12));
    let last = perfNow();
    return async function cooperativeYield(force = false) {
      const now = perfNow();
      if (!force && now - last < budgetMs) return false;
      await yieldToBrowser();
      last = perfNow();
      return true;
    };
  }

  function bboxForAB(a, b, marginM) {
    const A = asLatLng(a);
    const B = asLatLng(b);
    if (!A || !B) throw new Error("A/B 座標不完整。");
    const midLat = (A.lat + B.lat) / 2;
    const latM = 110540;
    const lngM = 111320 * Math.max(0.2, Math.cos(midLat * Math.PI / 180));
    const maxSide = Math.max(800, Number(config.maxBboxSideM) || 2800);
    const spanNS = Math.abs(B.lat - A.lat) * latM;
    const spanEW = Math.abs(B.lng - A.lng) * lngM;
    if (spanNS > maxSide || spanEW > maxSide) {
      throw new Error(`目前瀏覽器版 OSM Graph 原型只建議用於約 ${Math.round(maxSide / 100) / 10} km 內的 A→B。`);
    }
    const requested = Math.max(180, Number(marginM) || 420);
    const marginNS = Math.min(requested, Math.max(80, (maxSide - spanNS) / 2));
    const marginEW = Math.min(requested, Math.max(80, (maxSide - spanEW) / 2));
    return {
      south: Math.min(A.lat, B.lat) - marginNS / latM,
      north: Math.max(A.lat, B.lat) + marginNS / latM,
      west: Math.min(A.lng, B.lng) - marginEW / lngM,
      east: Math.max(A.lng, B.lng) + marginEW / lngM
    };
  }

  function bboxKey(bbox) {
    return [bbox.south, bbox.west, bbox.north, bbox.east].map((n) => Number(n).toFixed(4)).join(",");
  }

  function overpassQuery(bbox) {
    const bb = `${bbox.south.toFixed(6)},${bbox.west.toFixed(6)},${bbox.north.toFixed(6)},${bbox.east.toFixed(6)}`;
    return `[out:json][timeout:20];\n(\n  way["highway"](${bb});\n);\n(._;>;);\nout body;`;
  }

  async function fetchOverpass(bbox, options = {}) {
    const endpoints = Array.isArray(options.endpoints) && options.endpoints.length
      ? options.endpoints
      : config.overpassEndpoints;
    const query = overpassQuery(bbox);
    let lastError = null;
    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || config.overpassTimeoutMs));
      try {
        options.onProgress?.({ stage: "overpass", message: "正在讀取 OSM 步行路網…", endpoint });
        const response = await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            Accept: "application/json"
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || !Array.isArray(payload.elements)) {
          throw new Error(`Overpass HTTP ${response.status}`);
        }
        return { payload, endpoint };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastError?.name === "AbortError") throw new Error("OSM 步行路網查詢逾時。 ");
    throw new Error(`OSM 步行路網暫時無法取得：${lastError?.message || "unknown error"}`);
  }

  function normalizedTag(value) {
    return String(value || "").trim().toLowerCase();
  }


  function compactTagSummary(tags = {}) {
    const keys = ["highway", "foot", "access", "oneway", "oneway:foot", "bicycle", "cycleway", "service", "name", "surface", "lit", "bridge", "tunnel", "layer", "incline", "steps"];
    const out = {};
    for (const key of keys) {
      const value = tags?.[key];
      if (value != null && String(value).trim() !== "") out[key] = String(value);
    }
    return out;
  }

  function mergeWayTagSummaries(wayIds, wayMeta) {
    const values = {};
    for (const wayId of wayIds || []) {
      const tags = wayMeta?.get(String(wayId))?.tags || {};
      for (const [key, value] of Object.entries(compactTagSummary(tags))) {
        if (!values[key]) values[key] = new Set();
        values[key].add(value);
      }
    }
    const out = {};
    for (const [key, set] of Object.entries(values)) out[key] = Array.from(set).slice(0, 6);
    return out;
  }

  function primaryHighway(edge) {
    const values = edge?.tagsSummary?.highway || [];
    const priority = ["footway", "path", "pedestrian", "steps", "cycleway", "track", "living_street", "service", "residential", "unclassified", "tertiary", "secondary", "primary"];
    for (const item of priority) if (values.includes(item)) return item;
    return values[0] || "unknown";
  }

  function highwayFamily(highway) {
    const h = normalizedTag(highway);
    if (["footway", "path", "pedestrian", "steps", "cycleway", "track"].includes(h)) return "path";
    if (["service", "living_street", "residential", "unclassified", "road"].includes(h)) return "local-road";
    return "road";
  }

  // v9.0.0-dev8+: terminal snapping is walking-first, not motor-road-first.
  // Distance remains a hard local constraint: pedestrian preference only breaks
  // ties among edges within a small slack of the geometrically nearest edge.
  function pedestrianSnapRank(tags = {}) {
    const h = normalizedTag(tags.highway);
    const foot = normalizedTag(tags.foot);
    if (["yes", "designated", "permissive"].includes(foot) && ["cycleway", "track", "service", "residential", "unclassified", "tertiary", "secondary", "primary"].includes(h)) return 0;
    if (["footway", "path", "pedestrian", "steps"].includes(h)) return 0;
    if (h === "cycleway") return 1;
    if (h === "track") return 2;
    if (["living_street", "service", "residential"].includes(h)) return 3;
    if (["unclassified", "road", "tertiary", "tertiary_link"].includes(h)) return 4;
    if (["secondary", "secondary_link"].includes(h)) return 5;
    if (["primary", "primary_link"].includes(h)) return 6;
    return 7;
  }

  function pedestrianSnapLabel(tags = {}) {
    const h = normalizedTag(tags.highway) || "unknown";
    const rank = pedestrianSnapRank(tags);
    if (rank <= 0) return `${h} · 行人優先`;
    if (rank === 1) return `${h} · 共享步行優先`;
    if (rank <= 3) return `${h} · 慢速/地方道路`;
    return `${h} · 一般道路`;
  }

  function isPedestrianWay(tags = {}) {
    const highway = normalizedTag(tags.highway);
    if (!highway || highway === "construction" || highway === "proposed" || highway === "raceway") return false;

    const access = normalizedTag(tags.access);
    const foot = normalizedTag(tags.foot);
    if (["no", "private"].includes(foot)) return false;
    if (["no", "private"].includes(access) && !["yes", "designated", "permissive", "destination"].includes(foot)) return false;

    const blocked = new Set(["motorway", "motorway_link", "trunk", "trunk_link"]);
    if (blocked.has(highway) && !["yes", "designated", "permissive"].includes(foot)) return false;

    const allowed = new Set([
      "footway", "path", "pedestrian", "steps", "living_street", "residential",
      "service", "unclassified", "tertiary", "tertiary_link", "secondary",
      "secondary_link", "primary", "primary_link", "track", "cycleway", "road"
    ]);
    return allowed.has(highway) || ["yes", "designated", "permissive"].includes(foot);
  }

  function parseOverpass(payload) {
    const nodes = new Map();
    const ways = [];
    for (const element of payload?.elements || []) {
      if (element.type === "node" && Number.isFinite(Number(element.lat)) && Number.isFinite(Number(element.lon))) {
        nodes.set(String(element.id), { id: String(element.id), lat: Number(element.lat), lng: Number(element.lon) });
      } else if (element.type === "way" && Array.isArray(element.nodes) && element.nodes.length >= 2 && isPedestrianWay(element.tags || {})) {
        ways.push({ id: String(element.id), nodes: element.nodes.map(String), tags: element.tags || {} });
      }
    }
    return { nodes, ways };
  }

  function addRawNeighbor(adjacency, a, b, meta) {
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    const map = adjacency.get(a);
    const existing = map.get(b);
    if (!existing || meta.distanceM < existing.distanceM) map.set(b, meta);
  }

  function buildRawGraph(parsed) {
    const adjacency = new Map();
    const wayMeta = new Map();
    let rawSegments = 0;
    for (const way of parsed.ways) {
      wayMeta.set(String(way.id), { id: String(way.id), tags: Object.assign({}, way.tags || {}), nodeIds: (way.nodes || []).map(String) });
      for (let i = 1; i < way.nodes.length; i += 1) {
        const aId = way.nodes[i - 1];
        const bId = way.nodes[i];
        const a = parsed.nodes.get(aId);
        const b = parsed.nodes.get(bId);
        if (!a || !b) continue;
        const distanceM = haversineM(a, b);
        if (!(distanceM > 0.2 && distanceM < 1500)) continue;
        const meta = { distanceM, wayId: way.id, tags: way.tags };
        // Pedestrian routing is generally bidirectional. Do not inherit motor-vehicle oneway.
        const footOneway = normalizedTag(way.tags?.["oneway:foot"]);
        if (footOneway === "yes" || footOneway === "1" || footOneway === "true") {
          addRawNeighbor(adjacency, aId, bId, meta);
        } else if (footOneway === "-1" || footOneway === "reverse") {
          addRawNeighbor(adjacency, bId, aId, meta);
        } else {
          addRawNeighbor(adjacency, aId, bId, meta);
          addRawNeighbor(adjacency, bId, aId, meta);
        }
        rawSegments += 1;
      }
    }
    return { nodes: parsed.nodes, adjacency, rawSegments, wayMeta };
  }

  function nearestNode(raw, point, maxM = Infinity) {
    const P = asLatLng(point);
    if (!P) return null;
    let best = null;
    for (const [id, node] of raw.nodes) {
      if (!raw.adjacency.has(id)) continue;
      const distanceM = haversineM(P, node);
      if (distanceM <= maxM && (!best || distanceM < best.distanceM)) best = { id, node, distanceM };
    }
    return best;
  }

  function undirectedKey(a, b) {
    return String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
  }

  function contractGraph(raw, forcedTerminals = []) {
    // v9.0.0-dev4: build the undirected topology once.  The old code scanned
    // every adjacency list for every node to discover incoming links (O(V²)),
    // which could freeze the browser on denser Overpass responses.
    const undirectedAdj = new Map();
    function ensureUndirected(id) { if (!undirectedAdj.has(id)) undirectedAdj.set(id, new Set()); }
    for (const [a, neighbors] of raw.adjacency) {
      ensureUndirected(a);
      for (const b of neighbors.keys()) {
        ensureUndirected(b);
        undirectedAdj.get(a).add(b);
        undirectedAdj.get(b).add(a);
      }
    }

    const terminals = new Set(forcedTerminals.map(String));
    for (const [id, neighbors] of undirectedAdj) {
      if (neighbors.size !== 2) terminals.add(id);
    }

    // Pure cycles have no degree != 2 nodes. Seed one terminal per component.
    const seenComponent = new Set();
    for (const id of undirectedAdj.keys()) {
      if (seenComponent.has(id)) continue;
      const stack = [id];
      const component = [];
      let hasTerminal = false;
      seenComponent.add(id);
      while (stack.length) {
        const cur = stack.pop();
        component.push(cur);
        if (terminals.has(cur)) hasTerminal = true;
        for (const n of undirectedAdj.get(cur) || []) {
          if (!seenComponent.has(n)) { seenComponent.add(n); stack.push(n); }
        }
      }
      if (!hasTerminal && component.length) terminals.add(component[0]);
    }

    const nodes = new Map();
    const adjacency = new Map();
    const edges = new Map();
    const visitedRaw = new Set();
    let edgeCounter = 0;

    function addContractedNode(id) {
      if (!nodes.has(id) && raw.nodes.has(id)) nodes.set(id, raw.nodes.get(id));
      if (!adjacency.has(id)) adjacency.set(id, []);
    }

    function addEdge(aId, bId, geometry, wayIds) {
      if (aId === bId || geometry.length < 2) return;
      let distanceM = 0;
      for (let i = 1; i < geometry.length; i += 1) distanceM += haversineM(geometry[i - 1], geometry[i]);
      if (!(distanceM > 0.2)) return;
      addContractedNode(aId);
      addContractedNode(bId);
      const id = `g${++edgeCounter}`;
      const ids = Array.from(wayIds || []);
      const edge = { id, a: aId, b: bId, geometry, distanceM, wayIds: ids, tagsSummary: mergeWayTagSummaries(ids, raw.wayMeta) };
      edges.set(id, edge);
      adjacency.get(aId).push({ edgeId: id, to: bId });
      adjacency.get(bId).push({ edgeId: id, to: aId });
    }

    for (const start of terminals) {
      addContractedNode(start);
      for (const first of undirectedAdj.get(start) || []) {
        const firstKey = undirectedKey(start, first);
        if (visitedRaw.has(firstKey)) continue;
        const geometry = [raw.nodes.get(start), raw.nodes.get(first)].filter(Boolean).map((p) => ({ lat: p.lat, lng: p.lng }));
        const wayIds = new Set();
        const directMeta = raw.adjacency.get(start)?.get(first) || raw.adjacency.get(first)?.get(start);
        if (directMeta?.wayId) wayIds.add(directMeta.wayId);
        visitedRaw.add(firstKey);
        let prev = start;
        let cur = first;
        let guard = 0;
        while (!terminals.has(cur) && guard++ < 10000) {
          const choices = Array.from(undirectedAdj.get(cur) || []).filter((n) => n !== prev);
          if (!choices.length) break;
          const next = choices[0];
          const key = undirectedKey(cur, next);
          if (visitedRaw.has(key)) break;
          const meta = raw.adjacency.get(cur)?.get(next) || raw.adjacency.get(next)?.get(cur);
          if (meta?.wayId) wayIds.add(meta.wayId);
          visitedRaw.add(key);
          const p = raw.nodes.get(next);
          if (p) geometry.push({ lat: p.lat, lng: p.lng });
          prev = cur;
          cur = next;
        }
        if (terminals.has(cur)) addEdge(start, cur, geometry, wayIds);
      }
    }

    return { nodes, adjacency, edges, terminals, rawNodeCount: raw.nodes.size, rawSegmentCount: raw.rawSegments };
  }

  function interpolatePoint(a, b, fraction) {
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  }

  function splitGeometryByMaxLength(geometry, maxEdgeM) {
    const pts = (geometry || []).map(asLatLng).filter(Boolean);
    if (pts.length < 2) return [];
    const limit = Math.max(15, Number(maxEdgeM) || 80);
    const chunks = [];
    let current = [{ lat: pts[0].lat, lng: pts[0].lng }];
    let currentLen = 0;

    for (let i = 1; i < pts.length; i += 1) {
      let start = { lat: pts[i - 1].lat, lng: pts[i - 1].lng };
      const end = { lat: pts[i].lat, lng: pts[i].lng };
      let remaining = haversineM(start, end);
      let guard = 0;
      while (remaining > 0.01 && guard++ < 10000) {
        const room = limit - currentLen;
        if (remaining <= room + 0.01) {
          current.push(end);
          currentLen += remaining;
          remaining = 0;
        } else {
          const cut = interpolatePoint(start, end, room / remaining);
          current.push(cut);
          if (current.length >= 2) chunks.push(current);
          current = [cut];
          currentLen = 0;
          start = cut;
          remaining = haversineM(start, end);
        }
      }
    }
    if (current.length >= 2 && routeDistanceM(current) > 0.2) chunks.push(current);
    return chunks;
  }

  function refineGraph(contracted, options = {}) {
    const skipRefinement = options.skipRefinement === true;
    const generalMax = skipRefinement ? Infinity : Math.max(30, Number(options.maxFineEdgeM || config.maxFineEdgeM || 85));
    const pathMax = skipRefinement ? Infinity : Math.max(25, Number(options.pathMaxFineEdgeM || config.pathMaxFineEdgeM || 55));
    const nodes = new Map();
    const adjacency = new Map();
    const edges = new Map();
    let virtualCounter = 0;
    let edgeCounter = 0;

    function addNode(id, point, meta = {}) {
      const key = String(id);
      if (!nodes.has(key)) nodes.set(key, Object.assign({ id: key, lat: point.lat, lng: point.lng }, meta));
      if (!adjacency.has(key)) adjacency.set(key, []);
      return key;
    }
    function addEdge(aId, bId, geometry, source) {
      const distanceM = routeDistanceM(geometry);
      if (!(distanceM > 0.2)) return;
      const id = `f${++edgeCounter}`;
      const edge = {
        id, a: String(aId), b: String(bId), geometry: geometry.map((p) => ({ lat: p.lat, lng: p.lng })),
        distanceM, wayIds: (source.wayIds || []).slice(), tagsSummary: source.tagsSummary || {},
        sourceEdgeId: source.id, sourceDistanceM: source.distanceM
      };
      edges.set(id, edge);
      adjacency.get(String(aId)).push({ edgeId: id, to: String(bId) });
      adjacency.get(String(bId)).push({ edgeId: id, to: String(aId) });
    }

    for (const [id, node] of contracted.nodes) addNode(id, node, { sourceNodeId: id });

    for (const edge of contracted.edges.values()) {
      const family = highwayFamily(primaryHighway(edge));
      const limit = family === "path" ? pathMax : generalMax;
      const chunks = splitGeometryByMaxLength(edge.geometry, limit);
      if (!chunks.length) continue;
      let fromId = String(edge.a);
      for (let ci = 0; ci < chunks.length; ci += 1) {
        const chunk = chunks[ci];
        const isLast = ci === chunks.length - 1;
        const endPoint = chunk[chunk.length - 1];
        const toId = isLast ? String(edge.b) : `v:${edge.id}:${++virtualCounter}`;
        if (!isLast) addNode(toId, endPoint, { virtual: true, sourceEdgeId: edge.id });
        addEdge(fromId, toId, chunk, edge);
        fromId = toId;
      }
    }

    return {
      nodes, adjacency, edges, terminals: contracted.terminals,
      rawNodeCount: contracted.rawNodeCount, rawSegmentCount: contracted.rawSegmentCount,
      contractedNodeCount: contracted.nodes.size, contractedEdgeCount: contracted.edges.size,
      refinement: { generalMaxEdgeM: generalMax, pathMaxEdgeM: pathMax }
    };
  }

  class MinHeap {
    constructor(compare) { this.data = []; this.compare = compare || ((a, b) => a.priority - b.priority); }
    get size() { return this.data.length; }
    push(item) {
      const a = this.data;
      a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.compare(a[p], item) <= 0) break;
        a[i] = a[p]; i = p;
      }
      a[i] = item;
    }
    pop() {
      const a = this.data;
      if (!a.length) return null;
      const root = a[0];
      const last = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          let left = i * 2 + 1;
          if (left >= a.length) break;
          let right = left + 1;
          let child = right < a.length && this.compare(a[right], a[left]) < 0 ? right : left;
          if (this.compare(a[child], last) >= 0) break;
          a[i] = a[child]; i = child;
        }
        a[i] = last;
      }
      return root;
    }
  }

  function dijkstraTimes(graph, startId, speedMps, reverse = false) {
    const dist = new Map([[String(startId), 0]]);
    const prev = new Map();
    const heap = new MinHeap((a, b) => a.t - b.t);
    heap.push({ node: String(startId), t: 0 });
    while (heap.size) {
      const cur = heap.pop();
      if (cur.t !== dist.get(cur.node)) continue;
      for (const ref of graph.adjacency.get(cur.node) || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge) continue;
        const next = ref.to;
        const t = cur.t + edge.distanceM / speedMps;
        if (t + 1e-9 < (dist.get(next) ?? Infinity)) {
          dist.set(next, t);
          prev.set(next, { node: cur.node, edgeId: edge.id });
          heap.push({ node: next, t });
        }
      }
    }
    return { dist, prev, reverse };
  }

  async function dijkstraTimesResponsive(graph, startId, speedMps, reverse = false, options = {}) {
    const dist = new Map([[String(startId), 0]]);
    const prev = new Map();
    const heap = new MinHeap((a, b) => a.t - b.t);
    const cooperativeYield = makeCooperativeYielder(options);
    const every = Math.max(40, Number(options.yieldEveryDijkstra || config.yieldEveryDijkstra || 180));
    let popped = 0, yieldChecks = 0, yieldCount = 0, yieldWaitMs = 0;
    heap.push({ node: String(startId), t: 0 });
    while (heap.size) {
      if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      const cur = heap.pop();
      if (cur.t !== dist.get(cur.node)) continue;
      popped += 1;
      if (popped % every === 0) {
        options.onProgress?.({ stage: reverse ? "fastest-reverse" : "fastest", message: "正在整理最短路徑網路…", expanded: popped });
        yieldChecks += 1;
        const yieldStarted = nowMs();
        const didYield = await cooperativeYield();
        if (didYield) {
          yieldCount += 1;
          yieldWaitMs += Math.max(0, nowMs() - yieldStarted);
        }
      }
      for (const ref of graph.adjacency.get(cur.node) || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge) continue;
        const next = ref.to;
        const t = cur.t + edge.distanceM / speedMps;
        if (t + 1e-9 < (dist.get(next) ?? Infinity)) {
          dist.set(next, t);
          prev.set(next, { node: cur.node, edgeId: edge.id });
          heap.push({ node: next, t });
        }
      }
    }
    // dev35.0: do not force a compositor-frame yield after Dijkstra is already
    // complete. Background/throttled tabs can delay requestAnimationFrame by
    // many seconds; the old unconditional tail yield made two cheap HGR2 bound
    // passes appear to take ~30–240 s. Long traversals still yield above when
    // the CPU budget is exceeded, preserving progress/cancellation responsiveness.
    return { dist, prev, reverse, scheduling: { popped, yieldChecks, yieldCount, yieldWaitMs } };
  }

  function edgeGeometryFor(edge, fromId) {
    if (!edge) return [];
    return String(fromId) === String(edge.a) ? edge.geometry.slice() : edge.geometry.slice().reverse();
  }

  function reconstructDijkstra(graph, prev, startId, endId) {
    const edges = [];
    let cur = String(endId);
    const start = String(startId);
    let guard = 0;
    while (cur !== start && guard++ < 10000) {
      const step = prev.get(cur);
      if (!step) return null;
      edges.push({ edgeId: step.edgeId, from: step.node, to: cur });
      cur = step.node;
    }
    edges.reverse();
    return pathFromEdgeSteps(graph, edges);
  }

  function pathFromEdgeSteps(graph, steps) {
    const points = [];
    const edgeIds = [];
    let distanceM = 0;
    for (const step of steps || []) {
      const edge = graph.edges.get(step.edgeId);
      if (!edge) continue;
      const geometry = edgeGeometryFor(edge, step.from);
      edgeIds.push(edge.id);
      distanceM += edge.distanceM;
      for (const p of geometry) {
        const last = points[points.length - 1];
        if (!last || haversineM(last, p) > 0.2) points.push({ lat: p.lat, lng: p.lng });
      }
    }
    return { points, edgeIds, distanceM };
  }

  function pointAlongPolyline(points, targetM) {
    const pts = (points || []).map(asLatLng).filter(Boolean);
    if (!pts.length) return null;
    if (pts.length === 1) return pts[0];
    let walked = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const len = haversineM(pts[i - 1], pts[i]);
      if (walked + len >= targetM) {
        const f = len > 0 ? (targetM - walked) / len : 0;
        return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f };
      }
      walked += len;
    }
    return pts[pts.length - 1];
  }

  function shadeSamplePoints(geometry, spacingM, maxSamples) {
    const total = routeDistanceM(geometry);
    if (!(total > 0)) return [];
    const count = Math.max(1, Math.min(Number(maxSamples) || 4, Math.ceil(total / Math.max(12, Number(spacingM) || 28))));
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(pointAlongPolyline(geometry, total * ((i + 0.5) / count)));
    return out.filter(Boolean);
  }

  async function runPool(items, concurrency, worker) {
    const out = new Array(items.length);
    let cursor = 0;
    const n = Math.max(1, Math.min(items.length || 1, Number(concurrency) || 1));
    const runners = Array.from({ length: n }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
        if ((i & 1) === 1) await yieldToBrowser();
      }
    });
    await Promise.all(runners);
    return out;
  }

  async function runPoolNoYield(items, concurrency, worker) {
    const out = new Array(items.length);
    let cursor = 0;
    const n = Math.max(1, Math.min(items.length || 1, Number(concurrency) || 1));
    const runners = Array.from({ length: n }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    });
    await Promise.all(runners);
    return out;
  }

  async function defaultEdgeSunProvider(edge, fromId, at, context) {
    if (!window.HaidianShade || typeof window.HaidianShade.analyzeShadeModelAt !== "function") {
      throw new Error("找不到 HaidianShade.analyzeShadeModelAt，無法做 graph 日照成本。 ");
    }
    const geometry = edgeGeometryFor(edge, fromId);
    const samples = shadeSamplePoints(geometry, context.shadeSampleSpacingM, context.shadeMaxSamplesPerEdge);
    if (!samples.length) return { directSunFraction: 0, shadedFraction: 0, nightFraction: 1, samples: 0 };
    const models = await runPool(samples, context.shadeConcurrency, async (p) => {
      return window.HaidianShade.analyzeShadeModelAt(p.lat, p.lng, at, { canopyTimeoutMs: context.canopyTimeoutMs });
    });
    let sun = 0, shade = 0, night = 0, partial = 0, cacheUnsafe = 0;
    for (const model of models) {
      if (model?.state === "night") night += 1;
      else if (model?.shaded === true) shade += 1;
      else sun += 1;
      if (model?.reliability === "partial") partial += 1;
      if (model?.routeCacheSafe === false) cacheUnsafe += 1;
    }
    const total = models.length || 1;
    return {
      directSunFraction: sun / total, shadedFraction: shade / total, nightFraction: night / total, samples: total,
      partialSamples: partial, cacheUnsafeSamples: cacheUnsafe, cacheSafe: partial === 0 && cacheUnsafe === 0
    };
  }

  function denseShadeSegmentsForPath(graph, steps, spacingM) {
    const spacing = Math.max(4, Number(spacingM) || 10);
    const out = [];
    let cumulativeM = 0;
    for (let stepIndex = 0; stepIndex < (steps || []).length; stepIndex += 1) {
      const step = steps[stepIndex];
      const edge = graph.edges.get(step.edgeId);
      if (!edge) continue;
      const geometry = edgeGeometryFor(edge, step.from);
      for (let i = 1; i < (geometry || []).length; i += 1) {
        const a = geometry[i - 1], b = geometry[i];
        const len = haversineM(a, b);
        if (!(len > 0.05)) continue;
        const chunks = Math.max(1, Math.ceil(len / spacing));
        const chunkLen = len / chunks;
        for (let c = 0; c < chunks; c += 1) {
          const fm = (c + 0.5) / chunks;
          out.push({
            edgeId: edge.id,
            from: String(step.from),
            highway: primaryHighway(edge),
            wayIds: edge.wayIds?.slice?.() || [],
            lengthM: chunkLen,
            cumulativeMidM: cumulativeM + chunkLen / 2,
            sample: {
              lat: a.lat + (b.lat - a.lat) * fm,
              lng: a.lng + (b.lng - a.lng) * fm
            }
          });
          cumulativeM += chunkLen;
        }
      }
    }
    return { segments: out, totalDistanceM: cumulativeM };
  }

  async function reconcilePathShadeCost(graph, steps, coarseEdgeSun, departure, speedMps, options = {}) {
    if (!window.HaidianShade || typeof window.HaidianShade.analyzeShadeModelAt !== "function") {
      return { available: false, reason: "shade-api-unavailable" };
    }
    const spacingM = Math.max(4, Number(options.shadeReconcileSampleSpacingM || config.shadeReconcileSampleSpacingM || 10));
    const mismatchSec = Math.max(10, Number(options.shadeReconcileMismatchSec || config.shadeReconcileMismatchSec || 45));
    const topN = Math.max(3, Number(options.shadeReconcileTopEdges || config.shadeReconcileTopEdges || 8));
    const built = denseShadeSegmentsForPath(graph, steps, spacingM);
    if (!built.segments.length) return { available: false, reason: "no-path-segments" };
    const dep = departure instanceof Date ? departure : new Date(departure || Date.now());
    const safeSpeed = Math.max(0.4, Number(speedMps) || 1.25);
    const results = await runPool(
      built.segments,
      Math.max(1, Math.min(4, Number(options.shadeConcurrency || config.shadeConcurrency || 2))),
      async (seg) => {
        const at = new Date(dep.getTime() + (seg.cumulativeMidM / safeSpeed) * 1000);
        const model = await window.HaidianShade.analyzeShadeModelAt(seg.sample.lat, seg.sample.lng, at, {
          canopyTimeoutMs: options.canopyTimeoutMs || config.canopyTimeoutMs
        });
        return { seg, at, model };
      }
    );

    const denseByEdge = new Map();
    let denseSunS = 0, denseShadeS = 0, denseNightS = 0;
    for (const item of results) {
      const sec = item.seg.lengthM / safeSpeed;
      const state = item.model?.state === "night" ? "night" : item.model?.shaded === true ? "shade" : "sun";
      if (state === "sun") denseSunS += sec;
      else if (state === "shade") denseShadeS += sec;
      else denseNightS += sec;
      const row = denseByEdge.get(item.seg.edgeId) || {
        edgeId: item.seg.edgeId,
        highway: item.seg.highway,
        wayIds: item.seg.wayIds,
        distanceM: 0,
        sunS: 0,
        shadeS: 0,
        nightS: 0,
        samples: 0
      };
      row.distanceM += item.seg.lengthM;
      row.samples += 1;
      if (state === "sun") row.sunS += sec;
      else if (state === "shade") row.shadeS += sec;
      else row.nightS += sec;
      denseByEdge.set(item.seg.edgeId, row);
    }

    const coarseByEdge = new Map();
    for (const row of coarseEdgeSun || []) {
      const id = String(row.edgeId);
      const cur = coarseByEdge.get(id) || { sunS: 0, distanceM: 0, directSunFractionWeighted: 0 };
      cur.sunS += Number(row.directSunSeconds || 0);
      cur.distanceM += Number(row.distanceM || 0);
      cur.directSunFractionWeighted += Number(row.directSunFraction || 0) * Number(row.distanceM || 0);
      coarseByEdge.set(id, cur);
    }
    const coarseSunS = Array.from(coarseByEdge.values()).reduce((sum, row) => sum + row.sunS, 0);
    const edgeDiffs = [];
    for (const [edgeId, dense] of denseByEdge) {
      const coarse = coarseByEdge.get(String(edgeId)) || { sunS: 0, distanceM: dense.distanceM, directSunFractionWeighted: 0 };
      const denseDayS = dense.sunS + dense.shadeS;
      const denseFrac = denseDayS > 0 ? dense.sunS / denseDayS : 0;
      const coarseFrac = coarse.distanceM > 0 ? coarse.directSunFractionWeighted / coarse.distanceM : 0;
      edgeDiffs.push({
        edgeId,
        highway: dense.highway,
        wayIds: dense.wayIds,
        distanceM: dense.distanceM,
        denseSamples: dense.samples,
        coarseDirectSunFraction: coarseFrac,
        denseDirectSunFraction: denseFrac,
        coarseDirectSunSeconds: coarse.sunS,
        denseDirectSunSeconds: dense.sunS,
        deltaSeconds: coarse.sunS - dense.sunS,
        absDeltaSeconds: Math.abs(coarse.sunS - dense.sunS)
      });
    }
    edgeDiffs.sort((a, b) => b.absDeltaSeconds - a.absDeltaSeconds);
    const deltaSeconds = coarseSunS - denseSunS;
    const walkS = built.totalDistanceM / safeSpeed;
    const materialThresholdSec = Math.max(mismatchSec, walkS * 0.05);
    return {
      available: true,
      sampleSpacingM: spacingM,
      sampleCount: built.segments.length,
      distanceM: built.totalDistanceM,
      walkSeconds: walkS,
      coarseDirectSunSeconds: coarseSunS,
      denseDirectSunSeconds: denseSunS,
      denseShadedSeconds: denseShadeS,
      denseNightSeconds: denseNightS,
      deltaSeconds,
      absoluteDeltaSeconds: Math.abs(deltaSeconds),
      materialThresholdSec,
      materialMismatch: Math.abs(deltaSeconds) > materialThresholdSec,
      topEdgeMismatches: edgeDiffs.slice(0, topN)
    };
  }

  function pathHasNode(label, nodeId) {
    let cur = label;
    const target = String(nodeId);
    let guard = 0;
    while (cur && guard++ < 10000) {
      if (String(cur.node) === target) return true;
      cur = cur.parent || null;
    }
    return false;
  }

  function reconstructLabelPath(graph, label) {
    const steps = [];
    let cur = label;
    let guard = 0;
    while (cur?.parent && guard++ < 10000) {
      steps.push({ edgeId: cur.viaEdgeId, from: cur.parent.node, to: cur.node });
      cur = cur.parent;
    }
    steps.reverse();
    const path = pathFromEdgeSteps(graph, steps);
    return Object.assign(path, { walkSeconds: label.walkS, directSunSeconds: label.sunS });
  }

  function shadeBucketForMs(atMs, bucketSec) {
    return Math.floor((Number(atMs) / 1000) / Math.max(1, Number(bucketSec) || 60));
  }

  function shadeCacheKey(edge, bucket) {
    // Shade fraction is a property of the physical edge geometry + time bucket.
    // Traversal direction only reverses sample order and must not duplicate work.
    return `${String(edge?.id)}|${Number(bucket)}`;
  }

  function sessionShadeWarmCacheNamespace(context = {}) {
    if (context.enabled === false || config.sessionShadeWarmCacheEnabled === false) return null;
    const modelToken = String(context.modelToken || "").trim();
    if (!modelToken || context.modelReady === false) return null;
    const bucketSec = Math.max(30, Number(context.shadeTimeBucketSec || config.shadeTimeBucketSec || 60));
    const spacingM = Math.max(1, Number(context.shadeSampleSpacingM || config.shadeSampleSpacingM || 18));
    const maxSamples = Math.max(1, Number(context.shadeMaxSamplesPerEdge || config.shadeMaxSamplesPerEdge || 5));
    return JSON.stringify({
      revision: "dev35.2-edge-sun-v2",
      modelToken,
      bucketSec,
      spacingM,
      maxSamples
    });
  }

  function pruneSessionShadeWarmCaches(now = Date.now(), options = {}) {
    const ttlMs = Math.max(1000, Number(options.ttlMs || config.sessionShadeWarmCacheTtlMs || 30 * 60 * 1000));
    const maxNamespaces = Math.max(1, Number(options.maxNamespaces || config.sessionShadeWarmCacheMaxNamespaces || 4));
    for (const [namespace, record] of Array.from(sessionShadeWarmCaches.entries())) {
      if (!record || now - Number(record.lastUsedAt || record.createdAt || 0) > ttlMs) sessionShadeWarmCaches.delete(namespace);
    }
    if (sessionShadeWarmCaches.size > maxNamespaces) {
      const ordered = Array.from(sessionShadeWarmCaches.entries()).sort((a,b)=>Number(a[1]?.lastUsedAt||0)-Number(b[1]?.lastUsedAt||0));
      while (ordered.length && sessionShadeWarmCaches.size > maxNamespaces) sessionShadeWarmCaches.delete(ordered.shift()[0]);
    }
  }

  function acquireSessionShadeWarmCache(context = {}) {
    const namespace = sessionShadeWarmCacheNamespace(context);
    const localCache = new Map();
    if (!namespace) {
      return { enabled:false, reason: context.modelReady === false ? 'model-not-ready' : 'disabled-or-no-model-token', namespace:null, cache:localCache, seeded:0, namespaceEntriesBefore:0 };
    }
    const now = Date.now();
    const ttlMs = Math.max(1000, Number(context.ttlMs || config.sessionShadeWarmCacheTtlMs || 30 * 60 * 1000));
    const maxEntries = Math.max(100, Number(context.maxEntries || config.sessionShadeWarmCacheMaxEntries || 5000));
    const maxNamespaces = Math.max(1, Number(context.maxNamespaces || config.sessionShadeWarmCacheMaxNamespaces || 4));
    pruneSessionShadeWarmCaches(now, { ttlMs, maxNamespaces });
    let record = sessionShadeWarmCaches.get(namespace);
    if (!record) {
      record = { entries:new Map(), createdAt:now, lastUsedAt:now };
      sessionShadeWarmCaches.set(namespace, record);
      pruneSessionShadeWarmCaches(now, { ttlMs, maxNamespaces });
      record = sessionShadeWarmCaches.get(namespace) || record;
    }
    let seeded = 0, expired = 0;
    for (const [key, row] of Array.from(record.entries.entries())) {
      if (!row || now - Number(row.savedAt || 0) > ttlMs) { record.entries.delete(key); expired += 1; continue; }
      localCache.set(key, Promise.resolve(row.value));
      seeded += 1;
    }
    record.lastUsedAt = now;
    let totalEntries = 0;
    for (const r of sessionShadeWarmCaches.values()) totalEntries += Number(r?.entries?.size || 0);
    return {
      enabled:true, reason:null, namespace, cache:localCache, seeded, expired,
      namespaceEntriesBefore:record.entries.size, namespaceCount:sessionShadeWarmCaches.size, totalEntries,
      ttlMs, maxEntries, maxNamespaces
    };
  }

  function shadeResultSafeForWarmCache(value) {
    return Boolean(value && typeof value === 'object' && value.cacheSafe !== false && Number.isFinite(Number(value.directSunFraction)) && Number.isFinite(Number(value.shadedFraction)));
  }

  async function commitSessionShadeWarmCache(handle, localCache) {
    if (!handle?.enabled || !handle.namespace || !localCache || typeof localCache.entries !== 'function') {
      return { enabled:false, persisted:0, rejected:0, errors:0, namespaceEntriesAfter:0, reason:handle?.reason || 'disabled' };
    }
    const now = Date.now();
    const ttlMs = Math.max(1000, Number(handle.ttlMs || config.sessionShadeWarmCacheTtlMs || 30 * 60 * 1000));
    const maxEntries = Math.max(100, Number(handle.maxEntries || config.sessionShadeWarmCacheMaxEntries || 5000));
    const maxNamespaces = Math.max(1, Number(handle.maxNamespaces || config.sessionShadeWarmCacheMaxNamespaces || 4));
    pruneSessionShadeWarmCaches(now, { ttlMs, maxNamespaces });
    let record = sessionShadeWarmCaches.get(handle.namespace);
    if (!record) {
      record = { entries:new Map(), createdAt:now, lastUsedAt:now };
      sessionShadeWarmCaches.set(handle.namespace, record);
    }
    let persisted = 0, rejected = 0, errors = 0;
    for (const [key, raw] of localCache.entries()) {
      let value;
      try { value = await Promise.resolve(raw); }
      catch (_) { errors += 1; continue; }
      if (!shadeResultSafeForWarmCache(value)) { rejected += 1; continue; }
      record.entries.delete(key);
      record.entries.set(key, { value, savedAt:now });
      persisted += 1;
    }
    while (record.entries.size > maxEntries) record.entries.delete(record.entries.keys().next().value);
    record.lastUsedAt = now;
    pruneSessionShadeWarmCaches(now, { ttlMs, maxNamespaces });
    let totalEntries = 0;
    for (const r of sessionShadeWarmCaches.values()) totalEntries += Number(r?.entries?.size || 0);
    return { enabled:true, persisted, rejected, errors, namespaceEntriesAfter:record.entries.size, namespaceCount:sessionShadeWarmCaches.size, totalEntries };
  }

  function getSessionShadeWarmCacheStats() {
    let entries = 0;
    const namespaces = [];
    for (const [namespace, record] of sessionShadeWarmCaches.entries()) {
      const size = Number(record?.entries?.size || 0); entries += size;
      namespaces.push({ namespace, entries:size, lastUsedAt:Number(record?.lastUsedAt || 0) });
    }
    return { enabled:config.sessionShadeWarmCacheEnabled !== false, namespaceCount:sessionShadeWarmCaches.size, entries, namespaces };
  }

  function clearSessionShadeWarmCache() {
    const entries = getSessionShadeWarmCacheStats().entries;
    sessionShadeWarmCaches.clear();
    return { clearedEntries:entries, namespaceCount:0 };
  }

  function temporalBucketsForEdge(edge, fromStart, toEnd, speedMps, detourLimitS, departureMs, bucketSec, maxBucketsPerEdge) {
    const edgeTime = Number(edge?.distanceM || 0) / Math.max(0.1, Number(speedMps) || 1.25);
    if (!(edgeTime > 0)) return [];
    const startDist = fromStart?.dist || fromStart || new Map();
    const endDist = toEnd?.dist || toEnd || new Map();
    const ranges = [];
    const dirs = [[String(edge.a), String(edge.b)], [String(edge.b), String(edge.a)]];
    for (const [u,v] of dirs) {
      const du = Number(startDist.get(u)), dv = Number(endDist.get(v));
      if (!Number.isFinite(du) || !Number.isFinite(dv)) continue;
      const earliestMidS = du + edgeTime / 2;
      const latestMidS = Number(detourLimitS) - dv - edgeTime / 2;
      if (!Number.isFinite(latestMidS) || latestMidS + 0.5 < earliestMidS) continue;
      const first = shadeBucketForMs(departureMs + earliestMidS * 1000, bucketSec);
      const last = shadeBucketForMs(departureMs + latestMidS * 1000, bucketSec);
      ranges.push([Math.min(first,last), Math.max(first,last)]);
    }
    if (!ranges.length) return [];
    const buckets = new Set();
    for (const [first,last] of ranges) {
      for (let b=first; b<=last; b += 1) buckets.add(b);
    }
    const sorted = Array.from(buckets).sort((a,b)=>a-b);
    const maxN = Math.max(1, Number(maxBucketsPerEdge) || 8);
    if (sorted.length <= maxN) return sorted;
    // Keep a deterministic evenly-spaced subset. Missing buckets remain legal:
    // searchMinSun falls back to the exact on-demand provider for them.
    const picked = [];
    for (let i=0; i<maxN; i += 1) {
      const idx = Math.round(i * (sorted.length - 1) / Math.max(1, maxN - 1));
      const v = sorted[idx];
      if (picked[picked.length - 1] !== v) picked.push(v);
    }
    return picked;
  }

  async function buildTemporalShadeTable(graph, fromStart, toEnd, options = {}) {
    const started = nowMs();
    if (options.temporalShadeTableEnabled === false) return { enabled:false, durationMs:0, tasks:0, evaluated:0, cacheHits:0 };
    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const detourLimitS = Number(options.detourLimitS);
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    const departureMs = departure.getTime();
    const bucketSec = Math.max(30, Number(options.shadeTimeBucketSec || config.shadeTimeBucketSec || 60));
    const maxBucketsPerEdge = Math.max(1, Number(options.temporalShadeTableMaxBucketsPerEdge || config.temporalShadeTableMaxBucketsPerEdge || 8));
    const maxEvaluations = Math.max(50, Number(options.temporalShadeTableMaxEvaluations || config.temporalShadeTableMaxEvaluations || 1800));
    const concurrency = Math.max(1, Math.min(24, Number(options.temporalShadeTableConcurrency || config.temporalShadeTableConcurrency || 8)));
    const provider = options.edgeSunProvider || defaultEdgeSunProvider;
    const shadeCache = options.sharedShadeCache && typeof options.sharedShadeCache.has === 'function' ? options.sharedShadeCache : new Map();
    const tasks = [];
    let skippedExisting = 0, truncatedEdges = 0, potentialTasks = 0;
    for (const edge of graph?.edges?.values?.() || []) {
      const allBuckets = temporalBucketsForEdge(edge, fromStart, toEnd, speedMps, detourLimitS, departureMs, bucketSec, maxBucketsPerEdge);
      if (!allBuckets.length) continue;
      // Detect whether the feasible interval was wider than our deterministic cap.
      const edgeTime = Number(edge.distanceM || 0) / speedMps;
      const starts=fromStart?.dist||fromStart||new Map(), ends=toEnd?.dist||toEnd||new Map();
      let rawMin=Infinity, rawMax=-Infinity;
      for(const [u,v] of [[String(edge.a),String(edge.b)],[String(edge.b),String(edge.a)]]){
        const du=Number(starts.get(u)), dv=Number(ends.get(v));
        if(!Number.isFinite(du)||!Number.isFinite(dv)) continue;
        const lo=shadeBucketForMs(departureMs+(du+edgeTime/2)*1000,bucketSec);
        const hiS=detourLimitS-dv-edgeTime/2;
        if(hiS+0.5<du+edgeTime/2) continue;
        const hi=shadeBucketForMs(departureMs+hiS*1000,bucketSec);
        rawMin=Math.min(rawMin,lo,hi); rawMax=Math.max(rawMax,lo,hi);
      }
      if(Number.isFinite(rawMin)&&Number.isFinite(rawMax)&&rawMax-rawMin+1>maxBucketsPerEdge) truncatedEdges += 1;
      for (const bucket of allBuckets) {
        potentialTasks += 1;
        const key = shadeCacheKey(edge, bucket);
        if (shadeCache.has(key)) { skippedExisting += 1; continue; }
        tasks.push({ edge, bucket, key });
      }
    }
    // Favor tasks closest to departure first if an unusually large graph exceeds
    // the safety budget. Any omitted key is still evaluated lazily by search.
    tasks.sort((a,b)=>Math.abs(a.bucket - shadeBucketForMs(departureMs,bucketSec))-Math.abs(b.bucket-shadeBucketForMs(departureMs,bucketSec)) || String(a.edge.id).localeCompare(String(b.edge.id)));
    const scheduled = tasks.slice(0, maxEvaluations);
    let evaluated = 0, errors = 0, maxActive = 0, active = 0;
    options.onProgress?.({ stage:'temporal-shade-table', message:`dev33：預先批次建立 temporal shade table（${scheduled.length} edge/time cells，concurrency ${concurrency}）…` });
    await runPoolNoYield(scheduled, concurrency, async (task) => {
      if (options.shouldCancel?.()) throw new Error('ROUTE_ANALYSIS_CANCELLED');
      if (shadeCache.has(task.key)) { skippedExisting += 1; return; }
      const centerMs = (task.bucket * bucketSec + bucketSec / 2) * 1000;
      active += 1; maxActive = Math.max(maxActive, active);
      const promise = Promise.resolve(provider(task.edge, task.edge.a, new Date(centerMs), {
        shadeSampleSpacingM: options.shadeSampleSpacingM || config.shadeSampleSpacingM,
        shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge || config.shadeMaxSamplesPerEdge,
        shadeConcurrency: options.shadeConcurrency || config.shadeConcurrency,
        canopyTimeoutMs: options.canopyTimeoutMs || config.canopyTimeoutMs
      }));
      shadeCache.set(task.key, promise);
      try { await promise; evaluated += 1; }
      catch (error) { errors += 1; shadeCache.delete(task.key); throw error; }
      finally { active -= 1; }
    });
    return {
      enabled:true, bucketSec, concurrency, potentialTasks, tasks:scheduled.length,
      evaluated, cacheHits:skippedExisting, errors, truncatedEdges,
      omittedBySafetyCap:Math.max(0,tasks.length-scheduled.length), maxActive,
      cacheSize:shadeCache.size, durationMs:nowMs()-started
    };
  }

  async function searchMinSun(graph, startId, endId, options = {}) {
    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const detourLimitS = Number(options.detourLimitS);
    const toEnd = options.fastestToEnd?.dist || options.fastestToEnd || new Map();
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    const provider = options.edgeSunProvider || defaultEdgeSunProvider;
    const timeBucketSec = Math.max(15, Number(options.timeBucketSec || config.timeBucketSec));
    const shadeTimeBucketSec = Math.max(30, Number(options.shadeTimeBucketSec || config.shadeTimeBucketSec));
    const maxStates = Math.max(500, Number(options.maxExpandedStates || config.maxExpandedStates));
    const maxShadeEvals = Math.max(100, Number(options.maxShadeEdgeEvaluations || config.maxShadeEdgeEvaluations));
    const shadeCache = options.sharedShadeCache && typeof options.sharedShadeCache.has === "function" && typeof options.sharedShadeCache.get === "function" && typeof options.sharedShadeCache.set === "function" ? options.sharedShadeCache : new Map();
    let shadeEvals = 0;
    let shadeCacheHits = 0;
    let expanded = 0;
    let dominanceRejected = 0;
    let dominanceRemoved = 0;
    const cooperativeYield = makeCooperativeYielder(options);
    const yieldEveryExpanded = Math.max(2, Number(options.yieldEveryExpanded || config.yieldEveryExpanded || 8));

    // Resource-constrained label-setting search.  A single "best sun" value per
    // node/time bucket can incorrectly erase a slightly sunnier-but-earlier
    // arrival that later reaches a much shadier corridor.  Keep a tiny Pareto
    // frontier of (walk time, direct-sun time) labels instead.
    const heap = new MinHeap((a, b) => (a.sunS - b.sunS) || (a.walkS - b.walkS));
    const startLabel = { node: String(startId), walkS: 0, sunS: 0, parent: null, viaEdgeId: null, active: true };
    const labelsByState = new Map();

    function stateKey(label) {
      return `${label.node}|${Math.floor(label.walkS / timeBucketSec)}`;
    }
    // dev7 correctness rule: because pathHasNode() makes future legality depend
    // on the entire visited-node history, two labels with identical scalar
    // costs are NOT interchangeable unless the would-be dominating label has
    // visited no additional nodes. Time-dependent shade also means an earlier
    // arrival cannot safely dominate a later one (or vice versa) unless the
    // arrival time itself is effectively identical.
    const visitedSetCache = new WeakMap();
    function visitedSetForLabel(label) {
      if (!label || typeof label !== "object") return new Set();
      const cached = visitedSetCache.get(label);
      if (cached) return cached;
      const set = new Set();
      let cur = label;
      let guard = 0;
      while (cur && guard++ < 10000) {
        set.add(String(cur.node));
        cur = cur.parent || null;
      }
      visitedSetCache.set(label, set);
      return set;
    }
    function visitedSubset(a, b) {
      const A = visitedSetForLabel(a);
      const B = visitedSetForLabel(b);
      if (A.size > B.size) return false;
      for (const node of A) if (!B.has(node)) return false;
      return true;
    }
    function weaklyDominates(a, b) {
      // Equal arrival time preserves downstream time-dependent edge costs.
      // A subset of visited nodes preserves every simple-path continuation
      // still available to b.  The small epsilon is only numeric noise.
      return Math.abs(a.walkS - b.walkS) <= 1e-9 &&
        a.sunS <= b.sunS + 1e-9 &&
        visitedSubset(a, b);
    }
    function insertLabel(label) {
      const key = stateKey(label);
      const list = labelsByState.get(key) || [];
      for (const old of list) {
        if (old.active !== false && weaklyDominates(old, label)) {
          dominanceRejected += 1;
          return false;
        }
      }
      const kept = [];
      for (const old of list) {
        if (old.active !== false && weaklyDominates(label, old)) {
          old.active = false;
          dominanceRemoved += 1;
        } else if (old.active !== false) kept.push(old);
      }
      // IMPORTANT: dev7 intentionally has no arbitrary "top N labels" cap.
      // Search safety is enforced by maxExpandedStates/maxShadeEdgeEvaluations;
      // hitting either limit is reported as an incomplete search, never as an
      // optimum.  This trades some performance for correctness.
      kept.push(label);
      kept.sort((a, b) => (a.sunS - b.sunS) || (a.walkS - b.walkS));
      labelsByState.set(key, kept);
      return true;
    }

    insertLabel(startLabel);
    heap.push(startLabel);
    let bestGoal = null;

    async function sunForEdge(edge, fromId, walkS) {
      const edgeTime = edge.distanceM / speedMps;
      const atMs = departure.getTime() + (walkS + edgeTime / 2) * 1000;
      const bucket = shadeBucketForMs(atMs, shadeTimeBucketSec);
      const key = shadeCacheKey(edge, bucket);
      if (shadeCache.has(key)) {
        shadeCacheHits += 1;
        return shadeCache.get(key);
      }
      if (shadeEvals >= maxShadeEvals) throw new Error(`OSM Graph 搜尋未完整完成：日照評估已達安全上限 ${maxShadeEvals} 條 edge；目前結果不可視為真正最不曬。`);
      shadeEvals += 1;
      const promise = Promise.resolve(provider(edge, fromId, new Date(atMs), {
        shadeSampleSpacingM: options.shadeSampleSpacingM || config.shadeSampleSpacingM,
        shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge || config.shadeMaxSamplesPerEdge,
        shadeConcurrency: options.shadeConcurrency || config.shadeConcurrency,
        canopyTimeoutMs: options.canopyTimeoutMs || config.canopyTimeoutMs
      }));
      shadeCache.set(key, promise);
      try {
        const result = await promise;
        const sunFraction = clamp(result?.directSunFraction, 0, 1, 0);
        const debug = lastShadeDebug.get(edge.id) || { count: 0, samples: 0, directSunFractionSum: 0, shadedFractionSum: 0, directSunSecondsSum: 0, lastAt: null };
        debug.count += 1;
        debug.samples += Number(result?.samples || 0);
        debug.directSunFractionSum += sunFraction;
        debug.shadedFractionSum += Number(result?.shadedFraction || 0);
        debug.directSunSecondsSum += edgeTime * sunFraction;
        debug.lastDirectSunSeconds = edgeTime * sunFraction;
        debug.lastAt = new Date(atMs).toISOString();
        debug.lastFromId = String(fromId);
        lastShadeDebug.set(edge.id, debug);
        return result;
      } catch (error) {
        shadeCache.delete(key);
        throw error;
      }
    }

    while (heap.size) {
      if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      const cur = heap.pop();
      if (!cur || cur.active === false) continue;
      expanded += 1;
      if (expanded > maxStates) throw new Error(`OSM Graph 搜尋未完整完成：已達 ${maxStates} 個狀態安全上限；目前結果不可視為真正最不曬。`);
      if (expanded % yieldEveryExpanded === 0) await cooperativeYield();
      if (expanded === 1 || expanded % Math.max(1, Number(config.progressEvery || 20)) === 0) {
        options.onProgress?.({ stage: "search", expanded, shadeEvals, message: `正在做細緻 graph 搜尋：${expanded} 個狀態／${shadeEvals} 條 edge 日照` });
      }

      if (bestGoal && (cur.sunS > bestGoal.sunS + 0.01 || (Math.abs(cur.sunS - bestGoal.sunS) < 0.01 && cur.walkS >= bestGoal.walkS))) break;
      if (cur.node === String(endId)) {
        bestGoal = cur;
        continue;
      }

      const outgoing = graph.adjacency.get(cur.node) || [];
      const feasible = [];
      for (const ref of outgoing) {
        const next = String(ref.to);
        if (pathHasNode(cur, next)) continue; // simple path: no shaded dead-end score games.
        const edge = graph.edges.get(ref.edgeId);
        if (!edge) continue;
        const edgeTime = edge.distanceM / speedMps;
        const nextWalk = cur.walkS + edgeTime;
        const optimisticRemain = Number(toEnd.get(next));
        if (!Number.isFinite(optimisticRemain)) continue;
        // Exact resource bound: only prune when even the shortest possible
        // continuation would exceed the user's detour cap.
        if (Number.isFinite(detourLimitS) && nextWalk + optimisticRemain > detourLimitS + 0.5) continue;
        feasible.push({ next, edge, edgeTime, nextWalk });
      }
      // dev30: all feasible outgoing costs depend only on this immutable label,
      // so they may be evaluated concurrently without changing heap/label order.
      // Keep concurrency bounded: each edge may itself sample multiple ShadeMap
      // points, so an unbounded Promise.all can overload canopy/building work on
      // high-degree junctions and make the browser slower rather than faster.
      const edgeBatchConcurrency = Math.max(1, Math.min(12, Number(options.shadeEdgeBatchConcurrency || config.shadeEdgeBatchConcurrency || 4)));
      const shadedOutgoing = await runPoolNoYield(
        feasible,
        edgeBatchConcurrency,
        async (item) => ({ item, shade: await sunForEdge(item.edge, cur.node, cur.walkS) })
      );
      if (shadeEvals > 0 && shadeEvals % 6 === 0) await cooperativeYield();
      for (const row of shadedOutgoing) {
        const { next, edge, edgeTime, nextWalk } = row.item;
        const sunFraction = clamp(row.shade?.directSunFraction, 0, 1, 0);
        const nextSun = cur.sunS + edgeTime * sunFraction;
        const label = { node: next, walkS: nextWalk, sunS: nextSun, parent: cur, viaEdgeId: edge.id, active: true };
        if (insertLabel(label)) heap.push(label);
      }
    }

    if (!bestGoal) return { path: null, expanded, shadeEvals, shadeCacheHits, shadeCacheSize: shadeCache.size, dominanceRejected, dominanceRemoved };
    return { path: reconstructLabelPath(graph, bestGoal), expanded, shadeEvals, shadeCacheHits, shadeCacheSize: shadeCache.size, dominanceRejected, dominanceRemoved };
  }

  function routeSignature(points) {
    const pts = points || [];
    if (pts.length < 2) return "";
    const sampleIdx = [0, Math.floor((pts.length - 1) * 0.25), Math.floor((pts.length - 1) * 0.5), Math.floor((pts.length - 1) * 0.75), pts.length - 1];
    return sampleIdx.map((i) => `${pts[i].lat.toFixed(4)},${pts[i].lng.toFixed(4)}`).join("|");
  }


  // dev32: routeSignature() is retained for old diagnostics, but it is too
  // coarse to prove two candidates are identical. Five samples rounded to four
  // decimals can collide for nearby parallel paths. Suppression now requires
  // exact ordered edge identity whenever graph edge IDs are available.
  function geometryHash(points) {
    const pts = (points || []).map(asLatLng).filter(Boolean);
    if (!pts.length) return "geom-empty";
    let h = 2166136261 >>> 0;
    const payload = pts.map((p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`).join("|");
    for (let i = 0; i < payload.length; i += 1) {
      h ^= payload.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return `g${h.toString(16).padStart(8, "0")}`;
  }

  function canonicalGeometryKey(points) {
    const pts = (points || []).map(asLatLng).filter(Boolean);
    if (!pts.length) return "";
    return pts.map((p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`).join("|");
  }

  function sameGraphPathGeometry(a, b) {
    const ae = (a?.edgeIds || []).map(String), be = (b?.edgeIds || []).map(String);
    // Edge identity is the strongest proof. If only one side has edge IDs, do
    // not downgrade to a geometry hash and risk silently suppressing a route.
    if (ae.length || be.length) {
      if (!(ae.length && be.length) || ae.length !== be.length) return false;
      for (let i = 0; i < ae.length; i += 1) if (ae[i] !== be[i]) return false;
      return true;
    }
    // A hash is useful as a stable label, but hash equality is not duplicate
    // proof. Compare the complete quantized coordinate sequence instead.
    const ak = canonicalGeometryKey(a?.points || []), bk = canonicalGeometryKey(b?.points || []);
    return Boolean(ak && bk && ak === bk);
  }

  function makeGraphCandidate(kind, path, extra = {}) {
    const id = kind === 'graph-fastest' ? 'graph-fastest' : 'graph-min-sun';
    const hash = geometryHash(path?.points || []);
    return Object.assign({
      id,
      stableCandidateId: `${id}:${hash}`,
      geometryHash: hash,
      kind,
      distanceM: Number(path?.distanceM || 0),
      durationS: Number(path?.walkSeconds || extra.durationS || 0),
      points: path?.points || []
    }, extra);
  }

  function pruningCorrectnessCertificate(graph, keptEdgeIds, fromA, toB, speedMps, detourLimitS, options = {}) {
    const keep = keptEdgeIds instanceof Set ? keptEdgeIds : new Set(keptEdgeIds || []);
    const distA = fromA?.dist || fromA || new Map();
    const distB = toB?.dist || toB || new Map();
    const limitS = Number(detourLimitS);
    const slackS = Math.max(0, Number(options.externalGraphPruneSlackSec ?? config.externalGraphPruneSlackSec ?? 3));
    let omittedEdges = 0, minimumOmittedLowerBoundS = Infinity;
    const violations = [];
    for (const [id, edge] of graph?.edges || []) {
      const key = String(id);
      if (keep.has(key)) continue;
      omittedEdges += 1;
      const a = String(edge.a), b = String(edge.b);
      const edgeS = Number(edge.distanceM || 0) / Math.max(0.1, Number(speedMps) || 1.25);
      const ab = Number(distA.get(a)) + edgeS + Number(distB.get(b));
      const ba = Number(distA.get(b)) + edgeS + Number(distB.get(a));
      const lowerBoundS = Math.min(Number.isFinite(ab) ? ab : Infinity, Number.isFinite(ba) ? ba : Infinity);
      minimumOmittedLowerBoundS = Math.min(minimumOmittedLowerBoundS, lowerBoundS);
      if (Number.isFinite(lowerBoundS) && lowerBoundS <= limitS + 1e-9) {
        if (violations.length < 20) violations.push({ edgeId:key, lowerBoundS, detourLimitS:limitS });
      }
    }
    return {
      valid: violations.length === 0,
      proof: 'shortest(A→edge) + edge + shortest(edge→B) lower-bound',
      detourLimitS: limitS,
      pruneSlackS: slackS,
      keptEdges: keep.size,
      omittedEdges,
      minimumOmittedLowerBoundS: Number.isFinite(minimumOmittedLowerBoundS) ? minimumOmittedLowerBoundS : null,
      violationCount: violations.length,
      violations
    };
  }

  async function exactReplayPathShade(graph, path, startId, options = {}) {
    if (!graph?.edges || !path?.edgeIds?.length) return { available:false, reason:'missing-path' };
    const provider = options.edgeSunProvider || defaultEdgeSunProvider;
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    const speedMps = Math.max(0.1, Number(options.speedMps) || 1.25);
    let current = String(startId), walkS = 0, directSunSeconds = 0, evaluations = 0;
    const rows = [];
    for (const edgeId of path.edgeIds) {
      const edge = graph.edges.get(String(edgeId));
      if (!edge) return { available:false, reason:'missing-edge', edgeId:String(edgeId), evaluations };
      const a = String(edge.a), b = String(edge.b);
      if (current !== a && current !== b) return { available:false, reason:'broken-edge-order', edgeId:String(edgeId), current, evaluations };
      const from = current, to = current === a ? b : a;
      const edgeTimeS = Number(edge.distanceM || 0) / speedMps;
      const atMs = departure.getTime() + (walkS + edgeTimeS / 2) * 1000;
      const result = await provider(edge, from, new Date(atMs), {
        shadeSampleSpacingM: options.shadeSampleSpacingM || config.shadeSampleSpacingM,
        shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge || config.shadeMaxSamplesPerEdge,
        shadeConcurrency: options.shadeConcurrency || config.shadeConcurrency,
        canopyTimeoutMs: options.canopyTimeoutMs || config.canopyTimeoutMs
      });
      const sunFraction = clamp(result?.directSunFraction, 0, 1, 0);
      directSunSeconds += edgeTimeS * sunFraction;
      rows.push({ edgeId:String(edgeId), at:new Date(atMs).toISOString(), directSunFraction:sunFraction, edgeTimeS });
      evaluations += 1;
      walkS += edgeTimeS;
      current = to;
      if (options.shouldCancel?.()) throw new Error('ROUTE_ANALYSIS_CANCELLED');
    }
    const estimated = Number(path.directSunSeconds);
    const errorSeconds = Number.isFinite(estimated) ? directSunSeconds - estimated : null;
    const toleranceSec = Math.max(0, Number(options.candidateCorrectnessExactReplayToleranceSec ?? config.candidateCorrectnessExactReplayToleranceSec ?? 45));
    return {
      available:true,
      evaluations,
      directSunSeconds,
      estimatedDirectSunSeconds:Number.isFinite(estimated) ? estimated : null,
      errorSeconds,
      absoluteErrorSeconds:Number.isFinite(errorSeconds) ? Math.abs(errorSeconds) : null,
      toleranceSec,
      withinTolerance:Number.isFinite(errorSeconds) ? Math.abs(errorSeconds) <= toleranceSec + 1e-9 : null,
      rows
    };
  }


  function projectPointToSegmentM(point, a, b) {
    const P = asLatLng(point), A = asLatLng(a), B = asLatLng(b);
    if (!P || !A || !B) return null;
    const lat0 = ((P.lat + A.lat + B.lat) / 3) * Math.PI / 180;
    const mx = 111320 * Math.max(0.2, Math.cos(lat0));
    const my = 110540;
    const bx = (B.lng - A.lng) * mx, by = (B.lat - A.lat) * my;
    const px = (P.lng - A.lng) * mx, py = (P.lat - A.lat) * my;
    const denom = bx * bx + by * by;
    const t = denom > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by) / denom)) : 0;
    const projected = { lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t };
    return { point: projected, t, distanceM: haversineM(P, projected) };
  }

  function nearestPointOnGeometry(point, geometry) {
    let best = null;
    for (let i = 1; i < (geometry || []).length; i += 1) {
      const hit = projectPointToSegmentM(point, geometry[i - 1], geometry[i]);
      if (hit && (!best || hit.distanceM < best.distanceM)) best = Object.assign({ segmentIndex: i - 1 }, hit);
    }
    return best;
  }


  function projectPointToPolylineProgressM(point, geometry) {
    const route = (geometry || []).map(asLatLng).filter(Boolean);
    if (route.length < 2) return null;
    let best = null;
    let walked = 0;
    for (let i = 1; i < route.length; i += 1) {
      const segLen = haversineM(route[i - 1], route[i]);
      const hit = projectPointToSegmentM(point, route[i - 1], route[i]);
      if (hit) {
        const candidate = {
          point: hit.point,
          distanceM: hit.distanceM,
          segmentIndex: i - 1,
          progressM: walked + segLen * hit.t
        };
        if (!best || candidate.distanceM < best.distanceM) best = candidate;
      }
      walked += segLen;
    }
    if (best) best.routeLengthM = walked;
    return best;
  }

  function orderedEdgeMatch(edge, fromId, route, sampleCount = 4) {
    const geometry = edgeGeometryFor(edge, fromId);
    if (!geometry || geometry.length < 2) return null;
    const mids = shadeSamplePoints(geometry, Math.max(8, edge.distanceM / Math.max(2, sampleCount)), sampleCount);
    const samples = [geometry[0], ...mids, geometry[geometry.length - 1]].filter(Boolean);
    const hits = samples.map((p) => projectPointToPolylineProgressM(p, route));
    if (hits.some((h) => !h)) return null;
    const distances = hits.map((h) => h.distanceM);
    const progress = hits.map((h) => h.progressM);
    const startProgressM = progress[0];
    const endProgressM = progress[progress.length - 1];
    const progressGainM = endProgressM - startProgressM;
    return {
      avgDistanceM: distances.reduce((a,b)=>a+b,0) / distances.length,
      maxDistanceM: Math.max(...distances),
      startProgressM,
      endProgressM,
      progressGainM,
      minProgressM: Math.min(...progress),
      maxProgressM: Math.max(...progress)
    };
  }


  function graphHasDirectedEdge(graph, fromId, toId) {
    const from = String(fromId), to = String(toId);
    return (graph?.adjacency?.get(from) || []).some((ref) => String(ref.to) === to);
  }

  function compactTagsForBreakpoint(edge) {
    const src = edge?.tagsSummary || {};
    const out = {};
    for (const key of ["highway", "foot", "access", "oneway", "oneway:foot", "bicycle", "cycleway", "service", "bridge", "tunnel", "layer", "incline", "steps", "name"]) {
      const value = src[key];
      if (Array.isArray(value) && value.length) out[key] = value.slice(0, 6);
      else if (value != null && String(value).trim() !== "") out[key] = value;
    }
    return out;
  }

  function nodeMetaForBreakpoint(graph, nodeId) {
    const id = String(nodeId);
    const node = graph?.nodes?.get(id);
    if (!node) return { id };
    return {
      id,
      lat: Number.isFinite(Number(node.lat)) ? Number(node.lat) : null,
      lng: Number.isFinite(Number(node.lng)) ? Number(node.lng) : null,
      virtual: node.virtual === true,
      sourceNodeId: node.sourceNodeId != null ? String(node.sourceNodeId) : null,
      sourceEdgeId: node.sourceEdgeId != null ? String(node.sourceEdgeId) : null
    };
  }

  function classifyOrderedTransition(match, edge, curProgressM, routeLen, thresholdM, backwardToleranceM, maxForwardGapBaseM) {
    if (!match) return { accepted: false, reason: "noMatch" };
    if (match.maxDistanceM > thresholdM) return { accepted: false, reason: "tooFar" };
    if (match.progressGainM < -backwardToleranceM) return { accepted: false, reason: "edgeBackwards" };
    if (match.maxProgressM < curProgressM - backwardToleranceM) return { accepted: false, reason: "stateBehind" };
    const maxForwardGapM = Math.max(maxForwardGapBaseM, Number(edge?.distanceM || 0) + thresholdM * 2 + 18);
    if (match.startProgressM > curProgressM + maxForwardGapM) return { accepted: false, reason: "forwardJump", maxForwardGapM };
    if (match.maxProgressM < -backwardToleranceM || match.minProgressM > routeLen + backwardToleranceM) return { accepted: false, reason: "envelope", maxForwardGapM };
    return { accepted: true, reason: "accepted", maxForwardGapM };
  }

  function incidentEdgesForBreakpoint(graph, nodeId, route, curProgressM, thresholdM, backwardToleranceM, maxForwardGapBaseM) {
    const routeLen = routeDistanceM(route);
    const out = [];
    for (const ref of graph?.adjacency?.get(String(nodeId)) || []) {
      const edge = graph.edges.get(ref.edgeId);
      if (!edge) continue;
      const match = orderedEdgeMatch(edge, String(nodeId), route, 5);
      const verdict = classifyOrderedTransition(match, edge, curProgressM, routeLen, thresholdM, backwardToleranceM, maxForwardGapBaseM);
      const reverseExists = graphHasDirectedEdge(graph, ref.to, nodeId);
      out.push({
        edgeId: edge.id,
        toNodeId: String(ref.to),
        highway: primaryHighway(edge),
        wayIds: (edge.wayIds || []).slice(0, 8),
        tags: compactTagsForBreakpoint(edge),
        forwardExists: true,
        reverseExists,
        accepted: verdict.accepted,
        rejectReason: verdict.reason,
        distanceM: Number(edge.distanceM || 0),
        match: match ? {
          maxDistanceM: match.maxDistanceM,
          avgDistanceM: match.avgDistanceM,
          startProgressM: match.startProgressM,
          endProgressM: match.endProgressM,
          progressGainM: match.progressGainM,
          minProgressM: match.minProgressM,
          maxProgressM: match.maxProgressM
        } : null
      });
    }
    return out.sort((a, b) => (b.accepted - a.accepted) || ((b.match?.maxProgressM ?? -Infinity) - (a.match?.maxProgressM ?? -Infinity)) || (a.distanceM - b.distanceM));
  }

  function nearbyDisconnectedCandidatesForBreakpoint(graph, currentNodeId, route, curProgressM, thresholdM, backwardToleranceM, options = {}) {
    const current = graph?.nodes?.get(String(currentNodeId));
    if (!current) return [];
    const probeM = Math.max(4, Number(options.topologyBreakpointProbeM || config.topologyBreakpointProbeM || 14));
    const maxCandidates = Math.max(1, Number(options.topologyBreakpointMaxCandidates || config.topologyBreakpointMaxCandidates || 8));
    const forwardWindowM = Math.max(45, thresholdM * 4);
    const out = [];
    for (const [candidateId, node] of graph.nodes || []) {
      const id = String(candidateId);
      if (id === String(currentNodeId)) continue;
      const gapM = haversineM(current, node);
      if (!(gapM <= probeM + 1e-9)) continue;
      if (graphHasDirectedEdge(graph, currentNodeId, id) || graphHasDirectedEdge(graph, id, currentNodeId)) continue;
      const projection = projectPointToPolylineProgressM(node, route);
      if (!projection) continue;
      const deltaProgressM = projection.progressM - curProgressM;
      if (deltaProgressM < -backwardToleranceM || deltaProgressM > forwardWindowM) continue;
      if (projection.distanceM > Math.max(thresholdM * 1.35, probeM)) continue;
      const incident = incidentEdgesForBreakpoint(graph, id, route, curProgressM, thresholdM, backwardToleranceM, Math.max(35, Number(options.manualReplayMaxForwardGapM || 55)));
      const wayIds = [];
      const highways = [];
      for (const e of incident) {
        for (const w of e.wayIds || []) if (!wayIds.includes(String(w))) wayIds.push(String(w));
        if (e.highway && !highways.includes(e.highway)) highways.push(e.highway);
      }
      out.push({
        node: nodeMetaForBreakpoint(graph, id),
        gapM,
        routeDistanceM: projection.distanceM,
        routeProgressM: projection.progressM,
        deltaProgressM,
        forwardExists: graphHasDirectedEdge(graph, currentNodeId, id),
        reverseExists: graphHasDirectedEdge(graph, id, currentNodeId),
        highways: highways.slice(0, 8),
        wayIds: wayIds.slice(0, 12),
        incidentEdges: incident.slice(0, 6)
      });
    }
    out.sort((a, b) => (a.gapM + a.routeDistanceM * 0.8 + Math.max(0, -a.deltaProgressM) * 2) - (b.gapM + b.routeDistanceM * 0.8 + Math.max(0, -b.deltaProgressM) * 2));
    return out.slice(0, maxCandidates);
  }

  function buildTopologyBreakpointDiagnostics(graph, furthest, route, thresholdM, backwardToleranceM, maxForwardGapBaseM, rejectCounts, options = {}) {
    const node = graph?.nodes?.get(String(furthest?.node));
    if (!node) return null;
    const routeLen = routeDistanceM(route);
    const progressM = Math.max(0, Math.min(routeLen, Number(furthest?.progressM || 0)));
    const routePoint = pointAlongPolyline(route, progressM);
    const nextRoutePoint = pointAlongPolyline(route, Math.min(routeLen, progressM + Math.max(8, thresholdM * 0.75)));
    const incidentEdges = incidentEdgesForBreakpoint(graph, furthest.node, route, progressM, thresholdM, backwardToleranceM, maxForwardGapBaseM);
    const disconnected = nearbyDisconnectedCandidatesForBreakpoint(graph, furthest.node, route, progressM, thresholdM, backwardToleranceM, options);
    const acceptedIncident = incidentEdges.filter((e) => e.accepted);
    const rejectedIncident = incidentEdges.filter((e) => !e.accepted);
    let suspectedCause = "unknown";
    if (disconnected.length && disconnected[0].gapM <= Math.max(6, Math.min(Number(options.topologyBreakpointProbeM || config.topologyBreakpointProbeM || 14), thresholdM))) {
      suspectedCause = "near-miss-topology-gap";
    } else if (!acceptedIncident.length && rejectedIncident.length) {
      suspectedCause = "matcher-progress-rejection";
    } else if (!incidentEdges.length) {
      suspectedCause = "graph-dead-end";
    } else if (disconnected.length) {
      suspectedCause = "possible-topology-gap";
    }
    return {
      suspectedCause,
      thresholdM,
      progressM,
      progressRatio: routeLen > 0 ? progressM / routeLen : 0,
      routeLengthM: routeLen,
      routePoint: routePoint ? { lat: routePoint.lat, lng: routePoint.lng } : null,
      nextRoutePoint: nextRoutePoint ? { lat: nextRoutePoint.lat, lng: nextRoutePoint.lng } : null,
      currentNode: nodeMetaForBreakpoint(graph, furthest.node),
      incidentEdges: incidentEdges.slice(0, 12),
      acceptedIncidentCount: acceptedIncident.length,
      rejectedIncidentCount: rejectedIncident.length,
      incidentBidirectionalCount: incidentEdges.filter((e) => e.forwardExists && e.reverseExists).length,
      incidentOneWayCount: incidentEdges.filter((e) => e.forwardExists && !e.reverseExists).length,
      nearestDisconnected: disconnected[0] || null,
      nearbyDisconnected: disconnected,
      rejectCounts: Object.assign({}, rejectCounts || {})
    };
  }

  function pathCoverageAgainstRoute(pathPoints, route, thresholdM = 12, spacingM = 10) {
    const samples = samplePolyline(route, spacingM);
    if (!samples.length || !pathPoints?.length) return { coverageRatio: 0, averageDistanceM: Infinity, maxDistanceM: Infinity };
    let matched = 0, sum = 0, maxD = 0;
    for (const p of samples) {
      const hit = nearestPointOnGeometry(p, pathPoints);
      const d = hit?.distanceM ?? Infinity;
      if (d <= thresholdM) matched += 1;
      if (Number.isFinite(d)) { sum += d; maxD = Math.max(maxD, d); }
    }
    return { coverageRatio: matched / samples.length, averageDistanceM: sum / samples.length, maxDistanceM: maxD, samples: samples.length };
  }
  function headingDifferenceDeg(a, b, c, d) {
    const A = asLatLng(a), B = asLatLng(b), C = asLatLng(c), D = asLatLng(d);
    if (!A || !B || !C || !D) return null;
    const lat0 = ((A.lat + B.lat + C.lat + D.lat) / 4) * Math.PI / 180;
    const mx = 111320 * Math.max(0.2, Math.cos(lat0));
    const my = 110540;
    const h1 = Math.atan2((B.lat - A.lat) * my, (B.lng - A.lng) * mx) * 180 / Math.PI;
    const h2 = Math.atan2((D.lat - C.lat) * my, (D.lng - C.lng) * mx) * 180 / Math.PI;
    let diff = Math.abs(h1 - h2) % 180;
    if (diff > 90) diff = 180 - diff;
    return diff;
  }

  function pathDivergenceDiagnostics(graph, steps, route, fidelityThresholdM, sampleSpacingM = 6) {
    const manualRoute = (route || []).map(asLatLng).filter(Boolean);
    const routeLen = routeDistanceM(manualRoute);
    if (!graph || !steps?.length || manualRoute.length < 2 || !(fidelityThresholdM > 0)) return null;

    let walkedPathM = 0;
    let firstThresholdExceeded = null;
    let firstMeaningfulDivergence = null;
    let firstParallelDivergence = null;
    const divergentEdges = [];

    for (const step of steps) {
      const edge = graph.edges.get(step.edgeId);
      if (!edge) continue;
      const geometry = edgeGeometryFor(edge, step.from);
      const geometryLen = routeDistanceM(geometry);
      const count = Math.max(2, Math.ceil(Math.max(1, geometryLen) / Math.max(3, Number(sampleSpacingM) || 6)) + 1);
      const samples = [];
      let outside = 0;
      let maxDistanceM = 0;
      let firstOutside = null;

      for (let i = 0; i < count; i += 1) {
        const alongM = geometryLen * (i / (count - 1));
        const point = pointAlongPolyline(geometry, alongM);
        const projection = point ? projectPointToPolylineProgressM(point, manualRoute) : null;
        if (!projection) continue;
        const item = {
          point,
          pathProgressM: walkedPathM + alongM,
          manualProgressM: projection.progressM,
          manualProgressRatio: routeLen > 0 ? projection.progressM / routeLen : 0,
          distanceM: projection.distanceM,
          nearestManualPoint: projection.point,
          manualSegmentIndex: projection.segmentIndex
        };
        samples.push(item);
        maxDistanceM = Math.max(maxDistanceM, projection.distanceM);
        if (projection.distanceM > fidelityThresholdM) {
          outside += 1;
          if (!firstOutside) firstOutside = item;
          if (!firstThresholdExceeded) firstThresholdExceeded = item;
        }
      }

      const outsideRatio = samples.length ? outside / samples.length : 0;
      if (outsideRatio >= 0.5 && firstOutside) {
        const idx = Math.max(0, Math.min(manualRoute.length - 2, Number(firstOutside.manualSegmentIndex || 0)));
        const edgeHeadingDeltaDeg = geometry.length >= 2
          ? headingDifferenceDeg(geometry[0], geometry[geometry.length - 1], manualRoute[idx], manualRoute[idx + 1])
          : null;
        const parallelToManual = Number.isFinite(edgeHeadingDeltaDeg) && edgeHeadingDeltaDeg <= 30 && firstOutside.distanceM <= Math.max(60, fidelityThresholdM * 4);
        const detail = {
          pathProgressM: firstOutside.pathProgressM,
          manualProgressM: firstOutside.manualProgressM,
          manualProgressRatio: firstOutside.manualProgressRatio,
          distanceM: firstOutside.distanceM,
          point: firstOutside.point,
          nearestManualPoint: firstOutside.nearestManualPoint,
          edgeId: edge.id,
          fromNodeId: String(step.from),
          toNodeId: String(step.to),
          highway: primaryHighway(edge),
          wayIds: (edge.wayIds || []).slice(0, 8),
          tags: compactTagsForBreakpoint(edge),
          outsideSampleRatio: outsideRatio,
          maxDistanceM,
          headingDeltaDeg: edgeHeadingDeltaDeg,
          parallelToManual
        };
        divergentEdges.push(detail);
        if (!firstMeaningfulDivergence) firstMeaningfulDivergence = detail;
        if (!firstParallelDivergence && parallelToManual) firstParallelDivergence = detail;
      }
      walkedPathM += Number(edge.distanceM || geometryLen || 0);
    }

    const thresholdExceeded = firstThresholdExceeded ? {
      pathProgressM: firstThresholdExceeded.pathProgressM,
      manualProgressM: firstThresholdExceeded.manualProgressM,
      manualProgressRatio: firstThresholdExceeded.manualProgressRatio,
      distanceM: firstThresholdExceeded.distanceM,
      point: firstThresholdExceeded.point,
      nearestManualPoint: firstThresholdExceeded.nearestManualPoint
    } : null;

    return {
      fidelityThresholdM,
      routeLengthM: routeLen,
      firstThresholdExceeded: thresholdExceeded,
      firstDivergence: firstMeaningfulDivergence || (thresholdExceeded ? Object.assign({ edgeId: null, highway: null, wayIds: [], tags: {}, parallelToManual: false }, thresholdExceeded) : null),
      firstParallelDivergence,
      switchedToNearbyParallel: Boolean(firstParallelDivergence),
      divergentEdges: divergentEdges.slice(0, 8)
    };
  }

  function samplePolyline(points, spacingM) {
    const pts = (points || []).map(asLatLng).filter(Boolean);
    if (pts.length < 2) return pts;
    const total = routeDistanceM(pts);
    const count = Math.max(2, Math.ceil(total / Math.max(5, Number(spacingM) || 18)) + 1);
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(pointAlongPolyline(pts, total * (i / (count - 1))));
    return out.filter(Boolean);
  }

  function nearestGraphEdge(graph, point) {
    let best = null;
    for (const edge of graph?.edges?.values?.() || []) {
      const hit = nearestPointOnGeometry(point, edge.geometry);
      if (hit && (!best || hit.distanceM < best.distanceM)) best = Object.assign({ edge }, hit);
    }
    return best;
  }

  // dev34.5: endpoint snapping must not let a tiny disconnected island win just
  // because one of its edges is a few metres closer to A or B.  Build weak
  // component labels on the already-loaded local fine graph, then find the
  // nearest edge to each endpoint *within every component*.  If the globally
  // nearest A/B edges are already in the same component, behavior is unchanged.
  // Otherwise, fall back to the common component that minimizes endpoint access
  // distance.  This is strictly a connectivity rescue; route cost/shade cost and
  // detour limits remain untouched.
  function fineGraphComponentIndex(graph) {
    const byNode = new Map();
    const components = new Map();
    let serial = 0;
    for (const rawId of graph?.nodes?.keys?.() || []) {
      const start = String(rawId);
      if (byNode.has(start)) continue;
      const id = `c${++serial}`;
      const component = { id, nodeCount: 0, edgeCount: 0, edgeIds: new Set() };
      const queue = [start];
      byNode.set(start, id);
      for (let qi = 0; qi < queue.length; qi += 1) {
        const nodeId = queue[qi];
        component.nodeCount += 1;
        for (const ref of graph?.adjacency?.get?.(nodeId) || []) {
          const next = String(typeof ref === 'string' ? (() => {
            const e = graph?.edges?.get?.(ref);
            if (!e) return '';
            const a = String(e.a ?? e.from ?? ''), b = String(e.b ?? e.to ?? '');
            return a === nodeId ? b : (b === nodeId ? a : '');
          })() : ref?.to ?? '');
          if (!next || byNode.has(next) || !graph?.nodes?.has?.(next)) continue;
          byNode.set(next, id);
          queue.push(next);
        }
      }
      components.set(id, component);
    }
    for (const [edgeId, edge] of graph?.edges || []) {
      const a = String(edge?.a ?? edge?.from ?? '');
      const b = String(edge?.b ?? edge?.to ?? '');
      const ca = byNode.get(a), cb = byNode.get(b);
      if (!ca || ca !== cb) continue;
      const c = components.get(ca);
      if (!c) continue;
      c.edgeIds.add(String(edgeId));
      c.edgeCount += 1;
    }
    return { byNode, components };
  }

  function connectedEndpointSnapPlan(graph, a, b, maxM = Infinity, options = {}) {
    const A = asLatLng(a), B = asLatLng(b);
    if (!A || !B || !graph?.edges?.size) return { available:false, reason:'snap-plan-input-missing' };
    const limit = Math.max(0, Number(maxM));
    const index = fineGraphComponentIndex(graph);
    const bestA = new Map(), bestB = new Map();
    let nearestA = null, nearestB = null;
    for (const edge of graph.edges.values()) {
      const ca = index.byNode.get(String(edge.a ?? edge.from ?? ''));
      if (!ca) continue;
      const ha = nearestPointOnGeometry(A, edge.geometry || []);
      if (ha) {
        const hit = Object.assign({ edge, componentId:ca }, ha);
        if (!nearestA || hit.distanceM < nearestA.distanceM) nearestA = hit;
        const prev = bestA.get(ca);
        if (!prev || hit.distanceM < prev.distanceM) bestA.set(ca, hit);
      }
      const hb = nearestPointOnGeometry(B, edge.geometry || []);
      if (hb) {
        const hit = Object.assign({ edge, componentId:ca }, hb);
        if (!nearestB || hit.distanceM < nearestB.distanceM) nearestB = hit;
        const prev = bestB.get(ca);
        if (!prev || hit.distanceM < prev.distanceM) bestB.set(ca, hit);
      }
    }
    if (!nearestA || !nearestB) return { available:false, reason:'snap-plan-no-edge' };
    const nearestAOk = nearestA.distanceM <= limit + 1e-9;
    const nearestBOk = nearestB.distanceM <= limit + 1e-9;
    if (!nearestAOk || !nearestBOk) {
      return { available:false, reason:'snap-plan-outside-radius', nearestA:nearestA.distanceM, nearestB:nearestB.distanceM, nearestComponentA:nearestA.componentId, nearestComponentB:nearestB.componentId };
    }
    const nearestSame = nearestA.componentId === nearestB.componentId;
    let selected = nearestSame ? {
      componentId:nearestA.componentId, hitA:nearestA, hitB:nearestB
    } : null;
    if (!selected) {
      const candidates = [];
      for (const [componentId, hitA] of bestA) {
        const hitB = bestB.get(componentId);
        if (!hitB || hitA.distanceM > limit + 1e-9 || hitB.distanceM > limit + 1e-9) continue;
        const component = index.components.get(componentId);
        candidates.push({
          componentId, hitA, hitB,
          maxSnapM:Math.max(hitA.distanceM, hitB.distanceM),
          sumSnapM:hitA.distanceM + hitB.distanceM,
          edgeCount:Number(component?.edgeCount || 0),
          nodeCount:Number(component?.nodeCount || 0)
        });
      }
      candidates.sort((x, y) =>
        x.maxSnapM - y.maxSnapM ||
        x.sumSnapM - y.sumSnapM ||
        y.edgeCount - x.edgeCount ||
        String(x.componentId).localeCompare(String(y.componentId))
      );
      selected = candidates[0] || null;
      if (!selected) {
        return {
          available:false, reason:'no-common-snap-component',
          nearestA:nearestA.distanceM, nearestB:nearestB.distanceM,
          nearestComponentA:nearestA.componentId, nearestComponentB:nearestB.componentId,
          componentCount:index.components.size
        };
      }
    }
    const component = index.components.get(selected.componentId);
    const fallbackUsed = !nearestSame;
    return {
      available:true, fallbackUsed, componentId:selected.componentId,
      edgeIds:component?.edgeIds || new Set(), componentEdgeCount:Number(component?.edgeCount || 0), componentNodeCount:Number(component?.nodeCount || 0),
      nearestA:Number(nearestA.distanceM), nearestB:Number(nearestB.distanceM),
      nearestComponentA:nearestA.componentId, nearestComponentB:nearestB.componentId,
      selectedA:Number(selected.hitA.distanceM), selectedB:Number(selected.hitB.distanceM),
      selectedEdgeA:String(selected.hitA.edge?.id || ''), selectedEdgeB:String(selected.hitB.edge?.id || ''),
      componentCount:index.components.size
    };
  }

  function graphForConnectedEndpointSnap(graph, a, b, maxM = Infinity, options = {}) {
    const enabled = options.connectivitySnapFallbackEnabled ?? config.connectivitySnapFallbackEnabled ?? true;
    const plan = connectedEndpointSnapPlan(graph, a, b, maxM, options);
    if (!plan.available || !plan.fallbackUsed || enabled === false) return { graph, plan };
    const subset = subsetExistingFineGraph(graph, plan.edgeIds);
    if (!subset?.edges?.size) return { graph, plan:Object.assign({}, plan, { available:false, reason:'snap-component-subset-empty' }) };
    return { graph:subset, plan };
  }

  function graphStats(graph) {
    const types = {};
    const lengths = [];
    for (const edge of graph?.edges?.values?.() || []) {
      const h = primaryHighway(edge);
      types[h] = (types[h] || 0) + 1;
      lengths.push(Number(edge.distanceM) || 0);
    }
    lengths.sort((a, b) => a - b);
    return {
      typeCounts: types,
      longestEdgeM: lengths.length ? lengths[lengths.length - 1] : 0,
      medianEdgeM: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0
    };
  }

  function debugSnapshot() {
    const state = lastGraphDebug;
    if (!state?.graph) return null;
    const graph = state.graph;
    const edges = [];
    for (const edge of graph.edges.values()) {
      const shade = lastShadeDebug.get(edge.id);
      edges.push({
        id: edge.id,
        a: edge.a,
        b: edge.b,
        distanceM: edge.distanceM,
        geometry: edge.geometry.map((p) => ({ lat: p.lat, lng: p.lng })),
        wayIds: edge.wayIds.slice(),
        tagsSummary: edge.tagsSummary || {},
        highway: primaryHighway(edge),
        family: highwayFamily(primaryHighway(edge)),
        inFastest: lastRouteEdges.fastest.has(edge.id),
        inMinSun: lastRouteEdges.minSun.has(edge.id),
        shadeEstimate: shade ? {
          evaluations: shade.count,
          samples: shade.samples,
          directSunFraction: shade.count ? shade.directSunFractionSum / shade.count : null,
          shadedFraction: shade.count ? shade.shadedFractionSum / shade.count : null,
          directSunSeconds: shade.count ? shade.directSunSecondsSum / shade.count : null,
          lastDirectSunSeconds: shade.lastDirectSunSeconds,
          lastAt: shade.lastAt
        } : null
      });
    }
    const connectors = [];
    for (const [nodeId, refs] of graph.adjacency) {
      const families = new Set();
      const highways = new Set();
      for (const ref of refs || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge) continue;
        const h = primaryHighway(edge);
        highways.add(h);
        families.add(highwayFamily(h));
      }
      if (families.size >= 2) {
        const node = graph.nodes.get(nodeId);
        if (node) connectors.push({ id: nodeId, lat: node.lat, lng: node.lng, highways: Array.from(highways), degree: refs.length });
      }
    }
    return {
      version: VERSION,
      bbox: state.bbox,
      overpassEndpoint: state.endpoint,
      snapA: state.snapA ? { id: state.snapA.id, lat: state.snapA.node.lat, lng: state.snapA.node.lng, distanceM: state.snapA.distanceM, snapType: state.snapA.snapType || "node", highway: state.snapA.sourceHighway || null, wayId: state.snapA.sourceWayId || null, pedestrianRank: state.snapA.pedestrianRank ?? null, pedestrianLabel: state.snapA.pedestrianLabel || null, geometricNearestDistanceM: state.snapA.geometricNearestDistanceM ?? state.snapA.distanceM, extraSnapDistanceM: state.snapA.extraSnapDistanceM || 0 } : null,
      snapB: state.snapB ? { id: state.snapB.id, lat: state.snapB.node.lat, lng: state.snapB.node.lng, distanceM: state.snapB.distanceM, snapType: state.snapB.snapType || "node", highway: state.snapB.sourceHighway || null, wayId: state.snapB.sourceWayId || null, pedestrianRank: state.snapB.pedestrianRank ?? null, pedestrianLabel: state.snapB.pedestrianLabel || null, geometricNearestDistanceM: state.snapB.geometricNearestDistanceM ?? state.snapB.distanceM, extraSnapDistanceM: state.snapB.extraSnapDistanceM || 0 } : null,
      edges,
      connectors,
      stats: graphStats(graph)
    };
  }

  function diagnosePolyline(points, options = {}) {
    const state = lastGraphDebug;
    if (!state?.graph) return { available: false, reason: "no-graph" };
    const route = (points || []).map(asLatLng).filter(Boolean);
    if (route.length < 2) return { available: false, reason: "route-too-short" };
    const spacingM = Math.max(5, Number(options.sampleSpacingM || config.diagnosticSampleSpacingM || 18));
    const thresholdM = Math.max(4, Number(options.thresholdM || config.diagnosticMatchThresholdM || 16));
    const samples = samplePolyline(route, spacingM);
    const hits = [];
    const edgeUse = new Map();
    let matched = 0;
    let distanceSum = 0;
    let maxDistance = 0;
    let longestGapSamples = 0;
    let currentGap = 0;
    for (const point of samples) {
      const hit = nearestGraphEdge(state.graph, point);
      const distanceM = Number(hit?.distanceM ?? Infinity);
      const ok = distanceM <= thresholdM;
      if (ok) {
        matched += 1;
        currentGap = 0;
        const edge = hit.edge;
        edgeUse.set(edge.id, (edgeUse.get(edge.id) || 0) + 1);
      } else {
        currentGap += 1;
        longestGapSamples = Math.max(longestGapSamples, currentGap);
      }
      if (Number.isFinite(distanceM)) {
        distanceSum += distanceM;
        maxDistance = Math.max(maxDistance, distanceM);
      }
      hits.push({
        lat: point.lat, lng: point.lng, matched: ok, distanceM,
        edgeId: hit?.edge?.id || null,
        highway: hit?.edge ? primaryHighway(hit.edge) : null,
        nearest: hit?.point || null
      });
    }
    const matchedEdges = Array.from(edgeUse.entries()).sort((a, b) => b[1] - a[1]).map(([edgeId, count]) => {
      const edge = state.graph.edges.get(edgeId);
      return { edgeId, count, highway: edge ? primaryHighway(edge) : "unknown", wayIds: edge?.wayIds?.slice?.() || [] };
    });
    const selectedEdges = lastRouteEdges.minSun.size ? lastRouteEdges.minSun : lastRouteEdges.fastest;
    const overlapCount = matchedEdges.reduce((sum, item) => sum + (selectedEdges.has(item.edgeId) ? item.count : 0), 0);
    const coverageRatio = samples.length ? matched / samples.length : 0;
    const overlapRatio = matched ? overlapCount / matched : 0;
    let interpretation = "手繪線與目前 graph 的關係尚不明確。";
    if (coverageRatio >= 0.8 && overlapRatio < 0.35) interpretation = "手繪路線大多存在於 OSM graph，但目前自動最不曬路線沒有使用這些 edge；應優先檢查 edge 日照成本與搜尋剪枝，而不是再補路網。";
    else if (coverageRatio >= 0.8) interpretation = "手繪路線大多存在於 OSM graph，而且與目前自動路線有明顯重疊；差異可能集中在少數入口／出口或 shade-cost 細節。";
    else if (coverageRatio < 0.5) interpretation = "手繪路線有大段不在目前 OSM graph 附近；應優先檢查河堤／步道是否缺 way、缺 connector，或圖資拓樸沒有接起來。";
    else interpretation = "手繪路線部分存在於 graph，但仍有明顯缺口；可能是入口／出口 connector 缺失或局部 OSM 拓樸斷線。";
    return {
      available: true,
      thresholdM,
      sampleSpacingM: spacingM,
      totalSamples: samples.length,
      matchedSamples: matched,
      coverageRatio,
      averageDistanceM: samples.length ? distanceSum / samples.length : null,
      maxDistanceM: maxDistance,
      longestGapApproxM: longestGapSamples * spacingM,
      overlapWithSelectedRatio: overlapRatio,
      matchedEdges: matchedEdges.slice(0, 20),
      hits,
      interpretation
    };
  }

  function edgeDistanceToPolylineM(edge, route, sampleCount = 5) {
    const geometry = edge?.geometry || [];
    if (geometry.length < 2 || route.length < 2) return Infinity;
    const pts = shadeSamplePoints(geometry, Math.max(8, edge.distanceM / Math.max(2, sampleCount)), sampleCount);
    const samples = [geometry[0], ...pts, geometry[geometry.length - 1]].filter(Boolean);
    let maxD = 0;
    for (const p of samples) {
      const hit = nearestPointOnGeometry(p, route);
      if (!hit) return Infinity;
      maxD = Math.max(maxD, hit.distanceM);
    }
    return maxD;
  }



  function corridorIncidentAudit(graph, nodeId, route, thresholdM, edgeDistanceCache = new Map()) {
    const out = [];
    for (const ref of graph?.adjacency?.get(String(nodeId)) || []) {
      const edge = graph.edges.get(ref.edgeId);
      if (!edge) continue;
      let corridorDistanceM = edgeDistanceCache.get(edge.id);
      if (corridorDistanceM == null) {
        corridorDistanceM = edgeDistanceToPolylineM(edge, route, 5);
        edgeDistanceCache.set(edge.id, corridorDistanceM);
      }
      out.push({
        edgeId: edge.id,
        toNodeId: String(ref.to),
        highway: primaryHighway(edge),
        wayIds: (edge.wayIds || []).slice(0, 8),
        tags: compactTagsForBreakpoint(edge),
        distanceM: Number(edge.distanceM || 0),
        corridorDistanceM,
        withinCorridor: corridorDistanceM <= thresholdM + 1e-9
      });
    }
    return out.sort((a, b) => (b.withinCorridor - a.withinCorridor) || (a.corridorDistanceM - b.corridorDistanceM) || (a.distanceM - b.distanceM));
  }

  function strictCorridorConnectivityAudit(graph, startId, endId, route, thresholdM, options = {}, sharedEdgeDistanceCache = null) {
    const manualRoute = (route || []).map(asLatLng).filter(Boolean);
    const routeLen = routeDistanceM(manualRoute);
    const threshold = Math.max(4, Number(thresholdM || 0));
    const edgeDistanceCache = sharedEdgeDistanceCache || new Map();
    const start = String(startId), end = String(endId);
    const reverseAdjacency = new Map();

    function edgeCorridorDistance(edge) {
      if (!edge) return Infinity;
      let value = edgeDistanceCache.get(edge.id);
      if (value == null) {
        value = edgeDistanceToPolylineM(edge, manualRoute, 5);
        edgeDistanceCache.set(edge.id, value);
      }
      return value;
    }

    for (const [from, refs] of graph?.adjacency || []) {
      for (const ref of refs || []) {
        const key = String(ref.to);
        if (!reverseAdjacency.has(key)) reverseAdjacency.set(key, []);
        reverseAdjacency.get(key).push({ from: String(from), edgeId: ref.edgeId });
      }
    }

    const reachableFromA = new Set([start]);
    const prevFromA = new Map();
    const queueA = [start];
    for (let qi = 0; qi < queueA.length; qi += 1) {
      const nodeId = queueA[qi];
      for (const ref of graph?.adjacency?.get(nodeId) || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge || edgeCorridorDistance(edge) > threshold + 1e-9) continue;
        const next = String(ref.to);
        if (reachableFromA.has(next)) continue;
        reachableFromA.add(next);
        prevFromA.set(next, { from: nodeId, edgeId: edge.id });
        queueA.push(next);
      }
    }

    const canReachB = new Set([end]);
    const queueB = [end];
    for (let qi = 0; qi < queueB.length; qi += 1) {
      const nodeId = queueB[qi];
      for (const ref of reverseAdjacency.get(nodeId) || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge || edgeCorridorDistance(edge) > threshold + 1e-9) continue;
        const prevNode = String(ref.from);
        if (canReachB.has(prevNode)) continue;
        canReachB.add(prevNode);
        queueB.push(prevNode);
      }
    }

    function projectedNode(nodeId) {
      const node = graph?.nodes?.get(String(nodeId));
      if (!node) return null;
      const projection = projectPointToPolylineProgressM(node, manualRoute);
      if (!projection) return null;
      return {
        node: nodeMetaForBreakpoint(graph, nodeId),
        progressM: projection.progressM,
        progressRatio: routeLen > 0 ? projection.progressM / routeLen : 0,
        routeDistanceM: projection.distanceM,
        routePoint: projection.point ? { lat: projection.point.lat, lng: projection.point.lng } : null
      };
    }

    const aProjected = [];
    for (const nodeId of reachableFromA) {
      const item = projectedNode(nodeId);
      if (item) aProjected.push(item);
    }
    const bProjected = [];
    for (const nodeId of canReachB) {
      const item = projectedNode(nodeId);
      if (item) bProjected.push(item);
    }
    aProjected.sort((a, b) => b.progressM - a.progressM || a.routeDistanceM - b.routeDistanceM);
    bProjected.sort((a, b) => a.progressM - b.progressM || a.routeDistanceM - b.routeDistanceM);
    const furthestFromA = aProjected[0] || null;
    const earliestToB = bProjected[0] || null;

    let witness = null;
    const connected = reachableFromA.has(end);
    if (connected) {
      const steps = [];
      let cur = end;
      let guard = 0;
      while (cur !== start && guard++ < 20000) {
        const prev = prevFromA.get(cur);
        if (!prev) break;
        steps.push({ edgeId: prev.edgeId, from: prev.from, to: cur });
        cur = prev.from;
      }
      if (cur === start) {
        steps.reverse();
        const path = pathFromEdgeSteps(graph, steps);
        const coverage = pathCoverageAgainstRoute(path.points, manualRoute, threshold, 10);
        witness = {
          distanceM: path.distanceM,
          edgeIds: (path.edgeIds || []).slice(),
          coverageRatio: coverage.coverageRatio,
          averageDistanceM: coverage.averageDistanceM,
          maxDistanceM: coverage.maxDistanceM
        };
      }
    }

    const pairLimit = Math.max(30, Number(options.strictCorridorPairCandidateLimit || 120));
    const lateralLimit = Math.max(threshold * 1.8, Number(options.strictCorridorPairLateralM || 28));
    const aCandidates = aProjected.filter((x) => x.routeDistanceM <= lateralLimit).slice(0, pairLimit);
    const bCandidates = bProjected.filter((x) => x.routeDistanceM <= lateralLimit).slice(0, pairLimit);
    let nearestComponentGap = null;
    if (!connected) {
      for (const a of aCandidates) {
        const an = graph.nodes.get(String(a.node.id));
        if (!an) continue;
        for (const b of bCandidates) {
          if (b.progressM + threshold * 2 < a.progressM) continue;
          const bn = graph.nodes.get(String(b.node.id));
          if (!bn) continue;
          const gapM = haversineM(an, bn);
          const progressGapM = b.progressM - a.progressM;
          const directForward = graphHasDirectedEdge(graph, a.node.id, b.node.id);
          const directReverse = graphHasDirectedEdge(graph, b.node.id, a.node.id);
          const score = gapM + Math.max(0, progressGapM) * 0.015 + (a.routeDistanceM + b.routeDistanceM) * 0.08;
          if (!nearestComponentGap || score < nearestComponentGap._score) {
            nearestComponentGap = {
              _score: score,
              gapM,
              progressGapM,
              a,
              b,
              directForward,
              directReverse
            };
          }
        }
      }
      if (nearestComponentGap) {
        delete nearestComponentGap._score;
        nearestComponentGap.aIncidentEdges = corridorIncidentAudit(graph, nearestComponentGap.a.node.id, manualRoute, threshold, edgeDistanceCache).slice(0, 6);
        nearestComponentGap.bIncidentEdges = corridorIncidentAudit(graph, nearestComponentGap.b.node.id, manualRoute, threshold, edgeDistanceCache).slice(0, 6);
      }
    }

    const boundaryNodeId = furthestFromA?.node?.id || start;
    const boundaryIncident = corridorIncidentAudit(graph, boundaryNodeId, manualRoute, threshold, edgeDistanceCache);
    const acceptedBoundary = boundaryIncident.filter((e) => e.withinCorridor);
    const rejectedBoundary = boundaryIncident.filter((e) => !e.withinCorridor);
    const probeM = Math.max(4, Number(options.topologyBreakpointProbeM || config.topologyBreakpointProbeM || 14));
    let suspectedCause = connected ? "strict-corridor-connected" : "strict-corridor-disconnected";
    if (!connected && nearestComponentGap && nearestComponentGap.gapM <= probeM + 1e-9 && !nearestComponentGap.directForward) {
      suspectedCause = "strict-component-near-gap";
    } else if (!connected && rejectedBoundary.length && rejectedBoundary[0].corridorDistanceM <= Math.max(threshold * 2.2, 32)) {
      suspectedCause = "strict-corridor-needs-lateral-exit";
    }

    return {
      thresholdM: threshold,
      connected,
      suspectedCause,
      routeLengthM: routeLen,
      reachableFromACount: reachableFromA.size,
      canReachBCount: canReachB.size,
      furthestFromA,
      earliestToB,
      progressGapM: furthestFromA && earliestToB ? earliestToB.progressM - furthestFromA.progressM : null,
      nearestComponentGap,
      boundaryIncidentEdges: boundaryIncident.slice(0, 12),
      acceptedBoundaryEdgeCount: acceptedBoundary.length,
      rejectedBoundaryEdgeCount: rejectedBoundary.length,
      witness
    };
  }


  function corridorThresholdDeltaAudit(graph, startId, endId, route, lowerThresholdM, upperThresholdM, options = {}, sharedEdgeDistanceCache = null, precomputed = {}) {
    const manualRoute = (route || []).map(asLatLng).filter(Boolean);
    const routeLen = routeDistanceM(manualRoute);
    const lower = Math.max(4, Number(lowerThresholdM || 0));
    const upper = Math.max(lower, Number(upperThresholdM || lower));
    const start = String(startId), end = String(endId);
    const edgeDistanceCache = sharedEdgeDistanceCache || new Map();

    function edgeCorridorDistance(edge) {
      if (!edge) return Infinity;
      let value = edgeDistanceCache.get(edge.id);
      if (value == null) {
        value = edgeDistanceToPolylineM(edge, manualRoute, 5);
        edgeDistanceCache.set(edge.id, value);
      }
      return value;
    }

    const lowerAudit = precomputed.lowerAudit || strictCorridorConnectivityAudit(graph, start, end, manualRoute, lower, options, edgeDistanceCache);
    const upperAudit = precomputed.upperAudit || strictCorridorConnectivityAudit(graph, start, end, manualRoute, upper, options, edgeDistanceCache);
    const base = {
      lowerThresholdM: lower,
      upperThresholdM: upper,
      lowerConnected: Boolean(lowerAudit?.connected),
      upperConnected: Boolean(upperAudit?.connected),
      transitionFound: !lowerAudit?.connected && Boolean(upperAudit?.connected),
      outcome: lowerAudit?.connected ? 'lower-already-connected' : (upperAudit?.connected ? 'lower-disconnected-upper-connected' : 'upper-still-disconnected')
    };
    if (!(upper > lower + 1e-9) || lowerAudit?.connected || !upperAudit?.connected) return base;

    const reverseAdjacency = new Map();
    for (const [from, refs] of graph?.adjacency || []) {
      for (const ref of refs || []) {
        const key = String(ref.to);
        if (!reverseAdjacency.has(key)) reverseAdjacency.set(key, []);
        reverseAdjacency.get(key).push({ from: String(from), edgeId: ref.edgeId });
      }
    }

    function reachableFromA(thresholdM, forbiddenEdgeIds = null, forbiddenWayIds = null) {
      const seen = new Set([start]);
      const prev = new Map();
      const queue = [start];
      for (let qi = 0; qi < queue.length; qi += 1) {
        const nodeId = queue[qi];
        for (const ref of graph?.adjacency?.get(nodeId) || []) {
          const edge = graph.edges.get(ref.edgeId);
          if (!edge || edgeCorridorDistance(edge) > thresholdM + 1e-9) continue;
          if (forbiddenEdgeIds?.has(edge.id)) continue;
          if (forbiddenWayIds?.size && (edge.wayIds || []).some((w) => forbiddenWayIds.has(String(w)))) continue;
          const next = String(ref.to);
          if (seen.has(next)) continue;
          seen.add(next);
          prev.set(next, { from: nodeId, edgeId: edge.id });
          queue.push(next);
        }
      }
      return { seen, prev };
    }

    function reverseReachableToB(thresholdM) {
      const seen = new Set([end]);
      const queue = [end];
      for (let qi = 0; qi < queue.length; qi += 1) {
        const nodeId = queue[qi];
        for (const ref of reverseAdjacency.get(nodeId) || []) {
          const edge = graph.edges.get(ref.edgeId);
          if (!edge || edgeCorridorDistance(edge) > thresholdM + 1e-9) continue;
          const prevNode = String(ref.from);
          if (seen.has(prevNode)) continue;
          seen.add(prevNode);
          queue.push(prevNode);
        }
      }
      return seen;
    }

    const lowerA = reachableFromA(lower).seen;
    const lowerB = reverseReachableToB(lower);
    const upperSearch = reachableFromA(upper);
    if (!upperSearch.seen.has(end)) return Object.assign(base, { transitionFound: false, outcome: 'upper-witness-missing' });

    const steps = [];
    let cur = end;
    let guard = 0;
    while (cur !== start && guard++ < 20000) {
      const prev = upperSearch.prev.get(cur);
      if (!prev) break;
      steps.push({ edgeId: prev.edgeId, from: prev.from, to: cur });
      cur = prev.from;
    }
    if (cur !== start) return Object.assign(base, { transitionFound: false, outcome: 'upper-witness-reconstruction-failed' });
    steps.reverse();
    const nodeSeq = [start, ...steps.map((x) => String(x.to))];

    let bridgeEndNodeIndex = -1;
    for (let i = 1; i < nodeSeq.length; i += 1) {
      if (lowerB.has(nodeSeq[i])) { bridgeEndNodeIndex = i; break; }
    }
    let bridgeStartNodeIndex = -1;
    if (bridgeEndNodeIndex > 0) {
      for (let i = bridgeEndNodeIndex - 1; i >= 0; i -= 1) {
        if (lowerA.has(nodeSeq[i])) { bridgeStartNodeIndex = i; break; }
      }
    }
    if (bridgeStartNodeIndex < 0) bridgeStartNodeIndex = 0;
    if (bridgeEndNodeIndex < 0) bridgeEndNodeIndex = nodeSeq.length - 1;
    const bridgeSteps = steps.slice(bridgeStartNodeIndex, bridgeEndNodeIndex);

    function nodeProgress(nodeId) {
      const node = graph?.nodes?.get(String(nodeId));
      const proj = node ? projectPointToPolylineProgressM(node, manualRoute) : null;
      return proj ? {
        progressM: proj.progressM,
        progressRatio: routeLen > 0 ? proj.progressM / routeLen : 0,
        routeDistanceM: proj.distanceM
      } : null;
    }

    function edgeDetail(step) {
      const edge = graph.edges.get(step.edgeId);
      if (!edge) return null;
      const geometry = edge.geometry || [];
      const point = geometry.length ? geometry[Math.floor(geometry.length / 2)] : graph.nodes.get(String(step.from)) || null;
      return {
        edgeId: edge.id,
        from: String(step.from),
        to: String(step.to),
        highway: primaryHighway(edge),
        highways: (edge?.tagsSummary?.highway || [primaryHighway(edge)]).map(String).slice(0, 8),
        wayIds: (edge.wayIds || []).map(String).slice(0, 8),
        distanceM: Number(edge.distanceM || 0),
        corridorDistanceM: edgeCorridorDistance(edge),
        newlyAdmitted: edgeCorridorDistance(edge) > lower + 1e-9 && edgeCorridorDistance(edge) <= upper + 1e-9,
        tags: compactTagsForBreakpoint(edge),
        point: point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) ? { lat: Number(point.lat), lng: Number(point.lng) } : null
      };
    }

    const bridgeEdges = bridgeSteps.map(edgeDetail).filter(Boolean);
    const newlyAdmittedEdges = bridgeEdges.filter((e) => e.newlyAdmitted);
    const allWitnessDeltaEdges = steps.map(edgeDetail).filter((e) => e?.newlyAdmitted);
    const bridgePath = bridgeSteps.length ? pathFromEdgeSteps(graph, bridgeSteps) : null;
    const bridgeDistanceM = bridgeEdges.reduce((sum, e) => sum + Number(e.distanceM || 0), 0);
    const newlyAdmittedDistanceM = newlyAdmittedEdges.reduce((sum, e) => sum + Number(e.distanceM || 0), 0);

    function summarizeBy(field, edges) {
      const stats = new Map();
      for (const e of edges) {
        const keys = field === 'wayIds' ? (e.wayIds?.length ? e.wayIds : ['—']) : [e[field] || 'unknown'];
        for (const keyRaw of keys) {
          const key = String(keyRaw);
          const item = stats.get(key) || { key, distanceM: 0, edgeCount: 0, highway: e.highway || 'unknown' };
          item.distanceM += Number(e.distanceM || 0);
          item.edgeCount += 1;
          if (!item.highway || item.highway === 'unknown') item.highway = e.highway || 'unknown';
          stats.set(key, item);
        }
      }
      return Array.from(stats.values()).sort((a, b) => b.distanceM - a.distanceM || b.edgeCount - a.edgeCount);
    }

    const bridgeWayStats = summarizeBy('wayIds', bridgeEdges);
    const deltaWayStats = summarizeBy('wayIds', newlyAdmittedEdges);
    const bridgeHighwayStats = summarizeBy('highway', bridgeEdges);
    const candidateWays = [];
    for (const stat of [...deltaWayStats, ...bridgeWayStats]) {
      if (!stat.key || stat.key === '—' || candidateWays.some((x) => x.key === stat.key)) continue;
      candidateWays.push(stat);
      if (candidateWays.length >= 3) break;
    }

    const edgeExclusionTests = newlyAdmittedEdges.slice(0, 16).map((edgeInfo) => {
      const forbidden = new Set([String(edgeInfo.edgeId)]);
      const connectedWithoutEdge = reachableFromA(upper, forbidden, null).seen.has(end);
      return {
        edgeId: String(edgeInfo.edgeId),
        highway: edgeInfo.highway || 'unknown',
        highways: (edgeInfo.highways || [edgeInfo.highway || 'unknown']).slice(),
        wayIds: (edgeInfo.wayIds || []).slice(),
        corridorDistanceM: edgeInfo.corridorDistanceM,
        connectedWithoutEdge,
        essentialForUpperCorridor: !connectedWithoutEdge
      };
    });

    const wayExclusionTests = candidateWays.map((stat) => {
      const forbidden = new Set([String(stat.key)]);
      const connectedWithoutWay = reachableFromA(upper, null, forbidden).seen.has(end);
      const carryingEdges = bridgeEdges.filter((e) => (e.wayIds || []).includes(String(stat.key)));
      const provenanceAmbiguous = carryingEdges.some((e) => (e.wayIds || []).length > 1);
      return {
        wayId: String(stat.key),
        highway: stat.highway || 'unknown',
        bridgeDistanceM: stat.distanceM,
        connectedWithoutWay,
        essentialForUpperCorridor: !connectedWithoutWay,
        provenanceAmbiguous
      };
    });

    const criticalEdge = edgeExclusionTests.find((x) => x.essentialForUpperCorridor) || null;
    const criticalWay = wayExclusionTests.find((x) => x.essentialForUpperCorridor && !x.provenanceAmbiguous) || null;
    const criticalWayCandidate = wayExclusionTests.find((x) => x.essentialForUpperCorridor) || null;
    const firstNewEdge = newlyAdmittedEdges[0] || allWitnessDeltaEdges[0] || null;
    const maxBridgeCorridorDistanceM = bridgeEdges.reduce((m, e) => Math.max(m, Number(e.corridorDistanceM || 0)), 0);
    const startProgress = nodeProgress(nodeSeq[bridgeStartNodeIndex]);
    const endProgress = nodeProgress(nodeSeq[bridgeEndNodeIndex]);

    let interpretation = `${Math.round(upper)} m witness 需要使用至少一條位於 ${Math.round(lower)}–${Math.round(upper)} m 新增帶寬內的 edge，才把 ${Math.round(lower)} m 下分離的 component 接起來。`;
    if (criticalEdge) {
      interpretation += ` 暫時排除 fine edge ${criticalEdge.edgeId} 後，${Math.round(upper)} m corridor 也無法 A→B；因此這條 edge 是目前 threshold transition 的必要 graph 通道之一。`;
    }
    if (criticalWay) {
      interpretation += ` 其 source way ${criticalWay.wayId} 也可被單獨驗證為必要。這仍不能單獨證明 OSM 存在實體缺路。`;
    } else if (criticalWayCandidate?.provenanceAmbiguous) {
      interpretation += ` way ${criticalWayCandidate.wayId} 的排除測試也會令路徑中斷，但相關 fine edge 同時攜帶多個 source way provenance，因此只能視為候選 way group，不能據此宣告單一 OSM way 就是根因。這仍不能單獨證明 OSM 存在實體缺路。`;
    } else {
      interpretation += ' 目前沒有單一 source way 可被乾淨隔離成唯一原因；這仍不能單獨證明 OSM 存在實體缺路。';
    }

    return Object.assign(base, {
      transitionFound: true,
      upperWitnessDistanceM: steps.reduce((sum, step) => sum + Number(graph.edges.get(step.edgeId)?.distanceM || 0), 0),
      upperWitnessEdgeCount: steps.length,
      deltaWitnessEdgeCount: allWitnessDeltaEdges.length,
      bridgeChain: {
        startNode: nodeMetaForBreakpoint(graph, nodeSeq[bridgeStartNodeIndex]),
        endNode: nodeMetaForBreakpoint(graph, nodeSeq[bridgeEndNodeIndex]),
        startProgress,
        endProgress,
        distanceM: bridgeDistanceM,
        maxCorridorDistanceM: maxBridgeCorridorDistanceM,
        newlyAdmittedDistanceM,
        newlyAdmittedEdgeCount: newlyAdmittedEdges.length,
        edgeCount: bridgeEdges.length,
        points: bridgePath?.points || [],
        edges: bridgeEdges.slice(0, 40),
        firstNewEdge,
        dominantWay: bridgeWayStats[0] || null,
        dominantDeltaWay: deltaWayStats[0] || null,
        dominantHighway: bridgeHighwayStats[0] || null,
        sourceWayProvenanceAmbiguous: bridgeEdges.some((e) => (e.wayIds || []).length > 1)
      },
      edgeExclusionTests,
      wayExclusionTests,
      criticalEdge,
      criticalWay,
      criticalWayCandidate,
      interpretation
    });
  }



  function faithfulCorridorComponentTraceAudit(graph, startId, endId, route, thresholdM, options = {}, sharedEdgeDistanceCache = null) {
    const manualRoute = (route || []).map(asLatLng).filter(Boolean);
    const threshold = Math.max(4, Number(thresholdM || 0));
    const routeLen = routeDistanceM(manualRoute);
    const start = String(startId), end = String(endId);
    const edgeDistanceCache = sharedEdgeDistanceCache || new Map();
    const sampleSpacingM = Math.max(5, Number(options.corridorTraceSampleSpacingM || 8));
    const maxComponents = Math.max(4, Number(options.corridorTraceMaxComponents || 16));
    const transitionWindowM = Math.max(35, Number(options.corridorTraceTransitionWindowM || 90));
    const connectorMaxGapM = Math.max(8, Number(options.corridorTraceConnectorMaxGapM || 90));

    if (!graph || manualRoute.length < 2 || !graph.nodes?.has(start) || !graph.nodes?.has(end)) {
      return { available: false, thresholdM: threshold, reason: 'missing-graph-route-or-endpoint' };
    }

    function edgeCorridorDistance(edge) {
      if (!edge) return Infinity;
      let value = edgeDistanceCache.get(edge.id);
      if (value == null) {
        value = edgeDistanceToPolylineM(edge, manualRoute, 5);
        edgeDistanceCache.set(edge.id, value);
      }
      return value;
    }

    // Build the exact induced faithful-corridor graph, but compute weak components
    // separately from directed A→B reachability.  Dev13 only compared the A-side and
    // B-side directed components; this trace intentionally surfaces any third/fourth
    // disconnected component (for example a floating cycleway) that still hugs the
    // hand-drawn line and can be hidden between those two sets.
    const allowedEdgeIds = new Set();
    const weakAdj = new Map();
    const edgeEndpointPairs = new Map();
    function addWeak(a, b) {
      a = String(a); b = String(b);
      if (!weakAdj.has(a)) weakAdj.set(a, new Set());
      if (!weakAdj.has(b)) weakAdj.set(b, new Set());
      weakAdj.get(a).add(b); weakAdj.get(b).add(a);
    }
    for (const [from0, refs] of graph.adjacency || []) {
      const from = String(from0);
      for (const ref of refs || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge || edgeCorridorDistance(edge) > threshold + 1e-9) continue;
        const to = String(ref.to);
        allowedEdgeIds.add(edge.id);
        addWeak(from, to);
        if (!edgeEndpointPairs.has(edge.id)) edgeEndpointPairs.set(edge.id, []);
        edgeEndpointPairs.get(edge.id).push([from, to]);
      }
    }

    const componentOf = new Map();
    const components = [];
    for (const nodeId of weakAdj.keys()) {
      if (componentOf.has(nodeId)) continue;
      const id = `c${components.length + 1}`;
      const nodes = [];
      const queue = [nodeId];
      componentOf.set(nodeId, id);
      for (let qi = 0; qi < queue.length; qi += 1) {
        const u = queue[qi]; nodes.push(u);
        for (const v of weakAdj.get(u) || []) {
          if (componentOf.has(v)) continue;
          componentOf.set(v, id); queue.push(v);
        }
      }
      components.push({ id, nodeIds: nodes, edgeIds: [], edgeIdSet: new Set(), totalEdgeM: 0, highwayCounts: {}, wayCounts: {}, supportSamples: 0, supportMinProgressM: Infinity, supportMaxProgressM: -Infinity, supportDistanceSumM: 0 });
    }
    const componentById = new Map(components.map((c) => [c.id, c]));

    for (const edgeId of allowedEdgeIds) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      const pairs = edgeEndpointPairs.get(edgeId) || [];
      let cid = null;
      for (const pair of pairs) {
        cid = componentOf.get(String(pair[0])) || componentOf.get(String(pair[1])) || null;
        if (cid) break;
      }
      if (!cid && edge.a != null) cid = componentOf.get(String(edge.a)) || null;
      if (!cid) continue;
      const c = componentById.get(cid);
      if (!c || c.edgeIdSet.has(edge.id)) continue;
      c.edgeIdSet.add(edge.id); c.edgeIds.push(edge.id); c.totalEdgeM += Number(edge.distanceM || 0);
      const h = primaryHighway(edge);
      c.highwayCounts[h] = (c.highwayCounts[h] || 0) + Number(edge.distanceM || 0);
      for (const w of edge.wayIds || []) c.wayCounts[String(w)] = (c.wayCounts[String(w)] || 0) + Number(edge.distanceM || 0);
    }

    function componentForEdge(edge) {
      if (!edge) return null;
      if (edge.a != null && componentOf.has(String(edge.a))) return componentOf.get(String(edge.a));
      if (edge.b != null && componentOf.has(String(edge.b))) return componentOf.get(String(edge.b));
      const pair = (edgeEndpointPairs.get(edge.id) || [])[0];
      return pair ? (componentOf.get(String(pair[0])) || componentOf.get(String(pair[1])) || null) : null;
    }

    // Map the hand-drawn trace itself to the nearest *faithful-corridor* edge.  This
    // is deliberately score-free: it is not a map matcher, only a topology/source
    // trace that tells us which weak component physically supports each route sample.
    const routeSamples = samplePolyline(manualRoute, sampleSpacingM);
    const sampleTrace = [];
    for (let i = 0; i < routeSamples.length; i += 1) {
      const point = routeSamples[i];
      let best = null;
      for (const edgeId of allowedEdgeIds) {
        const edge = graph.edges.get(edgeId);
        if (!edge) continue;
        const hit = nearestPointOnGeometry(point, edge.geometry || []);
        if (!hit || hit.distanceM > threshold + 1e-9) continue;
        if (!best || hit.distanceM < best.distanceM - 1e-9) best = Object.assign({ edge }, hit);
      }
      const progressM = routeSamples.length > 1 ? routeLen * (i / (routeSamples.length - 1)) : 0;
      const cid = best ? componentForEdge(best.edge) : null;
      const item = {
        index: i,
        point: { lat: Number(point.lat), lng: Number(point.lng) },
        progressM,
        progressRatio: routeLen > 0 ? progressM / routeLen : 0,
        componentId: cid,
        edgeId: best?.edge?.id || null,
        highway: best?.edge ? primaryHighway(best.edge) : null,
        wayIds: best?.edge ? (best.edge.wayIds || []).map(String).slice(0, 8) : [],
        distanceM: best ? Number(best.distanceM) : null,
        nearest: best?.point ? { lat: Number(best.point.lat), lng: Number(best.point.lng) } : null
      };
      sampleTrace.push(item);
      const c = cid ? componentById.get(cid) : null;
      if (c) {
        c.supportSamples += 1;
        c.supportMinProgressM = Math.min(c.supportMinProgressM, progressM);
        c.supportMaxProgressM = Math.max(c.supportMaxProgressM, progressM);
        c.supportDistanceSumM += Number(best.distanceM || 0);
      }
    }

    // Compress consecutive nearest-component assignments.  One-sample A-B-A noise is
    // folded back into A so that a single crossing vertex does not look like a genuine
    // independent corridor component.
    const rawRuns = [];
    for (const s of sampleTrace) {
      const key = s.componentId || 'none';
      const last = rawRuns[rawRuns.length - 1];
      if (last && last.key === key) {
        last.samples.push(s); last.endProgressM = s.progressM;
      } else {
        rawRuns.push({ key, componentId: s.componentId, samples: [s], startProgressM: s.progressM, endProgressM: s.progressM });
      }
    }
    for (let i = 1; i + 1 < rawRuns.length; i += 1) {
      if (rawRuns[i].samples.length === 1 && rawRuns[i - 1].key === rawRuns[i + 1].key) rawRuns[i].key = rawRuns[i - 1].key, rawRuns[i].componentId = rawRuns[i - 1].componentId;
    }
    const runs = [];
    for (const r of rawRuns) {
      const last = runs[runs.length - 1];
      if (last && last.key === r.key) {
        last.samples.push(...r.samples); last.endProgressM = r.endProgressM;
      } else runs.push(Object.assign({}, r, { samples: r.samples.slice() }));
    }

    function dominantEntries(obj, limit = 4) {
      return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, distanceM]) => ({ key, distanceM }));
    }
    function compactComponent(c) {
      if (!c) return null;
      const dominantHighways = dominantEntries(c.highwayCounts, 4);
      const dominantWays = dominantEntries(c.wayCounts, 5);
      return {
        id: c.id,
        nodeCount: c.nodeIds.length,
        edgeCount: c.edgeIds.length,
        totalEdgeM: c.totalEdgeM,
        supportSamples: c.supportSamples,
        supportMinProgressM: Number.isFinite(c.supportMinProgressM) ? c.supportMinProgressM : null,
        supportMaxProgressM: Number.isFinite(c.supportMaxProgressM) ? c.supportMaxProgressM : null,
        supportMinProgressRatio: Number.isFinite(c.supportMinProgressM) && routeLen > 0 ? c.supportMinProgressM / routeLen : null,
        supportMaxProgressRatio: Number.isFinite(c.supportMaxProgressM) && routeLen > 0 ? c.supportMaxProgressM / routeLen : null,
        supportAverageDistanceM: c.supportSamples ? c.supportDistanceSumM / c.supportSamples : null,
        dominantHighways,
        dominantWays,
        containsA: componentOf.get(start) === c.id,
        containsB: componentOf.get(end) === c.id
      };
    }

    const startComponentId = componentOf.get(start) || null;
    const endComponentId = componentOf.get(end) || null;
    const supportComponents = components.filter((c) => c.supportSamples > 0).sort((a, b) => a.supportMinProgressM - b.supportMinProgressM || b.supportSamples - a.supportSamples);

    // Build an ordered component chain that explicitly includes the current snapped A/B
    // components even when neither is the nearest geometric support component at the
    // first/last manual sample.
    const chainIds = [];
    function pushChain(cid) { if (cid && chainIds[chainIds.length - 1] !== cid) chainIds.push(cid); }
    pushChain(startComponentId);
    for (const r of runs) pushChain(r.componentId);
    pushChain(endComponentId);

    function nodeProjection(nodeId) {
      const n = graph.nodes.get(String(nodeId));
      const p = n ? projectPointToPolylineProgressM(n, manualRoute) : null;
      return p ? { nodeId: String(nodeId), node: { id: String(nodeId), lat: Number(n.lat), lng: Number(n.lng) }, progressM: p.progressM, progressRatio: routeLen > 0 ? p.progressM / routeLen : 0, routeDistanceM: p.distanceM } : null;
    }

    const projectedNodesByComp = new Map();
    function projectedNodes(cid) {
      if (projectedNodesByComp.has(cid)) return projectedNodesByComp.get(cid);
      const c = componentById.get(cid);
      const arr = [];
      for (const id of c?.nodeIds || []) { const p = nodeProjection(id); if (p) arr.push(p); }
      projectedNodesByComp.set(cid, arr);
      return arr;
    }

    function componentEdgesNearProgress(cid, progressM) {
      const c = componentById.get(cid);
      const out = [];
      for (const edgeId of c?.edgeIds || []) {
        const edge = graph.edges.get(edgeId); if (!edge) continue;
        const g = edge.geometry || [];
        const mid = g.length ? g[Math.floor(g.length / 2)] : null;
        const p = mid ? projectPointToPolylineProgressM(mid, manualRoute) : null;
        if (!p) continue;
        out.push({ edge, progressDeltaM: Math.abs(p.progressM - progressM), routeDistanceM: p.distanceM });
      }
      out.sort((a, b) => a.progressDeltaM - b.progressDeltaM || a.routeDistanceM - b.routeDistanceM);
      return out.slice(0, 20);
    }

    function closestGeometryPair(cidA, cidB, progressM) {
      const aa = componentEdgesNearProgress(cidA, progressM), bb = componentEdgesNearProgress(cidB, progressM);
      let best = null;
      for (const x of aa) for (const y of bb) {
        const gx = x.edge.geometry || [], gy = y.edge.geometry || [];
        const xSamples = [gx[0], ...shadeSamplePoints(gx, 12, 8), gx[gx.length - 1]].filter(Boolean);
        for (const p of xSamples) {
          const hit = nearestPointOnGeometry(p, gy);
          if (hit && (!best || hit.distanceM < best.distanceM)) best = { distanceM: hit.distanceM, aPoint: { lat: Number(p.lat), lng: Number(p.lng) }, bPoint: { lat: Number(hit.point.lat), lng: Number(hit.point.lng) }, aEdgeId: x.edge.id, bEdgeId: y.edge.id };
        }
        const ySamples = [gy[0], ...shadeSamplePoints(gy, 12, 8), gy[gy.length - 1]].filter(Boolean);
        for (const p of ySamples) {
          const hit = nearestPointOnGeometry(p, gx);
          if (hit && (!best || hit.distanceM < best.distanceM)) best = { distanceM: hit.distanceM, aPoint: { lat: Number(hit.point.lat), lng: Number(hit.point.lng) }, bPoint: { lat: Number(p.lat), lng: Number(p.lng) }, aEdgeId: x.edge.id, bEdgeId: y.edge.id };
        }
      }
      return best;
    }

    function commonSourceWays(cidA, cidB) {
      const a = componentById.get(cidA), b = componentById.get(cidB);
      if (!a || !b) return [];
      const ways = new Set(Object.keys(a.wayCounts || {}));
      return Object.keys(b.wayCounts || {}).filter((w) => ways.has(w)).slice(0, 12);
    }

    function transitionProgress(cidA, cidB, index) {
      for (let i = 0; i + 1 < runs.length; i += 1) {
        if (runs[i].componentId === cidA && runs[i + 1].componentId === cidB) return (runs[i].endProgressM + runs[i + 1].startProgressM) / 2;
      }
      if (index === 0) return 0;
      if (index === chainIds.length - 2) return routeLen;
      const ca = componentById.get(cidA), cb = componentById.get(cidB);
      const pa = Number.isFinite(ca?.supportMaxProgressM) ? ca.supportMaxProgressM : routeLen * index / Math.max(1, chainIds.length - 1);
      const pb = Number.isFinite(cb?.supportMinProgressM) ? cb.supportMinProgressM : routeLen * (index + 1) / Math.max(1, chainIds.length - 1);
      return (pa + pb) / 2;
    }

    const transitions = [];
    for (let i = 0; i + 1 < chainIds.length; i += 1) {
      const cidA = chainIds[i], cidB = chainIds[i + 1];
      if (!cidA || !cidB || cidA === cidB) continue;
      const progressM = transitionProgress(cidA, cidB, i);
      const paAll = projectedNodes(cidA), pbAll = projectedNodes(cidB);
      let pa = paAll.filter((x) => Math.abs(x.progressM - progressM) <= transitionWindowM);
      let pb = pbAll.filter((x) => Math.abs(x.progressM - progressM) <= transitionWindowM);
      if (!pa.length) pa = paAll.slice().sort((x, y) => Math.abs(x.progressM - progressM) - Math.abs(y.progressM - progressM)).slice(0, 80);
      if (!pb.length) pb = pbAll.slice().sort((x, y) => Math.abs(x.progressM - progressM) - Math.abs(y.progressM - progressM)).slice(0, 80);
      let nearestNodePair = null;
      for (const a of pa.slice(0, 120)) for (const b of pb.slice(0, 120)) {
        const gapM = haversineM(a.node, b.node);
        const score = gapM + (a.routeDistanceM + b.routeDistanceM) * 0.08 + (Math.abs(a.progressM - progressM) + Math.abs(b.progressM - progressM)) * 0.01;
        if (!nearestNodePair || score < nearestNodePair._score) nearestNodePair = { _score: score, gapM, a, b };
      }
      if (nearestNodePair) delete nearestNodePair._score;
      const geometryPair = closestGeometryPair(cidA, cidB, progressM);
      const commonWays = commonSourceWays(cidA, cidB);
      let classification = 'component-gap';
      if (commonWays.length) classification = 'same-source-way-split-across-components';
      else if (geometryPair && geometryPair.distanceM <= 2.5 && (!nearestNodePair || nearestNodePair.gapM > 2.5)) classification = 'geometric-touch-without-shared-node';
      else if (nearestNodePair && nearestNodePair.gapM <= 8) classification = 'nearby-components-without-graph-join';
      transitions.push({
        fromComponentId: cidA,
        toComponentId: cidB,
        progressM,
        progressRatio: routeLen > 0 ? progressM / routeLen : 0,
        nearestNodePair,
        geometryPair,
        commonSourceWays: commonWays,
        classification,
        candidateForConnectorCounterfactual: Boolean(nearestNodePair && nearestNodePair.gapM <= connectorMaxGapM + 1e-9)
      });
    }

    // Diagnostic-only virtual joins.  These are never inserted into the production graph.
    // They answer a narrow causal question: if the observed route-support components were
    // joined exactly at their nearest boundary nodes, would the faithful corridor become
    // directed A→B?  This can distinguish disconnected source topology from matcher scoring.
    const virtualFrom = new Map();
    const virtualConnectors = [];
    for (let i = 0; i < transitions.length; i += 1) {
      const t = transitions[i], pair = t.nearestNodePair;
      if (!t.candidateForConnectorCounterfactual || !pair) continue;
      const a = String(pair.a.nodeId), b = String(pair.b.nodeId);
      const id = `dev16-v${i + 1}`;
      virtualConnectors.push({ id, a, b, gapM: pair.gapM, progressM: t.progressM, progressRatio: t.progressRatio, classification: t.classification, fromComponentId: t.fromComponentId, toComponentId: t.toComponentId });
      for (const [u, v] of [[a, b], [b, a]]) {
        if (!virtualFrom.has(u)) virtualFrom.set(u, []);
        virtualFrom.get(u).push({ to: v, virtualId: id });
      }
    }

    const seen = new Set([start]), prev = new Map(), queue = [start];
    for (let qi = 0; qi < queue.length; qi += 1) {
      const u = queue[qi];
      for (const ref of graph.adjacency.get(u) || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge || !allowedEdgeIds.has(edge.id)) continue;
        const v = String(ref.to); if (seen.has(v)) continue;
        seen.add(v); prev.set(v, { from: u, edgeId: edge.id, virtualId: null }); queue.push(v);
      }
      for (const ref of virtualFrom.get(u) || []) {
        const v = String(ref.to); if (seen.has(v)) continue;
        seen.add(v); prev.set(v, { from: u, edgeId: null, virtualId: ref.virtualId }); queue.push(v);
      }
    }
    const connectorCounterfactual = { tested: virtualConnectors.length > 0, connectorCount: virtualConnectors.length, connectors: virtualConnectors, connected: seen.has(end), witness: null };
    if (connectorCounterfactual.connected) {
      const steps = []; let cur = end, guard = 0;
      while (cur !== start && guard++ < 20000) { const p = prev.get(cur); if (!p) break; steps.push({ from: p.from, to: cur, edgeId: p.edgeId, virtualId: p.virtualId }); cur = p.from; }
      if (cur === start) {
        steps.reverse();
        const points = [], edgeIds = [], usedVirtual = [];
        function pushPoint(p) { if (!p) return; const q = asLatLng(p); if (!q) return; const last = points[points.length - 1]; if (!last || haversineM(last, q) > 0.2) points.push({ lat: Number(q.lat), lng: Number(q.lng) }); }
        for (const step of steps) {
          if (step.edgeId) {
            const edge = graph.edges.get(step.edgeId); if (!edge) continue;
            for (const p of edgeGeometryFor(edge, step.from, step.to) || []) pushPoint(p);
            edgeIds.push(edge.id);
          } else if (step.virtualId) {
            pushPoint(graph.nodes.get(String(step.from))); pushPoint(graph.nodes.get(String(step.to))); usedVirtual.push(step.virtualId);
          }
        }
        const coverage = pathCoverageAgainstRoute(points, manualRoute, threshold, 10);
        connectorCounterfactual.witness = { points, edgeIds, virtualConnectorIds: usedVirtual, distanceM: routeDistanceM(points), coverageRatio: coverage.coverageRatio, averageDistanceM: coverage.averageDistanceM, maxDistanceM: coverage.maxDistanceM };
      }
    }

    const compactRuns = runs.map((r) => {
      const c = r.componentId ? componentById.get(r.componentId) : null;
      const ways = c ? dominantEntries(c.wayCounts, 3) : [];
      const highways = c ? dominantEntries(c.highwayCounts, 3) : [];
      return {
        componentId: r.componentId,
        sampleCount: r.samples.length,
        startProgressM: r.startProgressM,
        endProgressM: r.endProgressM,
        startProgressRatio: routeLen > 0 ? r.startProgressM / routeLen : 0,
        endProgressRatio: routeLen > 0 ? r.endProgressM / routeLen : 0,
        averageDistanceM: r.samples.reduce((sum, x) => sum + Number(x.distanceM || 0), 0) / Math.max(1, r.samples.length),
        dominantWays: ways,
        dominantHighways: highways
      };
    });

    let outcome = 'multiple-faithful-components';
    let interpretation = '';
    if (startComponentId && endComponentId && startComponentId === endComponentId) {
      outcome = 'same-weak-component';
      interpretation = `A 與 B 在 ${Math.round(threshold)} m 忠實走廊內屬於同一 weak component；若 directed A→B 仍失敗，應優先檢查單向/方向性或 directed graph 建構，而不是補實體 connector。`;
    } else if (connectorCounterfactual.connected) {
      outcome = 'virtual-boundary-joins-restore-directed-path';
      interpretation = `${Math.round(threshold)} m 手繪廊道旁存在多個彼此分離、但依序貼著手繪線的 graph component；只在診斷中連接 ${virtualConnectors.length} 個 component 邊界，就能恢復 directed A→B。這支持「忠實廊道來源拓樸/共享節點斷接」而非 matcher scoring 是主要瓶頸；虛擬 connector 不會進入正式 routing。`;
    } else {
      interpretation = `${Math.round(threshold)} m 手繪廊道旁存在多個 route-support graph component，但目前以最近邊界建立的診斷 connector 仍不足以恢復 directed A→B；下一步應檢查 component 內方向性與 source-way/node 拓樸，不能直接補通用距離橋。`;
    }

    return {
      available: true,
      thresholdM: threshold,
      routeLengthM: routeLen,
      allowedEdgeCount: allowedEdgeIds.size,
      weakComponentCount: components.length,
      supportComponentCount: supportComponents.length,
      startComponentId,
      endComponentId,
      startEndSameWeakComponent: Boolean(startComponentId && startComponentId === endComponentId),
      supportComponents: supportComponents.slice(0, maxComponents).map(compactComponent),
      componentRuns: compactRuns.slice(0, maxComponents * 2),
      transitions: transitions.slice(0, maxComponents * 2),
      connectorCounterfactual,
      outcome,
      interpretation,
      sampleTrace: sampleTrace.slice(0, 240)
    };
  }


  // v9.0.0-dev18: trace each dev16 component boundary back to the raw Overpass
  // way/node topology that produced it.  This audit is intentionally read-only:
  // it distinguishes a source OSM noding gap from a custom graph-builder loss,
  // but never inserts a production connector or rewrites OSM data.
  function rawOsmJunctionAudit(graph, raw, route, componentTraceAudit, options = {}) {
    const manualRoute = (route || []).map(asLatLng).filter(Boolean);
    const transitions = componentTraceAudit?.transitions || [];
    if (!graph?.edges?.size || !raw?.nodes?.size || !raw?.wayMeta?.size || manualRoute.length < 2 || !transitions.length) {
      return { available: false, reason: 'missing-raw-topology-or-component-transitions' };
    }
    const nearRadiusM = Math.max(20, Number(options.rawJunctionNearRadiusM || 45));
    const endpointGapMaxM = Math.max(6, Number(options.rawJunctionEndpointGapMaxM || 20));
    const touchMaxM = Math.max(0.5, Number(options.rawJunctionTouchMaxM || 2.5));

    function wayMeta(id) { return raw.wayMeta.get(String(id)) || null; }
    function wayNodeIds(id) { return (wayMeta(id)?.nodeIds || []).map(String); }
    function wayTags(id) { return wayMeta(id)?.tags || {}; }
    function isEndpoint(wayId, nodeId) {
      const ids = wayNodeIds(wayId);
      return Boolean(ids.length && (ids[0] === String(nodeId) || ids[ids.length - 1] === String(nodeId)));
    }
    function compactWay(wayId) {
      const meta = wayMeta(wayId);
      if (!meta) return { wayId: String(wayId), missing: true, nodeCount: 0, tags: {} };
      const ids = (meta.nodeIds || []).map(String);
      return {
        wayId: String(wayId), nodeCount: ids.length,
        firstNodeId: ids[0] || null, lastNodeId: ids[ids.length - 1] || null,
        highway: normalizedTag(meta.tags?.highway || '') || 'unknown',
        tags: compactTagSummary(meta.tags || {})
      };
    }
    function zSignature(wayIds) {
      const sigs = [];
      for (const wayId of wayIds || []) {
        const tags = wayTags(wayId);
        const layer = String(tags?.layer ?? '0').trim() || '0';
        const bridge = normalizedTag(tags?.bridge || 'no');
        const tunnel = normalizedTag(tags?.tunnel || 'no');
        sigs.push({ wayId: String(wayId), layer, bridge, tunnel });
      }
      return sigs;
    }
    function gradeSeparationPossible(aWays, bWays) {
      const A = zSignature(aWays), B = zSignature(bWays);
      for (const a of A) for (const b of B) {
        if (a.layer !== b.layer) return true;
        const abr = !['', 'no', '0', 'false'].includes(a.bridge), bbr = !['', 'no', '0', 'false'].includes(b.bridge);
        const atu = !['', 'no', '0', 'false'].includes(a.tunnel), btu = !['', 'no', '0', 'false'].includes(b.tunnel);
        if (abr !== bbr || atu !== btu) return true;
      }
      return false;
    }
    function targetPoint(t, side) {
      const gp = t?.geometryPair || null;
      if (side === 'a' && gp?.aPoint) return asLatLng(gp.aPoint);
      if (side === 'b' && gp?.bPoint) return asLatLng(gp.bPoint);
      const np = t?.nearestNodePair || null;
      return asLatLng(side === 'a' ? np?.a?.node : np?.b?.node);
    }
    function edgeForTransition(t, side) {
      const gp = t?.geometryPair || null;
      const id = side === 'a' ? gp?.aEdgeId : gp?.bEdgeId;
      return id ? graph.edges.get(String(id)) || null : null;
    }
    function nearbyRawNodes(wayIds, point) {
      const P = asLatLng(point);
      if (!P) return [];
      const out = [], seen = new Set();
      for (const wayId0 of wayIds || []) {
        const wayId = String(wayId0);
        for (const nodeId of wayNodeIds(wayId)) {
          const key = `${wayId}:${nodeId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const node = raw.nodes.get(String(nodeId));
          if (!node) continue;
          const distanceM = haversineM(P, node);
          if (distanceM <= nearRadiusM + 1e-9) out.push({ wayId, nodeId: String(nodeId), node: { id: String(nodeId), lat: Number(node.lat), lng: Number(node.lng) }, distanceM, endpoint: isEndpoint(wayId, nodeId) });
        }
      }
      return out.sort((a,b)=>a.distanceM-b.distanceM);
    }
    function sharedNearRawNodes(aWays, bWays, aPoint, bPoint) {
      const aset = new Set();
      for (const w of aWays || []) for (const id of wayNodeIds(w)) aset.add(String(id));
      const out = [];
      for (const w of bWays || []) for (const id of wayNodeIds(w)) {
        const nid = String(id);
        if (!aset.has(nid) || out.some(x => x.nodeId === nid)) continue;
        const node = raw.nodes.get(nid); if (!node) continue;
        const da = aPoint ? haversineM(aPoint, node) : Infinity;
        const db = bPoint ? haversineM(bPoint, node) : Infinity;
        if (Math.min(da, db) <= nearRadiusM + 1e-9) out.push({ nodeId: nid, node: { id:nid, lat:Number(node.lat), lng:Number(node.lng) }, distanceToA_M: da, distanceToB_M: db });
      }
      return out.sort((x,y)=>Math.min(x.distanceToA_M,x.distanceToB_M)-Math.min(y.distanceToA_M,y.distanceToB_M));
    }
    function nearestRawNodePair(aNodes, bNodes) {
      let best = null;
      for (const a of aNodes.slice(0,120)) for (const b of bNodes.slice(0,120)) {
        const gapM = haversineM(a.node, b.node);
        if (!best || gapM < best.gapM) best = { gapM, a, b };
      }
      return best;
    }

    const junctions = [];
    let builderLossCount = 0, sourceGapCount = 0, touchWithoutNodeCount = 0, gradeSeparatedCount = 0;
    for (const t of transitions.slice(0, 20)) {
      const aEdge = edgeForTransition(t, 'a'), bEdge = edgeForTransition(t, 'b');
      const aWays = (aEdge?.wayIds || []).map(String);
      const bWays = (bEdge?.wayIds || []).map(String);
      const aPoint = targetPoint(t, 'a'), bPoint = targetPoint(t, 'b');
      const aNodes = nearbyRawNodes(aWays, aPoint), bNodes = nearbyRawNodes(bWays, bPoint);
      const shared = sharedNearRawNodes(aWays, bWays, aPoint, bPoint);
      const nearestPair = nearestRawNodePair(aNodes, bNodes);
      const geomGapM = Number(t?.geometryPair?.distanceM);
      const gradeSep = gradeSeparationPossible(aWays, bWays);
      let classification = 'source-topology-gap';
      let evidenceLayer = 'source-osm-topology';
      if (shared.length) {
        classification = 'raw-shared-node-but-fine-components-disconnected';
        evidenceLayer = 'custom-graph-builder';
        builderLossCount += 1;
      } else if (Number.isFinite(geomGapM) && geomGapM <= touchMaxM + 1e-9 && gradeSep) {
        classification = 'geometric-touch-with-grade-separation-tags';
        evidenceLayer = 'source-osm-topology';
        gradeSeparatedCount += 1;
      } else if (Number.isFinite(geomGapM) && geomGapM <= touchMaxM + 1e-9) {
        classification = 'non-noded-geometric-touch';
        evidenceLayer = 'source-osm-topology';
        touchWithoutNodeCount += 1; sourceGapCount += 1;
      } else if (nearestPair && nearestPair.gapM <= endpointGapMaxM + 1e-9 && nearestPair.a.endpoint && nearestPair.b.endpoint) {
        classification = 'source-way-endpoint-gap';
        evidenceLayer = 'source-osm-topology';
        sourceGapCount += 1;
      } else {
        sourceGapCount += 1;
      }
      junctions.push({
        fromComponentId: t.fromComponentId, toComponentId: t.toComponentId,
        progressM: Number(t.progressM || 0), progressRatio: Number(t.progressRatio || 0),
        dev16Classification: t.classification || null,
        geometryGapM: Number.isFinite(geomGapM) ? geomGapM : null,
        graphNodeGapM: Number.isFinite(Number(t?.nearestNodePair?.gapM)) ? Number(t.nearestNodePair.gapM) : null,
        fromFineEdgeId: aEdge?.id || null, toFineEdgeId: bEdge?.id || null,
        fromSourceEdgeId: aEdge?.sourceEdgeId || null, toSourceEdgeId: bEdge?.sourceEdgeId || null,
        fromWays: aWays.map(compactWay), toWays: bWays.map(compactWay),
        sharedRawNodesNearBoundary: shared.slice(0, 12),
        nearestRawNodePair: nearestPair,
        gradeSeparationPossible: gradeSep,
        fromZSignatures: zSignature(aWays), toZSignatures: zSignature(bWays),
        classification, evidenceLayer
      });
    }

    let outcome = 'source-topology-boundaries';
    let interpretation = '';
    if (builderLossCount > 0) {
      outcome = 'custom-builder-loses-raw-junction';
      interpretation = `至少 ${builderLossCount} 個忠實廊道斷點在原始 Overpass way 中其實共享同一 OSM node，但 fine graph 仍被分成不同 component；這是直接的 custom graph builder/contraction 證據，下一步應修 builder，而不是修改 OSM 或 matcher score。`;
    } else if (touchWithoutNodeCount > 0 || sourceGapCount > 0) {
      outcome = 'raw-source-topology-lacks-required-junctions';
      interpretation = `目前檢查到的忠實廊道斷點，在原始 Overpass way/node 拓樸中沒有找到可直接共享的 OSM node；其中 ${touchWithoutNodeCount} 個屬於幾何幾乎相碰但未 noding 的情況。這表示 custom builder 大致忠實保留了來源拓樸，主要瓶頸已下沉到 OSM/source junction，而不是 map-match scoring。仍須先排除橋梁/隧道/不同 layer 等合法不相交情況，再決定資料修正或受控 local connector。`;
    } else if (gradeSeparatedCount > 0) {
      outcome = 'possible-grade-separated-crossings';
      interpretation = `斷點幾何接近，但來源 way 含 layer/bridge/tunnel 差異；不可因為平面上相交就補 shared node，應視為可能的立體交會並做人工/成熟引擎資料核對。`;
    } else {
      interpretation = `dev17 尚未取得足夠 raw way/node 證據判定斷點屬於來源 OSM 拓樸或 custom builder；維持診斷狀態，不建立 production connector。`;
    }
    return {
      available: true,
      nearRadiusM,
      endpointGapMaxM,
      touchMaxM,
      junctionCount: junctions.length,
      builderLossCount,
      sourceGapCount,
      nonNodedTouchCount: touchWithoutNodeCount,
      gradeSeparatedCount,
      junctions,
      outcome,
      interpretation
    };
  }

  // v9.0.0-dev29: hand a fully detached fine-graph clone to the experimental
  // multi-source router.  This is the only supported bridge from the production
  // graph engine into the dev26 sandbox. Existing node/edge/adjacency objects are
  // copied so an experimental overlay cannot mutate production state by aliasing.
  function graphStructuralFingerprint(graph) {
    let adjacencyRefs = 0;
    for (const refs of graph?.adjacency?.values?.() || []) adjacencyRefs += (refs || []).length;
    return {
      nodeCount: Number(graph?.nodes?.size || 0),
      edgeCount: Number(graph?.edges?.size || 0),
      adjacencyNodeCount: Number(graph?.adjacency?.size || 0),
      adjacencyRefCount: adjacencyRefs
    };
  }

  function cloneFineGraphForExperimentalUse(graph) {
    if (!graph?.nodes || !graph?.edges || !graph?.adjacency) return null;
    const nodes = new Map();
    for (const [id, node] of graph.nodes) nodes.set(String(id), Object.assign({}, node));
    const edges = new Map();
    for (const [id, edge] of graph.edges) {
      edges.set(String(id), Object.assign({}, edge, {
        geometry: (edge.geometry || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
        wayIds: (edge.wayIds || []).slice(),
        tagsSummary: edge.tagsSummary ? JSON.parse(JSON.stringify(edge.tagsSummary)) : {}
      }));
    }
    const adjacency = new Map();
    for (const [id, refs] of graph.adjacency) adjacency.set(String(id), (refs || []).map((r) => Object.assign({}, r)));
    return Object.assign({}, graph, {
      nodes, edges, adjacency,
      experimentalClone: true,
      productionGraphMutated: false,
      sourceFingerprint: graphStructuralFingerprint(graph)
    });
  }

  function createExperimentalGraphClone() {
    const state = lastGraphDebug;
    if (!state?.graph || !state.snapA || !state.snapB) return { available: false, reason: 'no-production-graph' };
    const sourceGraph = state.experimentalBaseGraph || state.graph;
    const sourceSnapA = state.experimentalSnapA || state.snapA;
    const sourceSnapB = state.experimentalSnapB || state.snapB;
    const graph = cloneFineGraphForExperimentalUse(sourceGraph);
    if (!graph) return { available: false, reason: 'clone-failed' };
    return {
      available: true,
      version: VERSION,
      graph,
      snapA: Object.assign({}, sourceSnapA),
      snapB: Object.assign({}, sourceSnapB),
      bbox: state.bbox ? Object.assign({}, state.bbox) : null,
      productionFingerprint: graphStructuralFingerprint(state.graph),
      experimentalBaseFingerprint: graphStructuralFingerprint(sourceGraph),
      cloneFingerprint: graphStructuralFingerprint(graph),
      productionGraphMutated: false
    };
  }

  async function runExperimentalSearchOnClone(graph, startId, endId, options = {}) {
    if (!graph?.nodes?.has(String(startId)) || !graph?.nodes?.has(String(endId))) {
      return { available: false, reason: 'missing-experimental-endpoints', productionGraphMutated: false };
    }
    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const detourPct = clamp(options.detourPct, 0, 80, 30);
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    const savedShadeDebug = new Map(lastShadeDebug);
    const savedRouteEdges = { fastest: new Set(lastRouteEdges.fastest || []), minSun: new Set(lastRouteEdges.minSun || []) };
    try {
      const fromA = await dijkstraTimesResponsive(graph, String(startId), speedMps, false, options);
      const toB = await dijkstraTimesResponsive(graph, String(endId), speedMps, true, options);
      const fastestTime = fromA.dist.get(String(endId));
      if (!Number.isFinite(fastestTime)) return { available: false, reason: 'experimental-graph-disconnected', productionGraphMutated: false };
      const fastestPath = reconstructDijkstra(graph, fromA.prev, String(startId), String(endId));
      if (!fastestPath?.points?.length) return { available: false, reason: 'experimental-fastest-reconstruction-failed', productionGraphMutated: false };
      fastestPath.walkSeconds = fastestTime;
      const detourLimitS = fastestTime * (1 + detourPct / 100);
      const minSun = await searchMinSun(graph, String(startId), String(endId), {
        speedMps,
        detourLimitS,
        fastestToEnd: toB,
        departure,
        edgeSunProvider: options.edgeSunProvider,
        timeBucketSec: options.timeBucketSec,
        shadeTimeBucketSec: options.shadeTimeBucketSec,
        shadeSampleSpacingM: options.shadeSampleSpacingM,
        shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge,
        shadeConcurrency: options.shadeConcurrency,
        shadeEdgeBatchConcurrency: options.shadeEdgeBatchConcurrency,
        sharedShadeCache: options.sharedShadeCache,
        canopyTimeoutMs: options.canopyTimeoutMs,
        maxExpandedStates: options.maxExpandedStates,
        maxShadeEdgeEvaluations: options.maxShadeEdgeEvaluations,
        cooperativeYieldMs: options.cooperativeYieldMs,
        yieldEveryExpanded: options.yieldEveryExpanded,
        onProgress: options.onProgress,
        shouldCancel: options.shouldCancel
      });
      return {
        available: true,
        productionGraphMutated: false,
        fastest: Object.assign({}, fastestPath, { durationS: fastestTime }),
        minSun: minSun.path ? Object.assign({}, minSun.path, { durationS: minSun.path.walkSeconds }) : null,
        detourPct,
        detourLimitSeconds: detourLimitS,
        searchExpandedStates: minSun.expanded,
        shadeEdgeEvaluations: minSun.shadeEvals,
        dominanceRejected: minSun.dominanceRejected || 0,
        dominanceRemoved: minSun.dominanceRemoved || 0
      };
    } finally {
      lastShadeDebug.clear();
      for (const [key, value] of savedShadeDebug) lastShadeDebug.set(key, value);
      lastRouteEdges = savedRouteEdges;
    }
  }

  // v9.0.0-dev20: create an ephemeral fine-graph overlay containing only the
  // source-gap connectors already justified by dev16 route-support transitions
  // and dev17 raw-OSM evidence. The production graph is never mutated.
  function cloneFineGraphWithDiagnosticConnectors(graph, connectorSpecs = []) {
    const nodes = new Map(graph?.nodes || []);
    const edges = new Map(graph?.edges || []);
    const adjacency = new Map();
    for (const [id, refs] of graph?.adjacency || []) adjacency.set(String(id), (refs || []).map((r) => Object.assign({}, r)));
    function ensure(id) { const key = String(id); if (!adjacency.has(key)) adjacency.set(key, []); return key; }
    const added = [];
    let counter = 0;
    for (const spec of connectorSpecs || []) {
      const a = ensure(spec.a), b = ensure(spec.b);
      const pa = asLatLng(nodes.get(a)), pb = asLatLng(nodes.get(b));
      if (!pa || !pb || a === b) continue;
      const geometry = (spec.geometry || [pa, pb]).map(asLatLng).filter(Boolean).map((q) => ({ lat: q.lat, lng: q.lng }));
      const distanceM = routeDistanceM(geometry);
      if (!(distanceM > 0.2)) continue;
      const id = `dev19-c${++counter}`;
      const edge = {
        id, a, b, geometry, distanceM,
        wayIds: [],
        tagsSummary: { highway: ['path'], foot: ['yes'], diagnostic: ['dev19-source-gap-counterfactual'] },
        diagnosticConnector: true,
        diagnosticSource: 'dev17-source-topology-gap',
        diagnosticProgressRatio: Number(spec.progressRatio || 0),
        diagnosticGapM: Number(spec.gapM || distanceM),
        diagnosticClassification: spec.classification || 'source-topology-gap'
      };
      edges.set(id, edge);
      adjacency.get(a).push({ edgeId: id, to: b });
      adjacency.get(b).push({ edgeId: id, to: a });
      added.push({ id, a, b, distanceM, progressRatio: edge.diagnosticProgressRatio, gapM: edge.diagnosticGapM, classification: edge.diagnosticClassification, geometry: edge.geometry.map((q) => ({ lat: q.lat, lng: q.lng })) });
    }
    return {
      graph: Object.assign({}, graph, { nodes, edges, adjacency, diagnosticOverlay: true, diagnosticConnectorIds: added.map((x) => x.id) }),
      connectors: added
    };
  }

  async function coarseShadeScoreForSteps(graph, steps, departure, speedMps, options = {}) {
    const safeSpeed = clamp(speedMps, 0.5, 2.5, 1.25);
    const dep = departure instanceof Date ? departure : new Date(departure || Date.now());
    let walkS = 0, sunS = 0, shadeS = 0, nightS = 0;
    const edgeSun = [];
    const cooperativeYield = makeCooperativeYielder(options);
    for (let i = 0; i < (steps || []).length; i += 1) {
      const step = steps[i], edge = graph.edges.get(step.edgeId);
      if (!edge) continue;
      const edgeTime = edge.distanceM / safeSpeed;
      const at = new Date(dep.getTime() + (walkS + edgeTime / 2) * 1000);
      const shade = await defaultEdgeSunProvider(edge, step.from, at, {
        shadeSampleSpacingM: options.shadeSampleSpacingM || config.shadeSampleSpacingM,
        shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge || config.shadeMaxSamplesPerEdge,
        shadeConcurrency: options.shadeConcurrency || config.shadeConcurrency,
        canopyTimeoutMs: options.canopyTimeoutMs || config.canopyTimeoutMs
      });
      const sunFrac = clamp(shade?.directSunFraction, 0, 1, 0);
      const shadeFrac = clamp(shade?.shadedFraction, 0, 1, Math.max(0, 1 - sunFrac));
      const nightFrac = clamp(shade?.nightFraction, 0, 1, 0);
      const sun = edgeTime * sunFrac, sh = edgeTime * shadeFrac, ni = edgeTime * nightFrac;
      sunS += sun; shadeS += sh; nightS += ni; walkS += edgeTime;
      edgeSun.push({ edgeId: edge.id, highway: primaryHighway(edge), distanceM: edge.distanceM, directSunFraction: sunFrac, directSunSeconds: sun, diagnosticConnector: Boolean(edge.diagnosticConnector) });
      if ((i % 3) === 2) await cooperativeYield();
    }
    return { walkSeconds: walkS, directSunSeconds: sunS, shadedSeconds: shadeS, nightSeconds: nightS, edgeSun };
  }

  async function controlledSourceGapConnectorAuditUnsafe(graph, startId, endId, route, componentTraceAudit, rawAudit, departure, speedMps, options = {}) {
    const emit = (stage, message, extra = {}) => {
      try { options.onProgress?.(Object.assign({}, extra, { stage, message })); } catch (_) {}
    };
    emit('source-gap-prepare', '正在準備 dev19 source-gap 診斷副本；production graph 不會被修改…');
    const manualRoute = (route || []).map(asLatLng).filter(Boolean);
    if (options.sourceGapCounterfactualEnabled === false || config.sourceGapCounterfactualEnabled === false) return { available: false, reason: 'disabled' };
    if (!graph?.edges?.size || manualRoute.length < 2 || !componentTraceAudit?.available || !rawAudit?.available) return { available: false, reason: 'missing-component-or-raw-audit' };
    const strictM = Math.max(4, Number(options.sourceGapCounterfactualStrictM || config.sourceGapCounterfactualStrictM || 14));
    const maxGapM = Math.max(8, Number(options.sourceGapCounterfactualMaxGapM || config.sourceGapCounterfactualMaxGapM || 55));
    const minCoverage = clamp(options.manualReplayMinCoverage ?? config.manualReplayMinCoverage, 0.5, 1, 0.88);
    const cfConnectors = componentTraceAudit?.connectorCounterfactual?.connectors || [];
    const junctions = rawAudit?.junctions || [];
    const eligible = [];
    for (const c of cfConnectors) {
      const j = junctions.find((x) => x.fromComponentId === c.fromComponentId && x.toComponentId === c.toComponentId) || null;
      if (!j || j.evidenceLayer !== 'source-osm-topology' || j.gradeSeparationPossible) continue;
      if (Number(c.gapM || Infinity) > maxGapM + 1e-9) continue;
      const aNode = graph.nodes.get(String(c.a)), bNode = graph.nodes.get(String(c.b));
      if (!aNode || !bNode) continue;
      const probe = { geometry: [aNode, bNode], distanceM: haversineM(aNode, bNode) };
      const routeOffsetM = edgeDistanceToPolylineM(probe, manualRoute, 8);
      if (!(routeOffsetM <= strictM + 1.0)) continue;
      eligible.push({
        a: String(c.a), b: String(c.b), gapM: Number(c.gapM || probe.distanceM), progressRatio: Number(c.progressRatio || 0),
        classification: j.classification || c.classification || 'source-topology-gap', routeOffsetM,
        fromWays: (j.fromWays || []).map((w) => ({ wayId: w.wayId, highway: w.highway })),
        toWays: (j.toWays || []).map((w) => ({ wayId: w.wayId, highway: w.highway }))
      });
    }
    if (!eligible.length) {
      return { available: true, tested: false, strictM, maxGapM, connectorCount: 0, connectors: [], outcome: 'no-controlled-connectors', interpretation: 'dev17 沒有留下同時滿足 source-gap、無立體交會疑慮、且貼著手繪忠實走廊的受控 connector；不進行 patched-graph 因果測試。' };
    }

    emit('source-gap-overlay', `已確認 ${eligible.length} 個受控 source-gap；正在建立只存在於診斷中的 patched graph…`, { connectorCount: eligible.length });
    const over = cloneFineGraphWithDiagnosticConnectors(graph, eligible);
    const patched = over.graph;
    const strict = strictCorridorConnectivityAudit(patched, startId, endId, manualRoute, strictM, options, new Map());
    emit('source-gap-ordered', 'patched graph 已建立；正在驗證忠實 ordered A→B 路徑…');
    const ordered = await orderedMapMatchDijkstra(patched, startId, endId, manualRoute, strictM, speedMps, options);
    let orderedScore = null;
    let orderedDenseShade = null;
    if (ordered?.steps?.length) {
      emit('source-gap-coarse-shade', `忠實路徑已恢復；正在以搜尋器 coarse edge sampler 計分（${ordered.steps.length} steps）…`, { stepCount: ordered.steps.length });
      orderedScore = await coarseShadeScoreForSteps(patched, ordered.steps, departure, speedMps, options);
      // Reconcile the restored faithful geometry immediately instead of forcing
      // another release/test cycle when the coarse search model still dislikes it.
      // This reuses dev18's exact-same-geometry dense ShadeMap audit and remains
      // diagnostic-only. A dense failure must never invalidate the connector test.
      try {
        emit('source-gap-dense-shade', 'coarse 計分完成；正在對同一 patched geometry 做 10 m dense ShadeMap 對帳…');
        orderedDenseShade = await reconcilePathShadeCost(
          patched, ordered.steps, orderedScore?.edgeSun || [], departure, speedMps, options
        );
      } catch (error) {
        orderedDenseShade = { available: false, reason: 'dense-reconciliation-error', error: error?.message || String(error) };
      }
    }

    const detourLimitS = Number.isFinite(Number(options.referenceDetourLimitSeconds))
      ? Number(options.referenceDetourLimitSeconds)
      : Number.isFinite(Number(lastDiagnostics?.detourLimitSeconds)) ? Number(lastDiagnostics.detourLimitSeconds) : Infinity;
    emit('source-gap-global-prepare', '同一路徑日照對帳完成；正在準備 patched graph 全域 min-sun 搜尋…');
    const toEnd = await dijkstraTimesResponsive(patched, endId, speedMps, true, {
      onProgress: (p) => emit('source-gap-fastest-reverse', `patched graph：${p?.message || '正在整理終點反向時間…'}`, p || {}),
      shouldCancel: options.shouldCancel, cooperativeYieldMs: options.cooperativeYieldMs
    });
    emit('source-gap-global-search', '正在 patched graph 上重新執行完整 history-safe min-sun 搜尋…');
    const minSun = await searchMinSun(patched, startId, endId, {
      speedMps, detourLimitS, fastestToEnd: toEnd, departure,
      edgeSunProvider: options.edgeSunProvider,
      timeBucketSec: options.timeBucketSec,
      shadeTimeBucketSec: options.shadeTimeBucketSec,
      shadeSampleSpacingM: options.shadeSampleSpacingM,
      shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge,
      shadeConcurrency: options.shadeConcurrency,
      canopyTimeoutMs: options.canopyTimeoutMs,
      maxExpandedStates: options.maxExpandedStates,
      maxShadeEdgeEvaluations: options.maxShadeEdgeEvaluations,
      cooperativeYieldMs: options.cooperativeYieldMs,
      yieldEveryExpanded: options.yieldEveryExpanded,
      onProgress: (p) => emit('source-gap-global-search', `patched graph：${p?.message || '正在搜尋最少直接日照路徑…'}`, p || {}),
      shouldCancel: options.shouldCancel
    });
    const searchPath = minSun?.path || null;
    const searchCoverage = searchPath?.points?.length ? pathCoverageAgainstRoute(searchPath.points, manualRoute, strictM, 10) : null;
    const connectorIdSet = new Set(over.connectors.map((x) => x.id));
    const orderedUsedConnectors = (ordered?.edgeIds || []).filter((id) => connectorIdSet.has(String(id)));
    const searchUsedConnectors = (searchPath?.edgeIds || []).filter((id) => connectorIdSet.has(String(id)));
    const baselineSunS = Number(lastDiagnostics?.minSunEstimatedDirectSunSeconds);
    const faithfulSunS = Number(orderedScore?.directSunSeconds);
    const orderedCoverage = Number(ordered?.coverage?.coverageRatio || 0);
    const orderedFaithful = Boolean(ordered && orderedCoverage >= minCoverage && strict?.connected);
    const searchFaithful = Boolean(searchCoverage && Number(searchCoverage.coverageRatio || 0) >= minCoverage);
    const faithfulBeatsBaseline = orderedFaithful && Number.isFinite(faithfulSunS) && Number.isFinite(baselineSunS) && faithfulSunS + 0.5 < baselineSunS;
    const patchedSearchUsesFaithful = Boolean(searchPath && searchFaithful && searchUsedConnectors.length > 0);

    let outcome = 'controlled-connectors-tested';
    let interpretation = '受控 source-gap connector 已只在診斷副本 graph 中測試；production graph 完全未變更。';
    if (!strict?.connected) {
      outcome = 'controlled-connectors-insufficient';
      interpretation = '即使只補 dev16/dev17 已證實的 source-gap，14 m 忠實 corridor 仍未連通；目前兩個 gap 不是完整原因，不能升級成正式 connector。';
    } else if (!orderedFaithful) {
      outcome = 'strict-restored-ordered-still-unfaithful';
      interpretation = '受控 connector 已恢復 strict corridor，但 ordered matcher 仍無法忠實重建；source gap 與 matcher 兩層都還有問題。';
    } else if (faithfulBeatsBaseline && patchedSearchUsesFaithful) {
      outcome = 'source-gaps-causally-explain-search-miss';
      interpretation = '只在診斷副本補上 dev17 已證實的 source-gap 後，忠實手繪 graph path 恢復且 edge 日照成本比 production 自動解更低，patched global min-sun search 也實際選到這條忠實路。這是 source topology gap 導致 production 搜尋漏掉河堤路線的強因果證據；仍不代表可以自動把這些 connector 寫進正式 graph。';
    } else if (faithfulBeatsBaseline && !patchedSearchUsesFaithful) {
      outcome = 'source-gaps-restored-faithful-route-but-search-still-misses';
      interpretation = '受控 connector 已恢復一條在同一 coarse edge 日照模型下更少曬的忠實路徑，但 patched global search 仍沒選到它；除了 source gap 外，搜尋剪枝/狀態仍有第二個問題。';
    } else if (orderedFaithful && !faithfulBeatsBaseline) {
      const denseAvailable = Boolean(orderedDenseShade?.available);
      const denseMismatch = Boolean(orderedDenseShade?.materialMismatch);
      if (denseAvailable && denseMismatch) {
        outcome = 'source-gaps-restore-geometry-and-expose-shade-cost-mismatch';
        interpretation = '受控 connector 已恢復忠實河堤 geometry；同一條 patched faithful path 的 coarse edge 日照與 dense ShadeMap 重算又出現實質差異。source OSM gap 已被證實會阻斷忠實路徑，同時 shade-cost 採樣／時間模型還存在第二層誤差。';
      } else {
        outcome = 'source-gaps-restore-geometry-not-shade-advantage';
        interpretation = denseAvailable
          ? '受控 connector 已把忠實河堤 geometry 接回來，而且同一路徑 coarse/dense 日照大致一致；在搜尋器目前的日照模型下，它仍沒有比 production 自動解更少曬。此時不要再怪拓樸，應核對手繪原線與 patched faithful graph geometry 的最終 ShadeMap 差異。'
          : '受控 connector 已把忠實河堤 geometry 接回來，但搜尋器自己的 coarse edge 日照模型仍沒有把它評成比 production 自動解更少曬；dense ShadeMap reconciliation 這次不可用，仍不能把差異歸因於 shade-cost。';
      }
    }

    emit('source-gap-complete', `dev19 因果測試完成：${outcome}。`, { outcome });
    return {
      available: true, tested: true, strictM, maxGapM,
      connectorCount: over.connectors.length,
      connectors: over.connectors.map((c, i) => Object.assign({}, c, eligible[i] || {})),
      productionGraphMutated: false,
      strictConnected: Boolean(strict?.connected),
      strictWitnessCoverageRatio: strict?.witness?.coverageRatio ?? null,
      orderedReachedGoal: Boolean(ordered),
      orderedCoverageRatio: ordered?.coverage?.coverageRatio ?? null,
      orderedAverageDistanceM: ordered?.coverage?.averageDistanceM ?? null,
      orderedDistanceM: ordered?.distanceM ?? null,
      orderedPoints: ordered?.points?.map?.((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })) || [],
      orderedDirectSunSeconds: orderedScore?.directSunSeconds ?? null,
      orderedWalkSeconds: orderedScore?.walkSeconds ?? null,
      orderedDenseShadeReconciliation: orderedDenseShade,
      orderedDenseDirectSunSeconds: orderedDenseShade?.available ? orderedDenseShade.denseDirectSunSeconds : null,
      orderedCoarseDenseDeltaSeconds: orderedDenseShade?.available ? orderedDenseShade.deltaSeconds : null,
      orderedCoarseDenseMaterialMismatch: orderedDenseShade?.available ? Boolean(orderedDenseShade.materialMismatch) : null,
      orderedUsedConnectorIds: orderedUsedConnectors,
      referenceProductionMinSunSeconds: Number.isFinite(baselineSunS) ? baselineSunS : null,
      detourLimitSeconds: Number.isFinite(detourLimitS) ? detourLimitS : null,
      patchedSearchFound: Boolean(searchPath),
      patchedSearchDirectSunSeconds: searchPath?.directSunSeconds ?? null,
      patchedSearchDistanceM: searchPath?.distanceM ?? null,
      patchedSearchPoints: searchPath?.points?.map?.((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })) || [],
      patchedSearchCoverageRatio: searchCoverage?.coverageRatio ?? null,
      patchedSearchAverageDistanceM: searchCoverage?.averageDistanceM ?? null,
      patchedSearchUsedConnectorIds: searchUsedConnectors,
      searchExpandedStates: minSun?.expanded ?? null,
      shadeEdgeEvaluations: minSun?.shadeEvals ?? null,
      outcome, interpretation
    };
  }

  async function controlledSourceGapConnectorAudit(graph, startId, endId, route, componentTraceAudit, rawAudit, departure, speedMps, options = {}) {
    const savedShadeDebug = new Map(lastShadeDebug);
    const savedMatchFailure = lastOrderedMapMatchFailure;
    try {
      return await controlledSourceGapConnectorAuditUnsafe(graph, startId, endId, route, componentTraceAudit, rawAudit, departure, speedMps, options);
    } catch (error) {
      return {
        available: true,
        tested: true,
        productionGraphMutated: false,
        outcome: 'diagnostic-error',
        error: error?.message || String(error),
        interpretation: `dev19 的 patched-graph 因果測試發生診斷錯誤（${error?.message || error}）；production graph 與主要路線結果未被修改。`
      };
    } finally {
      lastShadeDebug.clear();
      for (const [key, value] of savedShadeDebug) lastShadeDebug.set(key, value);
      lastOrderedMapMatchFailure = savedMatchFailure;
    }
  }

  function deferredSourceGapCounterfactual(rawAudit) {
    const sourceGapCount = Number(rawAudit?.sourceGapCount || (rawAudit?.junctions || []).filter((j) => j?.evidenceLayer === 'source-osm-topology').length || 0);
    return {
      available: true, tested: false, deferred: true, reason: 'deferred-expensive-audit',
      outcome: 'deferred-expensive-audit', sourceGapCount, connectorCount: 0, connectors: [],
      productionGraphMutated: false,
      interpretation: sourceGapCount
        ? `已找到 ${sourceGapCount} 個 source-gap；dev20.1 先完成 topology / mature-engine benchmark，耗時的 patched shade + global min-sun 因果重算改由按鈕明確啟動。`
        : '目前沒有 source-gap 需要執行 patched-graph 因果重算。'
    };
  }

  async function runSourceGapCounterfactualAudit(points, options = {}) {
    const state = lastGraphDebug;
    if (!state?.graph || !state.snapA || !state.snapB) return { available: false, reason: 'no-graph' };
    const route = (points || []).map(asLatLng).filter(Boolean);
    if (route.length < 2) return { available: false, reason: 'route-too-short' };
    const graph = state.graph;
    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    const fidelity = Math.max(4, Number(options.manualReplayFidelityThresholdM ?? config.manualReplayFidelityThresholdM ?? 14));
    const cache = new Map();
    try { options.onProgress?.({ stage:'source-gap-topology', message:'正在重建 14 m faithful component trace 與 raw OSM junction audit…' }); } catch (_) {}
    const componentTraceAudit = faithfulCorridorComponentTraceAudit(graph, state.snapA.id, state.snapB.id, route, fidelity, options, cache);
    const rawAudit = rawOsmJunctionAudit(graph, state.raw, route, componentTraceAudit, options);
    const audit = await controlledSourceGapConnectorAudit(
      graph, state.snapA.id, state.snapB.id, route, componentTraceAudit, rawAudit, departure, speedMps,
      Object.assign({}, options, { deferSourceGapCounterfactual:false, referenceDetourLimitSeconds: lastDiagnostics?.detourLimitSeconds })
    );
    const connectorSafetyPolicy = sourceGapConnectorSafetyPolicy(rawAudit, audit, null, options);
    const engineBenchmark = engineBenchmarkManifest(route, route[0], route[route.length - 1], rawAudit, audit);
    return { available:true, audit, connectorSafetyPolicy, engineBenchmark, corridorComponentTraceAudit:componentTraceAudit, rawOsmJunctionAudit:rawAudit };
  }


  // v9.0.0-dev20: source-gap connectors are never promoted automatically from
  // a user-drawn route. This policy classifies what evidence would be required
  // before any production data repair can be considered.
  function sourceGapConnectorSafetyPolicy(rawAudit, counterfactualAudit, matureEngineCrossCheck = null, options = {}) {
    const nearTouchM = Math.max(0.5, Number(options.safeConnectorNearTouchM || config.safeConnectorNearTouchM || 2.5));
    const reviewGapM = Math.max(nearTouchM, Number(options.safeConnectorReviewGapM || config.safeConnectorReviewGapM || 12));
    const connectors = counterfactualAudit?.connectors || [];
    const junctions = rawAudit?.junctions || [];
    const valRouteFaithful = Boolean(matureEngineCrossCheck?.valhalla?.route?.faithful);
    const ghRouteFaithful = Boolean(matureEngineCrossCheck?.graphhopper?.route?.faithful);
    const ordinaryEngineCorroboration = valRouteFaithful || ghRouteFaithful;
    const items = junctions.map((j, index) => {
      const gapM = Number.isFinite(Number(j.geometryGapM)) ? Number(j.geometryGapM)
        : Number.isFinite(Number(j.graphNodeGapM)) ? Number(j.graphNodeGapM) : Infinity;
      const connector = connectors.find((c) => Math.abs(Number(c.progressRatio || 0) - Number(j.progressRatio || 0)) < 0.03) || connectors[index] || null;
      let tier = 'manual-review-source-gap';
      let reason = '來源 OSM 沒有 shared node；使用者手繪線本身不能作為正式道路連接證據。';
      if (j.evidenceLayer === 'custom-graph-builder') {
        tier = 'fix-builder-not-connector';
        reason = '原始 OSM 已有 shared node；應修 graph builder，而不是建立 local connector。';
      } else if (j.gradeSeparationPossible) {
        tier = 'reject-grade-separation-risk';
        reason = '存在 bridge/tunnel/layer 差異，平面接近不能視為可步行連接。';
      } else if (gapM > reviewGapM) {
        tier = 'manual-review-large-gap';
        reason = `幾何缺口約 ${Number.isFinite(gapM) ? gapM.toFixed(1) : '—'} m，超過 ${reviewGapM.toFixed(1)} m；不可做 proximity auto-bridge。`;
      } else if (gapM <= nearTouchM && j.classification === 'non-noded-geometric-touch') {
        tier = 'near-touch-review-candidate';
        reason = `幾何幾乎相碰（≤${nearTouchM.toFixed(1)} m）但來源 OSM 未 noding；可列入人工資料修正候選，仍不可自動上線。`;
      } else {
        tier = 'manual-review-source-gap';
        reason = `來源拓樸缺口在人工審核範圍內，但仍需要現地/影像/OSM 編修或等價外部證據。`;
      }
      return {
        index, progressRatio: Number(j.progressRatio || 0), gapM: Number.isFinite(gapM) ? gapM : null,
        classification: j.classification || null, evidenceLayer: j.evidenceLayer || null,
        gradeSeparationPossible: Boolean(j.gradeSeparationPossible), tier,
        productionAutoAllowed: false,
        diagnosticConnectorId: connector?.id || null,
        ordinaryEngineCorroboration,
        reason
      };
    });
    return {
      available: Boolean(items.length), nearTouchM, reviewGapM,
      productionAutoConnectorEnabled: false,
      ordinaryEngineCorroboration,
      items,
      interpretation: items.length
        ? `dev20 安全規則：source-gap 只可作診斷或人工資料修正候選；目前 ${items.length} 個斷點全部禁止由手繪線自動升級成 production connector。成熟引擎 ordinary route 可作交叉證據，但不能單獨證明真實世界可通行。`
        : '目前沒有 source-gap 可套用 dev20 connector safety policy。'
    };
  }

  function downsampleBenchmarkShape(shape, maxPoints = 180) {
    const pts = (shape || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng ?? p.lon) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const cap = Math.max(2, Math.floor(Number(maxPoints || 180)));
    if (pts.length <= cap) return pts;
    const total = routeDistanceM(pts);
    if (!(total > 0)) return pts.filter((_, i) => i === 0 || i === pts.length - 1);
    const spacing = total / Math.max(1, cap - 1);
    const sampled = samplePolyline(pts, spacing);
    if (!sampled.length) return [pts[0], pts[pts.length - 1]];
    const out = sampled.slice(0, cap - 1);
    const last = pts[pts.length - 1];
    if (haversineM(out[out.length - 1], last) > 0.2) out.push(last);
    return out.slice(0, cap);
  }

  function decodePolylineShape(encoded, precision = 6) {
    if (typeof encoded !== 'string' || !encoded.length) return [];
    let index = 0, lat = 0, lng = 0;
    const factor = Math.pow(10, precision);
    const points = [];
    while (index < encoded.length) {
      let result = 0, shift = 0, b;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index <= encoded.length);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      result = 0; shift = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index <= encoded.length);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      points.push({ lat: lat / factor, lng: lng / factor });
    }
    return points;
  }

  function geoJsonLineToPoints(value) {
    if (!value) return [];
    const geom = value.type === 'Feature' ? value.geometry : value;
    if (geom?.type === 'LineString' && Array.isArray(geom.coordinates)) {
      return geom.coordinates.map((c) => ({ lat: Number(c?.[1]), lng: Number(c?.[0]) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    }
    if (geom?.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      return geom.coordinates.flat().map((c) => ({ lat: Number(c?.[1]), lng: Number(c?.[0]) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    }
    return [];
  }

  function appendDistinctPoints(target, points) {
    for (const p of points || []) {
      if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue;
      const q = { lat: Number(p.lat), lng: Number(p.lng) };
      const prev = target[target.length - 1];
      if (!prev || haversineM(prev, q) > 0.05) target.push(q);
    }
    return target;
  }

  function extractValhallaPoints(payload) {
    const direct = geoJsonLineToPoints(payload?.trip?.shape || payload?.shape || payload?.route?.shape);
    if (direct.length) return direct;
    const legs = payload?.trip?.legs || payload?.route?.legs || payload?.legs || [];
    const out = [];
    for (const leg of legs) {
      const geo = geoJsonLineToPoints(leg?.shape);
      if (geo.length) { appendDistinctPoints(out, geo); continue; }
      if (typeof leg?.shape === 'string') appendDistinctPoints(out, decodePolylineShape(leg.shape, 6));
    }
    if (out.length) return out;
    if (typeof payload?.trip?.shape === 'string') return decodePolylineShape(payload.trip.shape, 6);
    if (typeof payload?.shape === 'string') return decodePolylineShape(payload.shape, 6);
    return [];
  }

  function extractGraphHopperPoints(payload) {
    const path = payload?.paths?.[0] || payload?.path || null;
    const geo = geoJsonLineToPoints(path?.points || path?.snapped_waypoints);
    if (geo.length) return geo;
    if (typeof path?.points === 'string') return decodePolylineShape(path.points, 5);
    return [];
  }

  function benchmarkPathAnalysis(points, manualShape, thresholdM = 14) {
    const manual = (manualShape || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng ?? p.lon) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const path = (points || []).map(asLatLng).filter(Boolean);
    if (manual.length < 2 || path.length < 2) return { available: false, pointCount: path.length };
    const coverage = pathCoverageAgainstRoute(path, manual, thresholdM, 10);
    const avgDistanceM = Number(coverage.averageDistanceM);
    const faithful = Number(coverage.coverageRatio || 0) >= 0.88 && Number.isFinite(avgDistanceM) && avgDistanceM <= thresholdM;
    const manualDistanceM = routeDistanceM(manual);
    const spacingM = 10;
    const samples = Math.max(1, Math.ceil(manualDistanceM / spacingM));
    let firstDivergence = null;
    let largestOffset = null;
    for (let i = 0; i <= samples; i += 1) {
      const progressM = Math.min(manualDistanceM, i * spacingM);
      const p = pointAlongPolyline(manual, progressM);
      if (!p) continue;
      const hit = nearestPointOnGeometry(p, path);
      const distanceM = Number(hit?.distanceM);
      if (!Number.isFinite(distanceM)) continue;
      const item = {
        progressRatio: manualDistanceM > 0 ? progressM / manualDistanceM : 0,
        manualPoint: { lat: Number(p.lat), lng: Number(p.lng) },
        enginePoint: hit?.point ? { lat: Number(hit.point.lat), lng: Number(hit.point.lng) } : null,
        distanceM
      };
      if (!largestOffset || distanceM > largestOffset.distanceM) largestOffset = item;
      if (!firstDivergence && distanceM > thresholdM) firstDivergence = item;
    }
    return {
      available: true,
      pointCount: path.length,
      distanceM: routeDistanceM(path),
      manualDistanceM,
      faithful,
      fidelityThresholdM: thresholdM,
      coverageRatio: coverage.coverageRatio,
      averageDistanceM: coverage.averageDistanceM,
      maxDistanceM: coverage.maxDistanceM,
      firstDivergence,
      largestOffset,
      points: path.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    };
  }

  async function fetchJsonWithTimeout(url, init = {}, timeoutMs = 15000, fetchImpl = null) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) throw new Error('fetch unavailable');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 15000))) : null;
    try {
      const response = await f(url, Object.assign({}, init, controller ? { signal: controller.signal } : {}));
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }
      if (!response.ok) throw new Error(`${response.status}${payload?.error ? ` ${payload.error}` : ''}`);
      if (!payload) throw new Error('empty or non-JSON response');
      return payload;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function gpxForBenchmarkShape(shape) {
    const pts = (shape || []).map((p) => ({ lat: Number(p.lat), lon: Number(p.lon ?? p.lng) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const esc = (v) => String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="${esc(VERSION)}" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>haidian-benchmark</name><trkseg>${pts.map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"></trkpt>`).join('')}</trkseg></trk></gpx>`;
  }

  async function runMatureEngineBenchmark(manifest, options = {}) {
    if (!manifest?.manualShape?.length || !manifest?.start || !manifest?.end) return { available: false, reason: 'benchmark-manifest-missing' };
    if (options.matureEngineCrossCheckEnabled === false || config.matureEngineCrossCheckEnabled === false) return { available: false, reason: 'disabled' };
    const timeoutMs = Number(options.timeoutMs || config.matureEngineTimeoutMs || 15000);
    const valhallaMinIntervalMs = Math.max(0, Number(options.valhallaMinIntervalMs ?? config.valhallaMinIntervalMs ?? 1100));
    const maxPoints = Number(options.maxShapePoints || config.matureEngineShapeMaxPoints || 180);
    const manualShape = downsampleBenchmarkShape(manifest.manualShape, maxPoints).map((p) => ({ lat: p.lat, lon: p.lng }));
    const thresholdM = Number(options.fidelityThresholdM || config.manualReplayFidelityThresholdM || 14);
    const fetchImpl = options.fetchImpl || null;
    const result = { available: true, generatedBy: VERSION, testedAt: new Date().toISOString(), fidelityThresholdM: thresholdM, manualDistanceM: routeDistanceM(manualShape.map((p) => ({ lat:Number(p.lat), lng:Number(p.lon ?? p.lng) }))), valhalla: { available: false }, graphhopper: { available: false } };

    const valBase = String(options.valhallaEndpoint || config.valhallaBenchmarkEndpoint || '').replace(/\/$/, '');
    if (valBase) {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const clientId = String(options.valhallaClientId || config.valhallaClientId || '').trim();
      if (clientId) headers['X-Client-Id'] = clientId;
      const routeReq = Object.assign({}, manifest.valhalla?.routeRequest || {}, { shape_format: 'geojson', directions_type: 'none' });
      const traceReq = Object.assign({}, manifest.valhalla?.traceRouteRequest || {}, {
        shape: manualShape, costing: 'pedestrian', shape_match: 'map_snap', shape_format: 'geojson', directions_type: 'none'
      });
      result.valhalla = { available: true, endpoint: valBase };
      try {
        const payload = await fetchJsonWithTimeout(`${valBase}/route`, { method:'POST', mode:'cors', credentials:'omit', headers, body: JSON.stringify(routeReq) }, timeoutMs, fetchImpl);
        const points = extractValhallaPoints(payload);
        result.valhalla.route = Object.assign({ ok: true }, benchmarkPathAnalysis(points, manualShape, thresholdM));
      } catch (error) {
        result.valhalla.route = { ok: false, error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)) };
      }
      if (valhallaMinIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, valhallaMinIntervalMs));
      try {
        const payload = await fetchJsonWithTimeout(`${valBase}/trace_route`, { method:'POST', mode:'cors', credentials:'omit', headers, body: JSON.stringify(traceReq) }, timeoutMs, fetchImpl);
        const points = extractValhallaPoints(payload);
        result.valhalla.traceRoute = Object.assign({ ok: true }, benchmarkPathAnalysis(points, manualShape, thresholdM));
      } catch (error) {
        result.valhalla.traceRoute = { ok: false, error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)) };
      }
    }

    const ghKey = String(options.graphHopperApiKey ?? config.graphHopperApiKey ?? '').trim();
    const ghBase = String(options.graphHopperEndpoint || config.graphHopperBenchmarkEndpoint || '').replace(/\/$/, '');
    if (ghBase && ghKey) {
      result.graphhopper = { available: true, endpoint: ghBase };
      try {
        const routePayload = { points: [[Number(manifest.start.lon), Number(manifest.start.lat)], [Number(manifest.end.lon), Number(manifest.end.lat)]], profile:'foot', points_encoded:false, instructions:false };
        const payload = await fetchJsonWithTimeout(`${ghBase}/route?key=${encodeURIComponent(ghKey)}`, { method:'POST', mode:'cors', credentials:'omit', headers:{'Content-Type':'application/json',Accept:'application/json'}, body:JSON.stringify(routePayload) }, timeoutMs, fetchImpl);
        result.graphhopper.route = Object.assign({ ok: true }, benchmarkPathAnalysis(extractGraphHopperPoints(payload), manualShape, thresholdM));
      } catch (error) {
        result.graphhopper.route = { ok: false, error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)) };
      }
      try {
        const gpx = gpxForBenchmarkShape(manualShape);
        const payload = await fetchJsonWithTimeout(`${ghBase}/match?profile=foot&points_encoded=false&type=json&key=${encodeURIComponent(ghKey)}`, { method:'POST', mode:'cors', credentials:'omit', headers:{'Content-Type':'application/gpx+xml',Accept:'application/json'}, body:gpx }, timeoutMs, fetchImpl);
        result.graphhopper.match = Object.assign({ ok: true }, benchmarkPathAnalysis(extractGraphHopperPoints(payload), manualShape, thresholdM));
      } catch (error) {
        result.graphhopper.match = { ok: false, error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)) };
      }
    } else {
      result.graphhopper = { available: false, reason: ghKey ? 'endpoint-missing' : 'api-key-not-configured' };
    }

    const ordinaryFaithful = Boolean(result.valhalla?.route?.faithful || result.graphhopper?.route?.faithful);
    const matchFaithful = Boolean(result.valhalla?.traceRoute?.faithful || result.graphhopper?.match?.faithful);
    let outcome = 'engine-crosscheck-inconclusive';
    let interpretation = '成熟引擎回應不足，暫時不能據此改 production connector policy。';
    if (ordinaryFaithful) {
      outcome = 'ordinary-engine-finds-faithful-corridor';
      interpretation = '至少一個成熟 pedestrian ordinary router 從同一 A/B 找到忠實河堤走廊。這可能代表 OSM 資料版本或引擎拓樸處理與目前 Overpass snapshot 不同；應比對資料版本與實際 edge，而不是直接啟用 proximity bridge。';
    } else if (matchFaithful) {
      outcome = 'map-matching-only-follows-faithful-corridor';
      interpretation = '成熟 map matcher 可以沿手繪河堤，但 ordinary pedestrian route 沒有同樣證據。這支持「軌跡可被解釋」但不等於 production routing 有合法 connector。';
    } else if ((result.valhalla?.route?.ok || result.graphhopper?.route?.ok) && !ordinaryFaithful) {
      outcome = 'ordinary-engine-also-avoids-faithful-corridor';
      interpretation = '至少一個成熟 ordinary pedestrian router 也沒有重建出忠實河堤走廊；這與 dev17/dev19 的 source-topology-gap 結論一致。';
    }
    result.outcome = outcome;
    result.interpretation = interpretation;
    result.connectorSafetyPolicy = sourceGapConnectorSafetyPolicy(
      { junctions: (manifest.sourceGaps || []).map((g) => ({
        progressRatio:g.progressRatio, classification:g.classification, geometryGapM:g.geometryGapM,
        graphNodeGapM:g.graphNodeGapM, gradeSeparationPossible:g.gradeSeparationPossible, evidenceLayer:g.evidenceLayer || 'source-osm-topology'
      })) }, null, result, options
    );
    return result;
  }

  function engineBenchmarkManifest(route, startPoint, endPoint, sourceGapAudit, counterfactualAudit) {
    const shape = (route || []).map(asLatLng).filter(Boolean).map((p) => ({ lat: Number(p.lat), lon: Number(p.lng) }));
    const A = asLatLng(startPoint), B = asLatLng(endPoint);
    if (!A || !B || shape.length < 2) return null;
    const cfConnectors = counterfactualAudit?.connectors || [];
    const sourceGaps = (sourceGapAudit?.junctions || []).map((j, index) => {
      const c = cfConnectors.find((x) => Math.abs(Number(x.progressRatio || 0) - Number(j.progressRatio || 0)) < 0.03) || cfConnectors[index] || null;
      return {
        progressRatio: Number(j.progressRatio || 0), classification: j.classification || null, evidenceLayer: j.evidenceLayer || null,
        geometryGapM: j.geometryGapM ?? null, graphNodeGapM: j.graphNodeGapM ?? null,
        gradeSeparationPossible: Boolean(j.gradeSeparationPossible),
        fromWays: (j.fromWays || []).map((w) => ({ wayId: String(w.wayId), highway: w.highway || null })),
        toWays: (j.toWays || []).map((w) => ({ wayId: String(w.wayId), highway: w.highway || null })),
        diagnosticConnector: c ? {
          id: c.id || null, distanceM: c.distanceM ?? c.gapM ?? null,
          geometry: (c.geometry || []).map((p) => ({ lat: Number(p.lat), lon: Number(p.lng ?? p.lon) }))
        } : null
      };
    });
    const connectorSafetyPolicy = sourceGapConnectorSafetyPolicy(sourceGapAudit, counterfactualAudit);
    return {
      schema: 'haidian-routing-engine-benchmark-v2', generatedBy: VERSION,
      start: { lat: A.lat, lon: A.lng }, end: { lat: B.lat, lon: B.lng }, manualShape: shape,
      sourceGaps,
      connectorSafetyPolicy,
      localCounterfactual: counterfactualAudit ? {
        outcome: counterfactualAudit.outcome || null,
        connectorCount: counterfactualAudit.connectorCount || 0,
        orderedCoverageRatio: counterfactualAudit.orderedCoverageRatio ?? null,
        patchedSearchCoverageRatio: counterfactualAudit.patchedSearchCoverageRatio ?? null
      } : null,
      valhalla: {
        referenceServer: 'https://valhalla1.openstreetmap.de',
        routeRequest: { locations: [{ lat: A.lat, lon: A.lng }, { lat: B.lat, lon: B.lng }], costing: 'pedestrian', shape_format: 'geojson' },
        traceRouteRequest: { shape, costing: 'pedestrian', shape_match: 'map_snap', search_radius: 20, gps_accuracy: 4.07, shape_format: 'geojson' }
      },
      graphhopper: {
        profile: 'foot',
        note: 'Use the same OSM extract date and run GraphHopper map-matching on the supplied manualShape converted to GPX; compare whether the two source-gap junctions remain disconnected.',
        gpxTrackPoints: shape
      }
    };
  }

  function endpointSnapCounterfactualAudit(graph, currentSnapA, currentSnapB, route, thresholdM, options = {}, sharedEdgeDistanceCache = null, context = {}) {
    const manualRoute = (route || []).map(asLatLng).filter(Boolean);
    if (manualRoute.length < 2 || !graph?.edges?.size) return { available: false, reason: 'route-or-graph-missing' };
    const threshold = Math.max(4, Number(thresholdM || config.manualReplayFidelityThresholdM || 14));
    const radiusM = Math.max(threshold, Number(options.endpointCounterfactualRadiusM || config.endpointCounterfactualRadiusM || 24));
    const maxCandidates = Math.max(2, Math.min(16, Number(options.endpointCounterfactualMaxCandidates || config.endpointCounterfactualMaxCandidates || 8)));
    const edgeDistanceCache = sharedEdgeDistanceCache || new Map();
    const A = manualRoute[0], B = manualRoute[manualRoute.length - 1];

    function edgeCorridorDistance(edge) {
      if (!edge) return Infinity;
      let value = edgeDistanceCache.get(edge.id);
      if (value == null) {
        value = edgeDistanceToPolylineM(edge, manualRoute, 5);
        edgeDistanceCache.set(edge.id, value);
      }
      return value;
    }

    function rankForEdge(edge) {
      const summary = edge?.tagsSummary || {};
      const first = (key) => Array.isArray(summary[key]) && summary[key].length ? summary[key][0] : undefined;
      return pedestrianSnapRank({
        highway: primaryHighway(edge), foot: first('foot'), access: first('access'), bicycle: first('bicycle')
      });
    }

    function currentAnchor(snap, label) {
      if (!snap?.id || !graph.nodes.has(String(snap.id))) return null;
      const node = graph.nodes.get(String(snap.id));
      return {
        id: `${label}:current`, label, type: 'current-snap', current: true,
        nodeId: String(snap.id), seedNodeIds: [String(snap.id)],
        point: { lat: Number(node.lat), lng: Number(node.lng) },
        distanceM: Number(snap.distanceM || 0), highway: snap.sourceHighway || 'unknown',
        wayIds: snap.sourceWayId != null ? [String(snap.sourceWayId)] : [],
        pedestrianRank: Number.isFinite(Number(snap.pedestrianRank)) ? Number(snap.pedestrianRank) : null,
        pedestrianLabel: snap.pedestrianLabel || null,
        corridorDistanceM: 0, withinCorridor: true
      };
    }

    function nearbyEdgeAnchors(point, label, currentSnap) {
      const out = [];
      for (const edge of graph.edges.values()) {
        const hit = nearestPointOnGeometry(point, edge.geometry || []);
        if (!hit || hit.distanceM > radiusM + 1e-9) continue;
        const wayIds = (edge.wayIds || []).map(String);
        const highway = primaryHighway(edge);
        const corridorDistanceM = edgeCorridorDistance(edge);
        const sameSource = currentSnap?.sourceWayId != null && wayIds.includes(String(currentSnap.sourceWayId));
        const snapNode = currentSnap?.node || (currentSnap?.id ? graph.nodes.get(String(currentSnap.id)) : null);
        const projectionNearCurrent = snapNode ? haversineM(hit.point, snapNode) <= 3.0 : false;
        if (sameSource && projectionNearCurrent) continue;
        out.push({
          id: `${label}:edge:${edge.id}`, label, type: 'edge-counterfactual', current: false,
          edgeId: String(edge.id), seedNodeIds: [String(edge.a), String(edge.b)],
          point: { lat: Number(hit.point.lat), lng: Number(hit.point.lng) },
          projectionSegmentIndex: Number(hit.segmentIndex || 0),
          projectionT: Number(hit.t || 0),
          distanceM: Number(hit.distanceM || 0), highway, wayIds,
          pedestrianRank: rankForEdge(edge), pedestrianLabel: pedestrianSnapLabel({ highway }),
          corridorDistanceM, withinCorridor: corridorDistanceM <= threshold + 1e-9,
          sameSourceAsCurrent: sameSource,
          sourceEdgeId: edge.sourceEdgeId || null
        });
      }
      // This is a route-aware diagnostic, not the production walking-first snap.
      // Prioritize edges that actually stay inside the faithful manual corridor;
      // otherwise a dense cluster of rank-0 footways can crowd the nearby levee
      // cycleway out of the bounded candidate set before it is ever tested.
      out.sort((x, y) =>
        (Number(y.withinCorridor) - Number(x.withinCorridor)) ||
        (x.corridorDistanceM - y.corridorDistanceM) ||
        (x.distanceM - y.distanceM) ||
        ((Number.isFinite(Number(x.pedestrianRank)) ? Number(x.pedestrianRank) : 99) - (Number.isFinite(Number(y.pedestrianRank)) ? Number(y.pedestrianRank) : 99))
      );
      const dedup = [];
      const seen = new Set();
      for (const item of out) {
        const sig = `${item.highway}|${item.wayIds.slice().sort().join(',')}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        dedup.push(item);
        if (dedup.length >= maxCandidates) break;
      }
      return dedup;
    }

    const currentA = currentAnchor(currentSnapA, 'A');
    const currentB = currentAnchor(currentSnapB, 'B');
    const alternativesA = nearbyEdgeAnchors(A, 'A', currentSnapA);
    const alternativesB = nearbyEdgeAnchors(B, 'B', currentSnapB);
    const anchorsA = [currentA, ...alternativesA].filter(Boolean);
    const anchorsB = [currentB, ...alternativesB].filter(Boolean);

    function searchFromAnchor(anchor, thresholdM, forbiddenWayIds = null) {
      if (!anchor) return { seen: new Set(), prev: new Map(), roots: new Set() };
      if (anchor.type === 'edge-counterfactual') {
        const edge = graph.edges.get(anchor.edgeId);
        if (!edge || edgeCorridorDistance(edge) > thresholdM + 1e-9) return { seen: new Set(), prev: new Map(), roots: new Set() };
        if (forbiddenWayIds?.size && (edge.wayIds || []).some((w) => forbiddenWayIds.has(String(w)))) return { seen: new Set(), prev: new Map(), roots: new Set() };
      }
      const roots = new Set((anchor.seedNodeIds || []).map(String));
      const seen = new Set(roots);
      const prev = new Map();
      const queue = Array.from(roots);
      for (let qi = 0; qi < queue.length; qi += 1) {
        const nodeId = queue[qi];
        for (const ref of graph.adjacency.get(nodeId) || []) {
          const edge = graph.edges.get(ref.edgeId);
          if (!edge || edgeCorridorDistance(edge) > thresholdM + 1e-9) continue;
          if (forbiddenWayIds?.size && (edge.wayIds || []).some((w) => forbiddenWayIds.has(String(w)))) continue;
          const next = String(ref.to);
          if (seen.has(next)) continue;
          seen.add(next);
          prev.set(next, { from: nodeId, edgeId: edge.id });
          queue.push(next);
        }
      }
      return { seen, prev, roots };
    }

    function targetNodeFor(anchor, search, thresholdM = threshold, forbiddenWayIds = null) {
      if (!anchor) return null;
      if (anchor.type === 'edge-counterfactual') {
        const edge = graph.edges.get(anchor.edgeId);
        if (!edge || edgeCorridorDistance(edge) > thresholdM + 1e-9) return null;
        if (forbiddenWayIds?.size && (edge.wayIds || []).some((w) => forbiddenWayIds.has(String(w)))) return null;
      }
      for (const id of anchor.seedNodeIds || []) if (search.seen.has(String(id))) return String(id);
      return null;
    }

    function anchorPartialGeometry(anchor, rootId) {
      if (!anchor || anchor.type !== 'edge-counterfactual' || !anchor.edgeId) return [];
      const edge = graph.edges.get(String(anchor.edgeId));
      const geom = edge?.geometry || [];
      if (geom.length < 2) return [];
      const i = Math.max(0, Math.min(geom.length - 2, Number(anchor.projectionSegmentIndex || 0)));
      const projection = anchor.point || interpolatePoint(geom[i], geom[i + 1], Number(anchor.projectionT || 0));
      if (String(rootId) === String(edge.a)) {
        return [projection, ...geom.slice(0, i + 1).reverse()].map(asLatLng).filter(Boolean);
      }
      if (String(rootId) === String(edge.b)) {
        return [projection, ...geom.slice(i + 1)].map(asLatLng).filter(Boolean);
      }
      return [];
    }

    function reconstruct(search, targetId, aAnchor, bAnchor) {
      if (!targetId) return null;
      const steps = [];
      let cur = String(targetId), guard = 0;
      while (!search.roots.has(cur) && guard++ < 20000) {
        const prev = search.prev.get(cur);
        if (!prev) return null;
        steps.push({ edgeId: prev.edgeId, from: prev.from, to: cur });
        cur = String(prev.from);
      }
      const startRootId = String(cur);
      const targetRootId = String(targetId);
      steps.reverse();
      const path = pathFromEdgeSteps(graph, steps);
      const points = [];
      function push(p) {
        if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return;
        const q = { lat: Number(p.lat), lng: Number(p.lng) };
        const last = points[points.length - 1];
        if (!last || haversineM(last, q) > 0.2) points.push(q);
      }
      const startPartial = anchorPartialGeometry(aAnchor, startRootId);
      if (startPartial.length) for (const p of startPartial) push(p);
      else push(aAnchor?.point);
      for (const p of path.points || []) push(p);
      const endPartial = anchorPartialGeometry(bAnchor, targetRootId);
      if (endPartial.length) for (const p of endPartial.slice().reverse()) push(p);
      else push(bAnchor?.point);
      const coverage = pathCoverageAgainstRoute(points, manualRoute, threshold, 10);
      return {
        edgeIds: (path.edgeIds || []).slice(), points,
        distanceM: Number(path.distanceM || 0) + routeDistanceM(startPartial) + routeDistanceM(endPartial),
        coverageRatio: coverage.coverageRatio,
        averageDistanceM: coverage.averageDistanceM,
        maxDistanceM: coverage.maxDistanceM,
        startRootId,
        targetRootId
      };
    }

    function compactAnchor(a) {
      if (!a) return null;
      return {
        id: a.id, type: a.type, current: Boolean(a.current), edgeId: a.edgeId || null,
        nodeId: a.nodeId || null, point: a.point || null, distanceM: a.distanceM,
        highway: a.highway || 'unknown', wayIds: (a.wayIds || []).slice(),
        pedestrianRank: a.pedestrianRank, pedestrianLabel: a.pedestrianLabel || null,
        corridorDistanceM: a.corridorDistanceM, withinCorridor: a.withinCorridor !== false,
        sameSourceAsCurrent: Boolean(a.sameSourceAsCurrent)
      };
    }

    const pairTests = [];
    let currentPair = null;
    let bestAlternative = null;
    for (const aAnchor of anchorsA) {
      const search = searchFromAnchor(aAnchor, threshold, null);
      for (const bAnchor of anchorsB) {
        const target = targetNodeFor(bAnchor, search);
        const connected = Boolean(target);
        const item = {
          a: compactAnchor(aAnchor), b: compactAnchor(bAnchor), connected,
          changedEndpointCount: Number(!aAnchor.current) + Number(!bAnchor.current),
          totalSnapDistanceM: Number(aAnchor.distanceM || 0) + Number(bAnchor.distanceM || 0),
          witness: connected ? reconstruct(search, target, aAnchor, bAnchor) : null
        };
        pairTests.push(item);
        if (aAnchor.current && bAnchor.current) currentPair = item;
        if (connected && !(aAnchor.current && bAnchor.current)) {
          if (!bestAlternative ||
              item.changedEndpointCount < bestAlternative.changedEndpointCount ||
              (item.changedEndpointCount === bestAlternative.changedEndpointCount && Number(item.witness?.averageDistanceM ?? Infinity) < Number(bestAlternative.witness?.averageDistanceM ?? Infinity) - 1e-9) ||
              (item.changedEndpointCount === bestAlternative.changedEndpointCount && Math.abs(Number(item.witness?.averageDistanceM ?? Infinity) - Number(bestAlternative.witness?.averageDistanceM ?? Infinity)) < 1e-9 && item.totalSnapDistanceM < bestAlternative.totalSnapDistanceM - 1e-9)) {
            bestAlternative = item;
          }
        }
      }
    }

    pairTests.sort((x, y) =>
      (Number(y.connected) - Number(x.connected)) ||
      (Number(x.changedEndpointCount || 0) - Number(y.changedEndpointCount || 0)) ||
      (Number(x.witness?.averageDistanceM ?? Infinity) - Number(y.witness?.averageDistanceM ?? Infinity)) ||
      (x.totalSnapDistanceM - y.totalSnapDistanceM)
    );
    const selectedSnapLikelyCause = Boolean(currentPair && !currentPair.connected && bestAlternative?.connected);

    const dynamicParallelWays = new Set();
    for (const t of context?.thresholdDeltaAudit?.wayExclusionTests || []) {
      if (t?.essentialForUpperCorridor && t?.wayId != null) dynamicParallelWays.add(String(t.wayId));
    }
    let upperWithoutTransitionWays = null;
    if (bestAlternative?.connected && dynamicParallelWays.size) {
      const upperThreshold = Math.max(threshold, Number(context.upperThresholdM || config.manualReplayCorridorM || 16));
      const aFull = anchorsA.find((a) => a.id === bestAlternative.a.id) || null;
      const bFull = anchorsB.find((b) => b.id === bestAlternative.b.id) || null;
      const search = searchFromAnchor(aFull, upperThreshold, dynamicParallelWays);
      const target = targetNodeFor(bFull, search, upperThreshold, dynamicParallelWays);
      upperWithoutTransitionWays = {
        thresholdM: upperThreshold,
        forbiddenWayIds: Array.from(dynamicParallelWays),
        connected: Boolean(target),
        witness: target ? reconstruct(search, String(target), aFull, bFull) : null
      };
    }

    let outcome = 'no-counterfactual-rescue';
    let interpretation = `在 ${Math.round(threshold)} m 忠實走廊內，替換 A/B endpoint anchor 後仍沒有找到比目前 snap 更能恢復 A→B 的合法 path；目前證據不支持把 endpoint snapping 當成主要根因。`;
    if (currentPair?.connected) {
      outcome = 'current-snap-already-faithful';
      interpretation = `目前 A/B snap 在 ${Math.round(threshold)} m 忠實走廊內本來就可連通；endpoint snapping 不是這個 corridor disconnect 的根因。`;
    } else if (selectedSnapLikelyCause) {
      outcome = 'counterfactual-snap-restores-faithful-path';
      const changedA = !bestAlternative.a.current;
      const changedB = !bestAlternative.b.current;
      const changed = [changedA ? `A→${bestAlternative.a.highway}` : null, changedB ? `B→${bestAlternative.b.highway}` : null].filter(Boolean).join('、');
      interpretation = `只替換 endpoint anchor（${changed || 'A/B'}），不補 edge、不改日照權重、不改 matcher scoring，就能在 ${Math.round(threshold)} m 忠實走廊內恢復 A→B；這是 endpoint snap 造成路徑被迫逃向平行廊道的直接反事實證據。`;
      if (upperWithoutTransitionWays?.connected) interpretation += ` 即使再排除 dev14 驗出的 transition-critical source way，替代 anchor 在 ${Math.round(upperWithoutTransitionWays.thresholdM)} m 仍可連通，進一步支持「起終點吸附錯廊道」而非「必須借道該 tertiary」的解釋。`;
    }

    return {
      available: true,
      thresholdM: threshold,
      radiusM,
      currentPair,
      candidatesA: anchorsA.map(compactAnchor),
      candidatesB: anchorsB.map(compactAnchor),
      pairTests: pairTests.slice(0, 20),
      bestAlternative,
      selectedSnapLikelyCause,
      upperWithoutTransitionWays,
      outcome,
      interpretation
    };
  }

  async function orderedMapMatchDijkstra(graph, startId, endId, route, thresholdM, speedMps, options = {}) {
    lastOrderedMapMatchFailure = null;
    // dev10+: ordered map matching is a state-space problem, not just a node shortest path.
    // The same graph node may be reached while representing different progress along the
    // hand-drawn route.  Collapsing those states by node alone can discard the only legal
    // continuation through a levee / footway connector.
    const configuredBacktrackM = Math.max(4, Number(options.manualReplayBacktrackToleranceM || config.manualReplayBacktrackToleranceM || 12));
    const backwardToleranceM = Math.max(configuredBacktrackM, thresholdM * 0.75);
    const lateralWeight = Math.max(0.5, Number(options.manualReplayLateralWeight || 4));
    const progressBucketM = Math.max(4, Number(options.manualReplayProgressBucketM || config.manualReplayProgressBucketM || 10));
    const routeLen = routeDistanceM(route);
    const goalToleranceM = Math.max(18, Number(options.manualReplayGoalToleranceM || config.manualReplayGoalToleranceM || 28), thresholdM * 0.8);
    const maxForwardGapBaseM = Math.max(35, Number(options.manualReplayMaxForwardGapM || 55));
    const dist = new Map();
    const time = new Map();
    const prev = new Map();
    const heap = new MinHeap((a, b) => a.score - b.score);
    const matchCache = new Map();
    const cooperativeYield = makeCooperativeYielder(options);
    const rejectCounts = { tooFar: 0, edgeBackwards: 0, stateBehind: 0, forwardJump: 0, envelope: 0 };
    let expanded = 0;
    let furthest = { progressM: 0, node: String(startId), score: 0 };

    function bucketFor(progressM) {
      return Math.max(0, Math.min(Math.ceil(routeLen / progressBucketM) + 2, Math.round(progressM / progressBucketM)));
    }
    function keyFor(node, progressM) {
      return `${String(node)}|${bucketFor(progressM)}`;
    }

    const startNode = graph.nodes.get(String(startId));
    const startProjection = startNode ? projectPointToPolylineProgressM(startNode, route) : null;
    const startProgressM = Math.max(0, Math.min(routeLen, startProjection?.progressM ?? 0));
    const startKey = keyFor(startId, startProgressM);
    dist.set(startKey, 0);
    time.set(startKey, 0);
    heap.push({ key: startKey, node: String(startId), progressM: startProgressM, score: 0 });
    let goalState = null;

    while (heap.size) {
      if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      const cur = heap.pop();
      if (!cur || cur.score !== dist.get(cur.key)) continue;
      if (cur.progressM > furthest.progressM + 0.01) furthest = { progressM: cur.progressM, node: cur.node, score: cur.score };
      if (cur.node === String(endId) && cur.progressM >= routeLen - goalToleranceM) {
        goalState = cur;
        break;
      }
      expanded += 1;
      if ((expanded % 100) === 0) await cooperativeYield();

      for (const ref of graph.adjacency.get(cur.node) || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge) continue;
        const cacheKey = `${edge.id}|${cur.node}`;
        let match = matchCache.get(cacheKey);
        if (match == null) {
          match = orderedEdgeMatch(edge, cur.node, route, 5);
          matchCache.set(cacheKey, match || false);
        }
        if (!match || match === false) continue;
        const verdict = classifyOrderedTransition(match, edge, cur.progressM, routeLen, thresholdM, backwardToleranceM, maxForwardGapBaseM);
        if (!verdict.accepted) {
          if (Object.prototype.hasOwnProperty.call(rejectCounts, verdict.reason)) rejectCounts[verdict.reason] += 1;
          continue;
        }

        const next = String(ref.to);
        const edgeTime = edge.distanceM / speedMps;
        const nextProgressM = Math.max(cur.progressM, Math.min(routeLen, match.endProgressM));
        const effectiveGainM = Math.max(0, nextProgressM - cur.progressM);
        const lateralFactor = 1 + lateralWeight * Math.min(1.5, match.avgDistanceM / Math.max(4, thresholdM));
        const stagnantPenalty = Math.max(0, Math.min(edge.distanceM, 20) - effectiveGainM) * 2;
        const continuityGapM = Math.max(0, Math.abs(match.startProgressM - cur.progressM) - thresholdM);
        const continuityPenalty = continuityGapM * 1.5;
        const score = cur.score + edge.distanceM * lateralFactor + stagnantPenalty + continuityPenalty;
        const nextKey = keyFor(next, nextProgressM);
        if (score + 1e-9 < (dist.get(nextKey) ?? Infinity)) {
          dist.set(nextKey, score);
          time.set(nextKey, (time.get(cur.key) || 0) + edgeTime);
          prev.set(nextKey, { prevKey: cur.key, node: cur.node, edgeId: edge.id, match, progressM: nextProgressM });
          heap.push({ key: nextKey, node: next, progressM: nextProgressM, score });
        }
      }
    }

    if (!goalState) {
      const node = graph.nodes.get(furthest.node);
      const nearbyHighways = [];
      for (const ref of graph.adjacency.get(furthest.node) || []) {
        const edge = graph.edges.get(ref.edgeId);
        const h = edge ? primaryHighway(edge) : null;
        if (h && !nearbyHighways.includes(h)) nearbyHighways.push(h);
      }
      const breakpoint = buildTopologyBreakpointDiagnostics(graph, furthest, route, thresholdM, backwardToleranceM, maxForwardGapBaseM, rejectCounts, options);
      lastOrderedMapMatchFailure = {
        outcome: "no-goal-path",
        reason: "ordered-graph-goal-not-reached",
        graphReachedGoal: false,
        manualFidelityAccepted: false,
        thresholdM,
        expanded,
        routeLengthM: routeLen,
        maxProgressM: furthest.progressM,
        maxProgressRatio: routeLen > 0 ? furthest.progressM / routeLen : 0,
        nodeId: furthest.node,
        lat: node?.lat ?? null,
        lng: node?.lng ?? null,
        nearbyHighways: nearbyHighways.slice(0, 8),
        backwardToleranceM,
        progressBucketM,
        rejectCounts,
        breakpoint
      };
      return null;
    }

    const steps = [];
    let curKey = goalState.key;
    let guard = 0;
    while (curKey !== startKey && guard++ < 20000) {
      const step = prev.get(curKey);
      if (!step) throw new Error("ORDERED_MAP_MATCH_RECONSTRUCTION_FAILED");
      const currentNode = curKey.split('|')[0];
      steps.push({ edgeId: step.edgeId, from: step.node, to: currentNode, match: step.match });
      curKey = step.prevKey;
    }
    steps.reverse();
    const path = pathFromEdgeSteps(graph, steps);
    path.walkSeconds = time.get(goalState.key);
    path.steps = steps;
    path.mapMatchScore = dist.get(goalState.key);
    path.mapMatchProgressM = goalState.progressM;
    const minCoverage = clamp(options.manualReplayMinCoverage ?? config.manualReplayMinCoverage, 0.5, 1, 0.88);
    const configuredFidelityThresholdM = clamp(options.manualReplayFidelityThresholdM ?? config.manualReplayFidelityThresholdM, 4, 100, 14);
    const fidelityThresholdM = Math.min(thresholdM, configuredFidelityThresholdM);
    path.coverage = pathCoverageAgainstRoute(path.points, route, fidelityThresholdM, 10);
    path.divergence = pathDivergenceDiagnostics(graph, steps, route, fidelityThresholdM, options.manualReplayDivergenceSampleM || config.manualReplayDivergenceSampleM || 6);
    path.mapMatchAttempt = {
      outcome: path.coverage.coverageRatio >= minCoverage ? "accepted-map-match" : "connected-low-coverage",
      reason: path.coverage.coverageRatio >= minCoverage ? "manual-fidelity-accepted" : "connected-low-manual-coverage",
      graphReachedGoal: true,
      manualFidelityAccepted: path.coverage.coverageRatio >= minCoverage,
      thresholdM,
      expanded,
      routeLengthM: routeLen,
      mapMatchProgressM: goalState.progressM,
      mapMatchScore: path.mapMatchScore,
      coverageRatio: path.coverage.coverageRatio,
      averageDistanceM: path.coverage.averageDistanceM,
      maxDistanceM: path.coverage.maxDistanceM,
      minCoverage,
      fidelityThresholdM,
      firstDivergence: path.divergence?.firstDivergence || null,
      firstThresholdExceeded: path.divergence?.firstThresholdExceeded || null,
      switchedToNearbyParallel: Boolean(path.divergence?.switchedToNearbyParallel),
      firstParallelDivergence: path.divergence?.firstParallelDivergence || null
    };
    lastOrderedMapMatchFailure = null;
    return path;
  }
  async function corridorDijkstra(graph, startId, endId, route, thresholdM, speedMps, options = {}) {
    const dist = new Map([[String(startId), 0]]);
    const prev = new Map();
    const heap = new MinHeap((a, b) => a.t - b.t);
    const edgeDistanceCache = new Map();
    const cooperativeYield = makeCooperativeYielder(options);
    let expanded = 0;
    heap.push({ node: String(startId), t: 0 });
    while (heap.size) {
      if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      const cur = heap.pop();
      if (!cur || cur.t !== dist.get(cur.node)) continue;
      if (cur.node === String(endId)) break;
      expanded += 1;
      if ((expanded % 120) === 0) await cooperativeYield();
      for (const ref of graph.adjacency.get(cur.node) || []) {
        const edge = graph.edges.get(ref.edgeId);
        if (!edge) continue;
        let corridorD = edgeDistanceCache.get(edge.id);
        if (corridorD == null) {
          corridorD = edgeDistanceToPolylineM(edge, route, 5);
          edgeDistanceCache.set(edge.id, corridorD);
        }
        if (!(corridorD <= thresholdM)) continue;
        const next = String(ref.to);
        const t = cur.t + edge.distanceM / speedMps;
        if (t + 1e-9 < (dist.get(next) ?? Infinity)) {
          dist.set(next, t);
          prev.set(next, { node: cur.node, edgeId: edge.id });
          heap.push({ node: next, t });
        }
      }
    }
    const endT = dist.get(String(endId));
    if (!Number.isFinite(endT)) return null;
    const steps = [];
    let cur = String(endId);
    let guard = 0;
    while (cur !== String(startId) && guard++ < 10000) {
      const step = prev.get(cur);
      if (!step) return null;
      steps.push({ edgeId: step.edgeId, from: step.node, to: cur });
      cur = step.node;
    }
    steps.reverse();
    const path = pathFromEdgeSteps(graph, steps);
    path.walkSeconds = endT;
    path.steps = steps;
    return path;
  }

  async function replayPolyline(points, options = {}) {
    const state = lastGraphDebug;
    if (!state?.graph || !state.snapA || !state.snapB) return { available: false, reason: "no-graph" };
    const route = (points || []).map(asLatLng).filter(Boolean);
    if (route.length < 2) return { available: false, reason: "route-too-short" };
    const graph = state.graph;
    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    const baseThreshold = Math.max(6, Number(options.corridorM || config.manualReplayCorridorM || 16));
    const maxThreshold = Math.max(baseThreshold, Number(options.maxCorridorM || config.manualReplayMaxCorridorM || 36));
    const minCoverage = clamp(options.manualReplayMinCoverage ?? config.manualReplayMinCoverage, 0.5, 1, 0.88);
    const thresholds = Array.from(new Set([baseThreshold, Math.min(maxThreshold, baseThreshold + 8), Math.min(maxThreshold, baseThreshold + 16), maxThreshold])).sort((a,b)=>a-b);
    let path = null;
    let usedThresholdM = null;
    let bestFailure = null;
    let bestLowCoverage = null;
    const failureAttempts = [];
    const attempts = [];

    function buildCorridorDiagnostics(fidelityThresholdM) {
      const cache = new Map();
      const fidelity = Math.max(4, Number(fidelityThresholdM || config.manualReplayFidelityThresholdM || 14));
      const auditThresholds = Array.from(new Set([fidelity, baseThreshold])).sort((a, b) => a - b);
      const strictCorridorAudits = auditThresholds.map((thresholdM) => strictCorridorConnectivityAudit(
        graph, state.snapA.id, state.snapB.id, route, thresholdM, options, cache
      ));
      const strictCorridorAudit = strictCorridorAudits[0] || null;
      const lowerAudit = strictCorridorAudits.find((a) => Math.abs(Number(a.thresholdM) - fidelity) < 1e-6) || strictCorridorAudit;
      const upperAudit = strictCorridorAudits.find((a) => Math.abs(Number(a.thresholdM) - baseThreshold) < 1e-6) || strictCorridorAudits[strictCorridorAudits.length - 1] || null;
      const thresholdDeltaAudit = baseThreshold > fidelity + 1e-9
        ? corridorThresholdDeltaAudit(
            graph, state.snapA.id, state.snapB.id, route, fidelity, baseThreshold, options, cache,
            { lowerAudit, upperAudit }
          )
        : null;
      const endpointSnapAudit = endpointSnapCounterfactualAudit(
        graph, state.snapA, state.snapB, route, fidelity, options, cache,
        { thresholdDeltaAudit, upperThresholdM: baseThreshold }
      );
      const corridorComponentTraceAudit = faithfulCorridorComponentTraceAudit(
        graph, state.snapA.id, state.snapB.id, route, fidelity, options, cache
      );
      const rawOsmJunctionAuditResult = rawOsmJunctionAudit(
        graph, state.raw, route, corridorComponentTraceAudit, options
      );
      return { strictCorridorAudits, strictCorridorAudit, thresholdDeltaAudit, endpointSnapCounterfactualAudit: endpointSnapAudit, corridorComponentTraceAudit, rawOsmJunctionAudit: rawOsmJunctionAuditResult };
    }

    function cloneAttempt(attempt) {
      if (!attempt) return null;
      return Object.assign({}, attempt, {
        rejectCounts: attempt.rejectCounts ? Object.assign({}, attempt.rejectCounts) : undefined,
        breakpoint: attempt.breakpoint ? Object.assign({}, attempt.breakpoint) : undefined,
        firstDivergence: attempt.firstDivergence ? Object.assign({}, attempt.firstDivergence, {
          wayIds: (attempt.firstDivergence.wayIds || []).slice(),
          tags: Object.assign({}, attempt.firstDivergence.tags || {})
        }) : null,
        firstThresholdExceeded: attempt.firstThresholdExceeded ? Object.assign({}, attempt.firstThresholdExceeded) : null,
        firstParallelDivergence: attempt.firstParallelDivergence ? Object.assign({}, attempt.firstParallelDivergence, {
          wayIds: (attempt.firstParallelDivergence.wayIds || []).slice(),
          tags: Object.assign({}, attempt.firstParallelDivergence.tags || {})
        }) : null
      });
    }

    function lowCoverageIsBetter(candidate, current) {
      if (!current) return true;
      const c = candidate.path.coverage || {};
      const b = current.path.coverage || {};
      if (Number(c.coverageRatio || 0) > Number(b.coverageRatio || 0) + 1e-9) return true;
      if (Math.abs(Number(c.coverageRatio || 0) - Number(b.coverageRatio || 0)) > 1e-9) return false;
      const cAvg = Number.isFinite(Number(c.averageDistanceM)) ? Number(c.averageDistanceM) : Infinity;
      const bAvg = Number.isFinite(Number(b.averageDistanceM)) ? Number(b.averageDistanceM) : Infinity;
      if (cAvg < bAvg - 1e-9) return true;
      if (Math.abs(cAvg - bAvg) > 1e-9) return false;
      const cScore = Number.isFinite(Number(candidate.path.mapMatchScore)) ? Number(candidate.path.mapMatchScore) : Infinity;
      const bScore = Number.isFinite(Number(current.path.mapMatchScore)) ? Number(current.path.mapMatchScore) : Infinity;
      return cScore < bScore;
    }

    for (const thresholdM of thresholds) {
      try { options.onProgress?.({ stage:'manual-replay-mapmatch', thresholdM, message:`ordered map-match：正在測試 ${Math.round(thresholdM)} m corridor…` }); } catch (_) {}
      path = await orderedMapMatchDijkstra(graph, state.snapA.id, state.snapB.id, route, thresholdM, speedMps, options);
      if (path) {
        const attempt = cloneAttempt(path.mapMatchAttempt || {
          outcome: (path.coverage?.coverageRatio || 0) >= minCoverage ? "accepted-map-match" : "connected-low-coverage",
          graphReachedGoal: true,
          manualFidelityAccepted: (path.coverage?.coverageRatio || 0) >= minCoverage,
          thresholdM,
          coverageRatio: path.coverage?.coverageRatio ?? null,
          averageDistanceM: path.coverage?.averageDistanceM ?? null,
          maxDistanceM: path.coverage?.maxDistanceM ?? null,
          mapMatchScore: path.mapMatchScore ?? null,
          minCoverage
        });
        attempts.push(attempt);
        if (attempt.manualFidelityAccepted) {
          usedThresholdM = thresholdM;
          break;
        }
        const low = { path, attempt };
        if (lowCoverageIsBetter(low, bestLowCoverage)) bestLowCoverage = low;
        path = null;
        continue;
      }

      if (lastOrderedMapMatchFailure) {
        const snapshot = cloneAttempt(lastOrderedMapMatchFailure);
        failureAttempts.push(snapshot);
        attempts.push(snapshot);
        if (!bestFailure || Number(snapshot.maxProgressRatio || 0) > Number(bestFailure.maxProgressRatio || 0) + 1e-9 ||
            (Math.abs(Number(snapshot.maxProgressRatio || 0) - Number(bestFailure.maxProgressRatio || 0)) < 1e-9 && Number(snapshot.thresholdM || Infinity) < Number(bestFailure.thresholdM || Infinity))) {
          bestFailure = snapshot;
        }
      }
    }

    if (!path && bestLowCoverage) {
      const lowPath = bestLowCoverage.path;
      const low = bestLowCoverage.attempt;
      const fidelityThresholdM = low.fidelityThresholdM ?? Math.min(14, Number(low.thresholdM || baseThreshold));
      const corridorDiagnostics = buildCorridorDiagnostics(fidelityThresholdM);
      const { strictCorridorAudits, strictCorridorAudit, thresholdDeltaAudit, endpointSnapCounterfactualAudit, corridorComponentTraceAudit, rawOsmJunctionAudit } = corridorDiagnostics;
      try { options.onProgress?.({ stage:'manual-replay-audit', message:'ordered path 已到 B；正在整理 strict corridor / source topology 診斷…' }); } catch (_) {}
      const deferSourceGap = options.deferSourceGapCounterfactual ?? config.deferSourceGapCounterfactual;
      const sourceGapCounterfactualAudit = deferSourceGap
        ? deferredSourceGapCounterfactual(rawOsmJunctionAudit)
        : await controlledSourceGapConnectorAudit(
            graph, state.snapA.id, state.snapB.id, route, corridorComponentTraceAudit, rawOsmJunctionAudit, departure, speedMps,
            Object.assign({}, options, { referenceDetourLimitSeconds: lastDiagnostics?.detourLimitSeconds })
          );
      const connectorSafetyPolicy = sourceGapConnectorSafetyPolicy(rawOsmJunctionAudit, sourceGapCounterfactualAudit, null, options);
      const engineBenchmark = engineBenchmarkManifest(route, route[0], route[route.length - 1], rawOsmJunctionAudit, sourceGapCounterfactualAudit);
      lastOrderedMapMatchFailure = null;
      return {
        available: true,
        connected: true,
        graphReachedGoal: true,
        mapMatched: false,
        manualFidelityAccepted: false,
        outcome: "connected-low-coverage",
        reason: "connected-low-manual-coverage",
        triedCorridorM: thresholds,
        corridorM: low.thresholdM,
        distanceM: lowPath.distanceM,
        mapMatchCoverageRatio: low.coverageRatio,
        mapMatchAverageDistanceM: low.averageDistanceM,
        mapMatchMaxDistanceM: low.maxDistanceM,
        mapMatchScore: low.mapMatchScore,
        mapMatchProgressM: low.mapMatchProgressM ?? null,
        minCoverage: low.minCoverage ?? minCoverage,
        fidelityThresholdM,
        strictCorridorAudit,
        strictCorridorAudits,
        thresholdDeltaAudit,
        endpointSnapCounterfactualAudit,
        corridorComponentTraceAudit,
        rawOsmJunctionAudit,
        sourceGapCounterfactualAudit,
        connectorSafetyPolicy,
        engineBenchmark,
        firstDivergence: low.firstDivergence || null,
        firstThresholdExceeded: low.firstThresholdExceeded || null,
        switchedToNearbyParallel: Boolean(low.switchedToNearbyParallel),
        firstParallelDivergence: low.firstParallelDivergence || null,
        edgeIds: lowPath.edgeIds,
        points: lowPath.points,
        attempts,
        failureAttempts: failureAttempts.map((f) => ({ thresholdM: f.thresholdM, maxProgressRatio: f.maxProgressRatio, maxProgressM: f.maxProgressM, nodeId: f.nodeId, breakpoint: f.breakpoint || null })),
        interpretation: "Graph 已可連到 B，但 ordered path 與手繪線的貼合度低於驗收門檻；這是低貼合匹配，不是拓樸不連通。"
      };
    }

    if (!path) {
      const fidelityThresholdM = Math.max(4, Number(options.manualReplayFidelityThresholdM ?? config.manualReplayFidelityThresholdM ?? 14));
      const corridorDiagnostics = buildCorridorDiagnostics(fidelityThresholdM);
      const { strictCorridorAudits, strictCorridorAudit, thresholdDeltaAudit, endpointSnapCounterfactualAudit, corridorComponentTraceAudit, rawOsmJunctionAudit } = corridorDiagnostics;
      try { options.onProgress?.({ stage:'manual-replay-audit', message:'ordered path 已到 B；正在整理 strict corridor / source topology 診斷…' }); } catch (_) {}
      const deferSourceGap = options.deferSourceGapCounterfactual ?? config.deferSourceGapCounterfactual;
      const sourceGapCounterfactualAudit = deferSourceGap
        ? deferredSourceGapCounterfactual(rawOsmJunctionAudit)
        : await controlledSourceGapConnectorAudit(
            graph, state.snapA.id, state.snapB.id, route, corridorComponentTraceAudit, rawOsmJunctionAudit, departure, speedMps,
            Object.assign({}, options, { referenceDetourLimitSeconds: lastDiagnostics?.detourLimitSeconds })
          );
      const connectorSafetyPolicy = sourceGapConnectorSafetyPolicy(rawOsmJunctionAudit, sourceGapCounterfactualAudit, null, options);
      const engineBenchmark = engineBenchmarkManifest(route, route[0], route[route.length - 1], rawOsmJunctionAudit, sourceGapCounterfactualAudit);
      lastOrderedMapMatchFailure = bestFailure || lastOrderedMapMatchFailure;
      return {
        available: true,
        connected: false,
        graphReachedGoal: false,
        mapMatched: false,
        manualFidelityAccepted: false,
        outcome: "no-goal-path",
        reason: "no-ordered-map-match-in-manual-corridor",
        triedCorridorM: thresholds,
        fidelityThresholdM,
        strictCorridorAudit,
        strictCorridorAudits,
        thresholdDeltaAudit,
        endpointSnapCounterfactualAudit,
        corridorComponentTraceAudit,
        rawOsmJunctionAudit,
        sourceGapCounterfactualAudit,
        connectorSafetyPolicy,
        engineBenchmark,
        failureDiagnostics: bestFailure ? Object.assign({}, bestFailure) : (lastOrderedMapMatchFailure ? Object.assign({}, lastOrderedMapMatchFailure) : null),
        failureAttempts: failureAttempts.map((f) => ({ thresholdM: f.thresholdM, maxProgressRatio: f.maxProgressRatio, maxProgressM: f.maxProgressM, nodeId: f.nodeId, breakpoint: f.breakpoint || null })),
        attempts
      };
    }

    let walkS = 0;
    let sunS = 0;
    const edgeSun = [];
    const cooperativeYield = makeCooperativeYielder(options);
    for (let i = 0; i < path.steps.length; i += 1) {
      const step = path.steps[i];
      const edge = graph.edges.get(step.edgeId);
      if (!edge) continue;
      const edgeTime = edge.distanceM / speedMps;
      const at = new Date(departure.getTime() + (walkS + edgeTime / 2) * 1000);
      const shade = await defaultEdgeSunProvider(edge, step.from, at, {
        shadeSampleSpacingM: options.shadeSampleSpacingM || config.shadeSampleSpacingM,
        shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge || config.shadeMaxSamplesPerEdge,
        shadeConcurrency: options.shadeConcurrency || config.shadeConcurrency,
        canopyTimeoutMs: options.canopyTimeoutMs || config.canopyTimeoutMs
      });
      const directSunFraction = clamp(shade?.directSunFraction, 0, 1, 0);
      const edgeSunSeconds = edgeTime * directSunFraction;
      sunS += edgeSunSeconds;
      walkS += edgeTime;
      edgeSun.push({ edgeId: edge.id, highway: primaryHighway(edge), distanceM: edge.distanceM, directSunFraction, directSunSeconds: edgeSunSeconds });
      if ((i % 3) === 2) await cooperativeYield();
    }
    const fidelityThresholdM = path.mapMatchAttempt?.fidelityThresholdM ?? Math.max(4, Number(options.manualReplayFidelityThresholdM ?? config.manualReplayFidelityThresholdM ?? 14));
    // dev18: even a coverage-passing ordered match can still ride a nearby parallel corridor.
    // Always retain the strict faithful-corridor evidence for accepted paths, then compare
    // the exact same graph geometry under the coarse search sampler and a dense 10 m sampler.
    const corridorDiagnostics = buildCorridorDiagnostics(fidelityThresholdM);
    const strictCorridorAuditsAccepted = corridorDiagnostics.strictCorridorAudits;
    const strictCorridorAuditAccepted = corridorDiagnostics.strictCorridorAudit;
    const thresholdDeltaAuditAccepted = corridorDiagnostics.thresholdDeltaAudit;
    const endpointSnapCounterfactualAuditAccepted = corridorDiagnostics.endpointSnapCounterfactualAudit;
    const corridorComponentTraceAuditAccepted = corridorDiagnostics.corridorComponentTraceAudit;
    const rawOsmJunctionAuditAccepted = corridorDiagnostics.rawOsmJunctionAudit;
    const deferSourceGapAccepted = options.deferSourceGapCounterfactual ?? config.deferSourceGapCounterfactual;
    const sourceGapCounterfactualAuditAccepted = !strictCorridorAuditAccepted?.connected
      ? (deferSourceGapAccepted
          ? deferredSourceGapCounterfactual(rawOsmJunctionAuditAccepted)
          : await controlledSourceGapConnectorAudit(
              graph, state.snapA.id, state.snapB.id, route, corridorComponentTraceAuditAccepted, rawOsmJunctionAuditAccepted, departure, speedMps,
              Object.assign({}, options, { referenceDetourLimitSeconds: lastDiagnostics?.detourLimitSeconds })
            ))
      : { available: false, reason: 'strict-corridor-already-connected' };
    const connectorSafetyPolicyAccepted = sourceGapConnectorSafetyPolicy(rawOsmJunctionAuditAccepted, sourceGapCounterfactualAuditAccepted, null, options);
    const engineBenchmarkAccepted = engineBenchmarkManifest(route, route[0], route[route.length - 1], rawOsmJunctionAuditAccepted, sourceGapCounterfactualAuditAccepted);
    const shadeCostAudit = await reconcilePathShadeCost(graph, path.steps, edgeSun, departure, speedMps, options);
    const strictFidelityAccepted = Boolean(strictCorridorAuditAccepted?.connected) && (path.coverage?.coverageRatio || 0) >= minCoverage;

    const fastestS = Number(lastDiagnostics?.fastestSeconds);
    const detourPct = Number.isFinite(Number(options.detourPct)) ? Number(options.detourPct) : Number(lastDiagnostics?.detourPct || 30);
    const detourLimitS = Number.isFinite(fastestS) ? fastestS * (1 + Math.max(0, detourPct) / 100) : Infinity;
    const autoSunS = Number(lastDiagnostics?.minSunEstimatedDirectSunSeconds);
    const withinDetour = walkS <= detourLimitS + 0.5;
    const searchMissConfirmed = withinDetour && Number.isFinite(autoSunS) && sunS + 0.5 < autoSunS;
    let interpretation = "手繪路線已按前進順序 map-match 成 OSM graph 的連通 A→B edge path。";
    if (!withinDetour) interpretation = "手繪 ordered map-match 路徑在 OSM graph 中連通，但依 graph 步行時間已超過目前繞路上限。";
    else if (!strictFidelityAccepted) interpretation = "ordered matcher 雖通過點覆蓋門檻，但 14 m strict faithful corridor 仍不連通；這個 match 可能借用了貼近手繪線的平行廊道，不能直接拿來判定 shade-cost 或搜尋漏解。";
    else if (searchMissConfirmed) interpretation = "已確認搜尋漏解：同一 OSM graph、同一日照成本模型中，手繪 ordered map-match 路徑符合繞路上限且直接日照更少。";
    else if (shadeCostAudit?.materialMismatch) interpretation = "同一條 ordered graph path 在搜尋用 coarse edge sampler 與 10 m dense ShadeMap 重算之間有實質日照差異；優先追 shade-cost 採樣／時間模型。";
    else if (Number.isFinite(autoSunS)) interpretation = "同一條 ordered graph path 的 coarse edge 日照與 10 m dense ShadeMap 大致一致；若它仍與手繪路線最終曝曬差很多，優先懷疑 map-match 幾何而不是 shade-cost。";
    return {
      available: true,
      connected: true,
      graphReachedGoal: true,
      mapMatched: true,
      manualFidelityAccepted: true,
      outcome: "accepted-map-match",
      reason: "manual-fidelity-accepted",
      corridorM: usedThresholdM,
      triedCorridorM: thresholds,
      distanceM: path.distanceM,
      walkSeconds: walkS,
      mapMatchCoverageRatio: path.coverage?.coverageRatio ?? null,
      mapMatchAverageDistanceM: path.coverage?.averageDistanceM ?? null,
      mapMatchMaxDistanceM: path.coverage?.maxDistanceM ?? null,
      mapMatchScore: path.mapMatchScore ?? null,
      minCoverage,
      fidelityThresholdM,
      strictFidelityAccepted,
      strictCorridorAudit: strictCorridorAuditAccepted,
      strictCorridorAudits: strictCorridorAuditsAccepted,
      thresholdDeltaAudit: thresholdDeltaAuditAccepted,
      endpointSnapCounterfactualAudit: endpointSnapCounterfactualAuditAccepted,
      corridorComponentTraceAudit: corridorComponentTraceAuditAccepted,
      rawOsmJunctionAudit: rawOsmJunctionAuditAccepted,
      sourceGapCounterfactualAudit: sourceGapCounterfactualAuditAccepted,
      connectorSafetyPolicy: connectorSafetyPolicyAccepted,
      engineBenchmark: engineBenchmarkAccepted,
      shadeCostAudit,
      firstDivergence: path.mapMatchAttempt?.firstDivergence || null,
      switchedToNearbyParallel: Boolean(path.mapMatchAttempt?.switchedToNearbyParallel),
      directSunSeconds: sunS,
      directSunFraction: walkS > 0 ? sunS / walkS : null,
      withinDetour,
      detourPct,
      detourLimitSeconds: detourLimitS,
      fastestSeconds: fastestS,
      autoEstimatedDirectSunSeconds: Number.isFinite(autoSunS) ? autoSunS : null,
      searchMissConfirmed,
      edgeIds: path.edgeIds,
      points: path.points,
      edgeSun,
      attempts,
      interpretation
    };
  }

  async function nearestNodeResponsive(raw, point, maxM = Infinity, options = {}) {
    const P = asLatLng(point);
    if (!P) return null;
    const cooperativeYield = makeCooperativeYielder(options);
    let best = null;
    let scanned = 0;
    for (const [id, node] of raw.nodes) {
      if (!raw.adjacency.has(id)) continue;
      const distanceM = haversineM(P, node);
      if (distanceM <= maxM && (!best || distanceM < best.distanceM)) best = { id, node, distanceM };
      scanned += 1;
      if (scanned % 600 === 0) await cooperativeYield();
    }
    return best;
  }

  function cloneRawGraph(raw) {
    const nodes = new Map();
    for (const [id, node] of raw?.nodes || []) nodes.set(String(id), Object.assign({}, node));
    const adjacency = new Map();
    for (const [id, neighbors] of raw?.adjacency || []) {
      const next = new Map();
      for (const [to, meta] of neighbors || []) next.set(String(to), Object.assign({}, meta));
      adjacency.set(String(id), next);
    }
    return {
      nodes,
      adjacency,
      rawSegments: Number(raw?.rawSegments || 0),
      wayMeta: raw?.wayMeta || new Map()
    };
  }

  function removeRawNeighbor(adjacency, a, b) {
    const map = adjacency.get(String(a));
    if (!map) return;
    map.delete(String(b));
    if (!map.size) adjacency.delete(String(a));
  }

  async function nearestRawEdgeResponsive(raw, point, maxM = Infinity, options = {}) {
    const P = asLatLng(point);
    if (!P) return null;
    const cooperativeYield = makeCooperativeYielder(options);
    const seen = new Set();
    const choices = [];
    let nearestDistanceM = Infinity;
    let scanned = 0;
    for (const [aId, neighbors] of raw?.adjacency || []) {
      const a = raw.nodes.get(String(aId));
      if (!a) continue;
      for (const [bId] of neighbors || []) {
        const key = undirectedKey(aId, bId);
        if (seen.has(key)) continue;
        seen.add(key);
        const b = raw.nodes.get(String(bId));
        if (!b) continue;
        const hit = projectPointToSegmentM(P, a, b);
        if (hit && hit.distanceM <= maxM) {
          const forwardMeta = raw.adjacency.get(String(aId))?.get(String(bId)) || null;
          const reverseMeta = raw.adjacency.get(String(bId))?.get(String(aId)) || null;
          const meta = forwardMeta || reverseMeta || null;
          const tags = meta?.tags || {};
          const candidate = Object.assign({}, hit, {
            aId: String(aId), bId: String(bId), a, b,
            forwardMeta, reverseMeta,
            wayId: meta?.wayId || null, tags,
            pedestrianRank: pedestrianSnapRank(tags),
            pedestrianLabel: pedestrianSnapLabel(tags)
          });
          choices.push(candidate);
          nearestDistanceM = Math.min(nearestDistanceM, hit.distanceM);
        }
        scanned += 1;
        if (scanned % 600 === 0) await cooperativeYield();
      }
    }
    if (!choices.length) return null;
    const slackM = Math.max(0, Number(options.pedestrianSnapSlackM ?? config.pedestrianSnapSlackM ?? 12));
    const eligible = choices.filter((c) => c.distanceM <= nearestDistanceM + slackM + 1e-9);
    eligible.sort((x, y) => (x.pedestrianRank - y.pedestrianRank) || (x.distanceM - y.distanceM));
    const best = eligible[0] || choices.sort((x, y) => x.distanceM - y.distanceM)[0];
    best.geometricNearestDistanceM = nearestDistanceM;
    best.preferenceSlackM = slackM;
    best.extraSnapDistanceM = Math.max(0, best.distanceM - nearestDistanceM);
    return best;
  }

  function splitRawEdgeAtPoint(raw, hit, label, options = {}) {
    if (!raw || !hit) return null;
    const endpointToleranceM = Math.max(0.5, Number(options.snapEndpointToleranceM || config.snapEndpointToleranceM || 1.5));
    const aId = String(hit.aId), bId = String(hit.bId);
    const a = raw.nodes.get(aId), b = raw.nodes.get(bId);
    if (!a || !b) return null;
    const projected = asLatLng(hit.point);
    if (!projected) return null;
    const da = haversineM(projected, a);
    const db = haversineM(projected, b);
    const sourceMeta = hit.forwardMeta || hit.reverseMeta || {};
    const common = {
      distanceM: Number(hit.distanceM || 0),
      snapType: 'edge',
      sourceA: aId,
      sourceB: bId,
      sourceWayId: sourceMeta.wayId || hit.wayId || null,
      sourceHighway: normalizedTag(sourceMeta.tags?.highway || hit.tags?.highway || '') || null,
      projectionT: Number(hit.t || 0),
      pedestrianRank: Number.isFinite(Number(hit.pedestrianRank)) ? Number(hit.pedestrianRank) : pedestrianSnapRank(hit.tags || {}),
      pedestrianLabel: hit.pedestrianLabel || pedestrianSnapLabel(hit.tags || {}),
      geometricNearestDistanceM: Number.isFinite(Number(hit.geometricNearestDistanceM)) ? Number(hit.geometricNearestDistanceM) : Number(hit.distanceM || 0),
      extraSnapDistanceM: Number(hit.extraSnapDistanceM || 0)
    };
    if (da <= endpointToleranceM) return Object.assign({ id: aId, node: a }, common, { snapType: 'edge-endpoint', distanceM: haversineM(options.inputPoint || projected, a) });
    if (db <= endpointToleranceM) return Object.assign({ id: bId, node: b }, common, { snapType: 'edge-endpoint', distanceM: haversineM(options.inputPoint || projected, b) });

    let id = `snap:${String(label || 'P')}`;
    let serial = 1;
    while (raw.nodes.has(id)) id = `snap:${String(label || 'P')}:${++serial}`;
    const node = { id, lat: projected.lat, lng: projected.lng, virtualSnap: true, snapLabel: String(label || 'P') };
    raw.nodes.set(id, node);

    const forward = raw.adjacency.get(aId)?.get(bId) || null;
    const reverse = raw.adjacency.get(bId)?.get(aId) || null;
    removeRawNeighbor(raw.adjacency, aId, bId);
    removeRawNeighbor(raw.adjacency, bId, aId);

    const distA = Math.max(0.05, haversineM(a, node));
    const distB = Math.max(0.05, haversineM(node, b));
    if (forward) {
      addRawNeighbor(raw.adjacency, aId, id, Object.assign({}, forward, { distanceM: distA }));
      addRawNeighbor(raw.adjacency, id, bId, Object.assign({}, forward, { distanceM: distB }));
    }
    if (reverse) {
      addRawNeighbor(raw.adjacency, bId, id, Object.assign({}, reverse, { distanceM: distB }));
      addRawNeighbor(raw.adjacency, id, aId, Object.assign({}, reverse, { distanceM: distA }));
    }
    raw.rawSegments = Number(raw.rawSegments || 0) + 1;
    return Object.assign({ id, node, distanceM: Number(hit.distanceM || 0) }, common);
  }

  async function snapPointIntoRawGraph(raw, point, label, maxM = Infinity, options = {}) {
    const P = asLatLng(point);
    if (!P) return null;
    const hit = await nearestRawEdgeResponsive(raw, P, maxM, options);
    if (hit) return splitRawEdgeAtPoint(raw, hit, label, Object.assign({}, options, { inputPoint: P }));
    const node = await nearestNodeResponsive(raw, P, maxM, options);
    return node ? Object.assign({}, node, { snapType: 'node-fallback', sourceHighway: null }) : null;
  }


  // dev26 nationwide backend -------------------------------------------------
  // HGR1 tiles already preserve Overture connector topology.  The browser
  // loader merges only the tiles near A/B, then this adapter converts that
  // detached tile graph into the same fine-graph shape used by the existing
  // routing/search engine.  No generic proximity joins are created here.
  function externalGraphToFineGraph(externalGraph, options = {}) {
    if (!externalGraph?.nodes || !externalGraph?.edges) return null;
    const skipRefinement = options.skipRefinement === true;
    const generalMax = skipRefinement ? Infinity : Math.max(30, Number(options.maxFineEdgeM || config.maxFineEdgeM || 85));
    const pathMax = skipRefinement ? Infinity : Math.max(25, Number(options.pathMaxFineEdgeM || config.pathMaxFineEdgeM || 55));
    const nodes = new Map();
    const adjacency = new Map();
    const edges = new Map();
    let virtualCounter = 0;
    let edgeCounter = 0;

    function addNode(id, point, meta = {}) {
      const key = String(id);
      if (!nodes.has(key)) nodes.set(key, Object.assign({ id: key, lat: Number(point.lat), lng: Number(point.lng) }, meta));
      if (!adjacency.has(key)) adjacency.set(key, []);
      return key;
    }
    for (const [id, n] of externalGraph.nodes) {
      if (!Number.isFinite(Number(n?.lat)) || !Number.isFinite(Number(n?.lng))) continue;
      addNode(id, n, { sourceNodeId: String(id), nationwideSource: true });
    }

    const seenUndirected = new Set();
    function addFineEdge(aId, bId, geometry, source) {
      if (!nodes.has(String(aId)) || !nodes.has(String(bId))) return;
      const g = (geometry || []).map(asLatLng).filter(Boolean);
      const distanceM = routeDistanceM(g);
      if (!(distanceM > 0.2)) return;
      const id = `ng${++edgeCounter}`;
      const edge = {
        id,
        a: String(aId), b: String(bId), geometry: g.map((q) => ({ lat: q.lat, lng: q.lng })), distanceM,
        wayIds: source?.sourceId ? [String(source.sourceId)] : [],
        tagsSummary: { highway: String(source?.roadClass || 'unknown') },
        sourceEdgeId: source?.id || null,
        sourceDistanceM: Number(source?.distanceM || distanceM),
        nationwideSource: true
      };
      edges.set(id, edge);
      adjacency.get(String(aId)).push({ edgeId: id, to: String(bId) });
      adjacency.get(String(bId)).push({ edgeId: id, to: String(aId) });
    }

    for (const e of externalGraph.edges.values()) {
      if (!e || e.pedestrianAllowed === false || !e.from || !e.to) continue;
      const aId = String(e.from), bId = String(e.to);
      if (!nodes.has(aId) || !nodes.has(bId)) continue;
      const endpoints = [aId, bId].sort();
      const stable = `${e.sourceId || ''}|${endpoints[0]}|${endpoints[1]}|${Math.round(Number(e.distanceM || 0) * 10)}`;
      if (seenUndirected.has(stable)) continue;
      seenUndirected.add(stable);
      let geometry = (e.geometry || []).map(asLatLng).filter(Boolean);
      if (geometry.length < 2) geometry = [nodes.get(aId), nodes.get(bId)].map(asLatLng).filter(Boolean);
      if (geometry.length < 2) continue;
      // HGR1 geometry is stored in edge direction; orient it to aId -> bId.
      const start = geometry[0], a = nodes.get(aId);
      const end = geometry[geometry.length - 1];
      if (haversineM(start, a) > haversineM(end, a)) geometry = geometry.slice().reverse();
      const family = highwayFamily(String(e.roadClass || 'unknown'));
      const chunks = skipRefinement ? [geometry] : splitGeometryByMaxLength(geometry, family === 'path' ? pathMax : generalMax);
      if (!chunks.length) continue;
      let fromId = aId;
      for (let ci = 0; ci < chunks.length; ci += 1) {
        const chunk = chunks[ci];
        const last = ci === chunks.length - 1;
        const endPoint = chunk[chunk.length - 1];
        const toId = last ? bId : `nv:${e.sourceId || edgeCounter}:${++virtualCounter}`;
        if (!last) addNode(toId, endPoint, { virtual: true, nationwideSource: true, sourceEdgeId: e.id || null });
        addFineEdge(fromId, toId, chunk, e);
        fromId = toId;
      }
    }
    return {
      nodes, adjacency, edges,
      rawNodeCount: Number(externalGraph.nodes.size || 0),
      rawSegmentCount: Number(seenUndirected.size || 0),
      contractedNodeCount: Number(externalGraph.nodes.size || 0),
      contractedEdgeCount: Number(seenUndirected.size || 0),
      refinement: { generalMaxEdgeM: generalMax, pathMaxEdgeM: pathMax, skipped: skipRefinement },
      nationwideTileGraph: true,
      productionGraphMutated: false
    };
  }

  function detourEligibleEdgeIds(graph, fromA, toB, speedMps, detourLimitS, options = {}) {
    const enabled = options.externalGraphDetourPrune ?? config.externalGraphDetourPrune;
    if (enabled === false) return new Set(graph?.edges?.keys?.() || []);
    const slackS = Math.max(0, Number(options.externalGraphPruneSlackSec ?? config.externalGraphPruneSlackSec ?? 3));
    const limit = Number(detourLimitS) + slackS;
    const out = new Set();
    const distA = fromA?.dist || new Map(), distB = toB?.dist || new Map();
    for (const [id, edge] of graph?.edges || []) {
      const a = String(edge.a), b = String(edge.b);
      const edgeS = Number(edge.distanceM || 0) / Math.max(0.1, Number(speedMps) || 1.25);
      const ab = Number(distA.get(a)) + edgeS + Number(distB.get(b));
      const ba = Number(distA.get(b)) + edgeS + Number(distB.get(a));
      if ((Number.isFinite(ab) && ab <= limit + 1e-9) || (Number.isFinite(ba) && ba <= limit + 1e-9)) out.add(String(id));
    }
    return out;
  }

  function refineExistingExternalGraph(graph, keepEdgeIds, options = {}) {
    if (!graph?.nodes || !graph?.edges || !graph?.adjacency) return null;
    const generalMax = Math.max(30, Number(options.maxFineEdgeM || config.maxFineEdgeM || 85));
    const pathMax = Math.max(25, Number(options.pathMaxFineEdgeM || config.pathMaxFineEdgeM || 55));
    const keep = keepEdgeIds instanceof Set ? keepEdgeIds : new Set(graph.edges.keys());
    const nodes = new Map(), adjacency = new Map(), edges = new Map();
    let virtualCounter = 0, edgeCounter = 0;
    function addNode(id, point, meta = {}) {
      const key = String(id);
      if (!nodes.has(key)) nodes.set(key, Object.assign({}, point, { id: key, lat: Number(point.lat), lng: Number(point.lng) }, meta));
      if (!adjacency.has(key)) adjacency.set(key, []);
      return key;
    }
    function addEdge(aId, bId, geometry, source) {
      if (!nodes.has(String(aId)) || !nodes.has(String(bId))) return;
      const g = (geometry || []).map(asLatLng).filter(Boolean);
      const distanceM = routeDistanceM(g);
      if (!(distanceM > 0.2)) return;
      const id = `np${++edgeCounter}`;
      const edge = Object.assign({}, source, {
        id, a: String(aId), b: String(bId), geometry: g.map((q) => ({ lat:q.lat, lng:q.lng })), distanceM,
        wayIds: (source?.wayIds || []).slice(), tagsSummary: source?.tagsSummary ? JSON.parse(JSON.stringify(source.tagsSummary)) : {},
        sourceEdgeId: source?.sourceEdgeId || source?.id || null, sourceDistanceM: Number(source?.sourceDistanceM || source?.distanceM || distanceM),
        nationwideSource: source?.nationwideSource === true
      });
      edges.set(id, edge);
      adjacency.get(String(aId)).push({ edgeId:id, to:String(bId) });
      adjacency.get(String(bId)).push({ edgeId:id, to:String(aId) });
    }
    for (const [edgeId, edge] of graph.edges) {
      if (!keep.has(String(edgeId))) continue;
      const aNode = graph.nodes.get(String(edge.a)), bNode = graph.nodes.get(String(edge.b));
      if (!aNode || !bNode) continue;
      addNode(edge.a, aNode);
      addNode(edge.b, bNode);
      const family = highwayFamily(primaryHighway(edge));
      const chunks = splitGeometryByMaxLength(edge.geometry, family === 'path' ? pathMax : generalMax);
      if (!chunks.length) continue;
      let fromId = String(edge.a);
      for (let ci=0; ci<chunks.length; ci += 1) {
        const chunk = chunks[ci], last = ci === chunks.length - 1;
        const toId = last ? String(edge.b) : `npv:${edge.sourceEdgeId || edge.id}:${++virtualCounter}`;
        if (!last) addNode(toId, chunk[chunk.length-1], { virtual:true, nationwideSource:true, sourceEdgeId:edge.sourceEdgeId || edge.id });
        addEdge(fromId, toId, chunk, edge);
        fromId = toId;
      }
    }
    return {
      nodes, adjacency, edges,
      rawNodeCount: Number(graph.rawNodeCount || graph.nodes.size || 0), rawSegmentCount: Number(graph.rawSegmentCount || graph.edges.size || 0),
      contractedNodeCount: Number(graph.nodes.size || 0), contractedEdgeCount: Number(keep.size || 0),
      refinement: { generalMaxEdgeM:generalMax, pathMaxEdgeM:pathMax, prunedBeforeRefine:true },
      nationwideTileGraph: graph.nationwideTileGraph === true, productionGraphMutated:false
    };
  }

  function removeFineEdge(graph, edgeId) {
    const edge = graph?.edges?.get(String(edgeId));
    if (!edge) return;
    graph.edges.delete(String(edgeId));
    for (const id of [String(edge.a), String(edge.b)]) {
      const refs = graph.adjacency.get(id) || [];
      graph.adjacency.set(id, refs.filter((r) => String(r.edgeId) !== String(edgeId)));
    }
  }

  function splitGeometryAtHit(geometry, hit) {
    const g = (geometry || []).map(asLatLng).filter(Boolean);
    if (g.length < 2 || !hit?.point) return null;
    const i = Math.max(0, Math.min(g.length - 2, Number(hit.segmentIndex || 0)));
    const p = asLatLng(hit.point);
    const before = g.slice(0, i + 1);
    const after = g.slice(i + 1);
    if (!before.length || haversineM(before[before.length - 1], p) > 0.05) before.push(p);
    if (!after.length || haversineM(p, after[0]) > 0.05) after.unshift(p);
    return { before, after, point: p };
  }

  function snapPointIntoFineGraph(graph, point, label, maxM = Infinity) {
    const P = asLatLng(point);
    if (!P) return null;
    const hit = nearestGraphEdge(graph, P);
    if (!hit || hit.distanceM > maxM) return null;
    const edge = hit.edge;
    const split = splitGeometryAtHit(edge.geometry, hit);
    if (!split) return null;
    const endpointToleranceM = Math.max(0.5, Number(config.snapEndpointToleranceM || 1.5));
    const aNode = graph.nodes.get(String(edge.a)), bNode = graph.nodes.get(String(edge.b));
    if (aNode && haversineM(split.point, aNode) <= endpointToleranceM) {
      return { id: String(edge.a), node: aNode, distanceM: haversineM(P, aNode), snapType: 'nationwide-edge-endpoint', sourceWayId: edge.wayIds?.[0] || null, sourceHighway: primaryHighway(edge) };
    }
    if (bNode && haversineM(split.point, bNode) <= endpointToleranceM) {
      return { id: String(edge.b), node: bNode, distanceM: haversineM(P, bNode), snapType: 'nationwide-edge-endpoint', sourceWayId: edge.wayIds?.[0] || null, sourceHighway: primaryHighway(edge) };
    }
    let id = `nationwide-snap:${String(label || 'P')}`;
    let serial = 1;
    while (graph.nodes.has(id)) id = `nationwide-snap:${String(label || 'P')}:${++serial}`;
    graph.nodes.set(id, { id, lat: split.point.lat, lng: split.point.lng, virtualSnap: true, nationwideSource: true });
    graph.adjacency.set(id, []);
    removeFineEdge(graph, edge.id);
    let edgeSerial = 0;
    function addPiece(aId, bId, geometry) {
      const d = routeDistanceM(geometry);
      if (!(d > 0.05)) return;
      const eid = `${edge.id}:snap:${String(label || 'P')}:${++edgeSerial}`;
      const e = Object.assign({}, edge, { id: eid, a: String(aId), b: String(bId), geometry: geometry.map((q) => ({ lat: q.lat, lng: q.lng })), distanceM: d });
      graph.edges.set(eid, e);
      graph.adjacency.get(String(aId)).push({ edgeId: eid, to: String(bId) });
      graph.adjacency.get(String(bId)).push({ edgeId: eid, to: String(aId) });
    }
    addPiece(edge.a, id, split.before);
    addPiece(id, edge.b, split.after);
    return { id, node: graph.nodes.get(id), distanceM: Number(hit.distanceM || 0), snapType: 'nationwide-edge', sourceWayId: edge.wayIds?.[0] || null, sourceHighway: primaryHighway(edge) };
  }

  function subsetExistingFineGraph(graph, keepEdgeIds) {
    if (!graph?.nodes || !graph?.edges || !graph?.adjacency) return null;
    const keep = keepEdgeIds instanceof Set ? keepEdgeIds : new Set(graph.edges.keys());
    const nodes = new Map(), edges = new Map(), adjacency = new Map();
    const ensureNode = (id) => {
      const k=String(id), n=graph.nodes.get(k); if(!n) return false;
      if(!nodes.has(k)) nodes.set(k,Object.assign({},n));
      if(!adjacency.has(k)) adjacency.set(k,[]);
      return true;
    };
    for(const [id,e] of graph.edges){
      if(!keep.has(String(id))) continue;
      const a=String(e.a),b=String(e.b); if(!ensureNode(a)||!ensureNode(b)) continue;
      const copy=Object.assign({},e,{id:String(id),geometry:(e.geometry||[]).map(q=>({lat:Number(q.lat),lng:Number(q.lng)})),wayIds:(e.wayIds||[]).slice(),tagsSummary:e.tagsSummary?JSON.parse(JSON.stringify(e.tagsSummary)):{}});
      edges.set(String(id),copy); adjacency.get(a).push({edgeId:String(id),to:b}); adjacency.get(b).push({edgeId:String(id),to:a});
    }
    return {nodes,edges,adjacency,nationwideTileGraph:graph.nationwideTileGraph===true,preRefinedFineGraph:true,hgr2:graph.hgr2===true,productionGraphMutated:false,refinement:{preRefined:true,prunedBeforeSearch:true}};
  }

  async function findRoutesOnHgr2FineGraph(a,b,externalGraph,options={}) {
    const totalStarted=nowMs(), A=asLatLng(a), B=asLatLng(b);
    if(!A||!B) throw new Error('A/B 座標不完整。');
    const speedMps=clamp(options.speedMps,0.5,2.5,1.25), detourPct=clamp(options.detourPct,0,80,30);
    const departure=options.departure instanceof Date?options.departure:new Date(options.departure||Date.now());
    if(Number.isNaN(departure.getTime())) throw new Error('出發時間不正確。');
    // dev32: temporal prewarm and the subsequent search must always share one
    // analysis-local cache, even when callers do not explicitly provide one.
    const sharedShadeCache = options.sharedShadeCache && typeof options.sharedShadeCache.has === 'function' ? options.sharedShadeCache : new Map();
    const perf={hgr2Direct:true}; let t=nowMs();
    const sourceFull=externalGraph; perf.graphReuseMs=nowMs()-t;
    if(!sourceFull?.edges?.size) return {available:false,reason:'empty-hgr2-graph',candidates:[]};
    const snapMaxM=Number(options.snapMaxM||config.snapMaxM||120);
    t=nowMs();
    const snapSelection=graphForConnectedEndpointSnap(sourceFull,A,B,snapMaxM,options);
    const endpointSnapPlan=snapSelection.plan || null;
    const full=snapSelection.graph || sourceFull;
    if(endpointSnapPlan && endpointSnapPlan.available===false){
      perf.snapMs=nowMs()-t;
      return {available:false,reason:`hgr2-${endpointSnapPlan.reason || 'no-connected-snap-component'}`,candidates:[],diagnostics:{graphBackend:'nationwide-hgr2',connectivitySnapPlan:endpointSnapPlan,performance:perf,productionGraphMutated:false}};
    }
    const snapA=snapPointIntoFineGraph(full,A,'A',snapMaxM), snapB=snapPointIntoFineGraph(full,B,'B',snapMaxM); perf.snapMs=nowMs()-t;
    if(!snapA||!snapB) return {available:false,reason:'hgr2-endpoint-snap-failed',candidates:[],diagnostics:{graphBackend:'nationwide-hgr2',connectivitySnapPlan:endpointSnapPlan,performance:perf,productionGraphMutated:false}};
    options.onProgress?.({stage:'fastest-hgr2',message:'dev33：HGR2 已預先細切；直接計算距離界線，不重建 source graph…'});
    t=nowMs(); const fromA=await dijkstraTimesResponsive(full,snapA.id,speedMps,false,options); const toB=await dijkstraTimesResponsive(full,snapB.id,speedMps,true,options); perf.distanceBoundsMs=nowMs()-t;
    perf.distanceBoundsScheduling={fromA:fromA.scheduling||null,toB:toB.scheduling||null,totalYieldCount:Number(fromA.scheduling?.yieldCount||0)+Number(toB.scheduling?.yieldCount||0),totalYieldWaitMs:Number(fromA.scheduling?.yieldWaitMs||0)+Number(toB.scheduling?.yieldWaitMs||0)};
    const fastestTime=fromA.dist.get(String(snapB.id));
    if(!Number.isFinite(fastestTime)) return {available:false,reason:'hgr2-graph-disconnected',candidates:[],diagnostics:{graphBackend:'nationwide-hgr2',snapA,snapB,connectivitySnapPlan:endpointSnapPlan,performance:perf,productionGraphMutated:false}};
    const fastestPath=reconstructDijkstra(full,fromA.prev,snapA.id,snapB.id);
    if(!fastestPath?.points?.length) return {available:false,reason:'hgr2-fastest-reconstruction-failed',candidates:[]};
    fastestPath.walkSeconds=fastestTime; const detourLimitS=fastestTime*(1+detourPct/100);
    t=nowMs(); const keptEdgeIds=detourEligibleEdgeIds(full,fromA,toB,speedMps,detourLimitS,options); perf.pruneMs=nowMs()-t;
    if(!keptEdgeIds.size) return {available:false,reason:'hgr2-prune-empty',candidates:[],diagnostics:{graphBackend:'nationwide-hgr2',performance:perf}};
    t=nowMs(); const graph=subsetExistingFineGraph(full,keptEdgeIds); perf.subsetMs=nowMs()-t;
    if(!graph?.nodes?.has(String(snapA.id))||!graph?.nodes?.has(String(snapB.id))) return {available:false,reason:'hgr2-prune-lost-endpoint',candidates:[],diagnostics:{graphBackend:'nationwide-hgr2',performance:perf}};
    const prodSnapA=Object.assign({},snapA,{node:graph.nodes.get(String(snapA.id))}), prodSnapB=Object.assign({},snapB,{node:graph.nodes.get(String(snapB.id))});
    lastShadeDebug.clear(); lastRouteEdges={fastest:new Set(),minSun:new Set()};
    lastGraphDebug={graph,raw:null,contracted:null,snapA:prodSnapA,snapB:prodSnapB,bbox:options.bbox||null,endpoint:'nationwide-hgr2',builtAt:Date.now(),nationwide:true,experimentalBaseGraph:full,experimentalSnapA:snapA,experimentalSnapB:snapB};
    options.onProgress?.({stage:'shade-search',message:`dev33：HGR2 micrograph 已裁到 ${keptEdgeIds.size}/${full.edges.size} fine edges；先建立 temporal shade table…`});
    t=nowMs();
    const temporalShade=await buildTemporalShadeTable(graph,fromA,toB,{speedMps,detourLimitS,departure,edgeSunProvider:options.edgeSunProvider,shadeTimeBucketSec:options.shadeTimeBucketSec,shadeSampleSpacingM:options.shadeSampleSpacingM,shadeMaxSamplesPerEdge:options.shadeMaxSamplesPerEdge,shadeConcurrency:options.shadeConcurrency,sharedShadeCache,temporalShadeTableEnabled:options.temporalShadeTableEnabled,temporalShadeTableConcurrency:options.temporalShadeTableConcurrency,temporalShadeTableMaxBucketsPerEdge:options.temporalShadeTableMaxBucketsPerEdge,temporalShadeTableMaxEvaluations:options.temporalShadeTableMaxEvaluations,canopyTimeoutMs:options.canopyTimeoutMs,onProgress:options.onProgress,shouldCancel:options.shouldCancel});
    perf.temporalShadeTableMs=nowMs()-t; perf.temporalShade=temporalShade;
    options.onProgress?.({stage:'shade-search',message:`dev33：temporal shade table ${temporalShade.evaluated||0} cells 完成；history-safe min-sun 改為查表搜尋…`});
    t=nowMs();
    const minSun=await searchMinSun(graph,prodSnapA.id,prodSnapB.id,{speedMps,detourLimitS,fastestToEnd:toB,departure,edgeSunProvider:options.edgeSunProvider,timeBucketSec:options.timeBucketSec,shadeTimeBucketSec:options.shadeTimeBucketSec,shadeSampleSpacingM:options.shadeSampleSpacingM,shadeMaxSamplesPerEdge:options.shadeMaxSamplesPerEdge,shadeConcurrency:options.shadeConcurrency,shadeEdgeBatchConcurrency:options.shadeEdgeBatchConcurrency,sharedShadeCache,canopyTimeoutMs:options.canopyTimeoutMs,maxExpandedStates:options.maxExpandedStates,maxShadeEdgeEvaluations:options.maxShadeEdgeEvaluations,cooperativeYieldMs:options.cooperativeYieldMs,yieldEveryExpanded:options.yieldEveryExpanded,onProgress:options.onProgress,shouldCancel:options.shouldCancel});
    perf.minSunMs=nowMs()-t; perf.totalMs=nowMs()-totalStarted;
    lastRouteEdges.fastest=new Set(fastestPath.edgeIds||[]); lastRouteEdges.minSun=new Set(minSun.path?.edgeIds||[]);
    const candidateLifecycle=[];
    const fastestCandidate=makeGraphCandidate('graph-fastest',Object.assign({},fastestPath,{walkSeconds:fastestTime}),{durationS:fastestTime,graphMeta:{edgeIds:fastestPath.edgeIds,snapA:prodSnapA,snapB:prodSnapB,backend:'nationwide-hgr2'}});
    candidateLifecycle.push({stage:'generated',candidateId:fastestCandidate.id,stableCandidateId:fastestCandidate.stableCandidateId,geometryHash:fastestCandidate.geometryHash,status:'kept'});
    const candidates=[fastestCandidate];
    if(minSun.path?.points?.length){
      const minCandidate=makeGraphCandidate('graph-shade',minSun.path,{graphEstimatedDirectSunSeconds:minSun.path.directSunSeconds,graphMeta:{edgeIds:minSun.path.edgeIds,snapA:prodSnapA,snapB:prodSnapB,backend:'nationwide-hgr2'}});
      const same=sameGraphPathGeometry(minSun.path,fastestPath);
      candidateLifecycle.push({stage:'generated',candidateId:minCandidate.id,stableCandidateId:minCandidate.stableCandidateId,geometryHash:minCandidate.geometryHash,status:same?'suppressed':'kept',reason:same?'exact-same-edge-sequence-as-fastest':null,legacyRouteSignatureCollision:!same&&routeSignature(minSun.path.points)===routeSignature(fastestPath.points)});
      if(!same) candidates.push(minCandidate);
    } else {
      candidateLifecycle.push({stage:'generated',candidateId:'graph-min-sun',stableCandidateId:null,geometryHash:null,status:'not-generated',reason:minSun?.reason || 'min-sun-search-returned-no-path'});
    }
    const pruningCertificate=pruningCorrectnessCertificate(full,keptEdgeIds,fromA,toB,speedMps,detourLimitS,options);
    let exactReplay=null;
    if(options.candidateCorrectnessExactReplayEnabled!==false && config.candidateCorrectnessExactReplayEnabled!==false && minSun.path?.edgeIds?.length){
      options.onProgress?.({stage:'candidate-correctness-replay',message:'dev32 correctness：正在 exact replay temporal winner，檢查時間 bucket 誤差…'});
      const replayStarted=nowMs();
      exactReplay=await exactReplayPathShade(graph,minSun.path,prodSnapA.id,Object.assign({},options,{speedMps,departure}));
      perf.exactReplayMs=nowMs()-replayStarted;
    }
    lastDiagnostics={version:VERSION,graphBackend:'nationwide-hgr2',overpassEndpoint:null,bbox:options.bbox||null,rawNodes:Number(externalGraph?.nodes?.size||0),rawSegments:Number(externalGraph?.edges?.size||0),coarseNodes:Number(externalGraph?.nodes?.size||0),coarseEdges:Number(externalGraph?.edges?.size||0),connectivitySnapPlan:endpointSnapPlan,prunedSourceEdges:keptEdgeIds.size,prunedEdgeRatio:full.edges.size?keptEdgeIds.size/full.edges.size:1,fineNodes:graph.nodes.size,fineEdges:graph.edges.size,maxFineEdgeM:null,pathMaxFineEdgeM:null,snapA:{distanceM:prodSnapA.distanceM,nodeId:prodSnapA.id,snapType:prodSnapA.snapType,highway:prodSnapA.sourceHighway||null,wayId:prodSnapA.sourceWayId||null},snapB:{distanceM:prodSnapB.distanceM,nodeId:prodSnapB.id,snapType:prodSnapB.snapType,highway:prodSnapB.sourceHighway||null,wayId:prodSnapB.sourceWayId||null},fastestSeconds:fastestTime,fastestDistanceM:fastestPath.distanceM,minSunEstimatedDirectSunSeconds:minSun.path?.directSunSeconds??null,minSunDistanceM:minSun.path?.distanceM??null,detourPct,detourLimitSeconds:detourLimitS,searchExpandedStates:minSun.expanded,shadeEdgeEvaluations:minSun.shadeEvals,shadeCacheHits:minSun.shadeCacheHits||0,shadeCacheSize:minSun.shadeCacheSize||0,temporalShadeTable:temporalShade,exactReplay,pruningCertificate,candidateLifecycle,dominanceRejected:minSun.dominanceRejected||0,dominanceRemoved:minSun.dominanceRemoved||0,candidateCount:candidates.length,searchMode:'resource-constrained-history-safe-labels',labelPruningMode:'equal-arrival + visited-subset dominance; no arbitrary label cap',responsiveScheduling:true,hgr2PreRefined:true,graphStats:graphStats(graph),performance:perf,productionGraphMutated:false};
    return {available:true,candidates,diagnostics:lastDiagnostics,backend:'nationwide-hgr2',productionGraphMutated:false};
  }

  async function findRoutesOnExternalGraph(a, b, externalGraph, options = {}) {
    if (config.enabled === false) return { available:false, reason:'disabled', candidates:[] };
    if (externalGraph?.preRefinedFineGraph === true || externalGraph?.hgr2 === true) return findRoutesOnHgr2FineGraph(a,b,externalGraph,options);
    const totalStarted = nowMs();
    const A = asLatLng(a), B = asLatLng(b);
    if (!A || !B) throw new Error('A/B 座標不完整。');
    if (!window.HaidianShade || typeof window.HaidianShade.analyzeShadeModelAt !== 'function') throw new Error('Nationwide graph routing 需要 HaidianShade.analyzeShadeModelAt。');
    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const detourPct = clamp(options.detourPct, 0, 80, 30);
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    if (Number.isNaN(departure.getTime())) throw new Error('出發時間不正確。');
    const perf = {};

    // dev29: first preserve HGR1 source topology without splitting every edge.
    // Snap + shortest-distance bounds are cheap on this coarse graph; only edges
    // that can occur in a route under the user's detour cap are fine-split later.
    let t = nowMs();
    let coarseGraph = externalGraphToFineGraph(externalGraph, Object.assign({}, options, { skipRefinement:true }));
    perf.coarseBuildMs = nowMs() - t;
    if (!coarseGraph || !coarseGraph.edges.size) return { available:false, reason:'empty-nationwide-graph', candidates:[] };
    const snapMaxM = Number(options.snapMaxM || config.snapMaxM || 120);
    t = nowMs();
    const snapSelection = graphForConnectedEndpointSnap(coarseGraph, A, B, snapMaxM, options);
    const endpointSnapPlan = snapSelection.plan || null;
    coarseGraph = snapSelection.graph || coarseGraph;
    if (endpointSnapPlan && endpointSnapPlan.available === false) {
      perf.snapMs = nowMs() - t;
      return { available:false, reason:`nationwide-${endpointSnapPlan.reason || 'no-connected-snap-component'}`, candidates:[], diagnostics:{graphBackend:'nationwide-hgr1', connectivitySnapPlan:endpointSnapPlan, performance:perf, productionGraphMutated:false} };
    }
    const coarseSnapA = snapPointIntoFineGraph(coarseGraph, A, 'A', snapMaxM);
    const coarseSnapB = snapPointIntoFineGraph(coarseGraph, B, 'B', snapMaxM);
    perf.snapMs = nowMs() - t;
    if (!coarseSnapA || !coarseSnapB) return { available:false, reason:'nationwide-endpoint-snap-failed', candidates:[], diagnostics:{graphBackend:'nationwide-hgr1', connectivitySnapPlan:endpointSnapPlan, performance:perf, productionGraphMutated:false} };

    options.onProgress?.({ stage:'fastest-coarse', message:'dev29：先在 HGR1 coarse graph 計算距離可達範圍…' });
    t = nowMs();
    const coarseFromA = await dijkstraTimesResponsive(coarseGraph, coarseSnapA.id, speedMps, false, options);
    const coarseToB = await dijkstraTimesResponsive(coarseGraph, coarseSnapB.id, speedMps, true, options);
    perf.coarseDijkstraMs = nowMs() - t;
    perf.coarseDijkstraScheduling = { fromA:coarseFromA.scheduling||null, toB:coarseToB.scheduling||null, totalYieldCount:Number(coarseFromA.scheduling?.yieldCount||0)+Number(coarseToB.scheduling?.yieldCount||0), totalYieldWaitMs:Number(coarseFromA.scheduling?.yieldWaitMs||0)+Number(coarseToB.scheduling?.yieldWaitMs||0) };
    const coarseFastestTime = coarseFromA.dist.get(String(coarseSnapB.id));
    if (!Number.isFinite(coarseFastestTime)) return { available:false, reason:'nationwide-graph-disconnected', candidates:[], diagnostics:{graphBackend:'nationwide-hgr1', snapA:coarseSnapA, snapB:coarseSnapB, connectivitySnapPlan:endpointSnapPlan, performance:perf, productionGraphMutated:false} };
    const coarseDetourLimitS = coarseFastestTime * (1 + detourPct / 100);

    t = nowMs();
    const keptEdgeIds = detourEligibleEdgeIds(coarseGraph, coarseFromA, coarseToB, speedMps, coarseDetourLimitS, options);
    perf.pruneMs = nowMs() - t;
    if (!keptEdgeIds.size) return { available:false, reason:'nationwide-prune-empty', candidates:[], diagnostics:{graphBackend:'nationwide-hgr1', connectivitySnapPlan:endpointSnapPlan, performance:perf, productionGraphMutated:false} };

    options.onProgress?.({ stage:'graph-refine', message:`dev29：距離上限先裁到 ${keptEdgeIds.size}/${coarseGraph.edges.size} source edges，再做細緻 graph…` });
    t = nowMs();
    const graph = refineExistingExternalGraph(coarseGraph, keptEdgeIds, options);
    perf.fineRefineMs = nowMs() - t;
    if (!graph?.nodes?.has(String(coarseSnapA.id)) || !graph?.nodes?.has(String(coarseSnapB.id))) {
      return { available:false, reason:'nationwide-prune-lost-endpoint', candidates:[], diagnostics:{graphBackend:'nationwide-hgr1', connectivitySnapPlan:endpointSnapPlan, performance:perf, productionGraphMutated:false} };
    }
    const snapA = Object.assign({}, coarseSnapA, { node:graph.nodes.get(String(coarseSnapA.id)) });
    const snapB = Object.assign({}, coarseSnapB, { node:graph.nodes.get(String(coarseSnapB.id)) });

    // Experimental fusion needs disconnected official-witness-side components that
    // production distance pruning may legitimately remove. Keep the same local
    // tile set, but use the unsplit coarse graph as the detached sandbox base.
    lastShadeDebug.clear();
    lastRouteEdges = { fastest:new Set(), minSun:new Set() };
    lastGraphDebug = {
      graph, raw:null, contracted:null, snapA, snapB, bbox:options.bbox || null,
      endpoint:'nationwide-hgr1', builtAt:Date.now(), nationwide:true,
      experimentalBaseGraph:coarseGraph, experimentalSnapA:coarseSnapA, experimentalSnapB:coarseSnapB
    };

    options.onProgress?.({ stage:'fastest', message:'正在 pruned fine graph 計算最快路線…' });
    t = nowMs();
    const fromA = await dijkstraTimesResponsive(graph, snapA.id, speedMps, false, options);
    const toB = await dijkstraTimesResponsive(graph, snapB.id, speedMps, true, options);
    perf.fineDijkstraMs = nowMs() - t;
    perf.fineDijkstraScheduling = { fromA:fromA.scheduling||null, toB:toB.scheduling||null, totalYieldCount:Number(fromA.scheduling?.yieldCount||0)+Number(toB.scheduling?.yieldCount||0), totalYieldWaitMs:Number(fromA.scheduling?.yieldWaitMs||0)+Number(toB.scheduling?.yieldWaitMs||0) };
    const fastestTime = fromA.dist.get(String(snapB.id));
    if (!Number.isFinite(fastestTime)) return { available:false, reason:'nationwide-fine-graph-disconnected', candidates:[], diagnostics:{graphBackend:'nationwide-hgr1', snapA, snapB, connectivitySnapPlan:endpointSnapPlan, performance:perf, productionGraphMutated:false} };
    const fastestPath = reconstructDijkstra(graph, fromA.prev, snapA.id, snapB.id);
    if (!fastestPath?.points?.length) return { available:false, reason:'nationwide-fastest-reconstruction-failed', candidates:[] };
    fastestPath.walkSeconds = fastestTime;
    const detourLimitS = fastestTime * (1 + detourPct / 100);

    options.onProgress?.({ stage:'shade-search', message:`dev33：在裁剪後 graph 搜尋最少直接日照路線（最多多走 ${Math.round(detourPct)}%）…` });
    t = nowMs();
    const minSun = await searchMinSun(graph, snapA.id, snapB.id, {
      speedMps, detourLimitS, fastestToEnd:toB, departure,
      edgeSunProvider:options.edgeSunProvider,
      timeBucketSec:options.timeBucketSec, shadeTimeBucketSec:options.shadeTimeBucketSec,
      shadeSampleSpacingM:options.shadeSampleSpacingM, shadeMaxSamplesPerEdge:options.shadeMaxSamplesPerEdge,
      shadeConcurrency:options.shadeConcurrency, shadeEdgeBatchConcurrency:options.shadeEdgeBatchConcurrency, sharedShadeCache:options.sharedShadeCache, canopyTimeoutMs:options.canopyTimeoutMs,
      maxExpandedStates:options.maxExpandedStates, maxShadeEdgeEvaluations:options.maxShadeEdgeEvaluations,
      cooperativeYieldMs:options.cooperativeYieldMs, yieldEveryExpanded:options.yieldEveryExpanded,
      onProgress:options.onProgress, shouldCancel:options.shouldCancel
    });
    perf.minSunMs = nowMs() - t;
    perf.totalMs = nowMs() - totalStarted;

    lastRouteEdges.fastest = new Set(fastestPath.edgeIds || []);
    lastRouteEdges.minSun = new Set(minSun.path?.edgeIds || []);
    const candidateLifecycle = [];
    const fastestCandidate = makeGraphCandidate('graph-fastest', Object.assign({}, fastestPath, { walkSeconds:fastestTime }), { durationS:fastestTime, graphMeta:{ edgeIds:fastestPath.edgeIds, snapA, snapB, backend:'nationwide-hgr1' } });
    candidateLifecycle.push({stage:'generated',candidateId:fastestCandidate.id,stableCandidateId:fastestCandidate.stableCandidateId,geometryHash:fastestCandidate.geometryHash,status:'kept'});
    const candidates = [fastestCandidate];
    if (minSun.path?.points?.length) {
      const minCandidate = makeGraphCandidate('graph-shade', minSun.path, { graphEstimatedDirectSunSeconds:minSun.path.directSunSeconds, graphMeta:{ edgeIds:minSun.path.edgeIds, snapA, snapB, backend:'nationwide-hgr1' } });
      const same = sameGraphPathGeometry(minSun.path, fastestPath);
      candidateLifecycle.push({stage:'generated',candidateId:minCandidate.id,stableCandidateId:minCandidate.stableCandidateId,geometryHash:minCandidate.geometryHash,status:same?'suppressed':'kept',reason:same?'exact-same-edge-sequence-as-fastest':null,legacyRouteSignatureCollision:!same&&routeSignature(minSun.path.points)===routeSignature(fastestPath.points)});
      if (!same) candidates.push(minCandidate);
    } else {
      candidateLifecycle.push({stage:'generated',candidateId:'graph-min-sun',stableCandidateId:null,geometryHash:null,status:'not-generated',reason:minSun?.reason || 'min-sun-search-returned-no-path'});
    }
    lastDiagnostics = {
      version:VERSION, graphBackend:'nationwide-hgr1', overpassEndpoint:null, bbox:options.bbox || null,
      connectivitySnapPlan:endpointSnapPlan,
      rawNodes:Number(externalGraph?.nodes?.size || 0), rawSegments:Number(externalGraph?.edges?.size || 0),
      coarseNodes:coarseGraph.nodes.size, coarseEdges:coarseGraph.edges.size,
      prunedSourceEdges:keptEdgeIds.size, prunedEdgeRatio:coarseGraph.edges.size ? keptEdgeIds.size / coarseGraph.edges.size : 1,
      fineNodes:graph.nodes.size, fineEdges:graph.edges.size,
      maxFineEdgeM:graph.refinement?.generalMaxEdgeM || config.maxFineEdgeM,
      pathMaxFineEdgeM:graph.refinement?.pathMaxEdgeM || config.pathMaxFineEdgeM,
      snapA:{ distanceM:snapA.distanceM, nodeId:snapA.id, snapType:snapA.snapType, highway:snapA.sourceHighway || null, wayId:snapA.sourceWayId || null },
      snapB:{ distanceM:snapB.distanceM, nodeId:snapB.id, snapType:snapB.snapType, highway:snapB.sourceHighway || null, wayId:snapB.sourceWayId || null },
      fastestSeconds:fastestTime, fastestDistanceM:fastestPath.distanceM,
      minSunEstimatedDirectSunSeconds:minSun.path?.directSunSeconds ?? null, minSunDistanceM:minSun.path?.distanceM ?? null,
      detourPct, detourLimitSeconds:detourLimitS,
      searchExpandedStates:minSun.expanded, shadeEdgeEvaluations:minSun.shadeEvals, shadeCacheHits:minSun.shadeCacheHits||0, shadeCacheSize:minSun.shadeCacheSize||0,
      dominanceRejected:minSun.dominanceRejected || 0, dominanceRemoved:minSun.dominanceRemoved || 0,
      pruningCertificate:pruningCorrectnessCertificate(coarseGraph,keptEdgeIds,coarseFromA,coarseToB,speedMps,coarseDetourLimitS,options), candidateLifecycle,
      candidateCount:candidates.length, searchMode:'resource-constrained-history-safe-labels',
      labelPruningMode:'equal-arrival + visited-subset dominance; no arbitrary label cap', responsiveScheduling:true,
      graphStats:graphStats(graph), performance:perf, productionGraphMutated:false
    };
    return { available:true, candidates, diagnostics:lastDiagnostics, backend:'nationwide-hgr1', productionGraphMutated:false };
  }

  async function buildGraphForAB(a, b, options = {}) {
    const cooperativeYield = makeCooperativeYielder(options);
    const bbox = bboxForAB(a, b, options.bboxMarginM || config.bboxMarginM);
    const key = bboxKey(bbox);
    let cached = graphCache.get(key);
    if (!cached) {
      const { payload, endpoint } = await fetchOverpass(bbox, options);
      if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      options.onProgress?.({ stage: "graph-parse", message: "正在整理 OSM 步行資料…" });
      await cooperativeYield(true);
      const parsed = parseOverpass(payload);
      if (parsed.nodes.size > Number(config.maxRawNodes || 18000)) throw new Error(`OSM 範圍含 ${parsed.nodes.size} 個節點，超過瀏覽器安全上限。`);
      await cooperativeYield(true);
      const raw = buildRawGraph(parsed);
      await cooperativeYield(true);
      cached = { bbox, parsed, raw, endpoint, cachedAt: Date.now() };
      graphCache.set(key, cached);
      if (graphCache.size > 4) graphCache.delete(graphCache.keys().next().value);
    }

    options.onProgress?.({ stage: "graph-snap", message: "正在把 A、B 投影到附近最適合行人的可步行 edge…" });
    // v9.0.0-dev6: snap terminals to the nearest walkable EDGE and split that
    // edge with a virtual terminal.  The old nearest-node snap could put A on
    // a parallel road even when a riverbank cycleway passed only a few metres
    // away, simply because the cycleway's next OSM node was farther away.
    const workingRaw = cloneRawGraph(cached.raw);
    const snapA = await snapPointIntoRawGraph(workingRaw, a, 'A', Number(options.snapMaxM || config.snapMaxM), options);
    const snapB = await snapPointIntoRawGraph(workingRaw, b, 'B', Number(options.snapMaxM || config.snapMaxM), options);
    if (!snapA) throw new Error(`A 點附近 ${config.snapMaxM} m 內找不到 OSM 可步行 edge。`);
    if (!snapB) throw new Error(`B 點附近 ${config.snapMaxM} m 內找不到 OSM 可步行 edge。`);

    options.onProgress?.({ stage: "graph", message: "正在建立本地 pedestrian graph…" });
    await cooperativeYield(true);
    const contracted = contractGraph(workingRaw, [snapA.id, snapB.id]);
    await cooperativeYield(true);
    if (contracted.nodes.size > Number(config.maxContractedNodes || 5000)) throw new Error(`步行 graph 有 ${contracted.nodes.size} 個交會節點，超過目前安全上限。`);

    options.onProgress?.({ stage: "graph-refine", message: "正在把過長道路 edge 切細，保留河堤/步道的局部日照差異…" });
    const graph = refineGraph(contracted, {
      maxFineEdgeM: options.maxFineEdgeM || config.maxFineEdgeM,
      pathMaxFineEdgeM: options.pathMaxFineEdgeM || config.pathMaxFineEdgeM
    });
    await cooperativeYield(true);
    if (graph.nodes.size > Number(config.maxFineNodes || 12000)) throw new Error(`細緻步行 graph 有 ${graph.nodes.size} 個節點，超過目前安全上限。`);
    lastGraphDebug = { graph, raw: workingRaw, contracted, snapA, snapB, bbox: cached.bbox, endpoint: cached.endpoint, builtAt: Date.now() };
    return { graph, snapA, snapB, bbox: cached.bbox, endpoint: cached.endpoint };
  }

  async function findRoutes(a, b, options = {}) {
    if (config.enabled === false) return { available: false, reason: "disabled", candidates: [] };
    const A = asLatLng(a), B = asLatLng(b);
    if (!A || !B) throw new Error("A/B 座標不完整。 ");
    if (!window.HaidianShade || typeof window.HaidianShade.analyzeShadeModelAt !== "function") {
      throw new Error("OSM Graph routing 需要 HaidianShade.analyzeShadeModelAt。 ");
    }

    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const detourPct = clamp(options.detourPct, 0, 80, 30);
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    if (Number.isNaN(departure.getTime())) throw new Error("出發時間不正確。 ");
    lastShadeDebug.clear();
    lastRouteEdges = { fastest: new Set(), minSun: new Set() };

    const built = await buildGraphForAB(A, B, {
      bboxMarginM: options.bboxMarginM,
      snapMaxM: options.snapMaxM,
      endpoints: options.overpassEndpoints,
      timeoutMs: options.overpassTimeoutMs,
      onProgress: options.onProgress,
      shouldCancel: options.shouldCancel
    });
    const { graph, snapA, snapB } = built;
    if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");

    options.onProgress?.({ stage: "fastest", message: "正在計算 graph 最快路線與可接受繞路範圍…" });
    const fromA = await dijkstraTimesResponsive(graph, snapA.id, speedMps, false, {
      onProgress: options.onProgress, shouldCancel: options.shouldCancel, cooperativeYieldMs: options.cooperativeYieldMs
    });
    const toB = await dijkstraTimesResponsive(graph, snapB.id, speedMps, true, {
      onProgress: options.onProgress, shouldCancel: options.shouldCancel, cooperativeYieldMs: options.cooperativeYieldMs
    });
    const fastestTime = fromA.dist.get(String(snapB.id));
    if (!Number.isFinite(fastestTime)) throw new Error("OSM pedestrian graph 中 A 與 B 目前沒有連通路徑。 ");
    const fastestPath = reconstructDijkstra(graph, fromA.prev, snapA.id, snapB.id);
    if (!fastestPath?.points?.length) throw new Error("無法重建 OSM graph 最快路線。 ");
    fastestPath.walkSeconds = fastestTime;

    const detourLimitS = fastestTime * (1 + detourPct / 100);
    options.onProgress?.({ stage: "shade-search", message: `正在 graph 內搜尋最少直接日照路線（最多多走 ${Math.round(detourPct)}%）…` });
    const minSun = await searchMinSun(graph, snapA.id, snapB.id, {
      speedMps,
      detourLimitS,
      fastestToEnd: toB,
      departure,
      edgeSunProvider: options.edgeSunProvider,
      timeBucketSec: options.timeBucketSec,
      shadeTimeBucketSec: options.shadeTimeBucketSec,
      shadeSampleSpacingM: options.shadeSampleSpacingM,
      shadeMaxSamplesPerEdge: options.shadeMaxSamplesPerEdge,
      shadeConcurrency: options.shadeConcurrency,
      canopyTimeoutMs: options.canopyTimeoutMs,
      maxExpandedStates: options.maxExpandedStates,
      maxShadeEdgeEvaluations: options.maxShadeEdgeEvaluations,
      cooperativeYieldMs: options.cooperativeYieldMs,
      yieldEveryExpanded: options.yieldEveryExpanded,
      onProgress: options.onProgress,
      shouldCancel: options.shouldCancel
    });

    lastRouteEdges.fastest = new Set(fastestPath.edgeIds || []);
    lastRouteEdges.minSun = new Set(minSun.path?.edgeIds || []);

    const candidates = [];
    const candidateLifecycle = [];
    const fastestCandidate = makeGraphCandidate('graph-fastest', Object.assign({}, fastestPath, { walkSeconds:fastestTime }), { durationS:fastestTime, graphMeta:{ edgeIds:fastestPath.edgeIds, snapA, snapB } });
    candidates.push(fastestCandidate);
    candidateLifecycle.push({stage:'generated',candidateId:fastestCandidate.id,stableCandidateId:fastestCandidate.stableCandidateId,geometryHash:fastestCandidate.geometryHash,status:'kept'});
    if (minSun.path?.points?.length) {
      const minCandidate = makeGraphCandidate('graph-shade', minSun.path, { graphEstimatedDirectSunSeconds:minSun.path.directSunSeconds, graphMeta:{ edgeIds:minSun.path.edgeIds, snapA, snapB } });
      const same = sameGraphPathGeometry(minSun.path, fastestPath);
      candidateLifecycle.push({stage:'generated',candidateId:minCandidate.id,stableCandidateId:minCandidate.stableCandidateId,geometryHash:minCandidate.geometryHash,status:same?'suppressed':'kept',reason:same?'exact-same-edge-sequence-as-fastest':null,legacyRouteSignatureCollision:!same&&routeSignature(minSun.path.points)===routeSignature(fastestPath.points)});
      if (!same) candidates.push(minCandidate);
    } else {
      candidateLifecycle.push({stage:'generated',candidateId:'graph-min-sun',stableCandidateId:null,geometryHash:null,status:'not-generated',reason:minSun?.reason || 'min-sun-search-returned-no-path'});
    }

    lastDiagnostics = {
      version: VERSION,
      overpassEndpoint: built.endpoint,
      bbox: built.bbox,
      rawNodes: graph.rawNodeCount,
      rawSegments: graph.rawSegmentCount,
      contractedNodes: graph.contractedNodeCount || graph.nodes.size,
      contractedEdges: graph.contractedEdgeCount || graph.edges.size,
      fineNodes: graph.nodes.size,
      fineEdges: graph.edges.size,
      maxFineEdgeM: graph.refinement?.generalMaxEdgeM || config.maxFineEdgeM,
      pathMaxFineEdgeM: graph.refinement?.pathMaxEdgeM || config.pathMaxFineEdgeM,
      snapA: { distanceM: snapA.distanceM, nodeId: snapA.id, snapType: snapA.snapType || "node", highway: snapA.sourceHighway || null, wayId: snapA.sourceWayId || null, pedestrianRank: snapA.pedestrianRank ?? null, pedestrianLabel: snapA.pedestrianLabel || null, geometricNearestDistanceM: snapA.geometricNearestDistanceM ?? snapA.distanceM, extraSnapDistanceM: snapA.extraSnapDistanceM || 0 },
      snapB: { distanceM: snapB.distanceM, nodeId: snapB.id, snapType: snapB.snapType || "node", highway: snapB.sourceHighway || null, wayId: snapB.sourceWayId || null, pedestrianRank: snapB.pedestrianRank ?? null, pedestrianLabel: snapB.pedestrianLabel || null, geometricNearestDistanceM: snapB.geometricNearestDistanceM ?? snapB.distanceM, extraSnapDistanceM: snapB.extraSnapDistanceM || 0 },
      fastestSeconds: fastestTime,
      fastestDistanceM: fastestPath.distanceM,
      minSunEstimatedDirectSunSeconds: minSun.path?.directSunSeconds ?? null,
      minSunDistanceM: minSun.path?.distanceM ?? null,
      detourPct,
      detourLimitSeconds: detourLimitS,
      searchExpandedStates: minSun.expanded,
      shadeEdgeEvaluations: minSun.shadeEvals,
      dominanceRejected: minSun.dominanceRejected || 0,
      dominanceRemoved: minSun.dominanceRemoved || 0,
      candidateLifecycle,
      candidateCount: candidates.length,
      searchMode: "resource-constrained-history-safe-labels",
      labelPruningMode: "equal-arrival + visited-subset dominance; no arbitrary label cap",
      responsiveScheduling: true,
      graphStats: graphStats(graph)
    };
    return { available: true, candidates, diagnostics: lastDiagnostics };
  }

  async function runCandidateCorrectnessAudit(a, b, externalGraph = null, options = {}) {
    if (config.candidateCorrectnessAuditEnabled === false || options.candidateCorrectnessAuditEnabled === false) {
      return { available:false, reason:'disabled' };
    }
    const source = externalGraph || lastGraphDebug?.experimentalBaseGraph || lastGraphDebug?.graph || null;
    if (!source?.edges?.size) return { available:false, reason:'no-external-graph' };

    // The audit is intentionally detached. Besides cloning the graph, preserve
    // the normal-run debug globals so pressing the developer audit button cannot
    // silently replace the production route/debug snapshot with an audit clone.
    const savedDiagnostics = lastDiagnostics;
    const savedGraphDebug = lastGraphDebug;
    const savedRouteEdges = { fastest:new Set(lastRouteEdges.fastest || []), minSun:new Set(lastRouteEdges.minSun || []) };
    const savedShadeDebug = new Map(lastShadeDebug);
    try {
      const baseOptions = Object.assign({}, options, {
        candidateCorrectnessExactReplayEnabled:false,
        candidateCorrectnessAuditEnabled:false,
        sharedShadeCache:new Map()
      });
      const temporalGraph = cloneFineGraphForExperimentalUse(source);
      const exactGraph = cloneFineGraphForExperimentalUse(source);
      const temporal = await findRoutesOnExternalGraph(a,b,temporalGraph,Object.assign({},baseOptions,{temporalShadeTableEnabled:true,sharedShadeCache:new Map()}));
      const exact = await findRoutesOnExternalGraph(a,b,exactGraph,Object.assign({},baseOptions,{temporalShadeTableEnabled:false,sharedShadeCache:new Map()}));
      const summarize = (result) => (result?.candidates || []).map((c) => ({
        id:c.id,
        kind:c.kind,
        stableCandidateId:c.stableCandidateId || `${c.id}:${geometryHash(c.points)}`,
        geometryHash:c.geometryHash || geometryHash(c.points),
        distanceM:Number(c.distanceM || 0),
        estimatedDirectSunSeconds:Number.isFinite(Number(c.graphEstimatedDirectSunSeconds)) ? Number(c.graphEstimatedDirectSunSeconds) : null
      }));
      const temporalCandidates=summarize(temporal), onDemandCandidates=summarize(exact);
      const pickFastest = (items) => items.find((c)=>c.kind==='graph-fastest') || null;
      const pickMinSun = (items) => items.find((c)=>c.kind==='graph-shade') || pickFastest(items);
      const temporalFastest=pickFastest(temporalCandidates), onDemandFastest=pickFastest(onDemandCandidates);
      const temporalMin=pickMinSun(temporalCandidates), onDemandMin=pickMinSun(onDemandCandidates);
      const sameFastestGeometry=Boolean(temporalFastest&&onDemandFastest&&temporalFastest.geometryHash===onDemandFastest.geometryHash);
      const sameMinSunGeometry=Boolean(temporalMin&&onDemandMin&&temporalMin.geometryHash===onDemandMin.geometryHash);
      const distanceDelta = (x,y) => x&&y&&Number.isFinite(x.distanceM)&&Number.isFinite(y.distanceM) ? x.distanceM-y.distanceM : null;
      const sunDeltaSeconds=(temporalMin&&onDemandMin&&Number.isFinite(temporalMin.estimatedDirectSunSeconds)&&Number.isFinite(onDemandMin.estimatedDirectSunSeconds))
        ? temporalMin.estimatedDirectSunSeconds-onDemandMin.estimatedDirectSunSeconds : null;
      const onDemandSummary={candidateCount:onDemandCandidates.length,candidates:onDemandCandidates,diagnostics:exact?.diagnostics || null};
      return {
        available:true,
        version:VERSION,
        backend:temporal?.backend || exact?.backend || null,
        temporal:{candidateCount:temporalCandidates.length,candidates:temporalCandidates,diagnostics:temporal?.diagnostics || null},
        onDemand:onDemandSummary,
        // Backward-compatible alias for early dev32 diagnostics. This side is
        // on-demand bucket evaluation; only exactReplay is truly unbucketed.
        exact:onDemandSummary,
        comparison:{
          sameCandidateCount:temporalCandidates.length===onDemandCandidates.length,
          sameFastestGeometry,
          sameMinSunGeometry,
          sameWinnerGeometry:sameMinSunGeometry,
          fastestDistanceDeltaM:distanceDelta(temporalFastest,onDemandFastest),
          minSunDistanceDeltaM:distanceDelta(temporalMin,onDemandMin),
          sunDeltaSeconds
        },
        pruningValid:Boolean(temporal?.diagnostics?.pruningCertificate?.valid !== false && exact?.diagnostics?.pruningCertificate?.valid !== false),
        productionGraphMutated:false,
        productionDebugStateMutated:false
      };
    } finally {
      lastDiagnostics = savedDiagnostics;
      lastGraphDebug = savedGraphDebug;
      lastRouteEdges = savedRouteEdges;
      lastShadeDebug.clear();
      for (const [id, value] of savedShadeDebug) lastShadeDebug.set(id, value);
    }
  }

  function clearCache() {
    graphCache.clear();
    clearSessionShadeWarmCache();
    lastDiagnostics = null;
    lastGraphDebug = null;
    lastRouteEdges = { fastest: new Set(), minSun: new Set() };
    lastShadeDebug.clear();
  }

  window.HaidianPedestrianGraph = {
    version: VERSION,
    get config() { return Object.assign({}, config); },
    findRoutes,
    findRoutesOnExternalGraph,
    buildGraphForAB,
    createExperimentalGraphClone,
    runExperimentalSearchOnClone,
    runCandidateCorrectnessAudit,
    acquireSessionShadeWarmCache,
    commitSessionShadeWarmCache,
    getSessionShadeWarmCacheStats,
    clearSessionShadeWarmCache,
    getDebugSnapshot: debugSnapshot,
    diagnosePolyline,
    replayPolyline,
    runSourceGapCounterfactualAudit,
    runMatureEngineBenchmark,
    clearCache,
    get lastDiagnostics() { return lastDiagnostics; },
    _internals: {
      isPedestrianWay,
      parseOverpass,
      buildRawGraph,
      contractGraph,
      refineGraph,
      splitGeometryByMaxLength,
      nearestNode,
      nearestNodeResponsive,
      cloneRawGraph,
      nearestRawEdgeResponsive,
      splitRawEdgeAtPoint,
      snapPointIntoRawGraph,
      dijkstraTimes,
      dijkstraTimesResponsive,
      reconstructDijkstra,
      searchMinSun,
      buildTemporalShadeTable,
      temporalBucketsForEdge,
      shadeCacheKey,
      sessionShadeWarmCacheNamespace,
      acquireSessionShadeWarmCache,
      commitSessionShadeWarmCache,
      getSessionShadeWarmCacheStats,
      clearSessionShadeWarmCache,
      shadeResultSafeForWarmCache,
      bboxForAB,
      routeDistanceM,
      routeSignature,
      geometryHash,
      canonicalGeometryKey,
      sameGraphPathGeometry,
      makeGraphCandidate,
      pruningCorrectnessCertificate,
      exactReplayPathShade,
      pathFromEdgeSteps,
      edgeGeometryFor,
      nearestGraphEdge,
      fineGraphComponentIndex,
      connectedEndpointSnapPlan,
      graphForConnectedEndpointSnap,
      diagnosePolyline,
      replayPolyline,
      orderedMapMatchDijkstra,
      strictCorridorConnectivityAudit,
      corridorThresholdDeltaAudit,
      endpointSnapCounterfactualAudit,
      faithfulCorridorComponentTraceAudit,
      rawOsmJunctionAudit,
      cloneFineGraphWithDiagnosticConnectors,
      cloneFineGraphForExperimentalUse,
      graphStructuralFingerprint,
      runExperimentalSearchOnClone,
      runCandidateCorrectnessAudit,
      controlledSourceGapConnectorAudit,
      runSourceGapCounterfactualAudit,
      deferredSourceGapCounterfactual,
      sourceGapConnectorSafetyPolicy,
      engineBenchmarkManifest,
      runMatureEngineBenchmark,
      extractValhallaPoints,
      extractGraphHopperPoints,
      benchmarkPathAnalysis,
      reconcilePathShadeCost,
      denseShadeSegmentsForPath,
      pathDivergenceDiagnostics,
      getLastOrderedMapMatchFailure: () => lastOrderedMapMatchFailure,
      primaryHighway,
      highwayFamily,
      pedestrianSnapRank,
      pedestrianSnapLabel,
      graphStats,
      externalGraphToFineGraph,
      detourEligibleEdgeIds,
      refineExistingExternalGraph,
      subsetExistingFineGraph,
      findRoutesOnHgr2FineGraph,
      snapPointIntoFineGraph,
      MinHeap
    }
  };
})();
