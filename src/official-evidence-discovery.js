/*
 * Haidian Soundscape — Route-local Official Evidence Discovery v9.0.0-dev33
 *
 * Purpose:
 * - inspect only official pedestrian-compatible geometry already lazy-loaded near A→B;
 * - detect short source-following spans where graph coverage switches/disappears and
 *   the existing graph has no equivalently short connection;
 * - emit audited `verified` gap records consumable by the detached fusion router.
 *
 * Safety invariants:
 * - manual/user-drawn geometry is never an evidence source;
 * - no generic nearest-edge bridge is emitted: connector geometry is always a
 *   subpath of one official source feature;
 * - endpoints must attach within a bounded distance to graph edges observed on
 *   opposite sides of the same official subpath;
 * - an existing graph path of comparable length suppresses the candidate;
 * - production graph is never mutated here.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev33";
  const DEFAULTS = {
    enabled: true,
    sourceKeys: ["nlma-sidewalk", "nlma-bikeway"],
    routeCorridorM: 220,
    sampleSpacingM: 4,
    graphCoverageM: 7,
    sourceAttachMaxM: 18,
    minWitnessM: 6,
    maxWitnessM: 90,
    equivalentGraphRatio: 1.35,
    equivalentGraphSlackM: 12,
    minGraphDetourRatio: 1.5,
    minGraphDetourM: 12,
    maxAnchorHeadingDiffDeg: 65,
    graphProbeMaxM: 260,
    clusterRadiusM: 15,
    maxFeatureCount: 220,
    maxCandidates: 12,
    productionMutationEnabled: false
  };
  const rootConfig = window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {};
  const config = Object.assign({}, DEFAULTS, rootConfig.officialEvidenceDiscovery || {});
  const state = { status: "idle", error: null, lastDiscovery: null };

  function safeArray(v) { return Array.isArray(v) ? v : []; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function asLatLng(v) {
    if (!v) return null;
    const lat = Number(v.lat ?? v[1]);
    const lng = Number(v.lng ?? v.lon ?? v[0]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  function haversineM(a0, b0) {
    const a = asLatLng(a0), b = asLatLng(b0);
    if (!a || !b) return Infinity;
    const R = 6371008.8, rad = Math.PI / 180;
    const p1 = a.lat * rad, p2 = b.lat * rad;
    const dp = (b.lat - a.lat) * rad, dl = (b.lng - a.lng) * rad;
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }
  function routeDistanceM(points) {
    const pts = safeArray(points).map(asLatLng).filter(Boolean);
    let d = 0;
    for (let i = 1; i < pts.length; i += 1) d += haversineM(pts[i - 1], pts[i]);
    return d;
  }
  function interpolate(a, b, t) { return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }; }
  function projectPointToSegment(point0, a0, b0) {
    const p = asLatLng(point0), a = asLatLng(a0), b = asLatLng(b0);
    if (!p || !a || !b) return null;
    const lat0 = ((p.lat + a.lat + b.lat) / 3) * Math.PI / 180;
    const mx = 111320 * Math.max(0.2, Math.cos(lat0)), my = 110540;
    const bx = (b.lng - a.lng) * mx, by = (b.lat - a.lat) * my;
    const px = (p.lng - a.lng) * mx, py = (p.lat - a.lat) * my;
    const den = bx * bx + by * by;
    const t = den > 1e-12 ? Math.max(0, Math.min(1, (px * bx + py * by) / den)) : 0;
    const hit = interpolate(a, b, t);
    return { point: hit, t, distanceM: haversineM(p, hit) };
  }
  function nearestOnPolyline(point, line) {
    const pts = safeArray(line).map(asLatLng).filter(Boolean);
    if (!pts.length) return null;
    if (pts.length === 1) return { point: pts[0], distanceM: haversineM(point, pts[0]), segmentIndex: 0, t: 0 };
    let best = null;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const hit = projectPointToSegment(point, pts[i], pts[i + 1]);
      if (hit && (!best || hit.distanceM < best.distanceM)) best = Object.assign({ segmentIndex: i }, hit);
    }
    return best;
  }
  function bboxOfPoints(points) {
    const pts = safeArray(points).map(asLatLng).filter(Boolean);
    if (!pts.length) return null;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const p of pts) { west = Math.min(west, p.lng); east = Math.max(east, p.lng); south = Math.min(south, p.lat); north = Math.max(north, p.lat); }
    return [west, south, east, north];
  }
  function expandBBoxM(bbox, marginM) {
    if (!bbox) return null;
    const [w, s, e, n] = bbox.map(Number), midLat = (s + n) / 2;
    const dLat = Math.max(0, Number(marginM) || 0) / 110540;
    const dLon = Math.max(0, Number(marginM) || 0) / (111320 * Math.max(0.2, Math.cos(midLat * Math.PI / 180)));
    return [w - dLon, s - dLat, e + dLon, n + dLat];
  }
  function bboxIntersects(a, b) { return Boolean(a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]); }
  function geometryPolylines(feature) {
    const g = feature?.geometry;
    if (!g) return [];
    const convert = (coords) => safeArray(coords).map((p) => asLatLng(p)).filter(Boolean);
    if (g.type === "LineString") return [convert(g.coordinates)].filter((x) => x.length >= 2);
    if (g.type === "MultiLineString") return safeArray(g.coordinates).map(convert).filter((x) => x.length >= 2);
    if (g.type === "Polygon") return safeArray(g.coordinates).map(convert).filter((x) => x.length >= 2);
    if (g.type === "MultiPolygon") return safeArray(g.coordinates).flatMap((poly) => safeArray(poly).map(convert)).filter((x) => x.length >= 2);
    return [];
  }
  function featureBBox(feature) { return bboxOfPoints(geometryPolylines(feature).flat()); }

  function densifyPolyline(points, spacingM) {
    const src = safeArray(points).map(asLatLng).filter(Boolean);
    if (src.length < 2) return [];
    const spacing = Math.max(1, Number(spacingM) || 4);
    const out = [{ point: src[0], progressM: 0 }];
    let progress = 0;
    for (let i = 1; i < src.length; i += 1) {
      const a = src[i - 1], b = src[i], seg = haversineM(a, b);
      if (!(seg > 0.05)) continue;
      const steps = Math.max(1, Math.ceil(seg / spacing));
      for (let k = 1; k <= steps; k += 1) {
        const t = k / steps;
        out.push({ point: interpolate(a, b, t), progressM: progress + seg * t });
      }
      progress += seg;
    }
    return out;
  }

  function edgeHighway(edge) {
    const raw = edge?.tagsSummary?.highway;
    if (Array.isArray(raw)) return String(raw[0] || "unknown");
    return String(raw || edge?.roadClass || "unknown");
  }
  function edgeSourceId(edge) {
    const ways = safeArray(edge?.wayIds).map(String).filter(Boolean);
    return ways[0] || String(edge?.sourceEdgeId || edge?.id || "");
  }
  function headingDeg(a0, b0) {
    const a = asLatLng(a0), b = asLatLng(b0);
    if (!a || !b) return null;
    const lat0 = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const x = (b.lng - a.lng) * Math.cos(lat0), y = b.lat - a.lat;
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  }
  function undirectedHeadingDiffDeg(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 180;
    let d = Math.abs(a - b) % 180;
    if (d > 90) d = 180 - d;
    return d;
  }
  function edgeHitHeading(hit) {
    const pts = safeArray(hit?.edge?.geometry).map(asLatLng).filter(Boolean);
    const i = Math.max(0, Math.min(pts.length - 2, Number(hit?.segmentIndex || 0)));
    return pts.length >= 2 ? headingDeg(pts[i], pts[i + 1]) : null;
  }

  function createGraphSpatialIndex(graph, cellM = 44) {
    const refNode = graph?.nodes?.values?.().next?.().value || { lat: 23.5, lng: 121 };
    const refLat = Number(refNode.lat || 23.5), mx = 111320 * Math.max(0.2, Math.cos(refLat * Math.PI / 180)), my = 110540;
    const cells = new Map();
    const key = (x, y) => `${x},${y}`;
    const xy = (p) => ({ x: Number(p.lng) * mx, y: Number(p.lat) * my });
    const add = (cx, cy, rec) => { const k = key(cx, cy); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(rec); };
    let segmentCount = 0;
    for (const edge of graph?.edges?.values?.() || []) {
      const pts = safeArray(edge?.geometry).map(asLatLng).filter(Boolean);
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const a = xy(pts[i]), b = xy(pts[i + 1]);
        const x0 = Math.floor(Math.min(a.x, b.x) / cellM), x1 = Math.floor(Math.max(a.x, b.x) / cellM);
        const y0 = Math.floor(Math.min(a.y, b.y) / cellM), y1 = Math.floor(Math.max(a.y, b.y) / cellM);
        const rec = { edge, segmentIndex: i };
        for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) add(x, y, rec);
        segmentCount += 1;
      }
    }
    return { cells, cellM, mx, my, key, segmentCount };
  }

  function nearestGraphHit(graph, spatial, point0, maxM) {
    const p = asLatLng(point0);
    if (!p || !graph?.edges?.size) return null;
    const cx = Math.floor((p.lng * spatial.mx) / spatial.cellM), cy = Math.floor((p.lat * spatial.my) / spatial.cellM);
    const ring = Math.max(1, Math.ceil(Math.max(1, Number(maxM) || 1) / spatial.cellM));
    const seen = new Set();
    let best = null;
    for (let dx = -ring; dx <= ring; dx += 1) for (let dy = -ring; dy <= ring; dy += 1) {
      const list = spatial.cells.get(spatial.key(cx + dx, cy + dy)) || [];
      for (const rec of list) {
        const rid = `${rec.edge?.id}:${rec.segmentIndex}`;
        if (seen.has(rid)) continue;
        seen.add(rid);
        const pts = safeArray(rec.edge?.geometry).map(asLatLng).filter(Boolean);
        const a = pts[rec.segmentIndex], b = pts[rec.segmentIndex + 1];
        const hit = projectPointToSegment(p, a, b);
        if (!hit || hit.distanceM > maxM) continue;
        if (!best || hit.distanceM < best.distanceM) best = Object.assign({ edge: rec.edge, segmentIndex: rec.segmentIndex }, hit);
      }
    }
    return best;
  }

  class MinHeap {
    constructor() { this.a = []; }
    push(item) { let i = this.a.length; this.a.push(item); while (i) { const p = (i - 1) >> 1; if (this.a[p].d <= item.d) break; this.a[i] = this.a[p]; i = p; } this.a[i] = item; }
    pop() { if (!this.a.length) return null; const root = this.a[0], last = this.a.pop(); if (this.a.length) { let i = 0; while (true) { let l = i * 2 + 1, r = l + 1, m = i; if (l < this.a.length && this.a[l].d < (m === i ? last.d : this.a[m].d)) m = l; if (r < this.a.length && this.a[r].d < (m === i ? last.d : this.a[m].d)) m = r; if (m === i) break; this.a[i] = this.a[m]; i = m; } this.a[i] = last; } return root; }
  }

  function hitEndpointCosts(graph, hit) {
    const edge = hit?.edge, p = hit?.point;
    if (!edge || !p) return [];
    const out = [];
    for (const id of [edge.a, edge.b]) {
      const node = graph.nodes.get(String(id));
      if (!node) continue;
      out.push({ id: String(id), cost: haversineM(p, node) });
    }
    return out;
  }

  function boundedGraphDistanceBetweenHits(graph, fromHit, toHit, maxM) {
    const starts = hitEndpointCosts(graph, fromHit), targets = hitEndpointCosts(graph, toHit);
    if (!starts.length || !targets.length) return Infinity;
    const targetCost = new Map(targets.map((x) => [x.id, x.cost]));
    const dist = new Map(), heap = new MinHeap();
    for (const s of starts) { if (s.cost <= maxM && (!dist.has(s.id) || s.cost < dist.get(s.id))) { dist.set(s.id, s.cost); heap.push({ id: s.id, d: s.cost }); } }
    let best = Infinity;
    while (heap.a.length) {
      const cur = heap.pop();
      if (!cur || cur.d !== dist.get(cur.id) || cur.d >= best || cur.d > maxM) continue;
      if (targetCost.has(cur.id)) best = Math.min(best, cur.d + targetCost.get(cur.id));
      for (const ref of safeArray(graph.adjacency.get(cur.id))) {
        const edge = graph.edges.get(String(ref.edgeId));
        if (!edge) continue;
        const nd = cur.d + Number(edge.distanceM || routeDistanceM(edge.geometry || []));
        if (nd > maxM || nd >= best) continue;
        const to = String(ref.to);
        if (!dist.has(to) || nd < dist.get(to)) { dist.set(to, nd); heap.push({ id: to, d: nd }); }
      }
    }
    return best;
  }

  function pointNearAnyRoute(point, routePolylines, maxM) {
    for (const line of safeArray(routePolylines)) {
      const hit = nearestOnPolyline(point, line);
      if (hit && hit.distanceM <= maxM) return true;
    }
    return false;
  }

  function runsFromSamples(samples) {
    const runs = [];
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i], key = s.anchorKey || null;
      const last = runs[runs.length - 1];
      if (!last || last.key !== key) runs.push({ key, start: i, end: i, hit: s.hit || null });
      else { last.end = i; if (s.hit) last.hit = s.hit; }
    }
    return runs;
  }

  function sourceProvenance(feature, sourceKey) {
    const p = feature?.properties || {};
    const provided = safeArray(p.provenance);
    if (provided.length) return clone(provided);
    return [{ dataset: sourceKey, record_id: String(p.sourceFeatureId || feature?.id || "runtime-feature") }];
  }

  function candidateFromRunPair(graph, samples, leftRun, rightRun, feature, sourceKey, opts) {
    const left = samples[leftRun.end], right = samples[rightRun.start];
    if (!left?.hit || !right?.hit) return null;
    const leftId = edgeSourceId(left.hit.edge), rightId = edgeSourceId(right.hit.edge);
    if (!leftId || !rightId || leftId === rightId) return null;
    const witnessSamples = samples.slice(leftRun.end, rightRun.start + 1);
    const geometry = witnessSamples.map((x) => x.point).filter(Boolean);
    const witnessM = Math.max(0, Number(right.progressM || 0) - Number(left.progressM || 0));
    if (witnessM < opts.minWitnessM || witnessM > opts.maxWitnessM || geometry.length < 2) return null;
    const midpoint = geometry[Math.floor(geometry.length / 2)];
    if (!pointNearAnyRoute(midpoint, opts.routePolylines, opts.routeCorridorM)) return null;

    // Endpoint direction must agree with the same official source-following corridor.
    // This rejects the common false positive where a sidewalk polygon merely crosses
    // a nearby perpendicular street and nearest-edge identity changes for a few metres.
    const witnessStartHeading = headingDeg(geometry[0], geometry[Math.min(1, geometry.length - 1)]);
    const witnessEndHeading = headingDeg(geometry[Math.max(0, geometry.length - 2)], geometry[geometry.length - 1]);
    const fromHeadingDiffDeg = undirectedHeadingDiffDeg(witnessStartHeading, edgeHitHeading(left.hit));
    const toHeadingDiffDeg = undirectedHeadingDiffDeg(witnessEndHeading, edgeHitHeading(right.hit));
    if (fromHeadingDiffDeg > opts.maxAnchorHeadingDiffDeg || toHeadingDiffDeg > opts.maxAnchorHeadingDiffDeg) return null;

    const compareThresholdM = witnessM * opts.equivalentGraphRatio + opts.equivalentGraphSlackM;
    const probeMaxM = Math.max(compareThresholdM, Math.min(opts.graphProbeMaxM, witnessM * 2.8 + 45));
    const graphDistanceM = boundedGraphDistanceBetweenHits(graph, left.hit, right.hit, probeMaxM);
    if (Number.isFinite(graphDistanceM)) {
      if (graphDistanceM <= compareThresholdM) return null;
      if ((graphDistanceM - witnessM) < opts.minGraphDetourM) return null;
      if (graphDistanceM / Math.max(1, witnessM) < opts.minGraphDetourRatio) return null;
    }

    const props = feature?.properties || {};
    const provenance = sourceProvenance(feature, sourceKey);
    const fid = String(props.sourceFeatureId || feature?.id || "feature");
    const fromHighway = edgeHighway(left.hit.edge), toHighway = edgeHighway(right.hit.edge);
    return {
      sourceKey, featureId: fid, featureName: props.name || null,
      geometry, witnessM, midpoint,
      fromHit: left.hit, toHit: right.hit,
      fromSourceId: leftId, toSourceId: rightId,
      fromHighway, toHighway,
      graphDistanceM: Number.isFinite(graphDistanceM) ? graphDistanceM : null,
      graphEquivalentThresholdM: compareThresholdM,
      fromHeadingDiffDeg, toHeadingDiffDeg,
      provenance,
      score: witnessM + left.hit.distanceM + right.hit.distanceM
    };
  }

  function clusterCandidates(items, radiusM, maxCandidates) {
    const sorted = safeArray(items).slice().sort((a, b) => a.score - b.score);
    const out = [];
    for (const c of sorted) {
      const duplicate = out.some((x) => x.sourceKey === c.sourceKey && x.featureId === c.featureId && haversineM(x.midpoint, c.midpoint) <= radiusM);
      if (duplicate) continue;
      out.push(c);
      if (out.length >= maxCandidates) break;
    }
    return out;
  }

  function gapFromCandidate(c, index) {
    const witness = {
      evidenceType: "official-route-local-continuous-geometry",
      source: c.sourceKey,
      sourceFeatureId: c.featureId,
      fromDistanceM: Number(c.fromHit.distanceM || 0),
      toDistanceM: Number(c.toHit.distanceM || 0),
      lengthM: c.witnessM,
      geometry: c.geometry.map((p) => ({ lat: p.lat, lon: p.lng })),
      pedestrianAllowed: true,
      accessBasis: "official feature pedestrianAllowed=true",
      independentProvenance: true,
      provenance: clone(c.provenance)
    };
    const id = `auto-${c.sourceKey}-${c.featureId}-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      classification: "route-local-official-topology-gap",
      discoveryMethod: "dev33-official-source-following-transition-audit",
      anchorNamespace: "production-edge-source-id",
      geometryGapM: c.witnessM,
      graphNodeGapM: c.graphDistanceM,
      fromWays: [{ wayId: c.fromSourceId, highway: c.fromHighway }],
      toWays: [{ wayId: c.toSourceId, highway: c.toHighway }],
      geometry: witness.geometry,
      location: { lat: c.midpoint.lat, lng: c.midpoint.lng },
      gradeSeparationConflict: false,
      accessConflict: false,
      explicitSharedTopology: false,
      officialContinuousGeometry: true,
      independentProvenance: true,
      continuousGeometryEvidence: [{ sourceFeatureId: c.featureId, fromDistanceM: witness.fromDistanceM, toDistanceM: witness.toDistanceM, officialInventory: true, provenance: clone(c.provenance), routableWitness: clone(witness) }],
      provenance: clone(c.provenance),
      evidenceSources: [c.sourceKey],
      sources: {
        overture: { availability: "ready", nearestFromM: witness.fromDistanceM, nearestToM: witness.toDistanceM, independentProvenance: false },
        [c.sourceKey]: { availability: "ready", nearestFromM: witness.fromDistanceM, nearestToM: witness.toDistanceM, officialContinuousGeometry: true, independentProvenance: true, provenance: clone(c.provenance) }
      },
      preferredFusionWitness: witness,
      decision: "verified",
      decisionReason: "dev33 route-local audit: one official pedestrian source follows the missing span, both sides attach within threshold, and no equivalently short graph connection exists.",
      productionAllowed: false,
      productionReason: "dev33 production lock: auto-discovered official evidence may enter only a detached experimental graph clone.",
      audit: {
        sourceFeatureName: c.featureName,
        witnessLengthM: c.witnessM,
        existingGraphDistanceM: c.graphDistanceM,
        equivalentGraphThresholdM: c.graphEquivalentThresholdM,
        fromAttachM: witness.fromDistanceM,
        toAttachM: witness.toDistanceM,
        fromHeadingDiffDeg: c.fromHeadingDiffDeg,
        toHeadingDiffDeg: c.toHeadingDiffDeg
      }
    };
  }

  function discoverFromGraph(graph, routePolylines, sourceGroups, options = {}) {
    const opts = Object.assign({}, config, options || {});
    opts.routePolylines = safeArray(routePolylines).map((line) => safeArray(line).map(asLatLng).filter(Boolean)).filter((line) => line.length >= 2);
    if (!graph?.edges?.size || !opts.routePolylines.length) return { available: false, reason: "graph-or-route-missing", gaps: [], productionGraphMutated: false };
    const routeBBox = expandBBoxM(bboxOfPoints(opts.routePolylines.flat()), opts.routeCorridorM);
    const spatial = createGraphSpatialIndex(graph);
    const raw = [];
    const inspected = [];
    let featureBudget = Math.max(1, Number(opts.maxFeatureCount) || 220);

    for (const sourceKey of safeArray(opts.sourceKeys)) {
      const fc = sourceGroups?.[sourceKey];
      const features = safeArray(fc?.features);
      let sourceInspected = 0;
      for (const feature of features) {
        if (featureBudget <= 0) break;
        const props = feature?.properties || {};
        if (props.pedestrianAllowed !== true || props.officialInventory === false) continue;
        const fb = featureBBox(feature);
        if (!bboxIntersects(routeBBox, fb)) continue;
        featureBudget -= 1; sourceInspected += 1;
        for (const line of geometryPolylines(feature)) {
          const samples = densifyPolyline(line, opts.sampleSpacingM);
          if (samples.length < 2) continue;
          for (const s of samples) {
            const hit = nearestGraphHit(graph, spatial, s.point, opts.sourceAttachMaxM);
            s.hit = hit;
            s.anchorKey = hit && hit.distanceM <= opts.graphCoverageM ? edgeSourceId(hit.edge) : null;
          }
          const runs = runsFromSamples(samples);
          for (let r = 0; r < runs.length; r += 1) {
            if (!runs[r].key) continue;
            let next = r + 1;
            while (next < runs.length && !runs[next].key) next += 1;
            if (next >= runs.length || runs[next].key === runs[r].key) continue;
            const c = candidateFromRunPair(graph, samples, runs[r], runs[next], feature, sourceKey, opts);
            if (c) raw.push(c);
          }
        }
      }
      inspected.push({ sourceKey, availableFeatures: features.length, inspectedFeatures: sourceInspected });
    }

    const clustered = clusterCandidates(raw, opts.clusterRadiusM, opts.maxCandidates);
    const gaps = clustered.map(gapFromCandidate);
    return {
      available: true,
      version: VERSION,
      schema: "haidian-route-local-official-evidence-discovery-v1",
      routeCorridorM: opts.routeCorridorM,
      inspectedSources: inspected,
      rawCandidateCount: raw.length,
      verifiedGapCount: gaps.length,
      gaps,
      evidenceIndex: {
        schema: "haidian-dynamic-evidence-index-v1",
        version: VERSION,
        generatedAt: new Date().toISOString(),
        productionGraphMutation: false,
        policy: { noProximityAutoBridge: true, manualRouteIsEvidence: false, verifiedStillProductionAllowed: false, sourceFollowingGeometryRequired: true },
        summary: { gapCount: gaps.length, verified: gaps.length, manualReview: 0, rejected: 0, routableVerified: gaps.length },
        gaps: clone(gaps)
      },
      productionGraphMutated: false
    };
  }

  async function discoverRouteLocalEvidence(options = {}) {
    if (config.enabled === false || options.enabled === false) return { available: false, reason: "disabled", gaps: [], productionGraphMutated: false };
    const graphApi = window.HaidianPedestrianGraph;
    const base = options.graph ? { available: true, graph: options.graph } : graphApi?.createExperimentalGraphClone?.();
    if (!base?.available || !base.graph) return { available: false, reason: base?.reason || "production-graph-unavailable", gaps: [], productionGraphMutated: false };
    const routePolylines = options.routePolylines || (options.routePoints ? [options.routePoints] : []);
    const sourceGroups = options.sourceGroups || options.bySource || {};
    state.status = "discovering"; state.error = null;
    try {
      const result = discoverFromGraph(base.graph, routePolylines, sourceGroups, options);
      state.status = "ready"; state.lastDiscovery = clone(result);
      return result;
    } catch (error) {
      state.status = "error"; state.error = String(error?.message || error);
      const result = { available: false, reason: "official-evidence-discovery-error", error: state.error, gaps: [], productionGraphMutated: false };
      state.lastDiscovery = clone(result);
      return result;
    }
  }

  function getState() { return { version: VERSION, status: state.status, error: state.error, lastDiscovery: clone(state.lastDiscovery), productionMutationEnabled: false }; }

  window.HaidianOfficialEvidenceDiscovery = {
    version: VERSION,
    get config() { return Object.assign({}, config); },
    discoverRouteLocalEvidence,
    discoverFromGraph,
    getState,
    _internals: { asLatLng, haversineM, routeDistanceM, geometryPolylines, densifyPolyline, createGraphSpatialIndex, nearestGraphHit, boundedGraphDistanceBetweenHits, clusterCandidates, gapFromCandidate }
  };
})();
