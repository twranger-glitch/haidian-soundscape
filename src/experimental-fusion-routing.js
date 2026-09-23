/*
 * Haidian Soundscape — Experimental Multi-source Fusion Router v9.0.0-dev32
 *
 * Safety model:
 * - consumes only evidence gaps already classified `verified`;
 * - requires a source-following `preferredFusionWitness` geometry;
 * - attaches witness endpoints only to graph edges carrying the audited OSM way IDs;
 * - splits only a detached clone supplied by HaidianPedestrianGraph;
 * - never writes experimental edges back to the production graph/cache;
 * - never treats proximity alone, a hand-drawn route, or `gap.geometry` as routable evidence.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev32";
  const DEFAULTS = {
    enabled: true,
    sourceAttachMaxM: 18,
    endpointReuseM: 0.8,
    renderOnMap: true,
    productionMutationEnabled: false
  };
  const globalConfig = window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {};
  const config = Object.assign({}, DEFAULTS, globalConfig.multisourceFusion || {});
  const state = { status: "idle", error: null, lastRun: null, map: null, layer: null };

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
    const p = safeArray(points).map(asLatLng).filter(Boolean);
    let d = 0;
    for (let i = 1; i < p.length; i += 1) d += haversineM(p[i - 1], p[i]);
    return d;
  }
  function interpolate(a, b, t) {
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }
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
  function nearestOnGeometry(point, geometry) {
    const g = safeArray(geometry).map(asLatLng).filter(Boolean);
    if (!g.length) return null;
    if (g.length === 1) return { point: g[0], distanceM: haversineM(point, g[0]), segmentIndex: 0, t: 0 };
    let best = null;
    for (let i = 0; i + 1 < g.length; i += 1) {
      const hit = projectPointToSegment(point, g[i], g[i + 1]);
      if (hit && (!best || hit.distanceM < best.distanceM)) best = Object.assign({ segmentIndex: i }, hit);
    }
    return best;
  }
  function edgeHasAnyWay(edge, wayIds) {
    const wanted = new Set(safeArray(wayIds).map(String));
    return safeArray(edge?.wayIds).some((id) => wanted.has(String(id)));
  }
  function sideWayIds(gap, key) {
    return safeArray(gap?.[key]).map((x) => String(x?.wayId ?? x)).filter(Boolean);
  }
  function sideHighways(gap, key) {
    return [...new Set(safeArray(gap?.[key]).map((x) => String(x?.highway || "").trim().toLowerCase()).filter(Boolean))];
  }
  function edgeHighways(edge) {
    const raw = edge?.tagsSummary?.highway;
    const values = Array.isArray(raw) ? raw : [raw];
    return values.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  }
  function edgeHasAnyHighway(edge, highways) {
    const wanted = new Set(safeArray(highways).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean));
    if (!wanted.size) return false;
    return edgeHighways(edge).some((x) => wanted.has(x));
  }
  function nearestMatchingEdge(graph, point, wayIds) {
    if (!graph?.edges?.size || !safeArray(wayIds).length) return null;
    let best = null;
    for (const edge of graph.edges.values()) {
      if (!edgeHasAnyWay(edge, wayIds)) continue;
      const hit = nearestOnGeometry(point, edge.geometry || []);
      if (!hit) continue;
      if (!best || hit.distanceM < best.distanceM) best = Object.assign({ edge }, hit);
    }
    return best;
  }
  function nearestMatchingHighwayEdge(graph, point, highways) {
    if (!graph?.edges?.size || !safeArray(highways).length) return null;
    let best = null;
    for (const edge of graph.edges.values()) {
      if (!edgeHasAnyHighway(edge, highways)) continue;
      const hit = nearestOnGeometry(point, edge.geometry || []);
      if (!hit) continue;
      if (!best || hit.distanceM < best.distanceM) best = Object.assign({ edge }, hit);
    }
    return best;
  }
  function findAnchorHit(graph, point, spec) {
    if (!spec) return null;
    if (spec.mode === "audited-osm-way") return nearestMatchingEdge(graph, point, spec.wayIds);
    if (spec.mode === "nationwide-audited-highway") return nearestMatchingHighwayEdge(graph, point, spec.highways);
    return null;
  }
  function dedupeGeometry(points) {
    const out = [];
    for (const p0 of safeArray(points)) {
      const p = asLatLng(p0);
      if (!p) continue;
      if (!out.length || haversineM(out[out.length - 1], p) > 0.05) out.push(p);
    }
    return out;
  }
  function removeAdjacencyEdge(graph, nodeId, edgeId) {
    const id = String(nodeId);
    graph.adjacency.set(id, safeArray(graph.adjacency.get(id)).filter((r) => String(r.edgeId) !== String(edgeId)));
  }
  function ensureAdjacency(graph, nodeId) {
    const id = String(nodeId);
    if (!graph.adjacency.has(id)) graph.adjacency.set(id, []);
    return id;
  }
  function copyEdgeMeta(edge) {
    return {
      wayIds: safeArray(edge.wayIds).slice(),
      tagsSummary: clone(edge.tagsSummary || {}),
      sourceEdgeId: edge.sourceEdgeId,
      sourceDistanceM: edge.sourceDistanceM
    };
  }
  function addClonedEdge(graph, id, a, b, geometry, meta) {
    const ga = ensureAdjacency(graph, a), gb = ensureAdjacency(graph, b);
    const pts = dedupeGeometry(geometry);
    const distanceM = routeDistanceM(pts);
    if (!(distanceM > 0.05)) return null;
    const edge = Object.assign({ id: String(id), a: ga, b: gb, geometry: pts, distanceM }, meta || {});
    graph.edges.set(edge.id, edge);
    graph.adjacency.get(ga).push({ edgeId: edge.id, to: gb });
    graph.adjacency.get(gb).push({ edgeId: edge.id, to: ga });
    return edge;
  }
  function splitGeometryAtHit(geometry, hit) {
    const g = safeArray(geometry).map(asLatLng).filter(Boolean);
    const i = Number(hit?.segmentIndex || 0);
    const p = asLatLng(hit?.point);
    if (!p || g.length < 2) return null;
    const left = g.slice(0, i + 1).concat([p]);
    const right = [p].concat(g.slice(i + 1));
    return { left: dedupeGeometry(left), right: dedupeGeometry(right) };
  }
  function attachWitnessEndpoint(graph, hit, gapId, side, options) {
    const edge = hit?.edge;
    const point = asLatLng(hit?.point);
    if (!edge || !point) return { ok: false, reason: "missing-anchor-edge" };
    const aNode = graph.nodes.get(String(edge.a)), bNode = graph.nodes.get(String(edge.b));
    const reuseM = Number(options.endpointReuseM ?? config.endpointReuseM);
    const da = haversineM(point, aNode), db = haversineM(point, bNode);
    if (da <= reuseM) return { ok: true, nodeId: String(edge.a), point: asLatLng(aNode), split: false, edgeId: edge.id };
    if (db <= reuseM) return { ok: true, nodeId: String(edge.b), point: asLatLng(bNode), split: false, edgeId: edge.id };

    const parts = splitGeometryAtHit(edge.geometry, hit);
    if (!parts || parts.left.length < 2 || parts.right.length < 2) return { ok: false, reason: "anchor-split-failed" };
    const nodeId = `dev27-anchor:${gapId}:${side}`;
    graph.nodes.set(nodeId, { id: nodeId, lat: point.lat, lng: point.lng, virtual: true, experimentalFusionAnchor: true, sourceEdgeId: edge.id });
    ensureAdjacency(graph, nodeId);
    removeAdjacencyEdge(graph, edge.a, edge.id);
    removeAdjacencyEdge(graph, edge.b, edge.id);
    graph.edges.delete(edge.id);
    const meta = copyEdgeMeta(edge);
    const e1 = addClonedEdge(graph, `${edge.id}:dev27a:${gapId}:${side}`, edge.a, nodeId, parts.left, meta);
    const e2 = addClonedEdge(graph, `${edge.id}:dev27b:${gapId}:${side}`, nodeId, edge.b, parts.right, meta);
    if (!e1 || !e2) return { ok: false, reason: "anchor-replacement-edge-failed" };
    return { ok: true, nodeId, point, split: true, edgeId: edge.id, replacementEdgeIds: [e1.id, e2.id] };
  }

  function chooseWitnessOrientation(graph, gap, witness) {
    const geometry = dedupeGeometry(witness?.geometry || []);
    if (geometry.length < 2) return { ok: false, reason: "missing-routable-witness" };
    const fromWays = sideWayIds(gap, "fromWays"), toWays = sideWayIds(gap, "toWays");
    if (!fromWays.length || !toWays.length) return { ok: false, reason: "missing-audited-way-anchors" };
    const first = geometry[0], last = geometry[geometry.length - 1];

    // Primary/dev25 rule: anchor only to the exact audited OSM way IDs.
    let fromSpec = { mode: "audited-osm-way", wayIds: fromWays };
    let toSpec = { mode: "audited-osm-way", wayIds: toWays };
    let anchorStrategy = "audited-osm-way";
    let forwardFrom = findAnchorHit(graph, first, fromSpec);
    let forwardTo = findAnchorHit(graph, last, toSpec);
    let reverseFrom = findAnchorHit(graph, last, fromSpec);
    let reverseTo = findAnchorHit(graph, first, toSpec);
    let forwardScore = (forwardFrom?.distanceM ?? Infinity) + (forwardTo?.distanceM ?? Infinity);
    let reverseScore = (reverseFrom?.distanceM ?? Infinity) + (reverseTo?.distanceM ?? Infinity);

    // dev27 namespace bridge: nationwide HGR1 edges carry Overture segment UUIDs,
    // not OSM way IDs.  Do NOT create a generic proximity bridge.  Only when:
    //   1) the gap is already verified by an independent official pedestrian witness;
    //   2) the nationwide graph is Overture-backed and the evidence index confirms
    //      Overture is present at both audited gap sides; and
    //   3) each witness endpoint can attach to the exact audited highway class.
    // The official witness remains the connector geometry; proximity is used only
    // to anchor that verified geometry into the different source-ID namespace.
    if (!Number.isFinite(forwardScore) && !Number.isFinite(reverseScore) && graph?.nationwideTileGraph) {
      const ov = gap?.sources?.overture || {};
      const fromHighways = sideHighways(gap, "fromWays"), toHighways = sideHighways(gap, "toWays");
      const overtureAtBothSides = ov?.availability === "ready" && Number.isFinite(Number(ov?.nearestFromM)) && Number.isFinite(Number(ov?.nearestToM));
      if (overtureAtBothSides && fromHighways.length && toHighways.length) {
        fromSpec = { mode: "nationwide-audited-highway", highways: fromHighways };
        toSpec = { mode: "nationwide-audited-highway", highways: toHighways };
        anchorStrategy = "nationwide-verified-witness-highway-anchor";
        forwardFrom = findAnchorHit(graph, first, fromSpec);
        forwardTo = findAnchorHit(graph, last, toSpec);
        reverseFrom = findAnchorHit(graph, last, fromSpec);
        reverseTo = findAnchorHit(graph, first, toSpec);
        forwardScore = (forwardFrom?.distanceM ?? Infinity) + (forwardTo?.distanceM ?? Infinity);
        reverseScore = (reverseFrom?.distanceM ?? Infinity) + (reverseTo?.distanceM ?? Infinity);
      }
    }

    if (!Number.isFinite(forwardScore) && !Number.isFinite(reverseScore)) {
      return { ok: false, reason: graph?.nationwideTileGraph ? "nationwide-audited-anchor-not-found" : "audited-osm-way-not-found" };
    }
    if (reverseScore < forwardScore) {
      return { ok: true, geometry: geometry.slice().reverse(), fromHit: reverseFrom, toHit: reverseTo, orientation: "reversed", fromAnchorSpec: fromSpec, toAnchorSpec: toSpec, anchorStrategy };
    }
    return { ok: true, geometry, fromHit: forwardFrom, toHit: forwardTo, orientation: "forward", fromAnchorSpec: fromSpec, toAnchorSpec: toSpec, anchorStrategy };
  }

  function addVerifiedGap(graph, gap, options = {}) {
    if (!gap || gap.decision !== "verified") return { added: false, gapId: gap?.id || null, reason: "not-verified" };
    if (gap.gradeSeparationConflict || gap.accessConflict) return { added: false, gapId: gap.id || null, reason: "grade-or-access-conflict" };
    const witness = gap.preferredFusionWitness;
    if (!witness || !witness.independentProvenance || witness.pedestrianAllowed !== true || safeArray(witness.geometry).length < 2) {
      return { added: false, gapId: gap.id || null, reason: "missing-independent-pedestrian-routable-witness" };
    }
    const oriented = chooseWitnessOrientation(graph, gap, witness);
    if (!oriented.ok) return { added: false, gapId: gap.id || null, reason: oriented.reason };
    const maxAttachM = Math.max(0.5, Number(options.sourceAttachMaxM ?? config.sourceAttachMaxM));
    const fromDistanceM = Number(oriented.fromHit?.distanceM ?? Infinity);
    const toDistanceM = Number(oriented.toHit?.distanceM ?? Infinity);
    if (fromDistanceM > maxAttachM || toDistanceM > maxAttachM) {
      return { added: false, gapId: gap.id || null, reason: "source-attach-too-far", fromDistanceM, toDistanceM, maxAttachM };
    }

    const gapId = String(gap.id || `gap-${graph.edges.size}`);
    const fromAnchor = attachWitnessEndpoint(graph, oriented.fromHit, gapId, "from", options);
    if (!fromAnchor.ok) return { added: false, gapId, reason: fromAnchor.reason };
    // Re-resolve the to-side after the first split, since the same source edge may have changed IDs.
    // Use the exact same audited anchor policy chosen above (OSM way ID or the
    // dev27 nationwide highway-class namespace bridge); never fall back to an
    // unconstrained nearest edge.
    const toTarget = oriented.geometry[oriented.geometry.length - 1];
    const toHit = findAnchorHit(graph, toTarget, oriented.toAnchorSpec);
    if (!toHit || toHit.distanceM > maxAttachM) return { added: false, gapId, reason: "to-anchor-lost-after-split", toDistanceM: toHit?.distanceM ?? null };
    const toAnchor = attachWitnessEndpoint(graph, toHit, gapId, "to", options);
    if (!toAnchor.ok) return { added: false, gapId, reason: toAnchor.reason };
    if (String(fromAnchor.nodeId) === String(toAnchor.nodeId)) return { added: false, gapId, reason: "same-anchor-node" };

    const geometry = dedupeGeometry([fromAnchor.point, ...oriented.geometry, toAnchor.point]);
    const id = `dev27-fused:${gapId}`;
    const edge = addClonedEdge(graph, id, fromAnchor.nodeId, toAnchor.nodeId, geometry, {
      wayIds: [],
      tagsSummary: {
        highway: ["path"], foot: ["yes"],
        experimental_fusion: ["dev27"],
        evidence_decision: ["verified"],
        evidence_source: safeArray(gap.evidenceSources).map(String)
      },
      experimentalFusion: true,
      productionAllowed: false,
      evidenceGapId: gapId,
      evidenceType: witness.evidenceType || null,
      evidenceSource: witness.source || null,
      evidenceSources: clone(gap.evidenceSources || []),
      provenance: clone(witness.provenance || []),
      sourceWitnessGeometry: clone(witness.geometry || [])
    });
    if (!edge) return { added: false, gapId, reason: "connector-edge-failed" };
    return {
      added: true, gapId, edgeId: edge.id, distanceM: edge.distanceM,
      sourceAttachFromM: fromDistanceM, sourceAttachToM: Number(toHit.distanceM),
      fromAnchor, toAnchor, orientation: oriented.orientation,
      anchorStrategy: oriented.anchorStrategy || "audited-osm-way",
      fromAnchorWayIds: safeArray(oriented.fromHit?.edge?.wayIds).map(String),
      toAnchorWayIds: safeArray(toHit?.edge?.wayIds).map(String),
      fromAnchorHighways: edgeHighways(oriented.fromHit?.edge),
      toAnchorHighways: edgeHighways(toHit?.edge),
      evidenceType: witness.evidenceType || null, source: witness.source || null,
      productionAllowed: false
    };
  }

  function buildExperimentalFusedGraph(baseGraph, evidenceIndex, options = {}) {
    if (!baseGraph?.nodes || !baseGraph?.edges || !baseGraph?.adjacency) {
      return { available: false, reason: "invalid-base-graph", productionGraphMutated: false };
    }
    const graphApi = window.HaidianPedestrianGraph;
    const cloneFn = graphApi?._internals?.cloneFineGraphForExperimentalUse;
    let graph = options.alreadyCloned ? baseGraph : (typeof cloneFn === "function" ? cloneFn(baseGraph) : null);
    if (!graph) return { available: false, reason: "safe-clone-api-unavailable", productionGraphMutated: false };
    const verified = safeArray(evidenceIndex?.gaps).filter((g) => g?.decision === "verified");
    const connectors = [], rejected = [];
    for (const gap of verified) {
      // Transaction boundary: a rejected candidate must not leave split anchors or
      // replacement edges behind in the shared experimental graph. Clone the current
      // accepted state, mutate the candidate clone, and commit only on success.
      const candidateGraph = typeof cloneFn === "function" ? cloneFn(graph) : null;
      if (!candidateGraph) {
        rejected.push({ added: false, gapId: gap?.id || null, reason: "safe-transaction-clone-unavailable" });
        continue;
      }
      const result = addVerifiedGap(candidateGraph, gap, options);
      if (result.added) {
        graph = candidateGraph;
        connectors.push(result);
      } else {
        rejected.push(result);
      }
    }
    graph.experimentalFusionOverlay = true;
    graph.experimentalFusionConnectorIds = connectors.map((x) => x.edgeId);
    graph.productionGraphMutated = false;
    return {
      available: true,
      graph,
      verifiedCandidateCount: verified.length,
      connectorCount: connectors.length,
      connectors,
      rejected,
      productionGraphMutated: false,
      productionMutationEnabled: false,
      interpretation: connectors.length
        ? "Verified source-following witnesses were inserted only into a detached experimental graph clone."
        : "No verified source-following witness could be safely anchored; no experimental connector was inserted."
    };
  }

  function attachMap(map) { state.map = map || null; return Boolean(state.map); }
  function clearMapLayer() {
    try { if (state.layer && state.map?.removeLayer) state.map.removeLayer(state.layer); } catch (_) {}
    state.layer = null;
  }
  function renderRun(run) {
    clearMapLayer();
    if (!config.renderOnMap || !state.map || !window.L?.layerGroup || !run?.available) return false;
    const layer = window.L.layerGroup().addTo(state.map);
    for (const c of safeArray(run.overlay?.connectors)) {
      const edge = run.overlay.graph?.edges?.get?.(c.edgeId);
      const pts = safeArray(edge?.geometry).map(asLatLng).filter(Boolean);
      if (pts.length >= 2 && window.L.polyline) {
        window.L.polyline(pts.map((p) => [p.lat, p.lng]), { color: "#ea580c", weight: 6, opacity: 0.92, dashArray: "9 5" })
          .bindTooltip(`dev27 experimental witness · ${c.gapId} · productionAllowed=false`, { sticky: true }).addTo(layer);
      }
    }
    const fastest = safeArray(run.search?.fastest?.points).map(asLatLng).filter(Boolean);
    if (fastest.length >= 2 && window.L.polyline) window.L.polyline(fastest.map((p) => [p.lat, p.lng]), { color: "#64748b", weight: 4, opacity: 0.68, dashArray: "5 5" }).addTo(layer);
    const minSun = safeArray(run.search?.minSun?.points).map(asLatLng).filter(Boolean);
    if (minSun.length >= 2 && window.L.polyline) window.L.polyline(minSun.map((p) => [p.lat, p.lng]), { color: "#0f766e", weight: 7, opacity: 0.86 }).addTo(layer);
    state.layer = layer;
    return true;
  }

  async function runFromLastProductionGraph(options = {}) {
    const graphApi = window.HaidianPedestrianGraph;
    const evidenceApi = window.HaidianMultiSourceEvidence;
    if (!config.enabled) return { available: false, reason: "disabled", productionGraphMutated: false };
    if (!graphApi?.createExperimentalGraphClone || !graphApi?.runExperimentalSearchOnClone) {
      return { available: false, reason: "graph-sandbox-api-unavailable", productionGraphMutated: false };
    }
    const evidenceIndex = options.evidenceIndex || evidenceApi?.getState?.().evidenceIndex || null;
    if (!evidenceIndex) return { available: false, reason: "evidence-not-loaded", productionGraphMutated: false };
    state.status = "running"; state.error = null;
    try {
      const base = graphApi.createExperimentalGraphClone();
      if (!base.available) return Object.assign({}, base, { productionGraphMutated: false });
      const overlay = buildExperimentalFusedGraph(base.graph, evidenceIndex, Object.assign({}, options, { alreadyCloned: true }));
      if (!overlay.available || !overlay.connectorCount) {
        const result = { available: false, reason: overlay.reason || "no-routable-verified-connectors", overlay, productionGraphMutated: false };
        state.status = "ready"; state.lastRun = result; return result;
      }
      const search = await graphApi.runExperimentalSearchOnClone(overlay.graph, base.snapA.id, base.snapB.id, options);
      const result = {
        available: Boolean(search?.available), version: VERSION, overlay, search,
        productionFingerprintBefore: base.productionFingerprint,
        cloneFingerprintBeforeFusion: base.cloneFingerprint,
        productionGraphMutated: false,
        productionMutationEnabled: false
      };
      state.status = "ready"; state.lastRun = result;
      if (result.available && options.renderOnMap !== false) renderRun(result);
      return result;
    } catch (error) {
      state.status = "error"; state.error = String(error?.message || error);
      const result = { available: false, reason: "experimental-fusion-error", error: state.error, productionGraphMutated: false };
      state.lastRun = result;
      return result;
    }
  }

  function getState() {
    return { version: VERSION, status: state.status, error: state.error, lastRun: clone(state.lastRun), mapAttached: Boolean(state.map), productionMutationEnabled: false };
  }

  window.HaidianExperimentalFusionRouter = {
    version: VERSION,
    get config() { return Object.assign({}, config); },
    attachMap,
    clearMapLayer,
    buildExperimentalFusedGraph,
    runFromLastProductionGraph,
    getState,
    _internals: {
      nearestOnGeometry,
      nearestMatchingEdge,
      nearestMatchingHighwayEdge,
      findAnchorHit,
      sideHighways,
      edgeHighways,
      splitGeometryAtHit,
      attachWitnessEndpoint,
      chooseWitnessOrientation,
      addVerifiedGap,
      dedupeGeometry,
      routeDistanceM
    }
  };
})();
