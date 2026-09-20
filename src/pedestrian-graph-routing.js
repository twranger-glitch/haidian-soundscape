/*
 * Haidian Soundscape — Local OSM Pedestrian Graph Routing v9.0.0-dev3 Diagnostics
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

  const VERSION = "v9.0.0-dev3";

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
    maxRawNodes: 18000,
    maxContractedNodes: 5000,
    maxExpandedStates: 5000,
    maxShadeEdgeEvaluations: 700,
    timeBucketSec: 60,
    shadeTimeBucketSec: 120,
    shadeSampleSpacingM: 30,
    shadeMaxSamplesPerEdge: 8,
    diagnosticMatchThresholdM: 16,
    diagnosticSampleSpacingM: 18,
    shadeConcurrency: 3,
    canopyTimeoutMs: 4200,
    progressEvery: 20
  };

  const globalConfig = window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {};
  const config = Object.assign({}, DEFAULTS, globalConfig.graphRouting || {});

  let lastDiagnostics = null;
  let lastGraphDebug = null;
  let lastRouteEdges = { fastest: new Set(), minSun: new Set() };
  const lastShadeDebug = new Map();
  const graphCache = new Map();

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
    const keys = ["highway", "foot", "access", "name", "surface", "lit", "bridge", "tunnel", "layer", "incline", "steps"];
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
      wayMeta.set(String(way.id), { id: String(way.id), tags: Object.assign({}, way.tags || {}) });
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
    const degree = new Map();
    for (const [id, neighbors] of raw.adjacency) {
      // Count unique pedestrian neighbors. Directed foot-only ways may be degree 1 and should remain terminals.
      const unique = new Set(neighbors.keys());
      for (const [other, others] of raw.adjacency) if (others.has(id)) unique.add(other);
      degree.set(id, unique.size);
    }
    const terminals = new Set(forcedTerminals.map(String));
    for (const [id, d] of degree) if (d !== 2) terminals.add(id);

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

    // Pure cycles have no degree != 2 nodes. Seed one terminal per remaining component.
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
        for (const n of undirectedAdj.get(cur) || []) if (!seenComponent.has(n)) { seenComponent.add(n); stack.push(n); }
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
          const options = Array.from(undirectedAdj.get(cur) || []).filter((n) => n !== prev);
          if (!options.length) break;
          const next = options[0];
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
    let sun = 0, shade = 0, night = 0;
    for (const model of models) {
      if (model?.state === "night") night += 1;
      else if (model?.shaded === true) shade += 1;
      else sun += 1;
    }
    const total = models.length || 1;
    return { directSunFraction: sun / total, shadedFraction: shade / total, nightFraction: night / total, samples: total };
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

  async function searchMinSun(graph, startId, endId, options = {}) {
    const speedMps = clamp(options.speedMps, 0.5, 2.5, 1.25);
    const detourLimitS = Number(options.detourLimitS);
    const toEnd = options.fastestToEnd?.dist || options.fastestToEnd || new Map();
    const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || Date.now());
    const provider = options.edgeSunProvider || defaultEdgeSunProvider;
    const timeBucketSec = Math.max(20, Number(options.timeBucketSec || config.timeBucketSec));
    const shadeTimeBucketSec = Math.max(30, Number(options.shadeTimeBucketSec || config.shadeTimeBucketSec));
    const maxStates = Math.max(200, Number(options.maxExpandedStates || config.maxExpandedStates));
    const maxShadeEvals = Math.max(50, Number(options.maxShadeEdgeEvaluations || config.maxShadeEdgeEvaluations));
    const shadeCache = new Map();
    let shadeEvals = 0;
    let expanded = 0;

    const heap = new MinHeap((a, b) => (a.sunS - b.sunS) || (a.walkS - b.walkS));
    const startLabel = { node: String(startId), walkS: 0, sunS: 0, parent: null, viaEdgeId: null };
    heap.push(startLabel);
    const bestByState = new Map([[`${startLabel.node}|0`, 0]]);
    let bestGoal = null;

    async function sunForEdge(edge, fromId, walkS) {
      const atMs = departure.getTime() + (walkS + edge.distanceM / speedMps / 2) * 1000;
      const bucket = Math.floor(atMs / 1000 / shadeTimeBucketSec);
      const key = `${edge.id}|${fromId}|${bucket}`;
      if (shadeCache.has(key)) return shadeCache.get(key);
      if (shadeEvals >= maxShadeEvals) throw new Error(`OSM Graph 日照評估已達安全上限 ${maxShadeEvals} 條 edge；請縮短 A→B 距離或提高繞路限制的精準度。`);
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
        const debug = lastShadeDebug.get(edge.id) || { count: 0, samples: 0, directSunFractionSum: 0, shadedFractionSum: 0, lastAt: null };
        debug.count += 1;
        debug.samples += Number(result?.samples || 0);
        debug.directSunFractionSum += Number(result?.directSunFraction || 0);
        debug.shadedFractionSum += Number(result?.shadedFraction || 0);
        debug.lastAt = new Date(atMs).toISOString();
        debug.lastFromId = String(fromId);
        lastShadeDebug.set(edge.id, debug);
        return result;
      }
      catch (error) { shadeCache.delete(key); throw error; }
    }

    while (heap.size) {
      if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      const cur = heap.pop();
      expanded += 1;
      if (expanded > maxStates) throw new Error(`OSM Graph 搜尋已達 ${maxStates} 個狀態安全上限。`);
      if (expanded === 1 || expanded % Math.max(1, Number(config.progressEvery || 20)) === 0) {
        options.onProgress?.({ stage: "search", expanded, shadeEvals, message: `正在搜尋步行 graph：${expanded} 個狀態／${shadeEvals} 條日照 edge` });
      }

      if (bestGoal && (cur.sunS > bestGoal.sunS + 0.01 || (Math.abs(cur.sunS - bestGoal.sunS) < 0.01 && cur.walkS >= bestGoal.walkS))) {
        // Heap is lexicographic (sun, time); nothing after this can beat the goal.
        break;
      }
      if (cur.node === String(endId)) {
        bestGoal = cur;
        continue;
      }

      const outgoing = graph.adjacency.get(cur.node) || [];
      for (const ref of outgoing) {
        const next = String(ref.to);
        if (pathHasNode(cur, next)) continue; // simple path: no dead-end in/out or loop games.
        const edge = graph.edges.get(ref.edgeId);
        if (!edge) continue;
        const edgeTime = edge.distanceM / speedMps;
        const nextWalk = cur.walkS + edgeTime;
        const optimisticRemain = Number(toEnd.get(next));
        if (!Number.isFinite(optimisticRemain)) continue;
        if (Number.isFinite(detourLimitS) && nextWalk + optimisticRemain > detourLimitS + 0.5) continue;

        const shade = await sunForEdge(edge, cur.node, cur.walkS);
        const sunFraction = clamp(shade?.directSunFraction, 0, 1, 0);
        const nextSun = cur.sunS + edgeTime * sunFraction;
        const bucket = Math.floor(nextWalk / timeBucketSec);
        const stateKey = `${next}|${bucket}`;
        const previous = bestByState.get(stateKey);
        if (previous != null && previous <= nextSun + 0.05) continue;
        bestByState.set(stateKey, nextSun);
        heap.push({ node: next, walkS: nextWalk, sunS: nextSun, parent: cur, viaEdgeId: edge.id });
      }
    }

    if (!bestGoal) return { path: null, expanded, shadeEvals, shadeCacheSize: shadeCache.size };
    return { path: reconstructLabelPath(graph, bestGoal), expanded, shadeEvals, shadeCacheSize: shadeCache.size };
  }

  function routeSignature(points) {
    const pts = points || [];
    if (pts.length < 2) return "";
    const sampleIdx = [0, Math.floor((pts.length - 1) * 0.25), Math.floor((pts.length - 1) * 0.5), Math.floor((pts.length - 1) * 0.75), pts.length - 1];
    return sampleIdx.map((i) => `${pts[i].lat.toFixed(4)},${pts[i].lng.toFixed(4)}`).join("|");
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
      snapA: state.snapA ? { id: state.snapA.id, lat: state.snapA.node.lat, lng: state.snapA.node.lng, distanceM: state.snapA.distanceM } : null,
      snapB: state.snapB ? { id: state.snapB.id, lat: state.snapB.node.lat, lng: state.snapB.node.lng, distanceM: state.snapB.distanceM } : null,
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

  async function buildGraphForAB(a, b, options = {}) {
    const bbox = bboxForAB(a, b, options.bboxMarginM || config.bboxMarginM);
    const key = bboxKey(bbox);
    let cached = graphCache.get(key);
    if (!cached) {
      const { payload, endpoint } = await fetchOverpass(bbox, options);
      if (options.shouldCancel?.()) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      const parsed = parseOverpass(payload);
      if (parsed.nodes.size > Number(config.maxRawNodes || 18000)) throw new Error(`OSM 範圍含 ${parsed.nodes.size} 個節點，超過瀏覽器安全上限。`);
      const raw = buildRawGraph(parsed);
      cached = { bbox, parsed, raw, endpoint, cachedAt: Date.now() };
      graphCache.set(key, cached);
      if (graphCache.size > 4) graphCache.delete(graphCache.keys().next().value);
    }

    const snapA = nearestNode(cached.raw, a, Number(options.snapMaxM || config.snapMaxM));
    const snapB = nearestNode(cached.raw, b, Number(options.snapMaxM || config.snapMaxM));
    if (!snapA) throw new Error(`A 點附近 ${config.snapMaxM} m 內找不到 OSM 可步行節點。`);
    if (!snapB) throw new Error(`B 點附近 ${config.snapMaxM} m 內找不到 OSM 可步行節點。`);

    options.onProgress?.({ stage: "graph", message: "正在建立本地 pedestrian graph…" });
    const graph = contractGraph(cached.raw, [snapA.id, snapB.id]);
    if (graph.nodes.size > Number(config.maxContractedNodes || 5000)) throw new Error(`步行 graph 有 ${graph.nodes.size} 個交會節點，超過目前安全上限。`);
    lastGraphDebug = { graph, snapA, snapB, bbox: cached.bbox, endpoint: cached.endpoint, builtAt: Date.now() };
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
    const fromA = dijkstraTimes(graph, snapA.id, speedMps);
    const toB = dijkstraTimes(graph, snapB.id, speedMps, true);
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
      onProgress: options.onProgress,
      shouldCancel: options.shouldCancel
    });

    lastRouteEdges.fastest = new Set(fastestPath.edgeIds || []);
    lastRouteEdges.minSun = new Set(minSun.path?.edgeIds || []);

    const candidates = [];
    candidates.push({
      id: "graph-fastest",
      kind: "graph-fastest",
      distanceM: fastestPath.distanceM,
      durationS: fastestTime,
      points: fastestPath.points,
      graphMeta: { edgeIds: fastestPath.edgeIds, snapA, snapB }
    });
    if (minSun.path?.points?.length) {
      const same = routeSignature(minSun.path.points) === routeSignature(fastestPath.points);
      if (!same) {
        candidates.push({
          id: "graph-min-sun",
          kind: "graph-shade",
          distanceM: minSun.path.distanceM,
          durationS: minSun.path.walkSeconds,
          points: minSun.path.points,
          graphEstimatedDirectSunSeconds: minSun.path.directSunSeconds,
          graphMeta: { edgeIds: minSun.path.edgeIds, snapA, snapB }
        });
      }
    }

    lastDiagnostics = {
      version: VERSION,
      overpassEndpoint: built.endpoint,
      bbox: built.bbox,
      rawNodes: graph.rawNodeCount,
      rawSegments: graph.rawSegmentCount,
      contractedNodes: graph.nodes.size,
      contractedEdges: graph.edges.size,
      snapA: { distanceM: snapA.distanceM, nodeId: snapA.id },
      snapB: { distanceM: snapB.distanceM, nodeId: snapB.id },
      fastestSeconds: fastestTime,
      detourPct,
      detourLimitSeconds: detourLimitS,
      searchExpandedStates: minSun.expanded,
      shadeEdgeEvaluations: minSun.shadeEvals,
      candidateCount: candidates.length,
      graphStats: graphStats(graph)
    };
    return { available: true, candidates, diagnostics: lastDiagnostics };
  }

  function clearCache() {
    graphCache.clear();
    lastDiagnostics = null;
    lastGraphDebug = null;
    lastRouteEdges = { fastest: new Set(), minSun: new Set() };
    lastShadeDebug.clear();
  }

  window.HaidianPedestrianGraph = {
    version: VERSION,
    get config() { return Object.assign({}, config); },
    findRoutes,
    buildGraphForAB,
    getDebugSnapshot: debugSnapshot,
    diagnosePolyline,
    clearCache,
    get lastDiagnostics() { return lastDiagnostics; },
    _internals: {
      isPedestrianWay,
      parseOverpass,
      buildRawGraph,
      contractGraph,
      nearestNode,
      dijkstraTimes,
      reconstructDijkstra,
      searchMinSun,
      bboxForAB,
      routeDistanceM,
      pathFromEdgeSteps,
      edgeGeometryFor,
      nearestGraphEdge,
      diagnosePolyline,
      primaryHighway,
      highwayFamily,
      graphStats,
      MinHeap
    }
  };
})();
