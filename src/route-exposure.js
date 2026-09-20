/*
 * Haidian Soundscape — Route Exposure Foundation v8.9.0-dev1
 *
 * Capabilities:
 * - hand-drawn fixed-route shade exposure analysis;
 * - time-dependent shade evaluation at each segment traversal time;
 * - nearby realtime heat-risk context for near-now departures;
 * - experimental A→B "最不曬" selection among routing-provider alternatives.
 *
 * Important: this is candidate-route scoring, not full-network shade-optimal routing.
 */
(function () {
  "use strict";

  const DEFAULTS = {
    sampleSpacingM: 10,
    walkingSpeedKmh: 4.5,
    shadeConcurrency: 3,
    canopyTimeoutMs: 4200,
    heatNearNowMinutes: 90,
    routingBase: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
    routingTimeoutMs: 15000,
    routingAlternatives: true,
    detourCapPct: 20,
    maxDrawPoints: 80,
    maxRouteSamples: 420,
    autoEnableShade: true,
    fitCandidateRoute: true
  };

  const config = Object.assign({}, DEFAULTS, window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {});
  let map = null;
  let panel = null;
  let button = null;
  let drawLayer = null;
  let resultLayer = null;
  let endpointsLayer = null;
  let drawMode = "idle";
  let drawPoints = [];
  let aPoint = null;
  let bPoint = null;
  let analysisSerial = 0;
  let doubleClickWasEnabled = null;
  let lastAnalysis = null;
  let lastCandidates = [];
  let lastSelectedCandidate = null;

  const icon = {
    route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="18" r="2.2"></circle><circle cx="19" cy="6" r="2.2"></circle><path d="M7.1 17.4c4.7-1 2.1-8.1 6.5-8.7l3.2-.4"></path></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
  };

  function nowLocalInputValue() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
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
    if (!A || !B) return 0;
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const p1 = A.lat * rad;
    const p2 = B.lat * rad;
    const dphi = (B.lat - A.lat) * rad;
    const dlambda = (B.lng - A.lng) * rad;
    const s = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }

  function interpolateLatLng(a, b, fraction) {
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f
    };
  }

  function routeDistanceM(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += haversineM(points[i - 1], points[i]);
    return total;
  }

  function buildSampleSegments(points, spacingM) {
    const source = (points || []).map(asLatLng).filter(Boolean);
    if (source.length < 2) return [];
    const spacing = clamp(spacingM, 4, 30, 10);
    const segments = [];
    let cumulative = 0;
    for (let i = 1; i < source.length; i += 1) {
      const a = source[i - 1];
      const b = source[i];
      const length = haversineM(a, b);
      if (!(length > 0.05)) continue;
      const chunks = Math.max(1, Math.ceil(length / spacing));
      const chunkLength = length / chunks;
      for (let c = 0; c < chunks; c += 1) {
        const f0 = c / chunks;
        const f1 = (c + 1) / chunks;
        const fm = (f0 + f1) / 2;
        segments.push({
          start: interpolateLatLng(a, b, f0),
          end: interpolateLatLng(a, b, f1),
          sample: interpolateLatLng(a, b, fm),
          lengthM: chunkLength,
          cumulativeStartM: cumulative,
          cumulativeMidM: cumulative + chunkLength / 2,
          cumulativeEndM: cumulative + chunkLength
        });
        cumulative += chunkLength;
      }
    }
    return segments;
  }

  async function runPool(items, concurrency, worker, onProgress) {
    const results = new Array(items.length);
    let next = 0;
    let completed = 0;
    const count = Math.max(1, Math.min(items.length || 1, Number(concurrency) || 1));
    async function consume() {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
        completed += 1;
        if (typeof onProgress === "function") onProgress(completed, items.length);
        if (completed % 8 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    await Promise.all(Array.from({ length: count }, consume));
    return results;
  }

  function departureDateFromPanel() {
    const value = panel?.querySelector("[data-re-departure]")?.value;
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function speedMpsFromPanel() {
    const kmh = clamp(panel?.querySelector("[data-re-speed]")?.value, 1.5, 8, config.walkingSpeedKmh);
    return kmh / 3.6;
  }

  function spacingFromPanel() {
    return clamp(panel?.querySelector("[data-re-spacing]")?.value, 5, 25, config.sampleSpacingM);
  }

  function detourCapFromPanel() {
    return clamp(panel?.querySelector("[data-re-detour]")?.value, 0, 60, config.detourCapPct);
  }

  function setStatus(message, tone = "") {
    const el = panel?.querySelector("[data-re-status]");
    if (!el) return;
    el.textContent = message || "";
    el.dataset.tone = tone;
  }

  function setBusy(busy) {
    if (!panel) return;
    panel.classList.toggle("is-busy", !!busy);
    panel.querySelectorAll("button, input").forEach((el) => {
      if (el.matches("[data-re-close]")) return;
      if (el.matches("[data-re-cancel]")) return;
      el.disabled = !!busy;
    });
  }

  function routeMidpoint(points) {
    const segments = buildSampleSegments(points, 30);
    if (!segments.length) return points[0] || null;
    const total = segments[segments.length - 1].cumulativeEndM;
    const target = total / 2;
    return (segments.find((s) => s.cumulativeEndM >= target) || segments[segments.length - 1]).sample;
  }

  function aggregateExposure(segmentResults, speedMps) {
    const summary = {
      totalDistanceM: 0,
      daylightDistanceM: 0,
      shadedDistanceM: 0,
      directSunDistanceM: 0,
      nightDistanceM: 0,
      shadedSeconds: 0,
      directSunSeconds: 0,
      nightSeconds: 0,
      longestSunM: 0,
      longestShadeM: 0,
      sourceDistanceM: { building: 0, tree: 0, mixed: 0, unknown: 0 },
      partialDistanceM: 0
    };
    let currentSun = 0;
    let currentShade = 0;
    for (const item of segmentResults) {
      const len = item.segment.lengthM;
      const sec = len / speedMps;
      summary.totalDistanceM += len;
      const model = item.model || {};
      if (model.state === "night") {
        summary.nightDistanceM += len;
        summary.nightSeconds += sec;
        currentSun = 0;
        currentShade = 0;
        continue;
      }
      summary.daylightDistanceM += len;
      if (model.shaded === true) {
        summary.shadedDistanceM += len;
        summary.shadedSeconds += sec;
        currentShade += len;
        currentSun = 0;
        summary.longestShadeM = Math.max(summary.longestShadeM, currentShade);
        const key = ["building", "tree", "mixed"].includes(model.sourceType) ? model.sourceType : "unknown";
        summary.sourceDistanceM[key] += len;
      } else {
        summary.directSunDistanceM += len;
        summary.directSunSeconds += sec;
        currentSun += len;
        currentShade = 0;
        summary.longestSunM = Math.max(summary.longestSunM, currentSun);
      }
      if (model.reliability === "partial") summary.partialDistanceM += len;
    }
    summary.shadeRatio = summary.daylightDistanceM > 0 ? summary.shadedDistanceM / summary.daylightDistanceM : null;
    summary.sunRatio = summary.daylightDistanceM > 0 ? summary.directSunDistanceM / summary.daylightDistanceM : null;
    summary.walkSeconds = summary.totalDistanceM / speedMps;
    return summary;
  }

  async function ensureShadeReady() {
    if (!window.HaidianShade || typeof window.HaidianShade.analyzeShadeModelAt !== "function") {
      throw new Error("找不到 v8.9.0 的路線陰影分析介面。請確認 shademap-integration.js 已先載入。");
    }
    if (config.autoEnableShade !== false && window.HaidianShade.state && !window.HaidianShade.state.enabled) {
      try { await Promise.resolve(window.HaidianShade.enable()); } catch (_) {}
    }
  }

  async function maybeHeatContext(points, departure, serial) {
    const api = window.HaidianHeatRisk;
    if (!api || typeof api.assessPoint !== "function") return null;
    const nearNowMinutes = Math.abs(departure.getTime() - Date.now()) / 60000;
    if (nearNowMinutes > Number(config.heatNearNowMinutes || 90)) {
      return { available: false, reason: "departure-not-near-now" };
    }
    const point = routeMidpoint(points);
    if (!point) return null;
    try {
      const payload = await api.assessPoint(point.lat, point.lng, { timeoutMs: 10000 });
      if (serial !== analysisSerial) return null;
      return { available: true, point, payload };
    } catch (error) {
      return { available: false, reason: error?.message || "heat-risk-unavailable" };
    }
  }

  async function analyzeRoute(points, options = {}) {
    await ensureShadeReady();
    const route = (points || []).map(asLatLng).filter(Boolean);
    if (route.length < 2) throw new Error("路線至少需要兩個點。");
    const spacingM = clamp(options.sampleSpacingM, 5, 25, spacingFromPanel());
    const speedMps = clamp(options.speedMps, 0.5, 2.5, speedMpsFromPanel());
    const departure = options.departure instanceof Date ? new Date(options.departure.getTime()) : new Date(options.departure || departureDateFromPanel());
    if (Number.isNaN(departure.getTime())) throw new Error("出發時間不正確。");
    const segments = buildSampleSegments(route, spacingM);
    if (!segments.length) throw new Error("路線長度不足。");
    if (segments.length > Number(config.maxRouteSamples || 420)) {
      throw new Error(`此路線需要 ${segments.length} 個採樣段，超過目前安全上限 ${config.maxRouteSamples}。請提高採樣間距或縮短路線。`);
    }
    const serial = options.serial ?? analysisSerial;
    const results = await runPool(
      segments,
      clamp(options.concurrency, 1, 6, config.shadeConcurrency),
      async (segment) => {
        if (serial !== analysisSerial) throw new Error("ROUTE_ANALYSIS_CANCELLED");
        const at = new Date(departure.getTime() + (segment.cumulativeMidM / speedMps) * 1000);
        const model = await window.HaidianShade.analyzeShadeModelAt(
          segment.sample.lat,
          segment.sample.lng,
          at,
          { canopyTimeoutMs: config.canopyTimeoutMs }
        );
        if (serial !== analysisSerial) throw new Error("ROUTE_ANALYSIS_CANCELLED");
        return { segment, at, model };
      },
      options.onProgress
    );
    const summary = aggregateExposure(results, speedMps);
    const heat = options.includeHeat === false ? null : await maybeHeatContext(route, departure, serial);
    return {
      version: "v8.9.0-dev1",
      route,
      departure: departure.toISOString(),
      sampleSpacingM: spacingM,
      walkingSpeedMps: speedMps,
      walkingSpeedKmh: speedMps * 3.6,
      segments: results,
      summary,
      heat,
      diagnostics: typeof window.HaidianShade.getRouteDiagnostics === "function"
        ? window.HaidianShade.getRouteDiagnostics()
        : null
    };
  }

  function createLayerGroup() {
    return window.L.layerGroup().addTo(map);
  }

  function clearLayer(layer) {
    if (!layer) return;
    try { layer.clearLayers(); } catch (_) {}
  }

  function drawEditableRoute() {
    if (!drawLayer) drawLayer = createLayerGroup();
    clearLayer(drawLayer);
    if (drawPoints.length >= 2) {
      window.L.polyline(drawPoints, { color: "#475569", weight: 5, opacity: 0.86, dashArray: "8 7" }).addTo(drawLayer);
    }
    drawPoints.forEach((p, i) => {
      window.L.circleMarker(p, {
        radius: i === 0 || i === drawPoints.length - 1 ? 6 : 4,
        weight: 2,
        color: "#334155",
        fillColor: "#ffffff",
        fillOpacity: 0.98,
        interactive: false
      }).addTo(drawLayer);
    });
  }

  function stateColor(model) {
    if (model?.state === "night") return "#64748b";
    if (model?.shaded === true) return "#059669";
    return "#f97316";
  }

  function renderAnalyzedRoute(analysis, options = {}) {
    if (!resultLayer) resultLayer = createLayerGroup();
    clearLayer(resultLayer);
    for (const item of analysis.segments || []) {
      window.L.polyline([item.segment.start, item.segment.end], {
        color: stateColor(item.model),
        weight: options.weight || 6,
        opacity: 0.92,
        interactive: false
      }).addTo(resultLayer);
    }
    if (options.fit !== false) {
      const latlngs = analysis.route.map((p) => [p.lat, p.lng]);
      if (latlngs.length > 1) map.fitBounds(window.L.latLngBounds(latlngs), { padding: [28, 28], maxZoom: 18 });
    }
  }

  function formatDistance(m) {
    if (!Number.isFinite(m)) return "—";
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
  }

  function formatMinutes(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    return `${(seconds / 60).toFixed(seconds < 600 ? 1 : 0)} 分`;
  }

  function resultHtml(analysis) {
    const s = analysis.summary;
    const shade = s.shadeRatio == null ? "—" : `${Math.round(s.shadeRatio * 100)}%`;
    const sun = s.sunRatio == null ? "—" : `${Math.round(s.sunRatio * 100)}%`;
    const heatPayload = analysis.heat?.available ? analysis.heat.payload : null;
    const hi = heatPayload?.assessment?.heatIndexC;
    const temp = heatPayload?.assessment?.temperatureC;
    const rh = heatPayload?.assessment?.relativeHumidity;
    const heatBlock = heatPayload
      ? `<div class="re-heat"><b>即時熱風險背景</b><span>熱指數 ${Number.isFinite(Number(hi)) ? Number(hi).toFixed(1) + "°C" : "—"}・氣溫 ${Number.isFinite(Number(temp)) ? Number(temp).toFixed(1) + "°C" : "—"}・濕度 ${Number.isFinite(Number(rh)) ? Math.round(Number(rh)) + "%" : "—"}</span><small>僅作目前附近溫濕度基準；沒有把日照虛構成額外幾°C。</small></div>`
      : "";
    const partialPct = s.daylightDistanceM > 0 ? (s.partialDistanceM / s.daylightDistanceM) * 100 : 0;
    return `
      <div class="re-summary-grid">
        <div><span>路線距離</span><b>${formatDistance(s.totalDistanceM)}</b></div>
        <div><span>估計步行</span><b>${formatMinutes(s.walkSeconds)}</b></div>
        <div><span>遮蔭比例</span><b>${shade}</b></div>
        <div><span>直接日照</span><b>${sun}</b></div>
        <div><span>日照時間</span><b>${formatMinutes(s.directSunSeconds)}</b></div>
        <div><span>遮蔭時間</span><b>${formatMinutes(s.shadedSeconds)}</b></div>
      </div>
      <div class="re-detail">最長連續日照 ${formatDistance(s.longestSunM)}・最長連續遮蔭 ${formatDistance(s.longestShadeM)}</div>
      ${s.nightSeconds > 0 ? `<div class="re-note">夜間 ${formatMinutes(s.nightSeconds)} 已獨立計算，不會灌進遮蔭百分比。</div>` : ""}
      ${partialPct > 1 ? `<div class="re-warn">約 ${Math.round(partialPct)}% 日間路段屬部分可靠度（多半是建築快取未就緒或低太陽高度）。</div>` : ""}
      ${heatBlock}
    `;
  }

  function updateResults(analysis) {
    const el = panel?.querySelector("[data-re-results]");
    if (!el) return;
    el.innerHTML = resultHtml(analysis);
  }

  function routeToGeoJsonCoords(points) {
    return points.map((p) => [Number(p.lng), Number(p.lat)]);
  }

  async function fetchRouteCandidates(a, b) {
    const A = asLatLng(a);
    const B = asLatLng(b);
    if (!A || !B) throw new Error("起終點不完整。");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), Number(config.routingTimeoutMs || 15000));
    try {
      const coords = `${A.lng.toFixed(6)},${A.lat.toFixed(6)};${B.lng.toFixed(6)},${B.lat.toFixed(6)}`;
      const base = String(config.routingBase || "").replace(/\/$/, "");
      const url = new URL(`${base}/${coords}`);
      url.searchParams.set("alternatives", config.routingAlternatives === false ? "false" : "true");
      url.searchParams.set("steps", "false");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("overview", "full");
      const response = await fetch(url.href, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.code !== "Ok" || !Array.isArray(payload?.routes) || !payload.routes.length) {
        throw new Error(payload?.message || `步行路線服務暫時無法使用（HTTP ${response.status}）`);
      }
      return payload.routes.map((route, index) => ({
        id: `candidate-${index + 1}`,
        providerIndex: index,
        distanceM: Number(route.distance) || 0,
        durationS: Number(route.duration) || 0,
        points: (route.geometry?.coordinates || []).map((c) => ({ lat: Number(c[1]), lng: Number(c[0]) })).filter(asLatLng),
        raw: route
      })).filter((route) => route.points.length >= 2);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("步行路線服務查詢逾時。");
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function candidateWithinDetour(candidate, fastest, detourPct) {
    const limit = 1 + Math.max(0, detourPct) / 100;
    const baseDuration = fastest.durationS > 0 ? fastest.durationS : null;
    const baseDistance = fastest.distanceM > 0 ? fastest.distanceM : null;
    if (baseDuration && candidate.durationS > 0) return candidate.durationS <= baseDuration * limit + 1;
    if (baseDistance) return candidate.distanceM <= baseDistance * limit + 1;
    return true;
  }

  async function scoreCandidates(candidates, options = {}) {
    if (!Array.isArray(candidates) || !candidates.length) throw new Error("沒有候選路線。");
    const serial = options.serial ?? analysisSerial;
    const fastest = candidates.reduce((best, c) => !best || (c.durationS || Infinity) < (best.durationS || Infinity) ? c : best, null);
    const detourPct = clamp(options.detourPct, 0, 60, detourCapFromPanel());
    const eligible = candidates.filter((c) => candidateWithinDetour(c, fastest, detourPct));
    const scored = [];
    for (let i = 0; i < eligible.length; i += 1) {
      if (serial !== analysisSerial) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      setStatus(`正在評分候選路線 ${i + 1}/${eligible.length}…`, "loading");
      const analysis = await analyzeRoute(eligible[i].points, {
        departure: options.departure,
        sampleSpacingM: options.sampleSpacingM,
        speedMps: options.speedMps,
        serial,
        includeHeat: false,
        onProgress: (done, total) => setStatus(`候選 ${i + 1}/${eligible.length}：陰影採樣 ${done}/${total}`, "loading")
      });
      scored.push(Object.assign({}, eligible[i], { analysis }));
    }
    const selected = scored.slice().sort((a, b) => {
      const sunA = a.analysis.summary.directSunSeconds;
      const sunB = b.analysis.summary.directSunSeconds;
      if (Math.abs(sunA - sunB) > 0.5) return sunA - sunB;
      const walkA = a.analysis.summary.walkSeconds;
      const walkB = b.analysis.summary.walkSeconds;
      return walkA - walkB;
    })[0] || null;
    if (selected && serial === analysisSerial) {
      const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || departureDateFromPanel());
      selected.analysis.heat = await maybeHeatContext(selected.points, departure, serial);
    }
    return { fastest, eligible, scored, selected, detourPct };
  }

  function candidatesHtml(bundle) {
    const selectedId = bundle.selected?.id;
    const rows = bundle.scored.map((c, i) => {
      const s = c.analysis.summary;
      const detour = bundle.fastest?.durationS > 0 ? ((c.durationS / bundle.fastest.durationS) - 1) * 100 : 0;
      return `<div class="re-candidate${c.id === selectedId ? " is-selected" : ""}"><b>${c.id === selectedId ? "最不曬" : `候選 ${i + 1}`}</b><span>${formatDistance(s.totalDistanceM)}・${formatMinutes(s.walkSeconds)}・日照 ${formatMinutes(s.directSunSeconds)}・遮蔭 ${s.shadeRatio == null ? "—" : Math.round(s.shadeRatio * 100) + "%"}</span><small>${detour > 0.5 ? `相對最快約 +${Math.round(detour)}%` : "接近最快路線"}</small></div>`;
    }).join("");
    return `<div class="re-candidates"><div class="re-candidate-head">候選路線比較（繞路上限 ${Math.round(bundle.detourPct)}%）</div>${rows}<div class="re-note">「最不曬」只代表目前 routing provider 提供的候選路線中，直接日照時間最少者；尚非全道路網路的全域最佳解。</div></div>`;
  }

  function renderCandidateBundle(bundle) {
    const el = panel?.querySelector("[data-re-results]");
    if (!el || !bundle.selected) return;
    el.innerHTML = resultHtml(bundle.selected.analysis) + candidatesHtml(bundle);
    renderAnalyzedRoute(bundle.selected.analysis, { fit: config.fitCandidateRoute !== false, weight: 7 });
  }

  function setEndpointMarker(point, label, color) {
    if (!endpointsLayer) endpointsLayer = createLayerGroup();
    window.L.circleMarker(point, {
      radius: 9,
      weight: 3,
      color,
      fillColor: "#fff",
      fillOpacity: 1
    }).bindTooltip(label, { permanent: true, direction: "top", offset: [0, -8] }).addTo(endpointsLayer);
  }

  function stopDrawMode() {
    drawMode = "idle";
    map.getContainer().classList.remove("route-exposure-drawing");
    if (doubleClickWasEnabled === true && map.doubleClickZoom && !map.doubleClickZoom.enabled()) map.doubleClickZoom.enable();
    doubleClickWasEnabled = null;
  }

  function startDrawMode() {
    analysisSerial += 1;
    clearAll(false);
    drawMode = "route";
    drawPoints = [];
    map.getContainer().classList.add("route-exposure-drawing");
    if (map.doubleClickZoom) {
      doubleClickWasEnabled = map.doubleClickZoom.enabled();
      if (doubleClickWasEnabled) map.doubleClickZoom.disable();
    }
    setStatus("手繪模式：依序點選路線節點；完成後按「分析手繪路線」。", "drawing");
  }

  function startABMode() {
    analysisSerial += 1;
    clearAll(false);
    drawMode = "a";
    aPoint = null;
    bPoint = null;
    if (!endpointsLayer) endpointsLayer = createLayerGroup();
    clearLayer(endpointsLayer);
    map.getContainer().classList.add("route-exposure-drawing");
    setStatus("請先在地圖點選 A 起點。", "drawing");
  }

  function clearAll(clearStatus = true) {
    analysisSerial += 1;
    stopDrawMode();
    drawPoints = [];
    aPoint = null;
    bPoint = null;
    lastAnalysis = null;
    lastCandidates = [];
    lastSelectedCandidate = null;
    clearLayer(drawLayer);
    clearLayer(resultLayer);
    clearLayer(endpointsLayer);
    const results = panel?.querySelector("[data-re-results]");
    if (results) results.innerHTML = "";
    if (clearStatus) setStatus("已清除路線。", "");
  }

  async function analyzeDrawnRoute() {
    if (drawPoints.length < 2) {
      setStatus("請至少點兩個路線節點。", "error");
      return;
    }
    stopDrawMode();
    analysisSerial += 1;
    const serial = analysisSerial;
    setBusy(true);
    try {
      setStatus("正在分析路線陰影…", "loading");
      const analysis = await analyzeRoute(drawPoints, {
        serial,
        departure: departureDateFromPanel(),
        sampleSpacingM: spacingFromPanel(),
        speedMps: speedMpsFromPanel(),
        onProgress: (done, total) => setStatus(`正在分析路線陰影 ${done}/${total}…`, "loading")
      });
      if (serial !== analysisSerial) return;
      lastAnalysis = analysis;
      renderAnalyzedRoute(analysis, { fit: false });
      updateResults(analysis);
      setStatus("路線分析完成。綠色＝遮蔭、橘色＝直接日照、灰色＝夜間。", "ok");
    } catch (error) {
      if (error?.message !== "ROUTE_ANALYSIS_CANCELLED") setStatus(error?.message || "路線分析失敗。", "error");
    } finally {
      if (serial === analysisSerial) setBusy(false);
    }
  }

  async function analyzeAB() {
    if (!aPoint || !bPoint) {
      setStatus("請先在地圖選好 A 與 B。", "error");
      return;
    }
    stopDrawMode();
    analysisSerial += 1;
    const serial = analysisSerial;
    setBusy(true);
    try {
      setStatus("正在取得步行候選路線…", "loading");
      const candidates = await fetchRouteCandidates(aPoint, bPoint);
      if (serial !== analysisSerial) return;
      lastCandidates = candidates;
      const bundle = await scoreCandidates(candidates, {
        serial,
        departure: departureDateFromPanel(),
        sampleSpacingM: spacingFromPanel(),
        speedMps: speedMpsFromPanel(),
        detourPct: detourCapFromPanel()
      });
      if (serial !== analysisSerial) return;
      lastSelectedCandidate = bundle.selected;
      lastAnalysis = bundle.selected?.analysis || null;
      renderCandidateBundle(bundle);
      setStatus(`完成：在 ${bundle.scored.length} 條符合繞路限制的候選中選出「最不曬」。`, "ok");
    } catch (error) {
      if (error?.message !== "ROUTE_ANALYSIS_CANCELLED") setStatus(error?.message || "A→B 路線分析失敗。", "error");
    } finally {
      if (serial === analysisSerial) setBusy(false);
    }
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportJson() {
    if (!lastAnalysis) return setStatus("目前沒有可匯出的分析結果。", "error");
    const clean = Object.assign({}, lastAnalysis, {
      segments: lastAnalysis.segments.map((item) => ({
        at: item.at.toISOString ? item.at.toISOString() : String(item.at),
        segment: item.segment,
        model: item.model
      }))
    });
    downloadBlob("haidian-route-exposure-v8.9.0-dev1.json", JSON.stringify(clean, null, 2), "application/json;charset=utf-8");
  }

  function exportCsv() {
    if (!lastAnalysis) return setStatus("目前沒有可匯出的分析結果。", "error");
    const rows = [["timestamp", "lat", "lng", "segment_m", "state", "shaded", "source", "reliability", "solar_altitude_deg"]];
    for (const item of lastAnalysis.segments) {
      rows.push([
        item.at.toISOString ? item.at.toISOString() : String(item.at),
        item.segment.sample.lat.toFixed(6),
        item.segment.sample.lng.toFixed(6),
        item.segment.lengthM.toFixed(2),
        item.model.state,
        item.model.shaded == null ? "" : String(item.model.shaded),
        item.model.sourceType || "",
        item.model.reliability || "",
        Number.isFinite(item.model.solar?.altitudeDeg) ? item.model.solar.altitudeDeg.toFixed(2) : ""
      ]);
    }
    downloadBlob("haidian-route-exposure-v8.9.0-dev1.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

  function addStyles() {
    if (document.getElementById("haidian-route-exposure-styles")) return;
    const style = document.createElement("style");
    style.id = "haidian-route-exposure-styles";
    style.textContent = `
      #rightToolsWrapper .route-exposure-tool{pointer-events:auto;position:relative;width:48px;height:48px;min-width:48px;min-height:48px;display:grid;place-items:center;margin:0 0 12px;padding:0;color:#047857;background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,.5));backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border:1px solid var(--glass-border);border-radius:16px;box-shadow:var(--glass-shadow);cursor:pointer;transition:.2s ease}
      #rightToolsWrapper .route-exposure-tool:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(15,23,42,.2)}
      #rightToolsWrapper .route-exposure-tool.is-on{color:#fff;background:linear-gradient(145deg,#10b981,#047857);border-color:#047857}
      #rightToolsWrapper .route-exposure-tool svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
      /* Host index integration: keep the real route button clickable in the v4 state manager. */
      body.haidian-v4 #rightToolsWrapper > .route-exposure-tool,
      body.haidian-v4-mode-idle #rightToolsWrapper > .route-exposure-tool,
      body.haidian-v4-mode-walk #rightToolsWrapper > .route-exposure-tool,
      body.haidian-v4-mode-data #rightToolsWrapper > .route-exposure-tool{pointer-events:auto!important}
      @media(min-width:601px){
        #rightToolsWrapper > .route-exposure-tool{order:3!important;width:52px!important;min-width:52px!important;height:52px!important;min-height:52px!important;margin:0!important;flex:0 0 52px!important;align-self:flex-end!important;z-index:4504!important}
        #rightToolsWrapper > .tools-toggle-btn[onclick*="toggleRightToolsPanel"]{order:4!important}
        #rightToolsWrapper > .tools-menu-container{order:5!important}
        #rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden) > button.route-exposure-tool{order:3!important;position:relative!important;inset:auto!important;width:32px!important;min-width:32px!important;height:32px!important;min-height:32px!important;margin:0!important;padding:0!important;flex:0 0 32px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;color:#12333b!important;background:rgba(255,255,255,.98)!important;border:1px solid #b7d8d4!important;border-radius:10px!important;box-shadow:0 5px 14px rgba(13,47,53,.14)!important;pointer-events:auto!important;transform:none!important;z-index:4516!important}
        #rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden) > .tools-toggle-btn[onclick*="toggleRightToolsPanel"]{order:4!important}
        #rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden) > #rightToolsCompactClose{order:5!important}
        #rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden) > .tools-menu-container{order:6!important}
        #rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden) > button.route-exposure-tool svg{width:16px!important;height:16px!important;max-width:16px!important;max-height:16px!important;pointer-events:none!important}
      }
      @media(max-width:600px){#rightToolsWrapper > .route-exposure-tool{width:50px!important;min-width:50px!important;height:50px!important;min-height:50px!important;margin-bottom:8px!important}}
      .route-exposure-drawing{cursor:crosshair!important}
      .re-panel{position:fixed;z-index:10050;top:76px;right:78px;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 96px);overflow:auto;padding:0;color:#17323b;background:rgba(255,255,255,.97);border:1px solid rgba(15,118,110,.22);border-radius:20px;box-shadow:0 24px 60px rgba(15,23,42,.24);font-family:"Helvetica Neue",Arial,"Microsoft JhengHei",sans-serif;display:none}
      .re-panel.is-open{display:block}.re-panel *{box-sizing:border-box}
      .re-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:16px 16px 12px;border-bottom:1px solid #dbe7e5;background:linear-gradient(145deg,#f0fdfa,#ecfeff)}
      .re-head small{display:block;color:#0f766e;font-weight:900;letter-spacing:.05em}.re-head h2{margin:3px 0 0;font-size:18px}.re-close{width:34px;height:34px;border:0;border-radius:50%;background:transparent;display:grid;place-items:center;cursor:pointer}.re-close svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2}
      .re-body{padding:14px 16px 16px}.re-controls{display:grid;grid-template-columns:1fr 1fr;gap:10px}.re-field{display:grid;gap:4px}.re-field.wide{grid-column:1/-1}.re-field label{font-size:10.5px;font-weight:900;color:#48636b}.re-field input{width:100%;min-height:38px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font:700 12px/1.2 inherit;color:#17323b}
      .re-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.re-actions button,.re-export button{min-height:40px;padding:8px 10px;border:1px solid #99c7c1;border-radius:11px;background:#fff;color:#0f766e;font-weight:900;cursor:pointer}.re-actions button.primary{color:#fff;background:#0f766e;border-color:#0f766e}.re-actions button.danger{color:#9f1239;border-color:#fecdd3;background:#fff1f2}.re-panel.is-busy button:disabled,.re-panel.is-busy input:disabled{opacity:.6;cursor:not-allowed}
      .re-status{margin:12px 0 0;padding:9px 10px;border-radius:10px;background:#f8fafc;color:#64748b;font-size:11px;font-weight:750;line-height:1.45}.re-status[data-tone="error"]{background:#fff1f2;color:#be123c}.re-status[data-tone="ok"]{background:#ecfdf5;color:#047857}.re-status[data-tone="loading"]{background:#eff6ff;color:#1d4ed8}.re-status[data-tone="drawing"]{background:#fffbeb;color:#a16207}
      .re-results{margin-top:12px}.re-summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.re-summary-grid>div{padding:9px 7px;border:1px solid #e2e8f0;border-radius:11px;background:#fff}.re-summary-grid span{display:block;color:#64748b;font-size:9.5px;font-weight:800}.re-summary-grid b{display:block;margin-top:3px;color:#0f3d46;font-size:14px}.re-detail,.re-note,.re-warn,.re-heat{margin-top:9px;padding:9px 10px;border-radius:10px;font-size:10.5px;line-height:1.45;font-weight:700}.re-detail{background:#f8fafc;color:#475569}.re-note{background:#f1f5f9;color:#475569}.re-warn{background:#fff7ed;color:#9a3412}.re-heat{display:grid;gap:3px;background:#fff7ed;color:#9a3412}.re-heat small{color:#7c5a45}
      .re-candidates{margin-top:10px}.re-candidate-head{font-size:11px;font-weight:900;color:#334155;margin-bottom:6px}.re-candidate{display:grid;gap:2px;padding:9px 10px;margin-top:6px;border:1px solid #e2e8f0;border-radius:10px;background:#fff}.re-candidate.is-selected{border-color:#34d399;background:#ecfdf5}.re-candidate b{font-size:11px;color:#0f766e}.re-candidate span,.re-candidate small{font-size:10px;color:#475569}.re-export{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
      @media(max-width:700px){.re-panel{top:auto;right:8px;left:8px;bottom:8px;width:auto;max-height:72vh;border-radius:18px}.re-head{padding:13px 14px 10px}.re-body{padding:12px 14px 14px}.re-summary-grid{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    if (document.querySelector(".re-panel")) return document.querySelector(".re-panel");
    const node = document.createElement("section");
    node.className = "re-panel";
    node.setAttribute("aria-label", "路線曝曬分析");
    node.innerHTML = `
      <header class="re-head"><div><small>v8.9.0-dev1・Route Exposure</small><h2>路線曝曬分析</h2></div><button type="button" class="re-close" data-re-close aria-label="關閉">${icon.close}</button></header>
      <div class="re-body">
        <div class="re-controls">
          <div class="re-field wide"><label>出發日期與時間</label><input data-re-departure type="datetime-local" value="${nowLocalInputValue()}"></div>
          <div class="re-field"><label>步行速度 km/h</label><input data-re-speed type="number" min="1.5" max="8" step="0.1" value="${config.walkingSpeedKmh}"></div>
          <div class="re-field"><label>採樣間距 m</label><input data-re-spacing type="number" min="5" max="25" step="1" value="${config.sampleSpacingM}"></div>
          <div class="re-field wide"><label>A→B 最不曬：最大繞路 %</label><input data-re-detour type="number" min="0" max="60" step="5" value="${config.detourCapPct}"></div>
        </div>
        <div class="re-actions">
          <button type="button" data-re-draw>手繪路線</button>
          <button type="button" class="primary" data-re-analyze-draw>分析手繪路線</button>
          <button type="button" data-re-ab>設定 A → B</button>
          <button type="button" class="primary" data-re-analyze-ab>找「最不曬」</button>
          <button type="button" class="danger" data-re-clear>清除</button>
          <button type="button" data-re-cancel>取消運算</button>
        </div>
        <div class="re-status" data-re-status>可先手繪固定路線，或設定 A、B 比較步行候選路線。</div>
        <div class="re-results" data-re-results></div>
        <div class="re-export"><button type="button" data-re-json>匯出 JSON</button><button type="button" data-re-csv>匯出 CSV</button></div>
      </div>`;
    document.body.appendChild(node);
    node.querySelector("[data-re-close]").addEventListener("click", () => togglePanel(false));
    node.querySelector("[data-re-draw]").addEventListener("click", startDrawMode);
    node.querySelector("[data-re-analyze-draw]").addEventListener("click", () => void analyzeDrawnRoute());
    node.querySelector("[data-re-ab]").addEventListener("click", startABMode);
    node.querySelector("[data-re-analyze-ab]").addEventListener("click", () => void analyzeAB());
    node.querySelector("[data-re-clear]").addEventListener("click", () => clearAll(true));
    node.querySelector("[data-re-cancel]").addEventListener("click", () => { analysisSerial += 1; setBusy(false); setStatus("已取消目前運算。", ""); });
    node.querySelector("[data-re-json]").addEventListener("click", exportJson);
    node.querySelector("[data-re-csv]").addEventListener("click", exportCsv);
    try {
      window.L.DomEvent.disableClickPropagation(node);
      window.L.DomEvent.disableScrollPropagation(node);
    } catch (_) {}
    return node;
  }

  function quietCompetingMapTools() {
    try {
      const heatButton = document.querySelector("#rightToolsWrapper .heat-risk-tool.is-on");
      if (heatButton) heatButton.click();
    } catch (_) {}
    try {
      if (map?.pm && typeof map.pm.disableDraw === "function") map.pm.disableDraw();
    } catch (_) {}
    try {
      if (typeof window.exitDrawMode === "function") window.exitDrawMode();
    } catch (_) {}
    try {
      if (typeof window.haidianV4CloseAll === "function") window.haidianV4CloseAll(true);
    } catch (_) {}
    try {
      if (map && typeof map.closePopup === "function") map.closePopup();
    } catch (_) {}
  }

  function togglePanel(open) {
    if (!panel) panel = createPanel();
    const next = open == null ? !panel.classList.contains("is-open") : !!open;
    if (next) quietCompetingMapTools();
    panel.classList.toggle("is-open", next);
    if (button) {
      button.classList.toggle("is-on", next);
      button.setAttribute("aria-pressed", String(next));
    }
    if (!next) stopDrawMode();
  }

  function addButton() {
    const wrapper = document.getElementById("rightToolsWrapper");
    if (!wrapper) return false;
    if (wrapper.querySelector(".route-exposure-tool")) {
      button = wrapper.querySelector(".route-exposure-tool");
      return true;
    }
    button = document.createElement("button");
    button.type = "button";
    button.className = "route-exposure-tool";
    button.title = "路線曝曬分析 / 最不曬路線";
    button.setAttribute("aria-label", "開啟路線曝曬分析");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = icon.route;
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); togglePanel(); });
    const menu = wrapper.querySelector(".tools-menu-container");
    const layerButton = Array.from(wrapper.querySelectorAll(".tools-toggle-btn")).find((candidate) => {
      const action = candidate.getAttribute("onclick") || "";
      const title = candidate.getAttribute("title") || "";
      const label = candidate.getAttribute("aria-label") || "";
      return action.includes("toggleRightToolsPanel") || /圖層|圖資/.test(`${title} ${label}`);
    });
    if (layerButton && layerButton.parentElement === wrapper) wrapper.insertBefore(button, layerButton);
    else if (menu) wrapper.insertBefore(button, menu);
    else wrapper.appendChild(button);
    return true;
  }

  function onMapClick(event) {
    if (!event?.latlng) return;
    const point = { lat: Number(event.latlng.lat), lng: Number(event.latlng.lng) };
    if (drawMode === "route") {
      if (drawPoints.length >= Number(config.maxDrawPoints || 80)) {
        setStatus(`手繪節點已達上限 ${config.maxDrawPoints}。`, "error");
        return;
      }
      drawPoints.push(point);
      drawEditableRoute();
      setStatus(`已加入 ${drawPoints.length} 個節點；完成後按「分析手繪路線」。`, "drawing");
      return;
    }
    if (drawMode === "a") {
      aPoint = point;
      if (!endpointsLayer) endpointsLayer = createLayerGroup();
      clearLayer(endpointsLayer);
      setEndpointMarker(aPoint, "A", "#2563eb");
      drawMode = "b";
      setStatus("A 已設定；請點選 B 終點。", "drawing");
      return;
    }
    if (drawMode === "b") {
      bPoint = point;
      setEndpointMarker(bPoint, "B", "#e11d48");
      drawMode = "idle";
      map.getContainer().classList.remove("route-exposure-drawing");
      setStatus("A、B 已設定；按「找『最不曬』」取得並評分候選步行路線。", "drawing");
    }
  }

  function boot() {
    addStyles();
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      map = map || window.map || null;
      if (map && window.L && addButton()) {
        panel = createPanel();
        map.on("click", onMapClick);
        window.clearInterval(timer);
      } else if (attempts > 80) {
        window.clearInterval(timer);
        console.warn("[Haidian Route Exposure] map / rightToolsWrapper not found.");
      }
    }, 400);
  }

  window.HaidianRouteExposure = {
    version: "v8.9.0-dev1",
    get config() { return Object.assign({}, config); },
    analyzeRoute,
    fetchRouteCandidates,
    scoreCandidates,
    open() { togglePanel(true); },
    close() { togglePanel(false); },
    clear() { clearAll(true); },
    get lastAnalysis() { return lastAnalysis; },
    get lastCandidates() { return lastCandidates.slice(); },
    get lastSelectedCandidate() { return lastSelectedCandidate; },
    _internals: {
      buildSampleSegments,
      aggregateExposure,
      routeDistanceM,
      routeToGeoJsonCoords
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
