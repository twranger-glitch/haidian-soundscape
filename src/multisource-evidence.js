/*
 * Haidian Soundscape — Multi-source Pedestrian Network Evidence v9.0.0-dev32
 *
 * Loads preprocessed Overture / NLMA / Tainan evidence, renders optional map
 * overlays, and classifies source-gap junction evidence. This module never
 * mutates the production pedestrian graph. In dev26 verified evidence may expose source-following routable witnesses to the isolated experimental router, while every cross-source junction remains productionAllowed=false by design.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev32";
  const DEFAULTS = {
    enabled: true,
    evidenceIndexUrl: "./data/multisource/evidence-index.json",
    sourceMetadataUrl: "./data/multisource/source-metadata.json",
    productionMutationEnabled: false,
    autoLoad: false
  };
  const globalConfig = window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {};
  const config = Object.assign({}, DEFAULTS, globalConfig.multisource || {});

  const SOURCE_CATALOG = {
    "overture-segments": { label: "Overture segments", source: "overture", kind: "line", color: "#2563eb", weight: 4 },
    "overture-connectors": { label: "Overture connectors", source: "overture", kind: "point", color: "#0ea5e9", radius: 4 },
    "nlma-sidewalk": { label: "國土署人行道", source: "nlma-sidewalk", kind: "line", color: "#7c3aed", weight: 4 },
    "nlma-bikeway": { label: "國土署自行車道", source: "nlma-bikeway", kind: "line", color: "#059669", weight: 5 },
    "tainan-sidewalk": { label: "臺南市人行道", source: "tainan-sidewalk", kind: "line", color: "#db2777", weight: 3 },
    "tainan-bikeway": { label: "臺南市自行車道清冊", source: "tainan-bikeway", kind: "metadata", color: "#d97706" },
    "source-gaps": { label: "source-gap 證據", source: "source-gaps", kind: "gap", color: "#dc2626" }
  };

  const state = {
    status: "idle",
    error: null,
    metadata: null,
    evidenceIndex: null,
    map: null,
    layers: {},
    visible: {},
    geojson: {},
    sourceErrors: {},
    runtimeSourceMeta: {}
  };

  function safeArray(value) { return Array.isArray(value) ? value : []; }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function datasetName(source) {
    return String(source?.dataset || source?.provider || source?.source || "").trim();
  }

  function isOsmProvenance(source) {
    const text = `${datasetName(source)} ${source?.license || ""} ${source?.resource || ""}`.toLowerCase();
    return text.includes("openstreetmap") || text.includes("odbl") || /(^|[^a-z])osm([^a-z]|$)/.test(text);
  }

  function hasIndependentProvenance(provenance) {
    const items = safeArray(provenance);
    return items.some((item) => !isOsmProvenance(item));
  }

  function evaluateJunctionEvidence(candidate, options = {}) {
    const c = candidate || {};
    const gradeConflict = Boolean(c.gradeSeparationConflict || c.gradeSeparationPossible === true);
    const accessConflict = Boolean(c.accessConflict || c.accessCompatible === false);
    const explicitSharedTopology = Boolean(c.explicitSharedTopology || safeArray(c.sharedTopologyEvidence).length);
    const officialContinuousGeometry = Boolean(c.officialContinuousGeometry || safeArray(c.continuousGeometryEvidence).length);
    const provenance = safeArray(c.provenance).concat(
      safeArray(c.sharedTopologyEvidence).flatMap((x) => safeArray(x?.provenance)),
      safeArray(c.continuousGeometryEvidence).flatMap((x) => safeArray(x?.provenance))
    );
    const independent = c.independentProvenance === true || hasIndependentProvenance(provenance);
    const proximityOnly = Boolean(c.proximityOnly || (!explicitSharedTopology && !officialContinuousGeometry && safeArray(c.geometryEvidence).length));
    let decision = "no-evidence";
    let reason = "沒有足以判斷跨來源 junction 的證據。";

    if (gradeConflict || accessConflict) {
      decision = "reject";
      reason = gradeConflict ? "存在 grade/layer 衝突，不能把幾何接近當成同層連通。" : "存在 access 衝突，不能建立行人/自行車 junction。";
    } else if (explicitSharedTopology && independent) {
      decision = "verified";
      reason = "有明確 shared topology，且包含非 OSM 的獨立 provenance。";
    } else if (officialContinuousGeometry && independent) {
      decision = "verified";
      reason = "官方幾何形成實際連續路徑，且 access/grade 無衝突。";
    } else if (explicitSharedTopology) {
      decision = "manual-review";
      reason = "有明確 topology，但 provenance 仍可能只複製 OSM，需人工確認獨立性。";
    } else if (officialContinuousGeometry) {
      decision = "manual-review";
      reason = "幾何看似連續，但缺少足夠獨立 provenance 或明確 topology。";
    } else if (proximityOnly) {
      decision = "manual-review";
      reason = "只有 proximity / geometry-near 證據；dev26 仍禁止以距離自動補橋。";
    }

    return {
      decision,
      reason,
      explicitSharedTopology,
      officialContinuousGeometry,
      independentProvenance: independent,
      gradeSeparationConflict: gradeConflict,
      accessConflict,
      productionAllowed: false,
      productionReason: "dev26 production lock: evidence may be used only by the isolated experimental graph; production mutation remains disabled."
    };
  }

  function normalizeGapDecision(gap) {
    const assessed = evaluateJunctionEvidence(gap || {});
    return Object.assign({}, gap || {}, {
      decision: gap?.decision || assessed.decision,
      decisionReason: gap?.decisionReason || assessed.reason,
      productionAllowed: false,
      productionReason: gap?.productionReason || assessed.productionReason
    });
  }

  async function fetchJson(url, fetchImpl) {
    const impl = fetchImpl || (typeof window.fetch === "function" ? window.fetch.bind(window) : null);
    if (!impl) throw new Error("fetch-unavailable");
    const response = await impl(url, { credentials: "same-origin", cache: "no-store" });
    if (!response || !response.ok) throw new Error(`HTTP ${response?.status || "?"} ${url}`);
    return response.json ? response.json() : JSON.parse(await response.text());
  }

  function sourceRecord(key) {
    return state.metadata?.sources?.[key] || null;
  }

  function sourceStatus(key) {
    if (key === "source-gaps") return state.evidenceIndex ? "ready" : state.status;
    if (state.runtimeSourceMeta[key] && state.geojson[key]) return "ready";
    const record = sourceRecord(key);
    if (!record) return "unbound";
    if (state.sourceErrors[key]) return "error";
    return record.availability || (record.browserPath ? "ready" : "unbound");
  }

  function attachMap(map) {
    state.map = map || null;
    return Boolean(state.map);
  }

  function clearLayer(key) {
    const layer = state.layers[key];
    try { if (layer && state.map?.removeLayer) state.map.removeLayer(layer); } catch (_) {}
    delete state.layers[key];
    state.visible[key] = false;
  }

  function clearOverlays() {
    Object.keys(state.layers).forEach(clearLayer);
  }

  function styleForFeature(key) {
    const info = SOURCE_CATALOG[key] || {};
    return { color: info.color || "#475569", weight: info.weight || 4, opacity: 0.78 };
  }

  function pointToLayer(key, feature, latlng) {
    const info = SOURCE_CATALOG[key] || {};
    if (!window.L?.circleMarker) return null;
    return window.L.circleMarker(latlng, {
      radius: info.radius || 4,
      weight: 1.5,
      color: info.color || "#475569",
      fillColor: "#fff",
      fillOpacity: 0.92
    });
  }

  function featureTooltip(key, feature) {
    const p = feature?.properties || {};
    const info = SOURCE_CATALOG[key] || {};
    const bits = [info.label || key];
    if (p.sourceFeatureId || p.id) bits.push(`id ${p.sourceFeatureId || p.id}`);
    if (p.facilityType) bits.push(p.facilityType);
    if (p.name) bits.push(p.name);
    if (p.officialInventory) bits.push("official inventory");
    return bits.join(" · ");
  }

  function renderGeoJsonLayer(key, geojson) {
    if (!state.map || !window.L?.geoJSON) return { visible: false, reason: "map-unavailable" };
    clearLayer(key);
    const layer = window.L.geoJSON(geojson, {
      style: () => styleForFeature(key),
      pointToLayer: (feature, latlng) => pointToLayer(key, feature, latlng),
      onEachFeature: (feature, leafletLayer) => {
        try { leafletLayer.bindTooltip(featureTooltip(key, feature), { sticky: true }); } catch (_) {}
      }
    }).addTo(state.map);
    state.layers[key] = layer;
    state.visible[key] = true;
    return { visible: true };
  }

  function renderGapLayer() {
    if (!state.map || !window.L?.layerGroup || !window.L?.circleMarker) return { visible: false, reason: "map-unavailable" };
    clearLayer("source-gaps");
    const layer = window.L.layerGroup().addTo(state.map);
    for (const rawGap of safeArray(state.evidenceIndex?.gaps)) {
      const gap = normalizeGapDecision(rawGap);
      const points = safeArray(gap.geometry);
      if (points.length >= 2 && window.L.polyline) {
        window.L.polyline(points.map((p) => [Number(p.lat ?? p[1]), Number(p.lng ?? p.lon ?? p[0])]), {
          color: "#dc2626", weight: 3.5, opacity: 0.92, dashArray: "7 5", interactive: false
        }).addTo(layer);
      }
      const mid = gap.location || (points.length ? points[Math.floor(points.length / 2)] : null);
      if (mid) {
        const lat = Number(mid.lat ?? mid[1]);
        const lng = Number(mid.lng ?? mid.lon ?? mid[0]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          window.L.circleMarker([lat, lng], { radius: 7, weight: 2.5, color: "#dc2626", fillColor: "#fff", fillOpacity: 1 })
            .bindTooltip(`${gap.id || "source-gap"} · ${gap.decision} · productionAllowed=false`, { sticky: true })
            .addTo(layer);
        }
      }
    }
    state.layers["source-gaps"] = layer;
    state.visible["source-gaps"] = true;
    return { visible: true };
  }


  function setRuntimeSourceGeojson(key, geojson, metadata = {}) {
    if (!SOURCE_CATALOG[key] || key === "source-gaps") return { ok: false, reason: "unknown-or-non-geometry-source" };
    if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      return { ok: false, reason: "invalid-feature-collection" };
    }
    state.geojson[key] = geojson;
    state.runtimeSourceMeta[key] = Object.assign({ runtime: true, featureCount: geojson.features.length }, metadata || {});
    delete state.sourceErrors[key];
    if (state.visible[key]) renderGeoJsonLayer(key, geojson);
    return { ok: true, key, featureCount: geojson.features.length };
  }

  function clearRuntimeSourceGeojson(key) {
    if (key) {
      delete state.runtimeSourceMeta[key];
      delete state.geojson[key];
      clearLayer(key);
    } else {
      for (const k of Object.keys(state.runtimeSourceMeta)) { delete state.geojson[k]; clearLayer(k); }
      state.runtimeSourceMeta = {};
    }
  }

  async function loadSourceGeojson(key, options = {}) {
    if (key === "source-gaps") return state.evidenceIndex || null;
    if (state.geojson[key]) return state.geojson[key];
    const record = sourceRecord(key);
    if (!record || record.availability !== "ready" || !record.browserPath) {
      return null;
    }
    try {
      const data = await fetchJson(record.browserPath, options.fetchImpl);
      state.geojson[key] = data;
      delete state.sourceErrors[key];
      return data;
    } catch (error) {
      state.sourceErrors[key] = String(error?.message || error);
      return null;
    }
  }

  async function toggleSourceOverlay(key, options = {}) {
    if (!SOURCE_CATALOG[key]) return { visible: false, reason: "unknown-source" };
    if (state.visible[key]) {
      clearLayer(key);
      return { visible: false };
    }
    if (key === "source-gaps") return renderGapLayer();
    const geojson = await loadSourceGeojson(key, options);
    if (!geojson) return { visible: false, reason: sourceStatus(key), error: state.sourceErrors[key] || null };
    return renderGeoJsonLayer(key, geojson);
  }

  async function loadEvidence(options = {}) {
    if (state.status === "loading") return getState();
    state.status = "loading";
    state.error = null;
    try {
      const [metadata, index] = await Promise.all([
        fetchJson(options.sourceMetadataUrl || config.sourceMetadataUrl, options.fetchImpl),
        fetchJson(options.evidenceIndexUrl || config.evidenceIndexUrl, options.fetchImpl)
      ]);
      state.metadata = metadata || { sources: {} };
      state.evidenceIndex = Object.assign({}, index || {}, {
        gaps: safeArray(index?.gaps).map(normalizeGapDecision)
      });
      state.status = "ready";
      return getState();
    } catch (error) {
      state.status = "error";
      state.error = String(error?.message || error);
      return getState();
    }
  }

  function buildExperimentalFusionPlan(index = state.evidenceIndex) {
    const candidates = safeArray(index?.gaps).map(normalizeGapDecision);
    const verified = candidates.filter((g) => g.decision === "verified");
    return {
      schema: "haidian-experimental-fusion-plan-v1",
      version: VERSION,
      productionGraphMutated: false,
      productionMutationEnabled: false,
      verifiedCandidateCount: verified.length,
      routableWitnessCount: verified.filter((g) => g?.preferredFusionWitness?.independentProvenance && g?.preferredFusionWitness?.pedestrianAllowed === true && safeArray(g?.preferredFusionWitness?.geometry).length >= 2).length,
      connectors: verified.map((g) => {
        const witness = g?.preferredFusionWitness || null;
        return {
          id: `experimental-${g.id || "gap"}`,
          gapId: g.id || null,
          witnessAvailable: Boolean(witness?.independentProvenance && witness?.pedestrianAllowed === true && safeArray(witness?.geometry).length >= 2),
          witnessGeometry: clone(witness?.geometry || []),
          witnessType: witness?.evidenceType || null,
          witnessSource: witness?.source || null,
          pedestrianAllowed: witness?.pedestrianAllowed === true,
          accessBasis: witness?.accessBasis || null,
          evidenceSources: clone(g.evidenceSources || []),
          decision: "verified",
          productionAllowed: false
        };
      }),
      interpretation: verified.length
        ? "Verified junction evidence is available. Only independently sourced, explicitly pedestrian-allowed preferredFusionWitness geometry may enter the isolated dev26 experimental graph; production routing is unchanged."
        : "No verified cross-source junction is available; production and experimental connector insertion both remain empty."
    };
  }

  function getState() {
    const sources = {};
    for (const key of Object.keys(SOURCE_CATALOG)) {
      sources[key] = {
        key,
        label: SOURCE_CATALOG[key].label,
        kind: SOURCE_CATALOG[key].kind,
        status: sourceStatus(key),
        visible: Boolean(state.visible[key]),
        error: state.sourceErrors[key] || null,
        metadata: key === "source-gaps" ? null : clone(sourceRecord(key)),
        runtimeMetadata: clone(state.runtimeSourceMeta[key] || null)
      };
    }
    return {
      version: VERSION,
      status: state.status,
      error: state.error,
      sources,
      metadata: clone(state.metadata),
      evidenceIndex: clone(state.evidenceIndex),
      fusionPlan: buildExperimentalFusionPlan(state.evidenceIndex)
    };
  }

  window.HaidianMultiSourceEvidence = {
    version: VERSION,
    get config() { return Object.assign({}, config); },
    sourceCatalog: clone(SOURCE_CATALOG),
    loadEvidence,
    attachMap,
    toggleSourceOverlay,
    clearOverlays,
    setRuntimeSourceGeojson,
    clearRuntimeSourceGeojson,
    getState,
    buildExperimentalFusionPlan,
    evaluateJunctionEvidence,
    _internals: {
      isOsmProvenance,
      hasIndependentProvenance,
      normalizeGapDecision,
      sourceStatus,
      loadSourceGeojson
    }
  };
})();
