/*
 * Haidian Soundscape — Route Exposure Foundation v9.0.0-dev28 Verified Fused Route Comparison
 *
 * Capabilities:
 * - hand-drawn fixed-route shade exposure analysis;
 * - time-dependent shade evaluation at each segment traversal time;
 * - nearby realtime heat-risk context for near-now departures;
 * - guided two-mode UX plus A→B candidate comparison with optional user-drawn route.
 *
 * Important: v9 uses local OSM pedestrian-graph routing plus final high-precision ShadeMap scoring; provider/manual candidates remain for comparison.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev28";

  const DEFAULTS = {
    sampleSpacingM: 10,
    walkingSpeedKmh: 4.5,
    shadeConcurrency: 3,
    canopyTimeoutMs: 4200,
    heatNearNowMinutes: 90,
    routingBase: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
    routingTimeoutMs: 15000,
    routingAlternatives: true,
    detourCapPct: 30,
    maxDrawPoints: 80,
    maxRouteSamples: 420,
    autoEnableShade: true,
    fitCandidateRoute: true,
    manualRouteSnapToleranceM: 120,
    manualEndpointToleranceM: 120,
    exploreCandidates: false,
    exploreMaxRoutes: 6,
    maxScoredCandidates: 10,
    // dev27: retain the verified-fusion comparison while adding nationwide tiles; automatically compare the detached verified-fusion min-sun route
    // alongside production/provider/manual candidates. This never mutates production.
    autoCompareVerifiedFusion: true,
    fusionFidelityThresholdM: 14,
    fusionFidelitySampleM: 10,
    // dev5 route-quality guard: shaded dead-ends / out-and-back loops never count as a benefit.
    routeQualityEnabled: true,
    routeQualitySampleM: 8,
    routeQualityLoopReturnRadiusM: 5,
    routeQualityMinLoopExcursionM: 70,
    routeQualityRepeatedCorridorRadiusM: 5,
    routeQualityRepeatedCorridorMinSeparationM: 40,
    routeQualityMaxRepeatedCorridorM: 32,
    routeQualityOppositeHeadingDeg: 155
  };

  const config = Object.assign({}, DEFAULTS, window.HAIDIAN_ROUTE_EXPOSURE_CONFIG || {});
  let map = null;
  let panel = null;
  let button = null;
  let drawLayer = null;
  let resultLayer = null;
  let endpointsLayer = null;
  let comparisonLayer = null;
  let graphDebugLayer = null;
  let graphDebugVisible = false;
  let engineCrossCheckLayer = null;
  let engineCrossCheckVisible = false;
  let lastManualGraphDiagnosis = null;
  let drawMode = "idle";
  let drawPoints = [];
  let aPoint = null;
  let bPoint = null;
  let analysisSerial = 0;
  let doubleClickWasEnabled = null;
  let lastAnalysis = null;
  let lastCandidates = [];
  let lastSelectedCandidate = null;
  let lastCandidateBundle = null;
  let uiMode = "home";
  let busy = false;
  let savedDrawnRoute = [];
  let savedDrawnAnalysis = null;
  let mapDragSuppressUntil = 0;
  let lastGraphFailure = null;
  let lastNationwideTileLoad = null;
  let lastNationwideGraphLoad = null;

  const icon = {
    route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="18" r="2.2"></circle><circle cx="19" cy="6" r="2.2"></circle><path d="M7.1 17.4c4.7-1 2.1-8.1 6.5-8.7l3.2-.4"></path></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
  };

  function nowMs() {
    return (typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : Date.now();
  }

  function nowLocalInputValue() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function localInputParts(value) {
    const text = String(value || "");
    const [date = "", time = ""] = text.split("T");
    return { date, time: time.slice(0, 5) };
  }

  function formatDepartureSummary(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "時間未設定";
    return new Intl.DateTimeFormat("zh-TW", {
      month: "numeric", day: "numeric", weekday: "short",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date);
  }

  function setDepartureDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime()) || !panel) return;
    const pad = (n) => String(n).padStart(2, "0");
    const value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const hidden = panel.querySelector("[data-re-departure]");
    const dateInput = panel.querySelector("[data-re-date]");
    const timeInput = panel.querySelector("[data-re-time]");
    const parts = localInputParts(value);
    if (hidden) hidden.value = value;
    if (dateInput) dateInput.value = parts.date;
    if (timeInput) timeInput.value = parts.time;
    syncUiState();
  }

  function syncDepartureFromParts() {
    if (!panel) return;
    const date = panel.querySelector("[data-re-date]")?.value;
    const time = panel.querySelector("[data-re-time]")?.value;
    const hidden = panel.querySelector("[data-re-departure]");
    if (!date || !time || !hidden) return;
    hidden.value = `${date}T${time}`;
    syncUiState();
  }

  function setDeparturePreset(minutesFromNow) {
    const d = new Date(Date.now() + Number(minutesFromNow || 0) * 60000);
    d.setSeconds(0, 0);
    setDepartureDate(d);
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

  function projectPointToSegment(target, a, b, segmentIndex = 0) {
    const P = asLatLng(target);
    const A = asLatLng(a);
    const B = asLatLng(b);
    if (!P || !A || !B) return null;
    const lat0 = ((P.lat + A.lat + B.lat) / 3) * Math.PI / 180;
    const mx = 111320 * Math.max(0.2, Math.cos(lat0));
    const my = 110540;
    const bx = (B.lng - A.lng) * mx;
    const by = (B.lat - A.lat) * my;
    const px = (P.lng - A.lng) * mx;
    const py = (P.lat - A.lat) * my;
    const denom = bx * bx + by * by;
    const t = denom > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by) / denom)) : 0;
    const point = interpolateLatLng(A, B, t);
    return {
      point,
      distanceM: haversineM(P, point),
      segmentIndex,
      t,
      position: segmentIndex + t
    };
  }

  function nearestPointOnRoute(routePoints, target) {
    const route = (routePoints || []).map(asLatLng).filter(Boolean);
    if (route.length < 2) return null;
    let best = null;
    for (let i = 0; i < route.length - 1; i += 1) {
      const hit = projectPointToSegment(target, route[i], route[i + 1], i);
      if (!hit) continue;
      if (!best || hit.distanceM < best.distanceM) best = hit;
    }
    return best;
  }

  function routeSliceBetweenSnaps(routePoints, startSnap, endSnap) {
    const route = (routePoints || []).map(asLatLng).filter(Boolean);
    if (route.length < 2 || !startSnap || !endSnap) return [];
    if (startSnap.position > endSnap.position) return [];
    const points = [startSnap.point];
    for (let i = startSnap.segmentIndex + 1; i <= endSnap.segmentIndex; i += 1) {
      const vertex = route[i];
      if (vertex && haversineM(points[points.length - 1], vertex) > 0.2) points.push(vertex);
    }
    if (haversineM(points[points.length - 1], endSnap.point) > 0.2) points.push(endSnap.point);
    else points[points.length - 1] = endSnap.point;
    return points;
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
    el.hidden = !message;
  }

  function activeWorkflowTitle() {
    return uiMode === "draw" ? "分析我自己的路線" : uiMode === "ab" ? "幫我找「最不曬」" : "路線曝曬分析";
  }

  function captureDrawnRouteIfValid() {
    if (drawPoints.length >= 2) savedDrawnRoute = drawPoints.map((p) => ({ lat: p.lat, lng: p.lng }));
  }

  function renderSavedDrawnReference() {
    if (!map || !window.L) return;
    if (!drawLayer) drawLayer = createLayerGroup();
    clearLayer(drawLayer);
    if (savedDrawnRoute.length < 2) return;
    window.L.polyline(savedDrawnRoute, {
      color: "#e11d48",
      weight: 5,
      opacity: 0.78,
      interactive: false
    }).addTo(drawLayer);
  }

  function setDetourPct(value) {
    const input = panel?.querySelector("[data-re-detour]");
    if (!input) return;
    input.value = String(clamp(value, 0, 60, config.detourCapPct));
    syncUiState();
  }

  function syncUiState() {
    if (!panel) return;
    panel.dataset.mode = uiMode;
    panel.querySelectorAll("[data-re-screen]").forEach((screen) => {
      screen.hidden = screen.dataset.reScreen !== uiMode;
    });
    const workflow = panel.querySelector("[data-re-workflow]");
    if (workflow) workflow.hidden = uiMode === "home";
    const home = panel.querySelector("[data-re-home]");
    if (home) home.hidden = uiMode !== "home";

    const modeTitle = panel.querySelector("[data-re-mode-title]");
    if (modeTitle) modeTitle.textContent = activeWorkflowTitle();
    const modeDesc = panel.querySelector("[data-re-mode-desc]");
    if (modeDesc) modeDesc.textContent = uiMode === "draw"
      ? "我已經知道想走哪一條路，看看沿途會曬多久。"
      : "我只知道起點和終點，讓系統比較可取得的步行候選。";


    const departureValue = panel.querySelector("[data-re-departure]")?.value || nowLocalInputValue();
    const departureSummary = panel.querySelector("[data-re-departure-summary]");
    if (departureSummary) departureSummary.textContent = formatDepartureSummary(departureValue);
    const nextFromTime = panel.querySelector("[data-re-time-next]");
    if (nextFromTime) {
      nextFromTime.textContent = uiMode === "draw" ? "下一步：開始畫路線 →" : "下一步：設定 A → B →";
      nextFromTime.disabled = busy;
    }
    const timeHint = panel.querySelector("[data-re-time-hint]");
    if (timeHint) timeHint.textContent = uiMode === "draw"
      ? "時間選好後按上面的「下一步」，系統會直接進入畫路線模式。"
      : "時間選好後按上面的「下一步」，接著到地圖點 A 起點、B 終點。";

    const drawProgress = panel.querySelector("[data-re-draw-progress]");
    if (drawProgress) {
      if (!drawPoints.length) drawProgress.textContent = "尚未開始畫路線";
      else if (drawPoints.length === 1) drawProgress.textContent = "已放 1 個節點，請至少再點 1 個";
      else drawProgress.textContent = `已放 ${drawPoints.length} 個節點，可繼續加點或直接分析`;
    }
    const drawWarning = panel.querySelector("[data-re-draw-warning]");
    if (drawWarning) {
      drawWarning.hidden = drawPoints.length !== 2;
      if (drawPoints.length === 2) drawWarning.textContent = "目前只有 2 個點，系統會用直線連接，可能穿過建築物。若實際道路會轉彎、走河堤或小巷，請沿路再加幾個節點。";
    }
    const drawStart = panel.querySelector("[data-re-draw-start]");
    const drawAnalyze = panel.querySelector("[data-re-analyze-draw]");
    const redraw = panel.querySelector("[data-re-redraw]");
    if (drawStart) {
      drawStart.hidden = drawMode === "route" || drawPoints.length > 0;
      drawStart.disabled = busy;
    }
    if (drawAnalyze) {
      drawAnalyze.hidden = drawPoints.length < 2;
      drawAnalyze.disabled = busy || drawPoints.length < 2;
      drawAnalyze.textContent = drawMode === "route" ? "分析這條路線" : (savedDrawnAnalysis ? "重新分析這條路線" : "分析這條路線");
    }
    if (redraw) {
      redraw.hidden = drawPoints.length === 0 && savedDrawnRoute.length === 0;
      redraw.disabled = busy;
    }

    const endpointState = panel.querySelector("[data-re-endpoint-state]");
    if (endpointState) {
      if (!aPoint && !bPoint) endpointState.innerHTML = '<span>A</span> 尚未設定　<span>B</span> 尚未設定';
      else if (aPoint && !bPoint) endpointState.innerHTML = '<span class="ok">A ✓</span> 已設定　<span>B</span> 請點地圖';
      else endpointState.innerHTML = '<span class="ok">A ✓</span> 已設定　<span class="ok">B ✓</span> 已設定';
    }
    const abSet = panel.querySelector("[data-re-ab]");
    if (abSet) {
      abSet.disabled = busy;
      abSet.textContent = aPoint && bPoint ? "重新設定 A → B" : (aPoint ? "正在設定 A → B…" : "在地圖設定 A → B");
    }
    const abAnalyze = panel.querySelector("[data-re-analyze-ab]");
    if (abAnalyze) abAnalyze.disabled = busy || !aPoint || !bPoint;

    const manualNote = panel.querySelector("[data-re-manual-note]");
    if (manualNote) {
      manualNote.hidden = savedDrawnRoute.length < 2;
      if (savedDrawnRoute.length >= 2) manualNote.textContent = "已保留你的手繪路線；若起終點靠近 A、B，會自動加入候選比較。";
    }

    const detour = detourCapFromPanel();
    panel.querySelectorAll("[data-re-detour-chip]").forEach((chip) => {
      chip.classList.toggle("is-active", Number(chip.dataset.reDetourChip) === Number(detour));
    });

    const cancelWrap = panel.querySelector("[data-re-cancel-wrap]");
    if (cancelWrap) cancelWrap.hidden = !busy;
    const reset = panel.querySelector("[data-re-reset]");
    if (reset) reset.disabled = busy;
    const exports = panel.querySelector("[data-re-export]");
    const hasRenderedResult = !!panel.querySelector("[data-re-results]")?.innerHTML.trim();
    if (exports) exports.hidden = !lastAnalysis || !hasRenderedResult;
  }

  function advanceFromTime() {
    if (!panel) return;
    if (uiMode === "draw") {
      const target = panel.querySelector("[data-re-draw-step]");
      if (!drawPoints.length && !savedDrawnRoute.length) startDrawMode({ reset: true });
      else {
        if (drawMode !== "route" && drawPoints.length < 2) startDrawMode({ reset: false });
        target?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      }
      return;
    }
    if (uiMode === "ab") {
      const target = panel.querySelector("[data-re-ab-step]");
      if (!aPoint || !bPoint) startABMode();
      target?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }

  function setUiMode(mode) {
    const next = ["home", "draw", "ab"].includes(mode) ? mode : "home";
    if (uiMode === "draw" && next !== "draw") captureDrawnRouteIfValid();
    stopDrawMode();
    uiMode = next;
    clearLayer(resultLayer);
    clearLayer(comparisonLayer);
    clearGraphDiagnostics();
    lastManualGraphDiagnosis = null;
    const results = panel?.querySelector("[data-re-results]");
    if (results) results.innerHTML = "";
    lastCandidateBundle = null;
    if (next === "home") {
      setStatus("", "");
      renderSavedDrawnReference();
    } else if (next === "draw") {
      drawPoints = savedDrawnRoute.map((p) => ({ lat: p.lat, lng: p.lng }));
      drawEditableRoute();
      setStatus(drawPoints.length >= 2 ? "這條手繪路線已保留，可重新分析或重新畫。" : "先確認出發時間，再按「下一步：開始畫路線」。", "");
    } else {
      renderSavedDrawnReference();
      setStatus(aPoint && bPoint ? "A、B 已設定，可以開始比較候選路線。" : "先確認出發時間，再按「下一步：設定 A → B」。", "");
    }
    syncUiState();
  }

  function setBusy(value) {
    busy = !!value;
    if (!panel) return;
    panel.classList.toggle("is-busy", busy);
    panel.querySelectorAll("button, input").forEach((el) => {
      if (el.matches("[data-re-close], [data-re-cancel]")) return;
      el.disabled = busy;
    });
    syncUiState();
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
    summary.nightRatio = summary.totalDistanceM > 0 ? summary.nightDistanceM / summary.totalDistanceM : null;
    summary.daylightRatio = summary.totalDistanceM > 0 ? summary.daylightDistanceM / summary.totalDistanceM : null;
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
      version: VERSION,
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
      window.L.polyline(drawPoints, { color: "#e11d48", weight: 5, opacity: 0.86, dashArray: "8 7" }).addTo(drawLayer);
    }
    drawPoints.forEach((p, i) => {
      window.L.circleMarker(p, {
        radius: i === 0 || i === drawPoints.length - 1 ? 6 : 4,
        weight: 2,
        color: "#be123c",
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

  function resultHtml(analysis, options = {}) {
    const s = analysis.summary;
    const shadePct = s.shadeRatio == null ? null : Math.round(s.shadeRatio * 100);
    const sunPct = s.sunRatio == null ? null : Math.round(s.sunRatio * 100);
    const nightPct = s.nightRatio == null
      ? (s.totalDistanceM > 0 ? Math.round((s.nightDistanceM / s.totalDistanceM) * 100) : null)
      : Math.round(s.nightRatio * 100);
    const allNight = s.totalDistanceM > 0 && s.nightDistanceM > 0 && s.daylightDistanceM <= 0.01;
    const shade = shadePct == null ? "—" : `${shadePct}%`;
    const sun = sunPct == null ? "—" : `${sunPct}%`;
    const heatPayload = analysis.heat?.available ? analysis.heat.payload : null;
    const hi = heatPayload?.assessment?.heatIndexC;
    const temp = heatPayload?.assessment?.temperatureC;
    const rh = heatPayload?.assessment?.relativeHumidity;
    const heatBlock = heatPayload
      ? `<div class="re-heat"><b>即時熱風險背景</b><span>熱指數 ${Number.isFinite(Number(hi)) ? Number(hi).toFixed(1) + "°C" : "—"}・氣溫 ${Number.isFinite(Number(temp)) ? Number(temp).toFixed(1) + "°C" : "—"}・濕度 ${Number.isFinite(Number(rh)) ? Math.round(Number(rh)) + "%" : "—"}</span><small>這是附近溫濕度基準；不把日照直接虛構成額外幾 °C。</small></div>`
      : "";
    const partialPct = s.daylightDistanceM > 0 ? (s.partialDistanceM / s.daylightDistanceM) * 100 : 0;
    let verdict = "這條路的日照與遮蔭已完成分析";
    if (allNight) {
      verdict = "這段路程全程為夜間，沒有直接日照";
    } else if (shadePct != null) {
      if (shadePct >= 75) verdict = "這條路大部分有遮蔭";
      else if (shadePct >= 50) verdict = "這條路有一半以上路段可遮蔭";
      else verdict = "這條路直接日照較多";
    }
    const title = escapeHtml(options.title || verdict);
    const eyebrow = options.eyebrow ? `<div class="re-result-eyebrow">${escapeHtml(options.eyebrow)}</div>` : "";
    const hero = allNight
      ? `<div class="re-result-hero">
          <div class="night"><span>夜間</span><b>${nightPct == null ? "100%" : `${nightPct}%`}</b></div>
          <div class="sun"><span>直接日照</span><b>0%</b></div>
        </div>`
      : `<div class="re-result-hero">
          <div class="shade"><span>遮蔭</span><b>${shade}</b></div>
          <div class="sun"><span>直接日照</span><b>${sun}</b></div>
        </div>`;
    const sentence = allNight
      ? `約 ${formatMinutes(s.walkSeconds)} 路程，出發到抵達都在夜間；直接日照為 <strong>0.0 分</strong>。夜間不是「遮蔭」，因此不硬算進遮蔭百分比。`
      : `約 ${formatMinutes(s.walkSeconds)} 路程，其中約 <strong>${formatMinutes(s.directSunSeconds)}</strong> 會直接曬到太陽。`;
    return `
      <section class="re-result-card">
        ${eyebrow}
        <h3>${title}</h3>
        ${hero}
        <p class="re-result-sentence">${sentence}</p>
        <details class="re-result-details">
          <summary>查看詳細資料</summary>
          <div class="re-summary-grid">
            <div><span>路線距離</span><b>${formatDistance(s.totalDistanceM)}</b></div>
            <div><span>估計步行</span><b>${formatMinutes(s.walkSeconds)}</b></div>
            <div><span>遮蔭時間</span><b>${formatMinutes(s.shadedSeconds)}</b></div>
            <div><span>日照時間</span><b>${formatMinutes(s.directSunSeconds)}</b></div>
            <div><span>夜間時間</span><b>${formatMinutes(s.nightSeconds)}</b></div>
            <div><span>最長連續日照</span><b>${formatDistance(s.longestSunM)}</b></div>
            <div><span>最長連續遮蔭</span><b>${formatDistance(s.longestShadeM)}</b></div>
          </div>
          ${s.nightSeconds > 0 ? `<div class="re-note">夜間 ${formatMinutes(s.nightSeconds)} 已獨立計算，不會灌進遮蔭百分比。${allNight ? " 本次整條路線都屬夜間，所以原本的遮蔭／日照日間比例不適用。" : ""}</div>` : ""}
          ${partialPct > 1 ? `<div class="re-warn">約 ${Math.round(partialPct)}% 日間路段屬部分可靠度（多半是建築快取未就緒或低太陽高度）。</div>` : ""}
          ${heatBlock}
        </details>
      </section>
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

  function bearingDeg(a, b) {
    const A = asLatLng(a);
    const B = asLatLng(b);
    if (!A || !B) return 0;
    const rad = Math.PI / 180;
    const y = Math.sin((B.lng - A.lng) * rad) * Math.cos(B.lat * rad);
    const x = Math.cos(A.lat * rad) * Math.sin(B.lat * rad) -
      Math.sin(A.lat * rad) * Math.cos(B.lat * rad) * Math.cos((B.lng - A.lng) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  function destinationPoint(origin, bearing, distanceM) {
    const O = asLatLng(origin);
    if (!O) return null;
    const R = 6371000;
    const d = Math.max(0, Number(distanceM) || 0) / R;
    const br = Number(bearing) * Math.PI / 180;
    const lat1 = O.lat * Math.PI / 180;
    const lon1 = O.lng * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180 };
  }

  function interpolatePoint(a, b, fraction) {
    const A = asLatLng(a);
    const B = asLatLng(b);
    const t = clamp(fraction, 0, 1, 0.5);
    if (!A || !B) return null;
    return { lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t };
  }

  async function fetchViaRouteCandidate(a, via, b, id) {
    const A = asLatLng(a);
    const V = asLatLng(via);
    const B = asLatLng(b);
    if (!A || !V || !B) return null;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), Number(config.routingTimeoutMs || 15000));
    try {
      const coords = [A, V, B].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
      const base = String(config.routingBase || '').replace(/\/$/, '');
      const url = new URL(`${base}/${coords}`);
      url.searchParams.set('alternatives', 'false');
      url.searchParams.set('steps', 'false');
      url.searchParams.set('geometries', 'geojson');
      url.searchParams.set('overview', 'full');
      const response = await fetch(url.href, {
        method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      const route = payload?.routes?.[0];
      if (!response.ok || payload?.code !== 'Ok' || !route) return null;
      const points = (route.geometry?.coordinates || [])
        .map((c) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
        .filter(asLatLng);
      if (points.length < 2) return null;
      return {
        id,
        kind: 'explore',
        providerIndex: null,
        distanceM: Number(route.distance) || routeDistanceM(points),
        durationS: Number(route.duration) || 0,
        points,
        raw: route,
        via: V
      };
    } catch (_) {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function routeSimilarityM(a, b) {
    const A = a?.points || [];
    const B = b?.points || [];
    if (A.length < 2 || B.length < 2) return Infinity;
    const fractions = [0.2, 0.5, 0.8];
    let total = 0;
    for (const f of fractions) {
      const ai = A[Math.min(A.length - 1, Math.round((A.length - 1) * f))];
      const bi = B[Math.min(B.length - 1, Math.round((B.length - 1) * f))];
      total += haversineM(ai, bi);
    }
    return total / fractions.length;
  }

  function dedupeCandidates(candidates) {
    const out = [];
    for (const candidate of candidates || []) {
      if (!candidate?.points?.length) continue;
      if (candidate.kind === 'manual' || candidate.kind === 'experimental-fused') { out.push(candidate); continue; }
      const duplicate = out.some((existing) => {
        if (existing.kind === 'manual' || existing.kind === 'experimental-fused') return false;
        const distanceClose = Math.abs((Number(existing.distanceM) || 0) - (Number(candidate.distanceM) || 0)) < 25;
        return distanceClose && routeSimilarityM(existing, candidate) < 35;
      });
      if (!duplicate) out.push(candidate);
    }
    return out;
  }

  async function fetchExploratoryCandidates(a, b) {
    if (config.exploreCandidates === false) return [];
    const A = asLatLng(a);
    const B = asLatLng(b);
    if (!A || !B) return [];
    const directM = Math.max(250, haversineM(A, B));
    const axisBearing = bearingDeg(A, B);
    // These via points deliberately probe both sides of the A→B corridor.
    // They are not claimed to be globally optimal; they simply give the shade
    // scorer materially different walkable alternatives instead of relying on
    // an OSRM server returning one or two near-identical alternatives.
    const specs = [
      [0.35, -1, 0.18], [0.35, 1, 0.18],
      [0.68, -1, 0.18], [0.68, 1, 0.18],
      [0.72, -1, 0.28], [0.72, 1, 0.28]
    ].slice(0, clamp(config.exploreMaxRoutes, 0, 8, 6));
    const jobs = specs.map(([fraction, side, ratio], index) => {
      const center = interpolatePoint(A, B, fraction);
      const offsetM = Math.min(240, Math.max(70, directM * ratio));
      const via = destinationPoint(center, axisBearing + side * 90, offsetM);
      return { via, id: `explore-${index + 1}` };
    }).filter((job) => job.via);

    const results = new Array(jobs.length).fill(null);
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        const index = cursor++;
        const job = jobs[index];
        results[index] = await fetchViaRouteCandidate(A, job.via, B, job.id);
      }
    }
    await Promise.all([worker(), worker()]);
    return results.filter(Boolean);
  }

  function buildManualCandidateFromRoute(routePoints, a, b, speedMps) {
    let route = Array.isArray(routePoints) ? routePoints.map(asLatLng).filter(Boolean) : [];
    if (route.length < 2) return { available: false, reason: "none" };
    const A = asLatLng(a);
    const B = asLatLng(b);
    if (!A || !B) return { available: true, matched: false, reason: "missing-endpoints" };

    // dev4: match A/B to the entire hand-drawn polyline, not only its first/last
    // vertices. A user may deliberately draw beyond A or B (for example along a
    // river levee); only the A→B portion should be compared.
    let snapA = nearestPointOnRoute(route, A);
    let snapB = nearestPointOnRoute(route, B);
    if (!snapA || !snapB) return { available: true, matched: false, reason: "snap-failed" };

    let reversed = false;
    if (snapA.position > snapB.position) {
      route = route.slice().reverse();
      reversed = true;
      snapA = nearestPointOnRoute(route, A);
      snapB = nearestPointOnRoute(route, B);
    }

    const tolerance = clamp(
      config.manualRouteSnapToleranceM ?? config.manualEndpointToleranceM,
      20,
      300,
      120
    );
    const startGapM = snapA?.distanceM ?? Infinity;
    const endGapM = snapB?.distanceM ?? Infinity;
    if (startGapM > tolerance || endGapM > tolerance) {
      return {
        available: true,
        matched: false,
        reason: "route-too-far-from-endpoints",
        toleranceM: tolerance,
        startGapM,
        endGapM,
        reversed,
        matchMode: "nearest-on-polyline"
      };
    }

    const middle = routeSliceBetweenSnaps(route, snapA, snapB);
    if (middle.length < 2) {
      return { available: true, matched: false, reason: "route-slice-too-short", toleranceM: tolerance };
    }

    const points = middle.slice();
    // Connect the actual selected A/B to the nearest points on the user's line.
    // These short connectors are included in distance/exposure, so comparison is
    // still apples-to-apples with provider routes that start exactly at A and B.
    if (haversineM(A, points[0]) > 2) points.unshift({ lat: A.lat, lng: A.lng });
    else points[0] = { lat: A.lat, lng: A.lng };
    if (haversineM(points[points.length - 1], B) > 2) points.push({ lat: B.lat, lng: B.lng });
    else points[points.length - 1] = { lat: B.lat, lng: B.lng };

    const distanceM = routeDistanceM(points);
    const safeSpeed = Math.max(0.4, Number(speedMps) || config.walkingSpeedKmh / 3.6);
    return {
      available: true,
      matched: true,
      toleranceM: tolerance,
      startGapM,
      endGapM,
      reversed,
      matchMode: "nearest-on-polyline",
      trimmed: true,
      candidate: {
        id: "manual-drawn",
        kind: "manual",
        label: "我的手繪路線",
        providerIndex: null,
        distanceM,
        durationS: distanceM / safeSpeed,
        points,
        raw: null
      }
    };
  }

  function buildManualCandidate(a, b, speedMps) {
    return buildManualCandidateFromRoute(savedDrawnRoute, a, b, speedMps);
  }

  function headingDifferenceDeg(a, b) {
    return Math.abs((((Number(a) || 0) - (Number(b) || 0) + 540) % 360) - 180);
  }

  function routeQualitySamples(points, spacingM) {
    return buildSampleSegments(points, clamp(spacingM, 5, 20, 8)).map((seg) => ({
      point: seg.sample,
      cumulativeM: seg.cumulativeMidM,
      lengthM: seg.lengthM,
      heading: bearingDeg(seg.start, seg.end)
    }));
  }

  /*
   * dev5 hard rule: a shaded dead-end / out-and-back excursion is never a
   * valid shade benefit.  Geometry quality is checked BEFORE ShadeMap scoring.
   */
  function evaluateRouteQuality(candidateOrPoints) {
    const points = Array.isArray(candidateOrPoints)
      ? candidateOrPoints.map(asLatLng).filter(Boolean)
      : (candidateOrPoints?.points || []).map(asLatLng).filter(Boolean);
    if (config.routeQualityEnabled === false || points.length < 2) {
      return { valid: true, reasons: [], loopExcursionM: 0, repeatedCorridorM: 0, maxBacktrackM: 0 };
    }

    const samples = routeQualitySamples(points, config.routeQualitySampleM);
    if (samples.length < 3) {
      return { valid: true, reasons: [], loopExcursionM: 0, repeatedCorridorM: 0, maxBacktrackM: 0 };
    }

    // dev6: reject only real geometric waste.  A route may temporarily move
    // sideways or slightly away from B to follow the street network; that is
    // NOT by itself a reason to reject it.
    const loopRadius = clamp(config.routeQualityLoopReturnRadiusM, 3, 12, 5);
    const minLoopPath = clamp(config.routeQualityMinLoopExcursionM, 40, 220, 70);
    let loopExcursionM = 0;
    for (let i = 0; i < samples.length - 2; i += 1) {
      for (let j = i + 2; j < samples.length; j += 1) {
        const pathSep = samples[j].cumulativeM - samples[i].cumulativeM;
        if (pathSep < minLoopPath) continue;
        if (haversineM(samples[i].point, samples[j].point) <= loopRadius) {
          loopExcursionM = Math.max(loopExcursionM, pathSep);
        }
      }
    }

    // Detect the same physical corridor traversed again in the opposite
    // direction.  Keep the radius tight so nearby parallel streets / lanes
    // are not mistaken for an out-and-back.
    const corridorRadius = clamp(config.routeQualityRepeatedCorridorRadiusM, 3, 10, 5);
    const corridorSep = clamp(config.routeQualityRepeatedCorridorMinSeparationM, 25, 160, 40);
    const oppositeDeg = clamp(config.routeQualityOppositeHeadingDeg, 140, 180, 155);
    const repeatedIndexes = new Set();
    for (let j = 1; j < samples.length; j += 1) {
      for (let i = 0; i < j - 1; i += 1) {
        if (samples[j].cumulativeM - samples[i].cumulativeM < corridorSep) continue;
        if (haversineM(samples[i].point, samples[j].point) > corridorRadius) continue;
        if (headingDifferenceDeg(samples[i].heading, samples[j].heading) >= oppositeDeg) {
          repeatedIndexes.add(j);
          break;
        }
      }
    }
    let repeatedCorridorM = 0;
    for (const index of repeatedIndexes) repeatedCorridorM += samples[index]?.lengthM || 0;

    // Keep AB-projection backtracking only as a diagnostic.  City streets can
    // legitimately run sideways/backward before reconnecting; dev5 used this
    // as a hard gate and rejected too many normal candidates.
    const A = points[0];
    const B = points[points.length - 1];
    const directM = haversineM(A, B);
    let maxBacktrackM = 0;
    if (directM > 20) {
      const lat0 = ((A.lat + B.lat) / 2) * Math.PI / 180;
      const mx = 111320 * Math.max(0.2, Math.cos(lat0));
      const my = 110540;
      const vx = (B.lng - A.lng) * mx;
      const vy = (B.lat - A.lat) * my;
      const denom = vx * vx + vy * vy;
      let maxProgress = 0;
      for (const sample of samples) {
        const px = (sample.point.lng - A.lng) * mx;
        const py = (sample.point.lat - A.lat) * my;
        const progressM = denom > 1e-9 ? ((px * vx + py * vy) / denom) * directM : 0;
        maxProgress = Math.max(maxProgress, progressM);
        maxBacktrackM = Math.max(maxBacktrackM, maxProgress - progressM);
      }
    }

    const reasons = [];
    if (loopExcursionM >= minLoopPath) reasons.push("loop-return");
    if (repeatedCorridorM > clamp(config.routeQualityMaxRepeatedCorridorM, 16, 120, 32)) reasons.push("repeated-corridor");
    return { valid: reasons.length === 0, reasons, loopExcursionM, repeatedCorridorM, maxBacktrackM, sampleCount: samples.length };
  }

  function applyRouteQuality(candidates) {
    return (candidates || []).map((candidate) => Object.assign({}, candidate, {
      routeQuality: evaluateRouteQuality(candidate)
    }));
  }

  function candidateWithinDetour(candidate, fastest, detourPct) {
    const limit = 1 + Math.max(0, detourPct) / 100;
    const baseDistance = fastest?.distanceM > 0 ? fastest.distanceM : null;
    const baseDuration = fastest?.durationS > 0 ? fastest.durationS : null;
    if (baseDistance && candidate.distanceM > 0) return candidate.distanceM <= baseDistance * limit + 1;
    if (baseDuration && candidate.durationS > 0) return candidate.durationS <= baseDuration * limit + 1;
    return true;
  }

  async function scoreCandidates(candidates, options = {}) {
    if (!Array.isArray(candidates) || !candidates.length) throw new Error("沒有候選路線。");
    const serial = options.serial ?? analysisSerial;
    const qualityChecked = applyRouteQuality(candidates);
    const qualityValid = qualityChecked.filter((c) => c?.routeQuality?.valid !== false);
    const rejectedQuality = qualityChecked.filter((c) => c?.routeQuality?.valid === false);
    if (!qualityValid.length) throw new Error("候選路線都有明顯折返或重複走廊，已全部淘汰。請重新設定 A、B。");
    const baselineCandidates = qualityValid.filter((c) => c?.kind !== "manual" && c?.kind !== "experimental-fused");
    const fastest = (baselineCandidates.length ? baselineCandidates : qualityValid).reduce((best, c) => {
      if (!best) return c;
      const d = Number(c.distanceM) || Infinity;
      const bestD = Number(best.distanceM) || Infinity;
      return d < bestD ? c : best;
    }, null);
    const detourPct = clamp(options.detourPct, 0, 60, detourCapFromPanel());
    let eligible = qualityValid.filter((c) => candidateWithinDetour(c, fastest, detourPct));
    const maxScored = clamp(config.maxScoredCandidates, 2, 14, 10);
    if (eligible.length > maxScored) {
      const mustKeep = new Set([fastest?.id, ...eligible.filter((c) => c.kind === "manual" || c.kind === "experimental-fused").map((c) => c.id)].filter(Boolean));
      const chosen = [];
      for (const c of eligible) if (mustKeep.has(c.id) && !chosen.some((x) => x.id === c.id)) chosen.push(c);
      for (const c of eligible) {
        if (chosen.length >= maxScored) break;
        if (!chosen.some((x) => x.id === c.id)) chosen.push(c);
      }
      eligible = chosen;
    }
    const eligibleIds = new Set(eligible.map((c) => c.id));
    // Even when a user-drawn or verified-fusion route is just outside the detour
    // cap, score it once so the user can inspect the trade-off instead of having
    // an evidence-backed comparison silently disappear from the UI.
    const comparisonOutside = qualityChecked.filter((c) =>
      (c?.kind === "manual" || c?.kind === "experimental-fused") &&
      c?.routeQuality?.valid !== false && !eligibleIds.has(c.id)
    );
    const scoringPool = eligible.concat(comparisonOutside);
    const scored = [];
    for (let i = 0; i < scoringPool.length; i += 1) {
      if (serial !== analysisSerial) throw new Error("ROUTE_ANALYSIS_CANCELLED");
      setStatus(`正在比較第 ${i + 1}/${scoringPool.length} 條路線…`, "loading");
      const analysis = await analyzeRoute(scoringPool[i].points, {
        departure: options.departure,
        sampleSpacingM: options.sampleSpacingM,
        speedMps: options.speedMps,
        serial,
        includeHeat: false,
        onProgress: (done, total) => setStatus(`候選 ${i + 1}/${scoringPool.length}：陰影採樣 ${done}/${total}`, "loading")
      });
      scored.push(Object.assign({}, scoringPool[i], { analysis, eligible: eligibleIds.has(scoringPool[i].id) }));
    }
    const eligibleScored = scored.filter((c) => c.eligible !== false);
    const selected = eligibleScored.slice().sort((a, b) => {
      const sunA = a.analysis.summary.directSunSeconds;
      const sunB = b.analysis.summary.directSunSeconds;
      if (Math.abs(sunA - sunB) > 0.5) return sunA - sunB;
      return a.analysis.summary.walkSeconds - b.analysis.summary.walkSeconds;
    })[0] || null;
    if (selected && serial === analysisSerial) {
      const departure = options.departure instanceof Date ? options.departure : new Date(options.departure || departureDateFromPanel());
      selected.analysis.heat = await maybeHeatContext(selected.points, departure, serial);
    }
    return {
      fastest,
      eligible,
      eligibleScored,
      scored,
      selected,
      best: selected,
      activeCandidateId: selected?.id || null,
      detourPct,
      comparisonValid: eligibleScored.length >= 2,
      rejectedQuality
    };
  }

  function candidateDetourPct(candidate, bundle) {
    const base = Number(bundle.fastest?.distanceM) || 0;
    const d = Number(candidate?.distanceM) || candidate?.analysis?.summary?.totalDistanceM || 0;
    return base > 0 ? Math.max(0, (d / base - 1) * 100) : 0;
  }

  function candidateName(candidate, bundle) {
    if (candidate?.kind === "experimental-fused") return "官方資料融合最不曬";
    if (candidate?.kind === "graph-shade") return candidate?.graphMeta?.backend === "nationwide-hgr1" ? "全臺圖資 Graph 最不曬候選" : "OSM Graph 最不曬候選";
    if (candidate?.kind === "graph-fastest") return candidate?.graphMeta?.backend === "nationwide-hgr1" ? "全臺圖資 Graph 最快" : "OSM Graph 最快";
    if (candidate?.kind === "manual") return "我的手繪路線";
    if (candidate?.id === bundle.fastest?.id) return "最快";
    if (candidate?.kind === "explore") {
      const explored = bundle.scored.filter((c) => c.kind === "explore");
      return `探索路線 ${explored.findIndex((c) => c.id === candidate.id) + 1}`;
    }
    const providers = bundle.scored.filter((c) => c.kind !== "manual" && c.kind !== "explore" && c.id !== bundle.fastest?.id);
    return `替代路線 ${providers.findIndex((c) => c.id === candidate.id) + 1}`;
  }


  function directionalRouteFidelity(sourcePoints, targetPoints, options = {}) {
    const source = (sourcePoints || []).map(asLatLng).filter(Boolean);
    const target = (targetPoints || []).map(asLatLng).filter(Boolean);
    const thresholdM = clamp(options.thresholdM, 2, 60, config.fusionFidelityThresholdM || 14);
    const sampleM = clamp(options.sampleM, 4, 30, config.fusionFidelitySampleM || 10);
    if (source.length < 2 || target.length < 2) {
      return { available: false, reason: "route-too-short", thresholdM, sampleM };
    }
    const samples = buildSampleSegments(source, sampleM);
    const totalM = samples.reduce((sum, seg) => sum + Number(seg.lengthM || 0), 0);
    if (!(totalM > 0)) return { available: false, reason: "route-too-short", thresholdM, sampleM };
    let coveredM = 0, weightedDistance = 0, maxDistanceM = 0, firstDivergence = null;
    for (const seg of samples) {
      const hit = nearestPointOnRoute(target, seg.sample);
      const distanceM = Number(hit?.distanceM);
      if (!Number.isFinite(distanceM)) continue;
      weightedDistance += distanceM * seg.lengthM;
      maxDistanceM = Math.max(maxDistanceM, distanceM);
      if (distanceM <= thresholdM) coveredM += seg.lengthM;
      else if (!firstDivergence) {
        firstDivergence = {
          progressRatio: totalM > 0 ? seg.cumulativeMidM / totalM : 0,
          point: { lat: seg.sample.lat, lng: seg.sample.lng },
          distanceM
        };
      }
    }
    return {
      available: true,
      thresholdM,
      sampleM,
      distanceM: totalM,
      coveredDistanceM: coveredM,
      coverageRatio: totalM > 0 ? coveredM / totalM : 0,
      averageDistanceM: totalM > 0 ? weightedDistance / totalM : Infinity,
      maxDistanceM,
      firstDivergence
    };
  }

  function compareRouteFidelity(fusedPoints, manualPoints, options = {}) {
    const fusedToManual = directionalRouteFidelity(fusedPoints, manualPoints, options);
    const manualToFused = directionalRouteFidelity(manualPoints, fusedPoints, options);
    if (!fusedToManual.available || !manualToFused.available) {
      return { available: false, reason: "route-too-short", fusedToManual, manualToFused };
    }
    return {
      available: true,
      thresholdM: fusedToManual.thresholdM,
      sampleM: fusedToManual.sampleM,
      // Conservative symmetric coverage: both routes must agree, not only one
      // short route sitting inside a longer one.
      coverageRatio: Math.min(fusedToManual.coverageRatio, manualToFused.coverageRatio),
      commonCorridorM: Math.min(fusedToManual.coveredDistanceM, manualToFused.coveredDistanceM),
      averageDistanceM: (fusedToManual.averageDistanceM + manualToFused.averageDistanceM) / 2,
      maxDistanceM: Math.max(fusedToManual.maxDistanceM, manualToFused.maxDistanceM),
      firstDivergence: fusedToManual.firstDivergence || manualToFused.firstDivergence || null,
      fusedToManual,
      manualToFused
    };
  }

  function experimentalFusionCandidateFromRun(result, speedMps) {
    const route = result?.search?.minSun;
    const points = (route?.points || []).map(asLatLng).filter(Boolean);
    if (!result?.available || points.length < 2) return null;
    const distanceM = routeDistanceM(points);
    const safeSpeed = Math.max(0.4, Number(speedMps) || config.walkingSpeedKmh / 3.6);
    return {
      id: "experimental-fused-minsun",
      kind: "experimental-fused",
      label: "官方資料融合最不曬",
      providerIndex: null,
      distanceM,
      durationS: Number(route.durationS) || distanceM / safeSpeed,
      points,
      raw: null,
      experimentalFusion: {
        version: result.version || null,
        connectorCount: Number(result.overlay?.connectorCount || 0),
        verifiedCandidateCount: Number(result.overlay?.verifiedCandidateCount || 0),
        connectorIds: (result.overlay?.connectors || []).map((c) => c.edgeId).filter(Boolean),
        gapIds: (result.overlay?.connectors || []).map((c) => c.gapId).filter(Boolean),
        sources: [...new Set((result.overlay?.connectors || []).map((c) => c.source).filter(Boolean))],
        coarseDirectSunSeconds: Number.isFinite(Number(route.directSunSeconds)) ? Number(route.directSunSeconds) : null,
        coarseWalkSeconds: Number.isFinite(Number(route.walkSeconds)) ? Number(route.walkSeconds) : Number(route.durationS) || null,
        productionGraphMutated: result.productionGraphMutated === true,
        productionMutationEnabled: result.productionMutationEnabled === true
      }
    };
  }

  async function buildAutomaticExperimentalFusionCandidate(options = {}) {
    if (config.autoCompareVerifiedFusion === false) return { candidate: null, status: { available: false, reason: "disabled" } };
    const evidenceApi = window.HaidianMultiSourceEvidence;
    const fusionApi = window.HaidianExperimentalFusionRouter;
    if (!evidenceApi || !fusionApi) return { candidate: null, status: { available: false, reason: "fusion-modules-unavailable" } };
    let evidenceState = evidenceApi.getState?.();
    if (evidenceState?.status !== "ready") evidenceState = await evidenceApi.loadEvidence?.();
    if (evidenceState?.status !== "ready") {
      return { candidate: null, status: { available: false, reason: evidenceState?.error || "evidence-not-ready" } };
    }
    if (!Number(evidenceState?.fusionPlan?.routableWitnessCount || 0)) {
      return { candidate: null, status: { available: false, reason: "no-routable-verified-witness" } };
    }
    const result = await fusionApi.runFromLastProductionGraph(Object.assign({}, options, { renderOnMap: false }));
    const candidate = experimentalFusionCandidateFromRun(result, options.speedMps);
    return {
      candidate,
      result,
      status: {
        available: Boolean(candidate),
        reason: candidate ? null : (result?.reason || result?.search?.reason || "experimental-fusion-unavailable"),
        connectorCount: Number(result?.overlay?.connectorCount || 0),
        productionGraphMutated: result?.productionGraphMutated === true
      }
    };
  }

  function buildFusionManualComparison(bundle) {
    const fused = (bundle?.scored || []).find((c) => c.kind === "experimental-fused");
    const manual = (bundle?.scored || []).find((c) => c.kind === "manual");
    if (!fused?.analysis || !manual?.analysis) return null;
    const fidelity = compareRouteFidelity(fused.points, manual.points, {
      thresholdM: config.fusionFidelityThresholdM,
      sampleM: config.fusionFidelitySampleM
    });
    if (!fidelity.available) return null;
    return {
      available: true,
      fidelity,
      fusedId: fused.id,
      manualId: manual.id,
      distanceDeltaM: Number(fused.analysis.summary.totalDistanceM || 0) - Number(manual.analysis.summary.totalDistanceM || 0),
      sunDeltaSeconds: Number(fused.analysis.summary.directSunSeconds || 0) - Number(manual.analysis.summary.directSunSeconds || 0),
      fusedDirectSunSeconds: Number(fused.analysis.summary.directSunSeconds || 0),
      manualDirectSunSeconds: Number(manual.analysis.summary.directSunSeconds || 0),
      connectorCount: Number(fused.experimentalFusion?.connectorCount || 0),
      productionGraphMutated: fused.experimentalFusion?.productionGraphMutated === true
    };
  }

  function fusionManualComparisonHtml(bundle) {
    const c = bundle?.fusionManualComparison;
    if (!c?.available) return "";
    const f = c.fidelity;
    const pct = Math.round(Number(f.coverageRatio || 0) * 100);
    const ftm = Math.round(Number(f.fusedToManual?.coverageRatio || 0) * 100);
    const mtf = Math.round(Number(f.manualToFused?.coverageRatio || 0) * 100);
    const sunDeltaMin = c.sunDeltaSeconds / 60;
    const distDelta = c.distanceDeltaM;
    const divergence = f.firstDivergence;
    const divergenceText = divergence
      ? `第一個超過 ${Number(f.thresholdM).toFixed(0)} m 的偏離約在融合路線 ${Math.round(Number(divergence.progressRatio || 0) * 100)}%（${Number(divergence.distanceM || 0).toFixed(1)} m）。`
      : `整條採樣均落在 ${Number(f.thresholdM).toFixed(0)} m 門檻內。`;
    return `<div class="re-fusion-compare"><b>dev28 官方融合 ↔ 手繪 fidelity</b><span>保守雙向貼合 <strong>${pct}%</strong>（融合→手繪 ${ftm}%／手繪→融合 ${mtf}%）；共同走廊約 ${Math.round(Number(f.commonCorridorM || 0))} m。</span><span>雙向平均偏移 ${Number(f.averageDistanceM || 0).toFixed(1)} m；最大偏移 ${Number(f.maxDistanceM || 0).toFixed(1)} m。${escapeHtml(divergenceText)}</span><span>同一套 dense ShadeMap：融合 ${formatMinutes(c.fusedDirectSunSeconds)}、手繪 ${formatMinutes(c.manualDirectSunSeconds)}；融合相差 ${sunDeltaMin >= 0 ? "+" : ""}${sunDeltaMin.toFixed(1)} 分，距離相差 ${distDelta >= 0 ? "+" : ""}${Math.round(distDelta)} m。</span><span>${c.connectorCount} 個 verified official witness；productionGraphMutated=${c.productionGraphMutated ? "true" : "false"}。</span></div>`;
  }

  function clearMatureEngineOverlay() {
    engineCrossCheckVisible = false;
    clearLayer(engineCrossCheckLayer);
  }

  function matureEngineOverlayEntries(live) {
    if (!live) return [];
    return [
      { id: "valhalla-route", label: "Valhalla ordinary pedestrian", engine: "Valhalla", mode: "ordinary", result: live.valhalla?.route, color: "#2563eb", dashArray: null, weight: 6 },
      { id: "valhalla-trace", label: "Valhalla trace_route map_snap", engine: "Valhalla", mode: "map-match", result: live.valhalla?.traceRoute, color: "#0ea5e9", dashArray: "10 6", weight: 5.5 },
      { id: "graphhopper-route", label: "GraphHopper foot route", engine: "GraphHopper", mode: "ordinary", result: live.graphhopper?.route, color: "#d97706", dashArray: null, weight: 5.5 },
      { id: "graphhopper-match", label: "GraphHopper GPX map-match", engine: "GraphHopper", mode: "map-match", result: live.graphhopper?.match, color: "#f59e0b", dashArray: "8 6", weight: 5 }
    ].filter((entry) => entry.result?.available && Array.isArray(entry.result.points) && entry.result.points.length >= 2);
  }

  function engineOverlayTooltip(entry) {
    const x = entry.result || {};
    const coverage = Number.isFinite(Number(x.coverageRatio)) ? `${Math.round(Number(x.coverageRatio) * 100)}%` : "—";
    const avg = Number.isFinite(Number(x.averageDistanceM)) ? `${Number(x.averageDistanceM).toFixed(1)} m` : "—";
    const max = Number.isFinite(Number(x.maxDistanceM)) ? `${Number(x.maxDistanceM).toFixed(1)} m` : "—";
    const divergence = x.firstDivergence && Number.isFinite(Number(x.firstDivergence.progressRatio))
      ? `<br>首個超出門檻：約 ${Math.round(Number(x.firstDivergence.progressRatio) * 100)}%・${Number(x.firstDivergence.distanceM || 0).toFixed(1)} m`
      : "";
    return `<b>${escapeHtml(entry.label)}</b><br>${x.faithful ? "忠實河堤" : "非忠實河堤"}・貼合 ${coverage}<br>平均偏移 ${avg}・最大偏移 ${max}<br>距離 ${escapeHtml(formatDistance(Number(x.distanceM || 0)))}${divergence}`;
  }

  function renderMatureEngineOverlay(live) {
    const entries = matureEngineOverlayEntries(live);
    if (!entries.length || !window.L || !map) {
      clearMatureEngineOverlay();
      return false;
    }
    if (!engineCrossCheckLayer) engineCrossCheckLayer = createLayerGroup();
    clearLayer(engineCrossCheckLayer);
    for (const entry of entries) {
      const x = entry.result;
      const line = window.L.polyline(x.points, {
        color: entry.color, weight: entry.weight, opacity: entry.mode === "ordinary" ? 0.9 : 0.82,
        dashArray: entry.dashArray || undefined, interactive: true
      }).addTo(engineCrossCheckLayer);
      line.bindTooltip(engineOverlayTooltip(entry), { direction: "top", sticky: true });
      const div = x.firstDivergence;
      if (div?.manualPoint && div?.enginePoint) {
        const gap = [div.manualPoint, div.enginePoint];
        window.L.polyline(gap, { color: entry.color, weight: 2.5, opacity: 0.8, dashArray: "3 5", interactive: false }).addTo(engineCrossCheckLayer);
        window.L.circleMarker(div.manualPoint, { radius: 6, weight: 2.5, color: entry.color, fillColor: "#ffffff", fillOpacity: 0.96, interactive: true })
          .bindTooltip(`${escapeHtml(entry.label)}<br>首個超出 fidelity 門檻：約 ${Math.round(Number(div.progressRatio || 0) * 100)}%・${Number(div.distanceM || 0).toFixed(1)} m`, { direction: "top" })
          .addTo(engineCrossCheckLayer);
      }
    }
    engineCrossCheckVisible = true;
    return true;
  }

  function toggleMatureEngineOverlay() {
    if (engineCrossCheckVisible) {
      clearMatureEngineOverlay();
    } else {
      renderMatureEngineOverlay(lastManualGraphDiagnosis?.replay?.matureEngineCrossCheck || null);
    }
    const button = panel?.querySelector("[data-re-engine-map]");
    if (button) button.textContent = engineCrossCheckVisible ? "隱藏成熟引擎路線" : "顯示成熟引擎路線";
  }

  function graphEdgeColor(edge) {
    if (edge?.inMinSun) return "#7c3aed";
    if (edge?.inFastest) return "#0f766e";
    if (edge?.family === "path") return "#8b5cf6";
    if (edge?.family === "local-road") return "#64748b";
    return "#94a3b8";
  }

  function graphEdgeLabel(edge) {
    const tags = edge?.tagsSummary || {};
    const tag = (key) => Array.isArray(tags[key]) ? tags[key].join(" / ") : "";
    const shade = edge?.shadeEstimate;
    const shadeText = shade && Number.isFinite(shade.directSunFraction)
      ? `<br>graph 估計：直接日照 ${Math.round(shade.directSunFraction * 100)}%・遮蔭 ${Math.round((shade.shadedFraction || 0) * 100)}%・約 ${Number(shade.directSunSeconds || 0).toFixed(1)} 秒日照成本・${Math.round(shade.samples || 0)} samples`
      : "<br>此 edge 尚未被 shade search 評估";
    return `<b>OSM Graph edge ${escapeHtml(edge?.id || "")}</b><br>` +
      `highway=${escapeHtml(edge?.highway || "unknown")}・長度 ${Math.round(edge?.distanceM || 0)} m` +
      `${tag("name") ? `<br>name=${escapeHtml(tag("name"))}` : ""}` +
      `${tag("foot") ? `<br>foot=${escapeHtml(tag("foot"))}` : ""}` +
      `${tag("access") ? `<br>access=${escapeHtml(tag("access"))}` : ""}` +
      `${tag("surface") ? `<br>surface=${escapeHtml(tag("surface"))}` : ""}` +
      `<br>way id：${escapeHtml((edge?.wayIds || []).join(", ") || "—")}` +
      `${edge?.inMinSun ? "<br><b>✓ 目前 OSM Graph 最不曬路線使用</b>" : ""}` +
      `${edge?.inFastest ? "<br>✓ OSM Graph 最快路線使用" : ""}` + shadeText;
  }

  function clearGraphDiagnostics() {
    graphDebugVisible = false;
    clearLayer(graphDebugLayer);
  }

  function renderGraphDiagnostics() {
    const api = window.HaidianPedestrianGraph;
    const snapshot = api?.getDebugSnapshot?.();
    if (!snapshot?.edges?.length) {
      setStatus("目前沒有可顯示的 OSM Graph；請先跑一次 A→B。", "warning");
      return false;
    }
    if (!graphDebugLayer) graphDebugLayer = createLayerGroup();
    clearLayer(graphDebugLayer);
    for (const edge of snapshot.edges) {
      const line = window.L.polyline(edge.geometry, {
        color: graphEdgeColor(edge),
        weight: edge.inMinSun ? 5 : edge.inFastest ? 4 : edge.family === "path" ? 3.2 : 2.2,
        opacity: edge.inMinSun || edge.inFastest ? 0.9 : edge.family === "path" ? 0.72 : 0.38,
        interactive: true
      }).addTo(graphDebugLayer);
      line.bindPopup(graphEdgeLabel(edge), { maxWidth: 330 });
    }
    for (const connector of snapshot.connectors || []) {
      window.L.circleMarker(connector, {
        radius: 4.5, weight: 2, color: "#a16207", fillColor: "#fde047", fillOpacity: 0.92, interactive: true
      }).bindTooltip(`可能的步道/道路轉換點<br>${escapeHtml((connector.highways || []).join(" + "))}`, { direction: "top" }).addTo(graphDebugLayer);
    }
    if (snapshot.snapA) {
      window.L.circleMarker(snapshot.snapA, { radius: 7, weight: 3, color: "#2563eb", fillColor: "#dbeafe", fillOpacity: 1 })
        .bindTooltip(`A edge 吸附・誤差 ${Math.round(snapshot.snapA.distanceM || 0)} m${snapshot.snapA.highway ? `<br>${escapeHtml(snapshot.snapA.highway)}` : ""}`, { permanent: false }).addTo(graphDebugLayer);
    }
    if (snapshot.snapB) {
      window.L.circleMarker(snapshot.snapB, { radius: 7, weight: 3, color: "#dc2626", fillColor: "#fee2e2", fillOpacity: 1 })
        .bindTooltip(`B edge 吸附・誤差 ${Math.round(snapshot.snapB.distanceM || 0)} m${snapshot.snapB.highway ? `<br>${escapeHtml(snapshot.snapB.highway)}` : ""}`, { permanent: false }).addTo(graphDebugLayer);
    }
    const strictGap = lastManualGraphDiagnosis?.replay?.strictCorridorAudit?.nearestComponentGap || null;
    const gapA = strictGap?.a?.node || null;
    const gapB = strictGap?.b?.node || null;
    if (gapA && gapB && Number.isFinite(Number(gapA.lat)) && Number.isFinite(Number(gapA.lng)) && Number.isFinite(Number(gapB.lat)) && Number.isFinite(Number(gapB.lng))) {
      const aPoint = { lat: Number(gapA.lat), lng: Number(gapA.lng) };
      const bPoint = { lat: Number(gapB.lat), lng: Number(gapB.lng) };
      window.L.circleMarker(aPoint, { radius: 7, weight: 3, color: "#b91c1c", fillColor: "#fecaca", fillOpacity: 1 })
        .bindTooltip(`dev13 strict corridor・A-side component 邊界<br>node ${escapeHtml(gapA.id || '—')}`, { direction: "top" }).addTo(graphDebugLayer);
      window.L.circleMarker(bPoint, { radius: 7, weight: 3, color: "#c2410c", fillColor: "#fed7aa", fillOpacity: 1 })
        .bindTooltip(`dev13 strict corridor・B-side component 邊界<br>node ${escapeHtml(gapB.id || '—')}`, { direction: "top" }).addTo(graphDebugLayer);
      window.L.polyline([aPoint, bPoint], { color: "#dc2626", weight: 3, opacity: 0.9, dashArray: "6 6", interactive: false }).addTo(graphDebugLayer);
    }

    const delta = lastManualGraphDiagnosis?.replay?.thresholdDeltaAudit || null;
    const bridgePoints = delta?.bridgeChain?.points || [];
    if (delta?.transitionFound && bridgePoints.length >= 2) {
      window.L.polyline(bridgePoints, { color: "#0284c7", weight: 6, opacity: 0.88, dashArray: "10 6", interactive: true })
        .bindTooltip(`dev14 ${Math.round(Number(delta.lowerThresholdM || 0))}→${Math.round(Number(delta.upperThresholdM || 0))} m threshold bridge chain`, { direction: "top" })
        .addTo(graphDebugLayer);
      const first = delta?.bridgeChain?.firstNewEdge || null;
      if (first?.point && Number.isFinite(Number(first.point.lat)) && Number.isFinite(Number(first.point.lng))) {
        window.L.circleMarker(first.point, { radius: 8, weight: 3, color: "#0369a1", fillColor: "#e0f2fe", fillOpacity: 1, interactive: true })
          .bindTooltip(`dev14 第一個新增帶寬 edge<br>${escapeHtml(first.edgeId || '—')} / ${escapeHtml(first.highway || 'unknown')}${first.wayIds?.length ? `<br>way ${escapeHtml(first.wayIds.join('/'))}` : ''}<br>距手繪最遠 ${Number(first.corridorDistanceM || 0).toFixed(1)} m`, { direction: "top" })
          .addTo(graphDebugLayer);
      }
    }

    const endpointAudit = lastManualGraphDiagnosis?.replay?.endpointSnapCounterfactualAudit || null;
    const alt = endpointAudit?.bestAlternative || null;
    if (endpointAudit?.selectedSnapLikelyCause && alt) {
      const witness = alt?.witness?.points || [];
      if (witness.length >= 2) {
        window.L.polyline(witness, { color: "#059669", weight: 6, opacity: 0.9, dashArray: "8 6", interactive: true })
          .bindTooltip(`dev15 endpoint counterfactual・${Math.round(Number(endpointAudit.thresholdM || 0))} m faithful witness`, { direction: "top" })
          .addTo(graphDebugLayer);
      }
      for (const item of [alt.a, alt.b]) {
        if (!item?.point || item.current) continue;
        window.L.circleMarker(item.point, { radius: 8, weight: 3, color: "#047857", fillColor: "#d1fae5", fillOpacity: 1, interactive: true })
          .bindTooltip(`dev15 ${escapeHtml(item.id?.startsWith('A:') ? 'A' : 'B')} 替代吸附<br>${escapeHtml(item.highway || 'unknown')}${item.wayIds?.length ? `<br>way ${escapeHtml(item.wayIds.join('/'))}` : ''}<br>距端點 ${Number(item.distanceM || 0).toFixed(1)} m`, { direction: "top" })
          .addTo(graphDebugLayer);
      }
    }

    const componentTrace = lastManualGraphDiagnosis?.replay?.corridorComponentTraceAudit || null;
    if (componentTrace?.available) {
      const cf = componentTrace.connectorCounterfactual || null;
      const witness = cf?.connected ? (cf.witness?.points || []) : [];
      if (witness.length >= 2) {
        window.L.polyline(witness, { color: "#9333ea", weight: 5.5, opacity: 0.82, dashArray: "7 6", interactive: true })
          .bindTooltip(`dev16 diagnostic-only component-join witness・${Math.round(Number(componentTrace.thresholdM || 0))} m corridor`, { direction: "top" })
          .addTo(graphDebugLayer);
      }
      for (const t of (componentTrace.transitions || []).slice(0, 12)) {
        const pair = t?.nearestNodePair || null;
        const a = pair?.a?.node || null, b = pair?.b?.node || null;
        if (!a || !b || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng)) || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) continue;
        const pts = [{ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) }];
        const label = `dev16 component gap ${escapeHtml(t.fromComponentId || '—')}→${escapeHtml(t.toComponentId || '—')}<br>進度 ${Math.round(Number(t.progressRatio || 0) * 100)}%・node gap ${Number(pair.gapM || 0).toFixed(1)} m<br>${escapeHtml(t.classification || 'component-gap')}${t.commonSourceWays?.length ? `<br>共同 source way ${escapeHtml(t.commonSourceWays.join('/'))}` : ''}`;
        window.L.polyline(pts, { color: "#a21caf", weight: 4, opacity: 0.9, dashArray: "4 5", interactive: true })
          .bindTooltip(label, { direction: "top" }).addTo(graphDebugLayer);
        window.L.circleMarker(pts[0], { radius: 5.5, weight: 2, color: "#86198f", fillColor: "#fae8ff", fillOpacity: 1, interactive: true }).bindTooltip(label, { direction: "top" }).addTo(graphDebugLayer);
        window.L.circleMarker(pts[1], { radius: 5.5, weight: 2, color: "#86198f", fillColor: "#fae8ff", fillOpacity: 1, interactive: true }).bindTooltip(label, { direction: "top" }).addTo(graphDebugLayer);
      }
    }



    const sourceGapCf = lastManualGraphDiagnosis?.replay?.sourceGapCounterfactualAudit || null;
    if (sourceGapCf?.tested) {
      for (const c of (sourceGapCf.connectors || []).slice(0, 8)) {
        const pts = c.geometry || [];
        if (pts.length < 2) continue;
        const label = `dev19 diagnostic source-gap connector<br>${Number(c.gapM || c.distanceM || 0).toFixed(1)} m・進度 ${Math.round(Number(c.progressRatio || 0) * 100)}%<br>production graph 未修改`;
        window.L.polyline(pts, { color: "#be123c", weight: 5.5, opacity: 0.92, dashArray: "2 6", interactive: true })
          .bindTooltip(label, { direction: "top" }).addTo(graphDebugLayer);
      }
      const orderedPts = sourceGapCf.orderedPoints || [];
      if (orderedPts.length >= 2) {
        window.L.polyline(orderedPts, { color: "#16a34a", weight: 6, opacity: 0.78, dashArray: "8 5", interactive: true })
          .bindTooltip(`dev19 patched ordered faithful path・貼合 ${Math.round(Number(sourceGapCf.orderedCoverageRatio || 0) * 100)}%`, { direction: "top" })
          .addTo(graphDebugLayer);
      }
      const searchPts = sourceGapCf.patchedSearchPoints || [];
      if (searchPts.length >= 2) {
        window.L.polyline(searchPts, { color: "#0f766e", weight: 6.5, opacity: 0.78, dashArray: "12 6", interactive: true })
          .bindTooltip(`dev19 patched global min-sun・貼合 ${Math.round(Number(sourceGapCf.patchedSearchCoverageRatio || 0) * 100)}%`, { direction: "top" })
          .addTo(graphDebugLayer);
      }
    }

    const rawJunctionAudit = lastManualGraphDiagnosis?.replay?.rawOsmJunctionAudit || null;
    if (rawJunctionAudit?.available) {
      for (const j of (rawJunctionAudit.junctions || []).slice(0, 12)) {
        const pair = j?.nearestRawNodePair || null;
        const a = pair?.a?.node || null, b = pair?.b?.node || null;
        if (!a || !b || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng)) || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) continue;
        const pts = [{ lat:Number(a.lat), lng:Number(a.lng) }, { lat:Number(b.lat), lng:Number(b.lng) }];
        const aw = (j.fromWays || []).map((w)=>`${w.highway || 'unknown'} ${w.wayId}`).join('/') || '—';
        const bw = (j.toWays || []).map((w)=>`${w.highway || 'unknown'} ${w.wayId}`).join('/') || '—';
        const shared = (j.sharedRawNodesNearBoundary || []).map((x)=>x.nodeId).join('/') || '無';
        const label = `dev17 raw OSM junction audit<br>進度 ${Math.round(Number(j.progressRatio || 0) * 100)}%・${escapeHtml(j.classification || 'unknown')}<br>${escapeHtml(aw)} ↔ ${escapeHtml(bw)}<br>raw node gap ${Number(pair.gapM || 0).toFixed(1)} m・shared raw node ${escapeHtml(shared)}`;
        window.L.polyline(pts, { color: "#ea580c", weight: 4.5, opacity: 0.92, dashArray: "3 5", interactive: true })
          .bindTooltip(label, { direction: "top" }).addTo(graphDebugLayer);
        window.L.circleMarker(pts[0], { radius: 5, weight: 2, color: "#c2410c", fillColor: "#ffedd5", fillOpacity: 1, interactive: true }).bindTooltip(label, { direction: "top" }).addTo(graphDebugLayer);
        window.L.circleMarker(pts[1], { radius: 5, weight: 2, color: "#c2410c", fillColor: "#ffedd5", fillOpacity: 1, interactive: true }).bindTooltip(label, { direction: "top" }).addTo(graphDebugLayer);
      }
    }

    graphDebugVisible = true;
    return true;
  }

  function toggleGraphDiagnostics() {
    if (graphDebugVisible) {
      clearGraphDiagnostics();
      const button = panel?.querySelector("[data-re-graph-toggle]");
      if (button) button.textContent = "顯示 OSM Graph";
      return;
    }
    if (renderGraphDiagnostics()) {
      const button = panel?.querySelector("[data-re-graph-toggle]");
      if (button) button.textContent = "隱藏 OSM Graph";
      setStatus("OSM Graph 診斷圖層已開啟：紫色為 footway/path 類步行廊道，黃色圓點是道路/步道類型的轉換節點。點任一 edge 可看 OSM tag 與 graph shade 估計。", "");
    }
  }


  function graphAttemptLadderHtml(replay) {
    const attempts = Array.isArray(replay?.attempts) ? replay.attempts : [];
    if (!attempts.length) return '';
    const parts = attempts.map((a) => {
      const threshold = Number.isFinite(Number(a?.thresholdM)) ? `${Math.round(Number(a.thresholdM))} m` : '—';
      if (a?.graphReachedGoal === true) {
        const coverage = Number.isFinite(Number(a.coverageRatio)) ? `${Math.round(Number(a.coverageRatio) * 100)}%` : '—';
        return `${threshold}：到 B／貼合 ${coverage}${a.manualFidelityAccepted ? ' ✓' : ''}`;
      }
      const progress = Number.isFinite(Number(a?.maxProgressRatio)) ? `／最遠 ${Math.round(Number(a.maxProgressRatio) * 100)}%` : '';
      return `${threshold}：未到 B${progress}`;
    });
    return `<span><strong>容許範圍嘗試：</strong>${escapeHtml(parts.join(' → '))}</span>`;
  }

  function strictCorridorAuditHtml(replay) {
    const audits = Array.isArray(replay?.strictCorridorAudits) && replay.strictCorridorAudits.length
      ? replay.strictCorridorAudits
      : (replay?.strictCorridorAudit ? [replay.strictCorridorAudit] : []);
    if (!audits.length) return '';
    const pieces = [];
    for (const audit of audits) {
      const threshold = Math.round(Number(audit?.thresholdM || 0));
      if (audit?.connected) {
        const witness = audit.witness || null;
        const coverage = witness && Number.isFinite(Number(witness.coverageRatio)) ? `；corridor witness 對手繪覆蓋 ${Math.round(Number(witness.coverageRatio) * 100)}%` : '';
        const avg = witness && Number.isFinite(Number(witness.averageDistanceM)) ? `、平均偏移 ${Number(witness.averageDistanceM).toFixed(1)} m` : '';
        pieces.push(`<span><strong>${threshold} m 忠實走廊：</strong>A→B 在不離開這個幾何走廊的條件下仍可連通${coverage}${avg}。若 ordered matcher 同一門檻仍到不了 B，優先檢查 progress gate，而不是 OSM 連通性。</span>`);
        continue;
      }
      const a = audit?.furthestFromA || null;
      const b = audit?.earliestToB || null;
      const aPct = a && Number.isFinite(Number(a.progressRatio)) ? Math.round(Number(a.progressRatio) * 100) : null;
      const bPct = b && Number.isFinite(Number(b.progressRatio)) ? Math.round(Number(b.progressRatio) * 100) : null;
      const progressGap = Number.isFinite(Number(audit?.progressGapM)) ? `${Number(audit.progressGapM).toFixed(1)} m` : '—';
      const gap = audit?.nearestComponentGap || null;
      const physicalGap = gap && Number.isFinite(Number(gap.gapM)) ? `${Number(gap.gapM).toFixed(1)} m` : null;
      const aNode = gap?.a?.node || a?.node || null;
      const bNode = gap?.b?.node || b?.node || null;
      const aEdge = (gap?.aIncidentEdges || audit?.boundaryIncidentEdges || [])[0] || null;
      const bEdge = (gap?.bIncidentEdges || [])[0] || null;
      const aWay = aEdge?.wayIds?.length ? ` way ${escapeHtml(aEdge.wayIds.join('/'))}` : '';
      const bWay = bEdge?.wayIds?.length ? ` way ${escapeHtml(bEdge.wayIds.join('/'))}` : '';
      const componentDetail = physicalGap
        ? `；最近兩個 A/B corridor component 節點相距 ${physicalGap}（A node ${escapeHtml(aNode?.id || '—')}${aEdge?.highway ? ` ${escapeHtml(aEdge.highway)}` : ''}${aWay} ↔ B-side node ${escapeHtml(bNode?.id || '—')}${bEdge?.highway ? ` ${escapeHtml(bEdge.highway)}` : ''}${bWay}），direct edge 正向 ${gap.directForward ? '有' : '無'}／反向 ${gap.directReverse ? '有' : '無'}`
        : '';
      const cause = audit?.suspectedCause === 'strict-component-near-gap'
        ? '兩側忠實 corridor component 幾何很近，但目前 graph 沒有直接連接；下一步應查 shared node／connector／fine graph 轉換。'
        : audit?.suspectedCause === 'strict-corridor-needs-lateral-exit'
          ? '從 A 側 component 繼續前進需要先離開忠實走廊；放寬 corridor 才能繞到 B。'
          : '忠實走廊內目前沒有 A→B 連通 path；這不等於整張 OSM Graph 不連通。';
      pieces.push(`<span><strong>${threshold} m 忠實走廊：</strong>A→B 不連通；A 側可達到約 ${aPct != null ? `${aPct}%` : '—'}，B 側可反向接回到約 ${bPct != null ? `${bPct}%` : '—'}，手繪進度缺口約 ${progressGap}${componentDetail}。${escapeHtml(cause)}</span>`);
    }
    return `<span><strong>dev13 Strict Corridor Audit：</strong>把「整張 Graph 可到 B」與「手繪忠實 corridor 自己是否連通」分開檢查。</span>${pieces.join('')}`;
  }



  function thresholdDeltaAuditHtml(replay) {
    const d = replay?.thresholdDeltaAudit || null;
    if (!d) return '';
    const lower = Math.round(Number(d.lowerThresholdM || 0));
    const upper = Math.round(Number(d.upperThresholdM || 0));
    if (d.outcome === 'lower-already-connected') {
      return `<span><strong>dev14 Threshold Delta Audit：</strong>${lower} m 已經可連通，因此 ${lower}→${upper} m 並不是這次 connectivity transition 的來源。</span>`;
    }
    if (d.outcome === 'upper-still-disconnected' || d.outcome === 'upper-witness-missing') {
      return `<span><strong>dev14 Threshold Delta Audit：</strong>${lower} m 與 ${upper} m 都沒有形成 faithful-corridor A→B path；這一輪沒有「放寬 2 m 突然變通」的 transition 可解剖。</span>`;
    }
    if (!d.transitionFound) return '';

    const bridge = d.bridgeChain || {};
    const bridgeDistance = Number.isFinite(Number(bridge.distanceM)) ? `${Number(bridge.distanceM).toFixed(1)} m` : '—';
    const newDistance = Number.isFinite(Number(bridge.newlyAdmittedDistanceM)) ? `${Number(bridge.newlyAdmittedDistanceM).toFixed(1)} m` : '—';
    const maxCross = Number.isFinite(Number(bridge.maxCorridorDistanceM)) ? `${Number(bridge.maxCorridorDistanceM).toFixed(1)} m` : '—';
    const sp = bridge.startProgress && Number.isFinite(Number(bridge.startProgress.progressRatio)) ? Math.round(Number(bridge.startProgress.progressRatio) * 100) : null;
    const ep = bridge.endProgress && Number.isFinite(Number(bridge.endProgress.progressRatio)) ? Math.round(Number(bridge.endProgress.progressRatio) * 100) : null;
    const progressText = sp != null && ep != null ? `（手繪進度約 ${sp}%→${ep}%）` : '';
    const first = bridge.firstNewEdge || null;
    const firstWay = first?.wayIds?.length ? `；${first.wayIds.length > 1 ? 'source way 候選' : 'way'} ${escapeHtml(first.wayIds.join('/'))}` : '';
    const firstHighway = first?.highways?.length ? first.highways.join('/') : (first?.highway || 'unknown');
    const firstText = first
      ? `<span><strong>第一個 ${lower} m 外、${upper} m 內的新 edge：</strong>${escapeHtml(first.edgeId || '—')} / ${escapeHtml(firstHighway)}${firstWay}；edge 幾何最遠離手繪約 ${Number(first.corridorDistanceM || 0).toFixed(1)} m。</span>`
      : '';
    const dominant = bridge.dominantWay || null;
    const dominantText = dominant?.key && dominant.key !== '—'
      ? `<span><strong>bridge chain ${bridge.sourceWayProvenanceAmbiguous ? 'source way 候選' : '主要 way'}：</strong>${escapeHtml(dominant.key)} / ${escapeHtml(dominant.highway || 'unknown')}，在這段 witness 約 ${Number(dominant.distanceM || 0).toFixed(1)} m${bridge.sourceWayProvenanceAmbiguous ? '；注意 fine edge provenance 同時含多個 way，這裡不可視為單一 way 的精確歸因' : ''}。</span>`
      : '';
    const edgeTests = Array.isArray(d.edgeExclusionTests) ? d.edgeExclusionTests : [];
    const criticalEdge = d.criticalEdge || edgeTests.find((t) => t.essentialForUpperCorridor) || null;
    const edgeTestText = criticalEdge
      ? `<span><strong>Exact edge 排除測試：</strong>暫時拿掉 fine edge ${escapeHtml(criticalEdge.edgeId)} 後，${upper} m corridor <b>不再可到 B</b>；這條 edge 可被乾淨驗證為 threshold transition 的必要 graph 通道之一。</span>`
      : (edgeTests.length ? `<span><strong>Exact edge 排除測試：</strong>目前逐一排除新增帶寬 edge 後仍存在替代 A→B path，沒有單一 fine edge 可被判定為唯一必要。</span>` : '');
    const tests = Array.isArray(d.wayExclusionTests) ? d.wayExclusionTests : [];
    const testText = tests.length
      ? `<span><strong>Source way 排除測試：</strong>${tests.map((t) => `way ${escapeHtml(t.wayId)} (${escapeHtml(t.highway || 'unknown')})${t.provenanceAmbiguous ? '［fine edge 同時含多個 way，僅作保守候選］' : ''} → 排除後 ${upper} m corridor ${t.connectedWithoutWay ? '仍可到 B' : '<b>不再可到 B</b>'}`).join('；')}。</span>`
      : '';
    const criticalWay = d.criticalWay || null;
    const criticalWayCandidate = d.criticalWayCandidate || null;
    let conclusion = criticalEdge
      ? `已確認 fine edge ${escapeHtml(criticalEdge.edgeId)} 是讓 ${lower}→${upper} m transition 成立的必要 graph edge。`
      : `目前只能確認 ${upper} m witness 必須離開 ${lower} m corridor，尚未隔離出唯一必要 fine edge。`;
    if (criticalWay) {
      conclusion += ` source way ${escapeHtml(criticalWay.wayId)} 也能被乾淨隔離為必要。`;
    } else if (criticalWayCandidate?.provenanceAmbiguous) {
      conclusion += ` way ${escapeHtml(criticalWayCandidate.wayId)} 的排除結果雖會斷路，但 fine edge provenance 同時含多個 way，因此只能列為候選，不能宣告單一 OSM way 就是根因。`;
    }
    conclusion += ` 這些結果證明的是目前 graph 的 threshold transition，仍不能單憑此結果宣告真實世界或 OSM 一定缺了一段道路。`;

    return `<span><strong>dev14 Threshold Delta Audit：</strong>${lower} m 不通、${upper} m 可通；系統直接解剖 ${upper} m witness 在兩個 ${lower} m component 之間使用的 bridge chain。</span>` +
      `<span>bridge chain 約 ${bridgeDistance}${progressText}；其中真正落在 ${lower}–${upper} m 新增帶寬內的 edge 共 ${Math.round(Number(bridge.newlyAdmittedEdgeCount || 0))} 條、約 ${newDistance}；整段最大橫向距離 ${maxCross}。</span>` +
      firstText + dominantText + edgeTestText + testText + `<p>${conclusion}</p>`;
  }



  function endpointSnapCounterfactualAuditHtml(replay) {
    const d = replay?.endpointSnapCounterfactualAudit || null;
    if (!d?.available) return '';
    const threshold = Math.round(Number(d.thresholdM || 0));
    const radius = Math.round(Number(d.radiusM || 0));
    const current = d.currentPair || null;
    const curA = current?.a || null;
    const curB = current?.b || null;
    const fmtAnchor = (a) => {
      if (!a) return '—';
      const way = a.wayIds?.length ? ` / way ${escapeHtml(a.wayIds.join('/'))}` : '';
      const edge = a.edgeId ? ` / edge ${escapeHtml(a.edgeId)}` : '';
      return `${escapeHtml(a.highway || 'unknown')}${way}${edge}（端點偏移 ${Number(a.distanceM || 0).toFixed(1)} m）`;
    };
    const currentText = `<span><strong>目前 endpoint snap：</strong>A = ${fmtAnchor(curA)}；B = ${fmtAnchor(curB)}；在 ${threshold} m 忠實走廊內 ${current?.connected ? '<b>可連通</b>' : '<b>不連通</b>'}。</span>`;
    const alt = d.bestAlternative || null;
    let altText = '';
    if (alt?.connected) {
      const changed = [];
      if (!alt.a?.current) changed.push(`A → ${fmtAnchor(alt.a)}`);
      if (!alt.b?.current) changed.push(`B → ${fmtAnchor(alt.b)}`);
      const avg = Number.isFinite(Number(alt.witness?.averageDistanceM)) ? `；witness 平均偏移 ${Number(alt.witness.averageDistanceM).toFixed(1)} m` : '';
      const max = Number.isFinite(Number(alt.witness?.maxDistanceM)) ? `、最大偏移 ${Number(alt.witness.maxDistanceM).toFixed(1)} m` : '';
      altText = `<span><strong>最佳反事實吸附：</strong>${changed.join('；') || '只改 endpoint anchor'}。不補 graph edge、不改 matcher score 即可在 ${threshold} m 內 A→B${avg}${max}。</span>`;
    } else {
      const aAlts = (d.candidatesA || []).filter((x) => !x.current).slice(0, 3).map(fmtAnchor).join('；') || '無';
      const bAlts = (d.candidatesB || []).filter((x) => !x.current).slice(0, 3).map(fmtAnchor).join('；') || '無';
      altText = `<span><strong>${radius} m 內候選：</strong>A：${aAlts}；B：${bAlts}。目前沒有任何 endpoint 反事實組合恢復 ${threshold} m 忠實連通。</span>`;
    }
    const exclusion = d.upperWithoutTransitionWays || null;
    const exclusionText = exclusion
      ? `<span><strong>排除 dev14 關鍵 way 再驗：</strong>暫時排除 way ${escapeHtml((exclusion.forbiddenWayIds || []).join('/'))} 後，替代 anchor 在 ${Math.round(Number(exclusion.thresholdM || 0))} m corridor ${exclusion.connected ? '<b>仍可到 B</b>' : '<b>不再可到 B</b>'}。</span>`
      : '';
    const verdict = d.selectedSnapLikelyCause
      ? `<p><strong>dev15 判讀：</strong>endpoint snapping 已有直接反事實證據。${escapeHtml(d.interpretation || '')}</p>`
      : `<p><strong>dev15 判讀：</strong>${escapeHtml(d.interpretation || '')}</p>`;
    return `<span><strong>dev15 Endpoint Snap Counterfactual Audit：</strong>不改 routing 成本，只把 A/B 改吸到端點附近其他合法 graph edge，檢查 ${threshold} m faithful corridor 能否被恢復。</span>` + currentText + altText + exclusionText + verdict;
  }



  function corridorComponentTraceAuditHtml(replay) {
    const d = replay?.corridorComponentTraceAudit || null;
    if (!d?.available) return '';
    const threshold = Math.round(Number(d.thresholdM || 0));
    const fmtDominant = (items, fallback = '—') => (items || []).slice(0, 3).map((x) => `${escapeHtml(x.key || 'unknown')} ${Math.round(Number(x.distanceM || 0))} m`).join('、') || fallback;
    const runs = (d.componentRuns || []).filter((x) => x.componentId);
    const runText = runs.slice(0, 8).map((r) => {
      const a = Math.round(Number(r.startProgressRatio || 0) * 100), b = Math.round(Number(r.endProgressRatio || 0) * 100);
      const h = fmtDominant(r.dominantHighways, 'unknown');
      const w = (r.dominantWays || []).slice(0, 2).map((x) => x.key).filter(Boolean).join('/') || '—';
      return `${escapeHtml(r.componentId)} ${a}–${b}%：${h}；way ${escapeHtml(w)}；平均離手繪 ${Number(r.averageDistanceM || 0).toFixed(1)} m`;
    }).join(' → ');
    const head = `<span><strong>dev16 Faithful Corridor Component Trace：</strong>${threshold} m corridor 內共有 ${Math.round(Number(d.weakComponentCount || 0))} 個 weak component，其中 ${Math.round(Number(d.supportComponentCount || 0))} 個實際貼著手繪線；目前 A=${escapeHtml(d.startComponentId || '無')}、B=${escapeHtml(d.endComponentId || '無')}。</span>`;
    const sequence = runText ? `<span><strong>手繪線最近 component 序列：</strong>${runText}。</span>` : '';
    const transitionText = (d.transitions || []).slice(0, 8).map((t) => {
      const p = Math.round(Number(t.progressRatio || 0) * 100);
      const nodeGap = Number.isFinite(Number(t.nearestNodePair?.gapM)) ? `${Number(t.nearestNodePair.gapM).toFixed(1)} m` : '—';
      const geomGap = Number.isFinite(Number(t.geometryPair?.distanceM)) ? `${Number(t.geometryPair.distanceM).toFixed(1)} m` : '—';
      const ways = t.commonSourceWays?.length ? `；兩 component 仍共享 source way ${escapeHtml(t.commonSourceWays.join('/'))}` : '';
      const na = t.nearestNodePair?.a?.node?.id || '—', nb = t.nearestNodePair?.b?.node?.id || '—';
      return `${p}% ${escapeHtml(t.fromComponentId || '—')}→${escapeHtml(t.toComponentId || '—')}：node gap ${nodeGap}（${escapeHtml(na)} ↔ ${escapeHtml(nb)}），geometry gap ${geomGap}，${escapeHtml(t.classification || 'component-gap')}${ways}`;
    }).join('；');
    const transitions = transitionText ? `<span><strong>component 斷接：</strong>${transitionText}。</span>` : '';
    const cf = d.connectorCounterfactual || null;
    let cfText = '';
    if (cf?.tested) {
      const cov = Number.isFinite(Number(cf.witness?.coverageRatio)) ? `${Math.round(Number(cf.witness.coverageRatio) * 100)}%` : '—';
      const avg = Number.isFinite(Number(cf.witness?.averageDistanceM)) ? `${Number(cf.witness.averageDistanceM).toFixed(1)} m` : '—';
      cfText = `<span><strong>Diagnostic-only connector counterfactual：</strong>只在上述 component 邊界暫時加入 ${Math.round(Number(cf.connectorCount || 0))} 條雙向診斷 join（不寫回 production graph），${cf.connected ? `<b>即可恢復 directed A→B</b>；witness 貼合 ${cov}、平均偏移 ${avg}` : '<b>仍無法恢復 directed A→B</b>'}。</span>`;
    }
    return head + sequence + transitions + cfText + `<p><strong>dev16 判讀：</strong>${escapeHtml(d.interpretation || '')}</p>`;
  }


  function rawOsmJunctionAuditHtml(replay) {
    const d = replay?.rawOsmJunctionAudit || null;
    if (!d?.available) return '';
    const fmtWays = (items) => (items || []).slice(0, 4).map((w) => `${escapeHtml(w.highway || 'unknown')} / way ${escapeHtml(w.wayId || '—')}`).join(' + ') || '—';
    const classLabel = (c) => ({
      'raw-shared-node-but-fine-components-disconnected': '原始 OSM 已共享 node，但 custom fine graph 仍斷開',
      'non-noded-geometric-touch': '幾何幾乎相碰，但原始 OSM 沒有 shared node',
      'geometric-touch-with-grade-separation-tags': '幾何接近，但 layer / bridge / tunnel 顯示可能是立體交會',
      'source-way-endpoint-gap': '兩條 source way 的端點彼此接近，但原始 OSM 沒有 shared node',
      'source-topology-gap': 'source topology gap'
    }[c] || c || 'unknown');
    const rows = (d.junctions || []).slice(0, 10).map((j, i) => {
      const progress = Math.round(Number(j.progressRatio || 0) * 100);
      const shared = (j.sharedRawNodesNearBoundary || []).map((x)=>x.nodeId).join('/') || '無';
      const pair = j.nearestRawNodePair || null;
      const rawGap = Number.isFinite(Number(pair?.gapM)) ? `${Number(pair.gapM).toFixed(1)} m` : '—';
      const ep = pair ? `（${pair.a?.endpoint ? 'A側 way端點' : 'A側中間node'} ↔ ${pair.b?.endpoint ? 'B側 way端點' : 'B側中間node'}）` : '';
      const geom = Number.isFinite(Number(j.geometryGapM)) ? `${Number(j.geometryGapM).toFixed(1)} m` : '—';
      const layer = j.evidenceLayer === 'custom-graph-builder' ? '<b>builder 層</b>' : '<b>source OSM 拓樸層</b>';
      return `<span><strong>斷點 ${i+1}（手繪進度 ${progress}%）：</strong>${fmtWays(j.fromWays)} ↔ ${fmtWays(j.toWays)}；fine geometry gap ${geom}；最近 raw node gap ${rawGap}${ep}；附近 shared raw node：${escapeHtml(shared)}；判定：${escapeHtml(classLabel(j.classification))}，證據落在 ${layer}。</span>`;
    }).join('');
    const summary = `<span><strong>dev17 Raw OSM Junction / Graph Builder Audit：</strong>直接使用這次 Overpass 回傳的原始 way node 序列檢查 dev16 的 component 邊界；共 ${Math.round(Number(d.junctionCount || 0))} 個斷點，builder-loss ${Math.round(Number(d.builderLossCount || 0))}、source-gap ${Math.round(Number(d.sourceGapCount || 0))}、non-noded touch ${Math.round(Number(d.nonNodedTouchCount || 0))}。</span>`;
    return summary + rows + `<p><strong>dev17 判讀：</strong>${escapeHtml(d.interpretation || '')}</p>`;
  }

  function engineBenchmarkControlsHtml(replay) {
    if (!replay?.engineBenchmark) return '';
    return `<span><strong>Mature-engine benchmark：</strong>已準備 Valhalla pedestrian route / trace_route 與 GraphHopper foot GPX 對照 payload。執行時會把這次 A/B 與手繪 shape 傳給所設定的外部 routing service。<button type="button" data-re-engine-live>執行外部成熟引擎對照</button> <button type="button" data-re-engine-benchmark>匯出 benchmark JSON</button></span>`;
  }

  function sourceGapCounterfactualAuditHtml(replay) {
    const d = replay?.sourceGapCounterfactualAudit || null;
    if (!d?.available) return '';
    const benchmarkControls = engineBenchmarkControlsHtml(replay);
    if (!d.tested) {
      const action = d.deferred ? ' <button type="button" data-re-source-gap-live>執行完整 source-gap 因果測試</button>' : '';
      return `<span><strong>dev19 Controlled Source-Gap Counterfactual：</strong>${escapeHtml(d.interpretation || '目前沒有可安全測試的受控 source-gap connector。')}${action}</span>${benchmarkControls}`;
    }
    const pct = (v) => Number.isFinite(Number(v)) ? `${Math.round(Number(v) * 100)}%` : '—';
    const mins = (v) => Number.isFinite(Number(v)) ? formatMinutes(Number(v)) : '—';
    const dist = (v) => Number.isFinite(Number(v)) ? formatDistance(Number(v)) : '—';
    const connectors = (d.connectors || []).slice(0, 8).map((c, i) => {
      const fromWays = (c.fromWays || []).map((w) => `${escapeHtml(w.highway || 'unknown')} way ${escapeHtml(w.wayId || '—')}`).join(' + ') || '—';
      const toWays = (c.toWays || []).map((w) => `${escapeHtml(w.highway || 'unknown')} way ${escapeHtml(w.wayId || '—')}`).join(' + ') || '—';
      return `#${i + 1} ${Number(c.gapM || c.distanceM || 0).toFixed(1)} m（進度 ${Math.round(Number(c.progressRatio || 0) * 100)}%）：${fromWays} ↔ ${toWays}`;
    }).join('；');
    const strict = `<span><strong>受控 patched graph：</strong>只在診斷副本加入 ${Math.round(Number(d.connectorCount || 0))} 條 source-gap connector；14 m strict corridor ${d.strictConnected ? '<b>已恢復連通</b>' : '<b>仍不連通</b>'}。production graph mutated = <b>${d.productionGraphMutated ? '是' : '否'}</b>。</span>`;
    const densePart = d.orderedDenseShadeReconciliation?.available
      ? `；同一路徑 dense ShadeMap 日照 ${mins(d.orderedDenseDirectSunSeconds)}，coarse↔dense 差 ${Number.isFinite(Number(d.orderedCoarseDenseDeltaSeconds)) ? (Number(d.orderedCoarseDenseDeltaSeconds) / 60).toFixed(1) + ' 分' : '—'}${d.orderedCoarseDenseMaterialMismatch ? '（<b>實質不一致</b>）' : '（大致一致）'}`
      : '';
    const ordered = `<span><strong>patched ordered faithful path：</strong>${d.orderedReachedGoal ? `到 B；貼合 ${pct(d.orderedCoverageRatio)}、平均偏移 ${Number.isFinite(Number(d.orderedAverageDistanceM)) ? Number(d.orderedAverageDistanceM).toFixed(1) + ' m' : '—'}、距離 ${dist(d.orderedDistanceM)}、coarse graph 日照 ${mins(d.orderedDirectSunSeconds)}${densePart}` : '仍沒有重建到 B'}。</span>`;
    const search = `<span><strong>patched global min-sun search：</strong>${d.patchedSearchFound ? `日照 ${mins(d.patchedSearchDirectSunSeconds)}、距離 ${dist(d.patchedSearchDistanceM)}、對手繪貼合 ${pct(d.patchedSearchCoverageRatio)}；使用診斷 connector ${Math.round((d.patchedSearchUsedConnectorIds || []).length)} 條` : '沒有產生路徑'}。production 自動解 coarse 日照 ${mins(d.referenceProductionMinSunSeconds)}。</span>`;
    const rerun = '<span><button type="button" data-re-source-gap-live>重新執行完整 source-gap 因果測試</button></span>';
    return `<span><strong>dev19 Controlled Source-Gap Counterfactual：</strong>${connectors}</span>${strict}${ordered}${search}<p><strong>dev19 判讀：</strong>${escapeHtml(d.interpretation || '')}</p>${rerun}${benchmarkControls}`;
  }


  function connectorSafetyPolicyHtml(replay) {
    const d = replay?.connectorSafetyPolicy || null;
    if (!d?.available) return '';
    const label = (tier) => ({
      'fix-builder-not-connector': '修 builder，不補 connector',
      'reject-grade-separation-risk': '拒絕自動連接：疑似立體交會',
      'manual-review-large-gap': '大型缺口：僅限人工驗證',
      'near-touch-review-candidate': '近接未 noding：人工資料修正候選',
      'manual-review-source-gap': '來源缺口：人工驗證'
    }[tier] || tier || '人工驗證');
    const rows = (d.items || []).slice(0, 10).map((item, i) =>
      `<span><strong>安全規則 #${i + 1}：</strong>進度 ${Math.round(Number(item.progressRatio || 0) * 100)}%・gap ${Number.isFinite(Number(item.gapM)) ? Number(item.gapM).toFixed(1) + ' m' : '—'}・${escapeHtml(label(item.tier))}；production auto connector = <b>否</b>。${escapeHtml(item.reason || '')}</span>`
    ).join('');
    return `<span><strong>dev20 Safe Connector Policy：</strong>手繪路線只提供診斷證據，不可直接把 source-gap 升級成正式道路。成熟 ordinary router ${d.ordinaryEngineCorroboration ? '<b>已有忠實走廊交叉證據</b>' : '目前沒有忠實走廊交叉證據'}。</span>${rows}<p><strong>dev20 connector 判讀：</strong>${escapeHtml(d.interpretation || '')}</p>`;
  }

  function matureEngineCrossCheckHtml(replay) {
    const d = replay?.matureEngineCrossCheck || null;
    if (!d) return '';
    if (!d.available) return `<span><strong>dev21 Mature Engine Cross-check：</strong>${escapeHtml(d.reason || '不可用')}</span>`;
    const pct = (v) => Number.isFinite(Number(v)) ? `${Math.round(Number(v) * 100)}%` : '—';
    const meters = (v) => Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)} m` : '—';
    const row = (name, x) => {
      if (!x) return `${name}：未執行`;
      if (x.ok === false) return `${name}：失敗（${escapeHtml(x.error || 'unknown')}）`;
      if (!x.available) return `${name}：沒有 geometry`;
      const first = x.firstDivergence && Number.isFinite(Number(x.firstDivergence.progressRatio))
        ? `・首個超出 ${meters(x.fidelityThresholdM || d.fidelityThresholdM || 14)} 門檻：${Math.round(Number(x.firstDivergence.progressRatio) * 100)}% / ${meters(x.firstDivergence.distanceM)}`
        : '';
      return `${name}：${x.faithful ? '<b>忠實河堤</b>' : '非忠實河堤'}・貼合 ${pct(x.coverageRatio)}・平均偏移 ${meters(x.averageDistanceM)}・最大偏移 ${meters(x.maxDistanceM)}・距離 ${formatDistance(x.distanceM || 0)}${first}`;
    };
    const val = d.valhalla?.available
      ? `<span><strong>Valhalla：</strong>${row('ordinary pedestrian route', d.valhalla.route)}；${row('trace_route map_snap', d.valhalla.traceRoute)}。</span>`
      : `<span><strong>Valhalla：</strong>${escapeHtml(d.valhalla?.reason || '未執行')}。</span>`;
    const gh = d.graphhopper?.available
      ? `<span><strong>GraphHopper：</strong>${row('foot route', d.graphhopper.route)}；${row('GPX map-match', d.graphhopper.match)}。</span>`
      : `<span><strong>GraphHopper：</strong>${d.graphhopper?.reason === 'api-key-not-configured' ? '未設定 API key，因此本次只跑 Valhalla；可在 graphRouting.graphHopperApiKey 設定後再比對。' : escapeHtml(d.graphhopper?.reason || '未執行')}。</span>`;
    const hasGeometry = matureEngineOverlayEntries(d).length > 0;
    const mapButton = hasGeometry ? `<span><button type="button" data-re-engine-map>${engineCrossCheckVisible ? '隱藏成熟引擎路線' : '顯示成熟引擎路線'}</button> ordinary＝實線；map-match＝虛線。地圖上的短連線標示第一個超出 fidelity 門檻的位置。</span>` : '';
    const tested = d.testedAt ? `<span><small>外部引擎測試時間：${escapeHtml(String(d.testedAt))}；fidelity 門檻 ${meters(d.fidelityThresholdM || 14)}。</small></span>` : '';
    return `<span><strong>dev21 Mature Engine Cross-check：</strong>${escapeHtml(d.outcome || '')}</span>${val}${gh}${tested}${mapButton}<p><strong>dev21 engine 判讀：</strong>${escapeHtml(d.interpretation || '')}</p>`;
  }

  function enrichShadeReconciliation(diagnosis) {
    const r = diagnosis?.replay;
    const a = r?.shadeCostAudit;
    if (!r?.connected || !a?.available) return null;
    const scored = lastCandidateBundle?.scored || [];
    const manualCandidate = scored.find((c) => c?.id === "manual-drawn") || null;
    const autoGraphCandidate = scored.find((c) => c?.id === "graph-min-sun" || c?.kind === "graph-shade") || null;
    const manualFinalSunSeconds = Number(manualCandidate?.analysis?.summary?.directSunSeconds);
    const autoFinalSunSeconds = Number(autoGraphCandidate?.analysis?.summary?.directSunSeconds);
    const matchedDenseSunSeconds = Number(a.denseDirectSunSeconds);
    const matchedCoarseSunSeconds = Number(r.directSunSeconds);
    const autoCoarseSunSeconds = Number(r.autoEstimatedDirectSunSeconds);
    const walkSeconds = Number(r.walkSeconds || a.walkSeconds || 0);
    const toleranceSec = Math.max(45, walkSeconds * 0.05);
    const sameGeometryDeltaSec = Number.isFinite(matchedCoarseSunSeconds) && Number.isFinite(matchedDenseSunSeconds)
      ? matchedCoarseSunSeconds - matchedDenseSunSeconds : null;
    const manualVsMatchedDenseDeltaSec = Number.isFinite(manualFinalSunSeconds) && Number.isFinite(matchedDenseSunSeconds)
      ? matchedDenseSunSeconds - manualFinalSunSeconds : null;
    const autoSameGeometryDeltaSec = Number.isFinite(autoCoarseSunSeconds) && Number.isFinite(autoFinalSunSeconds)
      ? autoCoarseSunSeconds - autoFinalSunSeconds : null;
    const nearestGraphAvg = Number(diagnosis?.averageDistanceM);
    const mapMatchAvg = Number(r.mapMatchAverageDistanceM);
    const geometryExcessOffsetM = Number.isFinite(nearestGraphAvg) && Number.isFinite(mapMatchAvg) ? mapMatchAvg - nearestGraphAvg : null;
    const sameGeometryMismatch = sameGeometryDeltaSec != null && Math.abs(sameGeometryDeltaSec) > toleranceSec;
    const manualGeometryExposureMismatch = manualVsMatchedDenseDeltaSec != null && Math.abs(manualVsMatchedDenseDeltaSec) > toleranceSec;
    const strictCorridorFailure = r.strictFidelityAccepted === false || r.strictCorridorAudit?.connected === false;
    let outcome = "same-geometry-reconciled";
    let interpretation = "同一 ordered graph path 的 coarse edge sampler 與 dense ShadeMap 重算大致一致。";
    if (sameGeometryMismatch && manualGeometryExposureMismatch) {
      outcome = "mixed-geometry-and-shade-cost-mismatch";
      interpretation = "同一 graph path 的 coarse/dense 日照已有實質差異，而且 dense graph path 仍與手繪最終曝曬明顯不同；geometry 與 shade-cost 兩層都需追。";
    } else if (sameGeometryMismatch) {
      outcome = "shade-cost-mismatch";
      interpretation = "同一 graph geometry 在 coarse edge sampler 與 dense ShadeMap 重算之間已有實質差異；shade-cost 採樣／時間模型是主要嫌疑。";
    } else if (manualGeometryExposureMismatch || strictCorridorFailure) {
      outcome = strictCorridorFailure ? "coverage-pass-strict-corridor-fail" : "map-match-geometry-mismatch";
      interpretation = strictCorridorFailure
        ? "ordered matcher 雖達點覆蓋門檻，但 strict faithful corridor 仍不連通；coarse 與 dense 對同一 graph path 又大致一致，因此目前差異主要來自 map-match 幾何借道，而不是 shade-cost。"
        : "coarse 與 dense 對同一 graph path 大致一致，但該 graph path 與手繪路線的最終曝曬明顯不同；主要問題是 map-match geometry，不是 edge shade-cost。";
    }
    r.shadeReconciliation = {
      available: true,
      outcome,
      toleranceSec,
      manualFinalSunSeconds: Number.isFinite(manualFinalSunSeconds) ? manualFinalSunSeconds : null,
      matchedDenseSunSeconds: Number.isFinite(matchedDenseSunSeconds) ? matchedDenseSunSeconds : null,
      matchedCoarseSunSeconds: Number.isFinite(matchedCoarseSunSeconds) ? matchedCoarseSunSeconds : null,
      autoFinalSunSeconds: Number.isFinite(autoFinalSunSeconds) ? autoFinalSunSeconds : null,
      autoCoarseSunSeconds: Number.isFinite(autoCoarseSunSeconds) ? autoCoarseSunSeconds : null,
      sameGeometryDeltaSec,
      manualVsMatchedDenseDeltaSec,
      autoSameGeometryDeltaSec,
      nearestGraphAverageDistanceM: Number.isFinite(nearestGraphAvg) ? nearestGraphAvg : null,
      mapMatchAverageDistanceM: Number.isFinite(mapMatchAvg) ? mapMatchAvg : null,
      geometryExcessOffsetM,
      strictCorridorFailure,
      sameGeometryMismatch,
      manualGeometryExposureMismatch,
      interpretation
    };
    return r.shadeReconciliation;
  }

  function shadeCostReconciliationHtml(replay) {
    const a = replay?.shadeCostAudit || null;
    const r = replay?.shadeReconciliation || null;
    if (!a?.available) return '';
    const fmtS = (v) => Number.isFinite(Number(v)) ? formatMinutes(Number(v)) : '—';
    const delta = Number.isFinite(Number(a.deltaSeconds)) ? `${Number(a.deltaSeconds) >= 0 ? '+' : ''}${(Number(a.deltaSeconds) / 60).toFixed(1)} 分` : '—';
    const top = (a.topEdgeMismatches || []).slice(0, 5).map((e) => {
      const way = e.wayIds?.length ? `way ${escapeHtml(e.wayIds.join('/'))}` : 'way —';
      const d = Number(e.deltaSeconds || 0);
      return `${escapeHtml(e.edgeId || '—')} / ${escapeHtml(e.highway || 'unknown')} / ${way}：coarse ${fmtS(e.coarseDirectSunSeconds)} → dense ${fmtS(e.denseDirectSunSeconds)}（Δ ${d >= 0 ? '+' : ''}${(d/60).toFixed(1)} 分）`;
    }).join('；');
    const head = `<span><strong>dev18 Shade-Cost Reconciliation：</strong>對<strong>同一條 ordered graph path</strong>做兩次計分：搜尋器 coarse edge sampler = ${fmtS(a.coarseDirectSunSeconds)}；10 m dense ShadeMap replay = ${fmtS(a.denseDirectSunSeconds)}；差 ${delta}。${a.materialMismatch ? '<b>這個差異已達實質門檻。</b>' : '兩者在目前門檻內大致一致。'}</span>`;
    const manual = r?.available ? `<span><strong>與最終候選評分對照：</strong>手繪原線 ${fmtS(r.manualFinalSunSeconds)}；matched graph geometry 的 dense replay ${fmtS(r.matchedDenseSunSeconds)}；自動 graph 解 coarse ${fmtS(r.autoCoarseSunSeconds)} / 最終 ShadeMap ${fmtS(r.autoFinalSunSeconds)}。</span>` : '';
    const geom = r?.available ? `<span><strong>幾何忠實度：</strong>手繪線到最近 graph 平均 ${Number.isFinite(Number(r.nearestGraphAverageDistanceM)) ? Number(r.nearestGraphAverageDistanceM).toFixed(1) + ' m' : '—'}；ordered path 平均 ${Number.isFinite(Number(r.mapMatchAverageDistanceM)) ? Number(r.mapMatchAverageDistanceM).toFixed(1) + ' m' : '—'}${Number.isFinite(Number(r.geometryExcessOffsetM)) ? `，額外偏移約 ${Number(r.geometryExcessOffsetM).toFixed(1)} m` : ''}；strict corridor ${r.strictCorridorFailure ? '<b>仍失敗</b>' : '可連通'}。</span>` : '';
    const edgeRows = top ? `<span><strong>同一路徑 coarse↔dense 差異最大的 edge：</strong>${top}。</span>` : '';
    const verdict = r?.available ? `<p><strong>dev18 判讀：</strong>${escapeHtml(r.interpretation || '')}</p>` : '';
    return head + manual + geom + edgeRows + verdict;
  }

  function graphDiagnosisHtml(diagnosis) {
    if (!diagnosis?.available) return '<div class="re-graph-diagnosis is-warning">目前沒有可診斷的手繪路線或 OSM Graph。</div>';
    const coverage = Math.round((diagnosis.coverageRatio || 0) * 100);
    const overlap = Math.round((diagnosis.overlapWithSelectedRatio || 0) * 100);
    const replayOutcome = diagnosis.replay?.outcome || '';
    const reconciliationOutcome = diagnosis.replay?.shadeReconciliation?.outcome || '';
    const reconciliationWarning = reconciliationOutcome && reconciliationOutcome !== 'same-geometry-reconciled';
    const cls = diagnosis.replay?.searchMissConfirmed ? "is-bad" : replayOutcome === 'connected-low-coverage' || reconciliationWarning ? "is-warning" : coverage >= 80 ? "is-good" : coverage < 50 ? "is-bad" : "is-warning";
    const types = (diagnosis.matchedEdges || []).slice(0, 5).map((e) => `${escapeHtml(e.highway)} (${e.count})`).join("、") || "—";
    let replay = '';
    if (diagnosis.replay) {
      const r = diagnosis.replay;
      if (r.graphReachedGoal === true && r.manualFidelityAccepted === false) {
        const matchPct = Math.round((r.mapMatchCoverageRatio || 0) * 100);
        const minPct = Math.round((r.minCoverage || 0.88) * 100);
        const avg = Number.isFinite(Number(r.mapMatchAverageDistanceM)) ? `${Number(r.mapMatchAverageDistanceM).toFixed(1)} m` : '—';
        const max = Number.isFinite(Number(r.mapMatchMaxDistanceM)) ? `${Number(r.mapMatchMaxDistanceM).toFixed(1)} m` : '—';
        const score = Number.isFinite(Number(r.mapMatchScore)) ? Number(r.mapMatchScore).toFixed(1) : '—';
        const d = r.firstDivergence || null;
        const progress = d && Number.isFinite(Number(d.manualProgressRatio)) ? Math.round(Number(d.manualProgressRatio) * 100) : null;
        const coords = d?.point && Number.isFinite(Number(d.point.lat)) && Number.isFinite(Number(d.point.lng)) ? `（${Number(d.point.lat).toFixed(5)}, ${Number(d.point.lng).toFixed(5)}）` : '';
        const wayText = d?.wayIds?.length ? `；way ${escapeHtml(d.wayIds.join(', '))}` : '';
        const edgeText = d ? `<span><strong>第一個明顯偏離：</strong>${progress != null ? `約手繪進度 ${progress}%` : '位置已定位'}${coords}；離手繪線 ${Number(d.distanceM || 0).toFixed(1)} m；edge ${escapeHtml(d.edgeId || '—')} / ${escapeHtml(d.highway || 'unknown')}${wayText}。</span>` : '';
        const parallel = r.switchedToNearbyParallel
          ? `<span><strong>平行廊道判斷：</strong>是；matcher 曾切到與手繪方向近似、但橫向偏離超過貼合門檻的附近廊道${r.firstParallelDivergence?.highway ? `（${escapeHtml(r.firstParallelDivergence.highway)}）` : ''}。</span>`
          : '<span><strong>平行廊道判斷：</strong>目前未偵測到明顯的平行廊道切換。</span>';
        replay = `<span><strong>Progress-state Graph map-match：</strong>Graph 可以連到 B，但目前匹配路徑只貼合手繪線 <strong>${matchPct}%</strong>，低於 ${minPct}% 門檻。這是「低貼合匹配」，不是「拓樸不連通」。</span>` +
          `<span>使用容許範圍 ${Math.round(Number(r.corridorM || 0))} m；貼合距離門檻 ${Math.round(Number(r.fidelityThresholdM || 0))} m；平均偏移 ${avg}、最大偏移 ${max}；map-match score ${score}。</span>` +
          edgeText + parallel + graphAttemptLadderHtml(r) + strictCorridorAuditHtml(r) + thresholdDeltaAuditHtml(r) + endpointSnapCounterfactualAuditHtml(r) + corridorComponentTraceAuditHtml(r) + rawOsmJunctionAuditHtml(r) + sourceGapCounterfactualAuditHtml(r) + connectorSafetyPolicyHtml(r) + matureEngineCrossCheckHtml(r) + `<p>${escapeHtml(r.interpretation || '')}</p>`;
      } else if (r.connected) {
        const strictWarning = r.strictFidelityAccepted === false ? `<span><strong>注意：</strong>coverage 門檻雖通過，但 strict faithful corridor 並未通過；這個 ordered path 仍可能是貼著手繪線的平行廊道，不能直接當成「同一條手繪路」。</span>` : '';
        replay = `<span><strong>Progress-state Graph map-match：</strong>已依手繪線前進順序重建 A→B；貼合覆蓋 ${Math.round((r.mapMatchCoverageRatio || 0) * 100)}%、平均偏移 ${Number(r.mapMatchAverageDistanceM || 0).toFixed(1)} m；graph 距離 ${formatDistance(r.distanceM)}、graph 估計直接日照 ${formatMinutes(r.directSunSeconds)}、${r.withinDetour ? '符合' : '超過'} ${Math.round(r.detourPct || 0)}% 上限。</span>` +
          (Number.isFinite(r.autoEstimatedDirectSunSeconds) ? `<span>同一 edge 日照模型下：自動解約 ${formatMinutes(r.autoEstimatedDirectSunSeconds)}；ordered 手繪 map-match 約 ${formatMinutes(r.directSunSeconds)}。</span>` : '') +
          strictWarning + graphAttemptLadderHtml(r) + strictCorridorAuditHtml(r) + thresholdDeltaAuditHtml(r) + endpointSnapCounterfactualAuditHtml(r) + corridorComponentTraceAuditHtml(r) + rawOsmJunctionAuditHtml(r) + sourceGapCounterfactualAuditHtml(r) + connectorSafetyPolicyHtml(r) + matureEngineCrossCheckHtml(r) + shadeCostReconciliationHtml(r) +
          `<p>${escapeHtml(r.interpretation || '')}</p>`;
      } else {
        const f = r.failureDiagnostics || null;
        const bp = f?.breakpoint || null;
        const progress = f && Number.isFinite(f.maxProgressRatio) ? Math.round(f.maxProgressRatio * 100) : null;
        const where = f && Number.isFinite(f.lat) && Number.isFinite(f.lng) ? `；最佳嘗試重建到約 ${progress}%（${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}）` : (progress != null ? `；最佳嘗試重建到約 ${progress}%` : '');
        const bestCorridor = Number.isFinite(Number(f?.thresholdM)) ? `；最佳容許範圍 ${Math.round(Number(f.thresholdM))} m` : '';
        const roads = f?.nearbyHighways?.length ? `；該處 graph edge：${escapeHtml(f.nearbyHighways.join(' / '))}` : '';
        const rejected = f?.rejectCounts ? `；拒絕統計：離線 ${f.rejectCounts.tooFar || 0}、反向 ${f.rejectCounts.edgeBackwards || 0}、落後進度 ${f.rejectCounts.stateBehind || 0}、跳太前 ${f.rejectCounts.forwardJump || 0}` : '';
        let breakpointHtml = '';
        if (bp) {
          const causeLabel = bp.suspectedCause === 'near-miss-topology-gap' ? '高度疑似 OSM 未共構 connector' :
            bp.suspectedCause === 'matcher-progress-rejection' ? '較像 matcher 進度規則拒絕' :
            bp.suspectedCause === 'graph-dead-end' ? 'graph 在此形成步行死端' :
            bp.suspectedCause === 'possible-topology-gap' ? '可能是近距離拓樸斷點' : '原因尚未定案';
          const cur = bp.currentNode || {};
          const curSource = cur.sourceNodeId ? ` / OSM node ${escapeHtml(cur.sourceNodeId)}` : (cur.virtual ? ' / fine-graph 虛擬節點' : '');
          const near = bp.nearestDisconnected || null;
          const nearNode = near?.node || {};
          const nearWays = near?.wayIds?.length ? `；way ${escapeHtml(near.wayIds.join(', '))}` : '';
          const nearTypes = near?.highways?.length ? `（${escapeHtml(near.highways.join(' / '))}）` : '';
          const nearDetail = near ? `<span><strong>最近未連接候選：</strong>node ${escapeHtml(nearNode.id || '—')}${nearNode.sourceNodeId ? ` / OSM node ${escapeHtml(nearNode.sourceNodeId)}` : ''}，與目前節點相距 ${Number(near.gapM || 0).toFixed(1)} m、離手繪線 ${Number(near.routeDistanceM || 0).toFixed(1)} m、手繪進度差 ${Number(near.deltaProgressM || 0).toFixed(1)} m；direct edge 正向 ${near.forwardExists ? '有' : '無'}／反向 ${near.reverseExists ? '有' : '無'}${nearTypes}${nearWays}。</span>` : '';
          const rejectedEdges = (bp.incidentEdges || []).filter((e) => !e.accepted).slice(0, 3).map((e) => `${e.highway || 'unknown'}[${(e.wayIds || []).join('/') || 'no-way'}]→${e.rejectReason || 'reject'}`).join('；');
          const edgeDetail = rejectedEdges ? `<span><strong>目前節點被拒 edge：</strong>${escapeHtml(rejectedEdges)}</span>` : '';
          const directionDetail = Number.isFinite(Number(bp.incidentBidirectionalCount)) ? `；目前節點鄰接 edge 雙向 ${Math.round(bp.incidentBidirectionalCount || 0)}、單向 ${Math.round(bp.incidentOneWayCount || 0)}` : '';
          breakpointHtml = `<span><strong>拓樸／轉換斷點分類：</strong>${escapeHtml(causeLabel)}。目前 fine node ${escapeHtml(cur.id || f?.nodeId || '—')}${curSource}；可接受鄰接 edge ${Math.round(bp.acceptedIncidentCount || 0)}、被拒 ${Math.round(bp.rejectedIncidentCount || 0)}${directionDetail}。</span>${nearDetail}${edgeDetail}`;
        }
        replay = `<span><strong>Progress-state Graph map-match：</strong>在 ${escapeHtml((r.triedCorridorM || []).join('/'))} m 容許範圍內，Graph 真的沒有找到符合 ordered matching 約束且可到 B 的 path${where}${bestCorridor}${roads}${rejected}。</span>` +
          graphAttemptLadderHtml(r) + strictCorridorAuditHtml(r) + thresholdDeltaAuditHtml(r) + endpointSnapCounterfactualAuditHtml(r) + corridorComponentTraceAuditHtml(r) + rawOsmJunctionAuditHtml(r) + sourceGapCounterfactualAuditHtml(r) + connectorSafetyPolicyHtml(r) + matureEngineCrossCheckHtml(r) + breakpointHtml +
          `<p>dev13 會另外驗證忠實 corridor 本身是否連通；只有這一步也失敗時，才把焦點放到 corridor component／connector，而不是先調日照權重。</p>`;
      }
    }
    return `<div class="re-graph-diagnosis ${cls}"><b>手繪路線 ↔ OSM Graph 對照</b>` +
      `<span>約 <strong>${coverage}%</strong> 的手繪採樣點落在 graph ${Math.round(diagnosis.thresholdM)} m 內；與目前自動路線 edge 重疊約 <strong>${overlap}%</strong>。</span>` +
      `<span>平均離 graph ${Number(diagnosis.averageDistanceM || 0).toFixed(1)} m；最長疑似缺口約 ${Math.round(diagnosis.longestGapApproxM || 0)} m。</span>` +
      `<span>主要對應：${types}</span>${replay}<p>${escapeHtml(diagnosis.interpretation || "")}</p></div>`;
  }

  function currentManualReplayPoints() {
    if (!savedDrawnRoute?.length || savedDrawnRoute.length < 2) return [];
    const manualMatch = aPoint && bPoint ? buildManualCandidate(aPoint, bPoint, speedMpsFromPanel()) : null;
    return manualMatch?.matched && manualMatch?.candidate?.points?.length ? manualMatch.candidate.points : savedDrawnRoute;
  }

  async function diagnoseSavedManualRoute() {
    clearMatureEngineOverlay();
    if (!savedDrawnRoute?.length || savedDrawnRoute.length < 2) {
      setStatus("還沒有手繪路線。請先用『分析我自己的路線』沿河堤/道路畫一條，再回來跑 A→B。", "warning");
      return;
    }
    const api = window.HaidianPedestrianGraph;
    if (!api?.diagnosePolyline) {
      setStatus("目前版本沒有 OSM Graph 手繪診斷 API。", "error");
      return;
    }
    const replayPoints = currentManualReplayPoints();
    const diagnosis = api.diagnosePolyline(replayPoints);
    lastManualGraphDiagnosis = diagnosis;
    const box = panel?.querySelector("[data-re-graph-diagnosis]");
    if (box) box.innerHTML = graphDiagnosisHtml(diagnosis);
    if (api.replayPolyline && aPoint && bPoint) {
      setStatus("正在用「graph node + 手繪進度」做 ordered OSM Graph map-match，並用同一 edge 日照模型重算…", "drawing");
      try {
        diagnosis.replay = await api.replayPolyline(replayPoints, {
          departure: departureDateFromPanel(),
          speedMps: speedMpsFromPanel(),
          detourPct: detourCapFromPanel(),
          corridorM: config.graphRouting?.manualReplayCorridorM || 16,
          maxCorridorM: config.graphRouting?.manualReplayMaxCorridorM || 36,
          shadeConcurrency: config.graphRouting?.shadeConcurrency || 2,
          canopyTimeoutMs: config.canopyTimeoutMs,
          deferSourceGapCounterfactual: config.graphRouting?.deferSourceGapCounterfactual !== false,
          onProgress: (() => {
            let lastUiAt = 0;
            return (info) => {
              const now = Date.now();
              if (now - lastUiAt < 180 && info?.stage !== 'source-gap-complete') return;
              lastUiAt = now;
              if (info?.message) setStatus(info.message, 'drawing');
            };
          })()
        });
        enrichShadeReconciliation(diagnosis);
        if (diagnosis.replay?.graphReachedGoal === true && diagnosis.replay?.manualFidelityAccepted === false) {
          const pct = Math.round((diagnosis.replay.mapMatchCoverageRatio || 0) * 100);
          diagnosis.interpretation = `Graph 已可連到 B，但 ordered path 與手繪線只有約 ${pct}% 貼合；這是低貼合匹配，不是拓樸不連通。請優先看第一個偏離 edge / way / highway 與平行廊道判斷。`;
        } else if (diagnosis.replay && diagnosis.replay.connected === false) {
          const f = diagnosis.replay.failureDiagnostics;
          const pct = f && Number.isFinite(f.maxProgressRatio) ? Math.round(f.maxProgressRatio * 100) : null;
          diagnosis.interpretation = pct != null
            ? `手繪線幾何上貼近 OSM graph，但依前進順序只能重建到約 ${pct}%；ordered matcher 已確認這次 graph 沒有到達 B，才進一步檢查該進度附近的 topology / transition breakpoint。`
            : "手繪線幾何上貼近 OSM graph，但目前 ordered matcher 的 graph path 沒有到達 B；系統會顯示拓樸／轉換 breakpoint 與附近未連接 node。";
        }
        lastManualGraphDiagnosis = diagnosis;
        if (box) box.innerHTML = graphDiagnosisHtml(diagnosis);
        const lowFidelity = diagnosis.replay?.graphReachedGoal === true && diagnosis.replay?.manualFidelityAccepted === false;
        setStatus(
          diagnosis.replay?.searchMissConfirmed
            ? "已確認：同一 OSM Graph 內存在符合上限、且比自動解更少曬的 ordered 手繪 edge path；搜尋器仍有漏解。"
            : lowFidelity
              ? `Graph 可連到 B，但目前貼合手繪線只有 ${Math.round((diagnosis.replay?.mapMatchCoverageRatio || 0) * 100)}%；這是低貼合匹配，不是拓樸不連通。請看第一個偏離 edge / way。`
              : diagnosis.replay?.connected === false
                ? "已定位 graph 無法到 B 的最佳拓樸／轉換斷點；請看 node / way / connector 與 matcher 拒絕原因。"
                : diagnosis.replay?.shadeReconciliation?.outcome === "shade-cost-mismatch"
                  ? "dev18 已確認同一 graph geometry 的 coarse 與 dense ShadeMap 計分不一致；下一步查 shade-cost 採樣／時間模型。"
                  : diagnosis.replay?.shadeReconciliation?.outcome === "coverage-pass-strict-corridor-fail" || diagnosis.replay?.shadeReconciliation?.outcome === "map-match-geometry-mismatch"
                    ? "dev18 顯示同一路徑 coarse/dense 大致一致，但 ordered path 幾何仍不是忠實手繪路；先修 map-match／source junction，不要怪 shade-cost。"
                    : "dev18 同幾何日照 reconciliation 已完成；請看 coarse↔dense 與手繪原線的三方對照。",
          diagnosis.replay?.searchMissConfirmed || lowFidelity || diagnosis.replay?.connected === false || diagnosis.replay?.shadeReconciliation?.outcome !== "same-geometry-reconciled" ? "warning" : "ok"
        );
      } catch (error) {
        diagnosis.replay = { available: true, connected: false, reason: error?.message || String(error) };
        if (box) box.innerHTML = graphDiagnosisHtml(diagnosis);
        setStatus(`手繪 Graph 路徑重播失敗：${error?.message || error}`, "warning");
      }
    }
    if (diagnosis?.available) {
      renderGraphDiagnostics();
      if (graphDebugLayer) {
        let missIndex = 0;
        for (const hit of diagnosis.hits || []) {
          if (hit.matched) continue;
          missIndex += 1;
          const marker = window.L.circleMarker([hit.lat, hit.lng], { radius: 4.5, weight: 2, color: "#be123c", fillColor: "#fff1f2", fillOpacity: 1, interactive: true })
            .bindTooltip(`手繪線此處離 OSM graph 約 ${Math.round(hit.distanceM || 0)} m`, { direction: "top" })
            .addTo(graphDebugLayer);
          if (hit.nearest && missIndex <= 24) {
            window.L.polyline([[hit.lat, hit.lng], [hit.nearest.lat, hit.nearest.lng]], { color: "#e11d48", weight: 1.5, opacity: 0.72, dashArray: "4 5", interactive: false }).addTo(graphDebugLayer);
          }
        }
        const bp = diagnosis.replay?.failureDiagnostics?.breakpoint || null;
        if (bp?.currentNode && Number.isFinite(bp.currentNode.lat) && Number.isFinite(bp.currentNode.lng)) {
          window.L.circleMarker([bp.currentNode.lat, bp.currentNode.lng], { radius: 8, weight: 3, color: "#dc2626", fillColor: "#fef2f2", fillOpacity: 0.95, interactive: true })
            .bindTooltip(`拓樸／轉換斷點 · ${bp.suspectedCause || 'unknown'} · node ${bp.currentNode.id || '—'}`, { direction: "top" })
            .addTo(graphDebugLayer);
        }
        const near = bp?.nearestDisconnected || null;
        if (near?.node && Number.isFinite(near.node.lat) && Number.isFinite(near.node.lng)) {
          window.L.circleMarker([near.node.lat, near.node.lng], { radius: 7, weight: 3, color: "#f59e0b", fillColor: "#fffbeb", fillOpacity: 0.95, interactive: true })
            .bindTooltip(`附近未連接候選 · gap ${Number(near.gapM || 0).toFixed(1)} m · node ${near.node.id || '—'}`, { direction: "top" })
            .addTo(graphDebugLayer);
          if (bp?.currentNode && Number.isFinite(bp.currentNode.lat) && Number.isFinite(bp.currentNode.lng)) {
            window.L.polyline([[bp.currentNode.lat, bp.currentNode.lng], [near.node.lat, near.node.lng]], { color: "#f59e0b", weight: 3, opacity: 0.9, dashArray: "7 5", interactive: false }).addTo(graphDebugLayer);
          }
        }
      }
      const button = panel?.querySelector("[data-re-graph-toggle]");
      if (button) button.textContent = "隱藏 OSM Graph";
    }
  }

  function multiSourceStatusLabel(status) {
    return ({ ready: 'ready', unbound: '未綁定', 'metadata-only': '僅清冊', error: '錯誤', loading: '載入中', idle: '尚未載入' })[status] || String(status || 'unknown');
  }

  function multiSourceGapSourceText(source) {
    if (!source) return '—';
    const availability = source.availability || 'unknown';
    if (availability === 'unbound') return '未綁定（未知，不等於沒有）';
    if (source.metadataOnly) return '僅清冊／無可用 graph geometry';
    const bits = [];
    if (source.explicitSharedTopology) bits.push('shared connector ✓');
    if (source.officialContinuousGeometry) bits.push('continuous geometry ✓');
    if (Number.isFinite(Number(source.nearestFromM))) bits.push(`from ${Number(source.nearestFromM).toFixed(1)}m`);
    if (Number.isFinite(Number(source.nearestToM))) bits.push(`to ${Number(source.nearestToM).toFixed(1)}m`);
    if (source.independentProvenance) bits.push('independent provenance ✓');
    return bits.length ? bits.join(' · ') : availability;
  }


  function nationwideTilesStatusHtml() {
    const api = window.HaidianNationwideTiles;
    if (!api) return '<p class="re-fusion-note"><strong>dev28 Taiwan tiles：</strong>loader 未載入；目前仍可使用既有 AOI evidence。</p>';
    const st = api.getState?.() || {};
    const last = st.lastLoad || lastNationwideTileLoad;
    const graphLast = st.lastGraphLoad || lastNationwideGraphLoad;
    if (st.status === 'error') return `<p class="re-fusion-note"><strong>dev28 Taiwan tiles：</strong>載入錯誤 ${escapeHtml(st.error || 'unknown')}；production routing 可回退 Overpass。</p>`;
    if (!last && !graphLast) return `<p class="re-fusion-note"><strong>dev28 Taiwan tiles：</strong>${st.manifestLoaded ? `manifest ready · 全國 index ${Number(st.tileCount || 0)} tiles` : '尚未載入 manifest'}；A→B 時只會 lazy-load 路線附近 tile。</p>`;
    const counts = Object.entries(last?.sourceCounts || {}).map(([k,v]) => `${k} ${v}`).join('、');
    const evidenceText = last ? `evidence ${Number(last.loadedTileCount || 0)} tiles／${Number(last.featureCount || 0)} features${counts ? `（${escapeHtml(counts)}）` : ''}` : 'evidence 尚未載入';
    const graphText = graphLast ? `graph ${Number(graphLast.loadedTileCount || 0)} tiles／${Number(graphLast.nodeCount || 0)} nodes／${Number(graphLast.edgeCount || 0)} directed edges` : 'graph 尚未載入';
    return `<p class="re-fusion-note"><strong>dev28 Taiwan tiles：</strong>${evidenceText}；${graphText}；cache ${Number(st.cachedTileCount || 0)} evidence／${Number(st.cachedGraphTileCount || 0)} graph tiles。全國原始 ZIP 未進瀏覽器。</p>`;
  }

  async function prefetchNationwideEvidence(points, overrides = {}) {
    const api = window.HaidianNationwideTiles;
    if (!api || config.nationwideTiles?.enabled === false || config.nationwideTiles?.autoPrefetchForAB === false) return null;
    try {
      const result = await api.loadEvidenceForPolyline(points, {
        marginM: overrides.marginM ?? config.nationwideTiles?.routeBufferM,
        ring: overrides.ring ?? config.nationwideTiles?.neighborRing,
        maxTiles: overrides.maxTiles ?? config.nationwideTiles?.maxTilesPerRequest,
        attach: overrides.attach !== false
      });
      lastNationwideTileLoad = result;
      refreshMultiSourcePanel();
      return result;
    } catch (error) {
      lastNationwideTileLoad = { available: false, error: String(error?.message || error) };
      refreshMultiSourcePanel();
      console.warn('[Haidian dev28 nationwide tiles] prefetch unavailable; continuing with local routing.', error);
      return null;
    }
  }

  async function prefetchNationwideGraph(points, overrides = {}) {
    const api = window.HaidianNationwideTiles;
    if (!api || config.nationwideTiles?.enabled === false || config.nationwideTiles?.preferGraphRouting === false) return null;
    try {
      const result = await api.loadGraphForPolyline(points, {
        marginM: overrides.marginM ?? config.nationwideTiles?.graphRouteBufferM ?? config.nationwideTiles?.routeBufferM,
        ring: overrides.ring ?? config.nationwideTiles?.graphNeighborRing ?? config.nationwideTiles?.neighborRing,
        maxTiles: overrides.maxTiles ?? config.nationwideTiles?.maxGraphTilesPerRequest ?? config.nationwideTiles?.maxTilesPerRequest
      });
      result.loadStage = overrides.stage || null;
      lastNationwideGraphLoad = result;
      refreshMultiSourcePanel();
      return result;
    } catch (error) {
      lastNationwideGraphLoad = { available: false, error: String(error?.message || error), loadStage: overrides.stage || null, productionGraphMutated: false };
      refreshMultiSourcePanel();
      console.warn('[Haidian dev28 nationwide graph] lazy-load unavailable; may fall back to Overpass.', error);
      return null;
    }
  }

  function nationwideGraphLoadStages() {
    const configured = Array.isArray(config.nationwideTiles?.graphLoadStages) ? config.nationwideTiles.graphLoadStages : [];
    const stages = configured.length ? configured : [
      { marginM: config.nationwideTiles?.graphRouteBufferM ?? 220, ring: config.nationwideTiles?.graphNeighborRing ?? 0 }
    ];
    return stages.map((stage, index) => ({
      marginM: Math.max(0, Number(stage?.marginM ?? 220) || 0),
      ring: Math.max(0, Number(stage?.ring ?? 0) || 0),
      stage: index + 1
    }));
  }

  function multiSourcePanelHtml() {
    const api = window.HaidianMultiSourceEvidence;
    if (!api) return '<div class="re-multisource-note" data-re-multisource><b>dev28 Multi-source Evidence</b><span>模組未載入；production graph 未修改。</span></div>';
    const st = api.getState();
    if (st.status === 'idle') {
      return '<div class="re-multisource-note" data-re-multisource><b>dev28 Multi-source Evidence</b><span>OSM 仍是 production base graph；外部來源只作 provenance/evidence，不做 proximity 自動補橋。</span><div class="re-multisource-actions"><button type="button" data-re-multisource-load>載入多來源證據矩陣</button></div></div>';
    }
    if (st.status === 'loading') {
      return '<div class="re-multisource-note" data-re-multisource><b>dev28 Multi-source Evidence</b><span>正在讀取預處理 AOI evidence index…</span></div>';
    }
    if (st.status === 'error') {
      return `<div class="re-multisource-note is-error" data-re-multisource><b>dev28 Multi-source Evidence</b><span>讀取失敗：${escapeHtml(st.error || 'unknown')}</span><div class="re-multisource-actions"><button type="button" data-re-multisource-load>重試</button></div></div>`;
    }

    const sourceOrder = ['overture-segments','overture-connectors','nlma-sidewalk','nlma-bikeway','tainan-sidewalk','tainan-bikeway','source-gaps'];
    const sourceButtons = sourceOrder.map((key) => {
      const src = st.sources?.[key];
      if (!src) return '';
      const usable = src.status === 'ready';
      const label = `${src.visible ? '隱藏' : '顯示'} ${src.label}`;
      return `<button type="button" data-re-multisource-source="${escapeHtml(key)}" ${usable ? '' : 'disabled'}>${escapeHtml(label)} <small>${escapeHtml(multiSourceStatusLabel(src.status))}</small></button>`;
    }).join('');

    const gaps = (st.evidenceIndex?.gaps || []).map((gap) => {
      const rows = [
        ['OSM', gap.sources?.osm ? `source-gap · ${Number(gap.sources.osm.geometryGapM || gap.geometryGapM || 0).toFixed(1)}m` : '—'],
        ['Overture', multiSourceGapSourceText(gap.sources?.overture)],
        ['國土署人行道', multiSourceGapSourceText(gap.sources?.['nlma-sidewalk'])],
        ['國土署自行車道', multiSourceGapSourceText(gap.sources?.['nlma-bikeway'])],
        ['臺南人行道', multiSourceGapSourceText(gap.sources?.['tainan-sidewalk'])],
        ['臺南自行車道', multiSourceGapSourceText(gap.sources?.['tainan-bikeway'])]
      ].map(([name, value]) => `<div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(value)}</span></div>`).join('');
      return `<details class="re-evidence-gap"><summary>${escapeHtml(gap.id || 'gap')} · ${Number(gap.geometryGapM || 0).toFixed(1)}m · <b>${escapeHtml(gap.decision || 'unknown')}</b></summary><div class="re-evidence-matrix">${rows}</div><p>${escapeHtml(gap.decisionReason || '')}</p><p><strong>productionAllowed=false</strong> · ${escapeHtml(gap.productionReason || 'dev28 production lock')}</p></details>`;
    }).join('');

    const summary = st.evidenceIndex?.summary || {};
    const fusion = st.fusionPlan || {};
    const fusionApi = window.HaidianExperimentalFusionRouter;
    const fusionState = fusionApi?.getState?.() || null;
    const lastRun = fusionState?.lastRun || null;
    const fusionBusy = fusionState?.status === 'running';
    const routable = Number(fusion.routableWitnessCount || 0);
    let fusionResult = '尚未執行 experimental fused graph。先完成一次 A→B OSM graph 搜尋，sandbox 才有 production graph 可複製。';
    if (!fusionApi) fusionResult = 'Experimental fusion router 模組未載入；production graph 仍保持不變。';
    else if (fusionBusy) fusionResult = '正在 detached graph clone 上執行 experimental fused routing…';
    else if (lastRun?.available) {
      const connectors = Number(lastRun.overlay?.connectorCount || 0);
      const minSun = lastRun.search?.minSun;
      const sun = Number(minSun?.directSunSeconds);
      fusionResult = `最近一次 experimental run：${connectors} 個 source-following connector；min-sun ${Number.isFinite(sun) ? formatMinutes(sun) : '—'}；productionGraphMutated=false。`;
    } else if (lastRun?.reason) {
      fusionResult = `最近一次 experimental run 未成立：${lastRun.reason}；production graph 未修改。`;
    }
    const fusionButton = fusionApi
      ? `<button type="button" data-re-multisource-fusion-run ${routable > 0 && !fusionBusy ? '' : 'disabled'}>${fusionBusy ? 'Experimental routing…' : `執行 dev28 experimental fused graph (${routable})`}</button>`
      : '';
    const witnessNotes = (st.evidenceIndex?.gaps || []).map((gap) => {
      const w = gap.preferredFusionWitness;
      if (!w) return '';
      return `<p class="re-fusion-note"><strong>${escapeHtml(gap.id || 'gap')} pedestrian witness：</strong>${escapeHtml(w.source || 'unknown')} · ${escapeHtml(w.evidenceType || 'unknown')} · pedestrianAllowed=${w.pedestrianAllowed === true ? 'true' : 'false'} · productionAllowed=false</p>`;
    }).join('');
    return `<div class="re-multisource-note" data-re-multisource><b>dev28 Multi-source Evidence + Experimental Fusion</b><span>目前 gap ${Number(summary.gapCount || 0)}：verified ${Number(summary.verified || 0)}、manual-review ${Number(summary.manualReview || 0)}、unbound ${Number(summary.unbound || 0)}、pedestrian-routable ${routable}。<strong>未下載/未綁定只代表未知，不代表來源沒有設施。</strong></span><div class="re-multisource-actions">${sourceButtons}<button type="button" data-re-multisource-load>重新載入 index</button>${fusionButton}</div>${gaps}${witnessNotes}<p class="re-fusion-note">Experimental fusion plan：${Number(fusion.verifiedCandidateCount || 0)} 個 verified candidate；只有 independent + pedestrianAllowed=true 的 source-following witness 可進 detached clone。<strong>productionGraphMutated=false</strong>。</p><p class="re-fusion-note">${escapeHtml(fusionResult)}</p>${nationwideTilesStatusHtml()}</div>`;
  }

  function refreshMultiSourcePanel() {
    const current = panel?.querySelector('[data-re-multisource]');
    if (!current) return;
    const holder = document.createElement('div');
    holder.innerHTML = multiSourcePanelHtml();
    const next = holder.firstElementChild;
    if (next) current.replaceWith(next);
  }

  async function loadMultiSourceEvidence() {
    const api = window.HaidianMultiSourceEvidence;
    if (!api) return setStatus('dev28 multi-source evidence 模組未載入。', 'warning');
    refreshMultiSourcePanel();
    setStatus('正在載入預處理 multi-source evidence index；不會修改 production graph…', 'loading');
    const result = await api.loadEvidence();
    refreshMultiSourcePanel();
    if (result.status === 'ready') {
      const u = Number(result.evidenceIndex?.summary?.unbound || 0);
      setStatus(u ? `dev28 證據矩陣已載入；目前仍有 ${u} 個 gap 含未綁定來源，這些是未知，不是負證據。` : 'dev28 證據矩陣已載入；production graph 保持不變。', u ? 'warning' : 'ok');
    } else {
      setStatus(`multi-source evidence 載入失敗：${result.error || 'unknown'}`, 'warning');
    }
  }

  async function toggleMultiSourceOverlay(key) {
    const api = window.HaidianMultiSourceEvidence;
    if (!api) return;
    const result = await api.toggleSourceOverlay(key);
    refreshMultiSourcePanel();
    if (!result.visible && result.reason && result.reason !== 'ready') {
      setStatus(`無法顯示 ${key}：${result.reason}。若為未綁定，代表尚未取得資料，不是來源不存在。`, 'warning');
    }
  }

  async function runExperimentalFusion() {
    const evidenceApi = window.HaidianMultiSourceEvidence;
    const fusionApi = window.HaidianExperimentalFusionRouter;
    if (!evidenceApi || !fusionApi) {
      setStatus('dev28 experimental fusion 模組未完整載入；production graph 未修改。', 'warning');
      return;
    }
    let evidenceState = evidenceApi.getState?.();
    if (evidenceState?.status !== 'ready') {
      setStatus('先載入 multi-source evidence index，再建立 experimental graph。', 'loading');
      evidenceState = await evidenceApi.loadEvidence();
      refreshMultiSourcePanel();
      if (evidenceState?.status !== 'ready') {
        setStatus(`multi-source evidence 載入失敗：${evidenceState?.error || 'unknown'}`, 'warning');
        return;
      }
    }
    if (!Number(evidenceState?.fusionPlan?.routableWitnessCount || 0)) {
      setStatus('目前沒有 independent + pedestrianAllowed=true 的 verified source-following witness；不建立 experimental connector。', 'warning');
      return;
    }
    const button = panel?.querySelector('[data-re-multisource-fusion-run]');
    if (button) button.disabled = true;
    try {
      await ensureShadeReady();
      setStatus('dev28：正在 detached production-graph clone 上插入 verified pedestrian witness 並重跑 min-sun；正式 graph 完全不修改…', 'loading');
      let lastUiAt = 0;
      const result = await fusionApi.runFromLastProductionGraph({
        renderOnMap: true,
        departure: departureDateFromPanel(),
        speedMps: speedMpsFromPanel(),
        detourPct: detourCapFromPanel(),
        shadeConcurrency: config.graphRouting?.shadeConcurrency || 2,
        canopyTimeoutMs: config.canopyTimeoutMs,
        maxExpandedStates: config.graphRouting?.maxExpandedStates,
        maxShadeEdgeEvaluations: config.graphRouting?.maxShadeEdgeEvaluations,
        cooperativeYieldMs: config.graphRouting?.cooperativeYieldMs,
        yieldEveryExpanded: config.graphRouting?.yieldEveryExpanded,
        onProgress: (info) => {
          const now = Date.now();
          if (now - lastUiAt < 180) return;
          lastUiAt = now;
          if (info?.message) setStatus(`dev28 experimental：${info.message}`, 'loading');
        }
      });
      refreshMultiSourcePanel();
      if (!result?.available) {
        const reason = result?.reason || result?.search?.reason || 'experimental-fusion-unavailable';
        setStatus(`dev28 experimental fused graph 未產生可用路徑：${reason}。production graph 未修改。`, 'warning');
        return;
      }
      const connectorCount = Number(result.overlay?.connectorCount || 0);
      const minSun = result.search?.minSun;
      const sunS = Number(minSun?.directSunSeconds);
      setStatus(`dev28 experimental fused graph 完成：使用 ${connectorCount} 個 verified pedestrian witness；${Number.isFinite(sunS) ? `min-sun 直接日照 ${formatMinutes(sunS)}；` : ''}productionGraphMutated=false。`, 'ok');
    } catch (error) {
      refreshMultiSourcePanel();
      setStatus(`dev28 experimental fusion 失敗：${error?.message || error}。production graph 未修改。`, 'warning');
    } finally {
      const b = panel?.querySelector('[data-re-multisource-fusion-run]');
      if (b) b.disabled = false;
    }
  }

  function candidatesHtml(bundle) {
    const activeId = bundle.activeCandidateId || bundle.best?.id || bundle.selected?.id;
    const bestId = bundle.best?.id || bundle.selected?.id;
    const rows = bundle.scored.map((c) => {
      const s = c.analysis.summary;
      const detour = candidateDetourPct(c, bundle);
      const badges = [];
      if (c.kind === 'manual') badges.push('<em class="manual">手繪</em>');
      if (c.kind === 'experimental-fused') badges.push('<em class="fusion">官方融合</em>');
      if (c.kind === 'explore') badges.push('<em class="explore">探索</em>');
      if (c.kind === 'graph-shade' || c.kind === 'graph-fastest') badges.push(`<em class="graph">${c?.graphMeta?.backend === 'nationwide-hgr1' ? '全臺 HGR1' : 'OSM Graph'}</em>`);
      if (c.id === bestId && bundle.comparisonValid) badges.push('<em class="best">最不曬</em>');
      if (c.eligible === false) badges.push('<em class="over">超過上限</em>');
      if (c.id === activeId) badges.push('<em class="viewing">目前顯示</em>');
      return `<button type="button" class="re-candidate${c.id === activeId ? " is-selected" : ""}" data-re-candidate-id="${escapeHtml(c.id)}" aria-pressed="${c.id === activeId ? "true" : "false"}">
        <div class="re-candidate-title"><b>${escapeHtml(candidateName(c, bundle))}</b><span>${badges.join('')}</span></div>
        <div class="re-candidate-metrics"><span>${formatDistance(s.totalDistanceM)}</span><span>${s.daylightDistanceM <= 0.01 && s.nightDistanceM > 0 ? "夜間 100%" : `遮蔭 ${s.shadeRatio == null ? "—" : Math.round(s.shadeRatio * 100) + "%"}`}</span><span>日照 ${formatMinutes(s.directSunSeconds)}</span></div>
        <small>${c.kind === "experimental-fused" ? `${Number(c.experimentalFusion?.connectorCount || 0)} 個 verified witness · productionGraphMutated=${c.experimentalFusion?.productionGraphMutated === true ? "true" : "false"} · ` : ""}${detour > 0.5 ? `比最短路線多約 ${Math.round(detour)}%` : "接近最短路線"} · 點一下可切換地圖</small>
      </button>`;
    }).join('');

    let notice = '';
    if (!bundle.comparisonValid) {
      notice = `<div class="re-candidate-alert"><b>目前只有 1 條可比較路線（符合繞路上限）</b><span>已完成曝曬分析，但還不能判定真正的「最不曬」。手繪路線即使略超過上限，也會顯示在下方供你點選比較。</span><button type="button" data-re-result-draw>畫一條我的路線</button></div>`;
    } else {
      const selectedName = candidateName(bundle.best, bundle);
      notice = `<div class="re-candidate-success"><b>已比較 ${bundle.eligibleScored?.length || bundle.eligible?.length || 0} 條符合上限的候選</b><span>目前直接日照最少的是「${escapeHtml(selectedName)}」。下方每張路線卡都可以點選切換。</span></div>`;
    }

    let manualState = '';
    if (bundle.manualMatch?.matched && bundle.manualEligible) {
      manualState = '<div class="re-note re-note--manual">✓ 已在你的整條手繪線上對準 A、B，並自動截取 A→B 區段加入比較；畫在 A/B 外面的延伸不會被算進繞路。</div>';
    } else if (bundle.manualMatch?.matched && !bundle.manualEligible) {
      manualState = '<div class="re-note re-note--manual">你的手繪路線已完成分析，但超過目前設定的繞路上限；仍保留在下方供你點選比較。</div>';
    } else if (bundle.manualMatch?.available && !bundle.manualMatch?.matched) {
      manualState = `<div class="re-note">偵測到手繪路線，但整條線本身仍沒有靠近目前的 A 或 B（容許約 ${Math.round(bundle.manualMatch.toleranceM)} m），因此沒有當成同一趟 A→B。</div>`;
    }

    const rejectedCount = bundle.rejectedQuality?.length || 0;
    const qualityNote = rejectedCount > 0
      ? `<div class="re-quality-note">已自動淘汰 ${rejectedCount} 條真正返回同一位置／反向重走同一走廊的候選。一般街廓轉彎、平行街繞行不會只因短暫朝反方向就被淘汰。</div>`
      : "";

    const graphDiag = bundle.graphDiagnostics;
    const graphStats = graphDiag?.graphStats || {};
    const graphDebugAvailable = Boolean(bundle.graphDebugAvailable);
    let graphNote = "";
    if (graphDiag) {
      const nationwideBackend = graphDiag.graphBackend === 'nationwide-hgr1';
      const graphLabel = nationwideBackend ? 'dev28 全臺 HGR1 Graph' : 'v9 OSM Graph';
      const rawCount = Math.round(graphDiag.rawNodes || graphDiag.contractedNodes || 0);
      const rawEdges = Math.round(graphDiag.rawSegments || graphDiag.contractedEdges || 0);
      const pruned = Math.round(graphDiag.prunedSourceEdges || rawEdges);
      const prunePct = rawEdges > 0 ? Math.max(0, Math.round((1 - pruned / rawEdges) * 100)) : 0;
      const stageText = nationwideBackend && graphDiag.nationwideLoadStage ? `stage ${graphDiag.nationwideLoadStage}・${Math.round(graphDiag.nationwideLoadedTileCount || 0)} tiles` : '';
      const p = graphDiag.performance || {}, tp = graphDiag.nationwideTilePerformance || {};
      const perfText = nationwideBackend ? `tile ${(Number(tp.totalMs||0)/1000).toFixed(1)}s・graph ${(Number(p.totalMs||0)/1000).toFixed(1)}s` : `graph ${(Number(p.totalMs||0)/1000).toFixed(1)}s`;
      const snapLabel = nationwideBackend ? 'A、B edge 吸附' : 'A、B 行人優先 edge 吸附';
      graphNote = `<div class="re-graph-note"><b>${graphLabel} 已啟用 · dev28 fast path</b><span>${stageText ? `${stageText}；` : ''}${nationwideBackend ? '核心 tile 合併後' : '原始決策 graph'} ${rawCount} 節點／${rawEdges} source edge；detour-safe pruning 保留 ${pruned} edge（裁掉 ${prunePct}%）後才細切成 ${Math.round(graphDiag.fineNodes || graphDiag.contractedNodes || 0)} 節點／${Math.round(graphDiag.fineEdges || graphDiag.contractedEdges || 0)} edge。${snapLabel}約 ${Math.round(graphDiag.snapA?.distanceM || 0)} m／${Math.round(graphDiag.snapB?.distanceM || 0)} m。</span><span>搜尋：history-safe min-sun；展開 ${Math.round(graphDiag.searchExpandedStates || 0)} 狀態、評估 ${Math.round(graphDiag.shadeEdgeEvaluations || 0)} 條 edge 日照；${perfText}。${nationwideBackend ? ' 未呼叫 Overpass。' : ''}</span><span>dev13–18 forensic 診斷已改成按需執行，不再阻塞一般 A→B 搜尋。</span><div class="re-graph-actions"><button type="button" data-re-graph-toggle>${graphDebugVisible ? "隱藏" : "顯示"} Graph</button><button type="button" data-re-graph-diagnose>執行進階 Graph 診斷</button></div><div data-re-graph-diagnosis>${lastManualGraphDiagnosis ? graphDiagnosisHtml(lastManualGraphDiagnosis) : ""}</div></div>`;
    } else if (bundle.graphError || graphDebugAvailable) {
      graphNote = `<div class="re-graph-note is-error"><b>OSM Graph 路由沒有完成</b><span>${escapeHtml(bundle.graphError || lastGraphFailure || "graph search 未產生候選")}</span>${graphDebugAvailable ? '<span>但步行 graph 已成功建立，所以仍可直接顯示 graph、對照你的手繪河堤路線，判斷是拓樸/connector 還是搜尋成本問題。</span><div class="re-graph-actions"><button type="button" data-re-graph-toggle>顯示 OSM Graph</button><button type="button" data-re-graph-diagnose>驗證手繪 Graph 路徑</button></div><div data-re-graph-diagnosis>' + (lastManualGraphDiagnosis ? graphDiagnosisHtml(lastManualGraphDiagnosis) : '') + '</div>' : '<span>這次連 graph 都沒有建立成功；可直接再按一次「開始找最不曬」重試 Overpass。</span>'}</div>`;
    }

    return `<section class="re-candidates">
      <div class="re-candidate-head"><b>候選路線比較</b><span>最多繞路 ${Math.round(bundle.detourPct)}%</span></div>
      ${notice}${graphNote}${multiSourcePanelHtml()}${fusionManualComparisonHtml(bundle)}${manualState}${qualityNote}${rows}
      ${bundle.performance ? `<div class="re-method-note"><b>dev28 Performance：</b>總計 ${(Number(bundle.performance.totalMs||0)/1000).toFixed(1)}s；graph ${(Number(bundle.performance.graphMs||0)/1000).toFixed(1)}s；fusion ${(Number(bundle.performance.fusionMs||0)/1000).toFixed(1)}s；dense ${(Number(bundle.performance.denseScoreMs||0)/1000).toFixed(1)}s；provider ${(Number(bundle.performance.providerMs||0)/1000).toFixed(1)}s。</div>` : ''}
      <div class="re-method-note">評選以「距離上限內的直接日照時間最少」為核心，不以提高遮蔭百分比為目的。v9 細緻 graph 會保留多個時間／日照互不支配的合法狀態；走進無尾巷再原路走回仍不會成為最佳解。</div>
    </section>`;
  }

  function renderCandidateOutlines(bundle, activeId) {
    if (!comparisonLayer) comparisonLayer = createLayerGroup();
    clearLayer(comparisonLayer);
    for (const candidate of bundle.scored || []) {
      if (!candidate?.points?.length || candidate.id === activeId) continue;
      const isManual = candidate.kind === 'manual';
      const isFusion = candidate.kind === 'experimental-fused';
      window.L.polyline(candidate.points, {
        color: isManual ? '#be123c' : (isFusion ? '#0f766e' : '#64748b'),
        weight: (isManual || isFusion) ? 4 : 3,
        opacity: isManual ? 0.48 : (isFusion ? 0.5 : 0.28),
        dashArray: isManual ? '8 7' : (isFusion ? '11 6' : '5 7'),
        interactive: false
      }).addTo(comparisonLayer);
    }
  }

  function renderCandidateBundle(bundle, options = {}) {
    const el = panel?.querySelector('[data-re-results]');
    if (!el || !bundle.best) return;
    const activeId = bundle.activeCandidateId || bundle.best.id;
    const active = bundle.scored.find((c) => c.id === activeId) || bundle.best;
    bundle.activeCandidateId = active.id;
    const activeName = candidateName(active, bundle);
    const isBest = active.id === bundle.best.id && bundle.comparisonValid;
    const title = isBest ? `最不曬：${activeName}` : `正在查看：${activeName}`;
    const eyebrow = bundle.comparisonValid ? `已分析 ${bundle.scored.length} 條路線 · 點下方卡片切換` : '候選不足，先顯示曝曬分析';
    el.innerHTML = resultHtml(active.analysis, { title, eyebrow }) + candidatesHtml(bundle);
    try { window.HaidianExperimentalFusionRouter?.clearMapLayer?.(); } catch (_) {}
    clearLayer(drawLayer);
    renderCandidateOutlines(bundle, active.id);
    renderAnalyzedRoute(active.analysis, { fit: options.fit !== false && config.fitCandidateRoute !== false, weight: 7 });
    lastSelectedCandidate = active;
    lastAnalysis = active.analysis;
    syncUiState();
  }

  function selectCandidate(candidateId) {
    const bundle = lastCandidateBundle;
    if (!bundle || !candidateId) return;
    const candidate = bundle.scored.find((c) => c.id === candidateId);
    if (!candidate) return;
    bundle.activeCandidateId = candidate.id;
    renderCandidateBundle(bundle, { fit: true });
    setStatus(`目前顯示「${candidateName(candidate, bundle)}」；可再點其他候選互相比較。`, 'ok');
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
    if (map) map.getContainer().classList.remove("route-exposure-drawing");
    if (doubleClickWasEnabled === true && map?.doubleClickZoom && !map.doubleClickZoom.enabled()) map.doubleClickZoom.enable();
    doubleClickWasEnabled = null;
    syncUiState();
  }

  function startDrawMode(options = {}) {
    analysisSerial += 1;
    stopDrawMode();
    uiMode = "draw";
    if (options.reset !== false) {
      drawPoints = [];
      savedDrawnRoute = [];
      savedDrawnAnalysis = null;
      clearLayer(drawLayer);
      clearLayer(resultLayer);
      lastAnalysis = null;
    } else if (drawPoints.length < 2 && savedDrawnRoute.length >= 2) {
      drawPoints = savedDrawnRoute.map((p) => ({ lat: p.lat, lng: p.lng }));
    }
    drawMode = "route";
    if (map) map.getContainer().classList.add("route-exposure-drawing");
    if (map?.doubleClickZoom) {
      doubleClickWasEnabled = map.doubleClickZoom.enabled();
      if (doubleClickWasEnabled) map.doubleClickZoom.disable();
    }
    drawEditableRoute();
    setStatus("依序點選地圖上的路線節點；至少 2 點後就可以分析。", "drawing");
    syncUiState();
  }

  function startABMode() {
    analysisSerial += 1;
    stopDrawMode();
    uiMode = "ab";
    aPoint = null;
    bPoint = null;
    if (!endpointsLayer) endpointsLayer = createLayerGroup();
    clearLayer(endpointsLayer);
    clearLayer(resultLayer);
    renderSavedDrawnReference();
    drawMode = "a";
    if (map) map.getContainer().classList.add("route-exposure-drawing");
    setStatus("請先在地圖點選 A 起點。", "drawing");
    syncUiState();
  }

  function clearAll(clearStatus = true) {
    analysisSerial += 1;
    stopDrawMode();
    drawPoints = [];
    savedDrawnRoute = [];
    savedDrawnAnalysis = null;
    aPoint = null;
    bPoint = null;
    lastAnalysis = null;
    lastCandidates = [];
    lastSelectedCandidate = null;
    lastCandidateBundle = null;
    clearLayer(drawLayer);
    clearLayer(resultLayer);
    clearLayer(endpointsLayer);
    clearLayer(comparisonLayer);
    clearMatureEngineOverlay();
    try { window.HaidianMultiSourceEvidence?.clearOverlays?.(); } catch (_) {}
    try { window.HaidianExperimentalFusionRouter?.clearMapLayer?.(); } catch (_) {}
    const results = panel?.querySelector("[data-re-results]");
    if (results) results.innerHTML = "";
    if (clearStatus) setStatus("已重新開始。", "");
    setUiMode("home");
  }

  async function analyzeDrawnRoute() {
    if (drawPoints.length < 2) {
      setStatus("請至少點兩個路線節點。", "error");
      return;
    }
    captureDrawnRouteIfValid();
    stopDrawMode();
    analysisSerial += 1;
    const serial = analysisSerial;
    setBusy(true);
    try {
      setStatus("正在分析這條路的日照與遮蔭…", "loading");
      const analysis = await analyzeRoute(savedDrawnRoute, {
        serial,
        departure: departureDateFromPanel(),
        sampleSpacingM: spacingFromPanel(),
        speedMps: speedMpsFromPanel(),
        onProgress: (done, total) => setStatus(`正在分析 ${done}/${total} 個路段…`, "loading")
      });
      if (serial !== analysisSerial) return;
      savedDrawnAnalysis = analysis;
      lastAnalysis = analysis;
      renderAnalyzedRoute(analysis, { fit: false });
      updateResults(analysis);
      setStatus("分析完成。綠色＝遮蔭、橘色＝直接日照、灰色＝夜間。這條手繪路線也會保留給 A→B 比較。", "ok");
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
    const perfStart = nowMs();
    const perf = { providerMs: 0, graphMs: 0, fusionMs: 0, denseScoreMs: 0, totalMs: 0 };
    try {
      const departure = departureDateFromPanel();
      const speedMps = speedMpsFromPanel();
      const detourPct = detourCapFromPanel();
      lastManualGraphDiagnosis = null;

      setStatus("正在準備 A→B 候選；dev28 先載核心全臺 HGR1 tiles，只有必要時才擴張…", "loading");
      // Provider is comparison-only. Start it in parallel instead of blocking our
      // nationwide graph search. The nationwide seed intentionally uses only A/B
      // so a provider detour cannot expand the first tile request.
      const providerStarted = nowMs();
      const providerPromise = fetchRouteCandidates(aPoint, bPoint).catch((providerError) => {
        console.warn("[Haidian dev28 provider] comparison route unavailable; continuing with nationwide HGR1.", providerError);
        return [];
      }).then((items) => { perf.providerMs = nowMs() - providerStarted; return items || []; });
      const nationwideSeed = [aPoint, bPoint];

      let graphResult = null;
      let graphCandidates = [];
      let graphLoadAttempts = [];
      lastGraphFailure = null;
      if (config.graphRouting?.enabled !== false && window.HaidianPedestrianGraph?.findRoutes) {
        await ensureShadeReady();
        let lastGraphUi = 0;
        const graphProgress = (info) => {
          const now = Date.now();
          if (now - lastGraphUi < 180 && info?.stage === "search") return;
          lastGraphUi = now;
          if (serial !== analysisSerial) return;
          setStatus(info?.message || "正在搜尋 pedestrian graph…", "loading");
        };

        if (config.nationwideTiles?.enabled !== false && config.nationwideTiles?.preferGraphRouting !== false && window.HaidianPedestrianGraph?.findRoutesOnExternalGraph) {
          const graphStarted = nowMs();
          for (const stage of nationwideGraphLoadStages()) {
            if (serial !== analysisSerial) return;
            try {
              setStatus(`dev28：載入全臺 HGR1 核心路網（stage ${stage.stage}，buffer ${Math.round(stage.marginM)}m / ring ${stage.ring}）…`, "loading");
              const loaded = await prefetchNationwideGraph(nationwideSeed, stage);
              const attempt = {
                stage: stage.stage, marginM: stage.marginM, ring: stage.ring,
                loadedTileCount: Number(loaded?.loadedTileCount || 0),
                nodeCount: Number(loaded?.nodeCount || 0), edgeCount: Number(loaded?.edgeCount || 0),
                performance: loaded?.performance || null, routed: false
              };
              graphLoadAttempts.push(attempt);
              if (loaded?.available && loaded?.graph?.edges?.size) {
                graphResult = await window.HaidianPedestrianGraph.findRoutesOnExternalGraph(aPoint, bPoint, loaded.graph, {
                  departure, speedMps, detourPct,
                  bbox: loaded.bbox,
                  snapMaxM: config.graphRouting?.snapMaxM,
                  maxFineEdgeM: config.graphRouting?.maxFineEdgeM,
                  pathMaxFineEdgeM: config.graphRouting?.pathMaxFineEdgeM,
                  externalGraphDetourPrune: config.graphRouting?.externalGraphDetourPrune,
                  externalGraphPruneSlackSec: config.graphRouting?.externalGraphPruneSlackSec,
                  shadeConcurrency: config.graphRouting?.shadeConcurrency,
                  canopyTimeoutMs: config.canopyTimeoutMs,
                  maxExpandedStates: config.graphRouting?.maxExpandedStates,
                  maxShadeEdgeEvaluations: config.graphRouting?.maxShadeEdgeEvaluations,
                  cooperativeYieldMs: config.graphRouting?.cooperativeYieldMs,
                  yieldEveryExpanded: config.graphRouting?.yieldEveryExpanded,
                  shouldCancel: () => serial !== analysisSerial,
                  onProgress: graphProgress
                });
                graphCandidates = Array.isArray(graphResult?.candidates) ? graphResult.candidates : [];
                attempt.routed = graphCandidates.length > 0;
                if (graphResult?.diagnostics) {
                  graphResult.diagnostics.nationwideLoadStage = stage.stage;
                  graphResult.diagnostics.nationwideLoadMarginM = stage.marginM;
                  graphResult.diagnostics.nationwideLoadRing = stage.ring;
                  graphResult.diagnostics.nationwideLoadedTileCount = attempt.loadedTileCount;
                  graphResult.diagnostics.nationwideTilePerformance = loaded?.performance || null;
                }
                if (graphCandidates.length) break;
              }
            } catch (nationwideError) {
              if (nationwideError?.message === "ROUTE_ANALYSIS_CANCELLED") throw nationwideError;
              console.warn(`[Haidian dev28 nationwide graph] stage ${stage.stage} unavailable; expanding if another stage exists.`, nationwideError);
              lastGraphFailure = nationwideError?.message || String(nationwideError);
              graphLoadAttempts.push({ stage: stage.stage, marginM: stage.marginM, ring: stage.ring, error: lastGraphFailure, routed: false });
            }
          }
          perf.graphMs = nowMs() - graphStarted;
        }

        if (!graphCandidates.length && config.nationwideTiles?.fallbackToOverpass !== false) {
          try {
            setStatus("v9 fallback：正在讀取 OSM Overpass 步行路網…", "loading");
            const overpassStarted = nowMs();
            graphResult = await window.HaidianPedestrianGraph.findRoutes(aPoint, bPoint, {
              departure, speedMps, detourPct,
              shouldCancel: () => serial !== analysisSerial,
              onProgress: graphProgress
            });
            if (!perf.graphMs) perf.graphMs = nowMs() - overpassStarted;
            graphCandidates = Array.isArray(graphResult?.candidates) ? graphResult.candidates : [];
          } catch (graphError) {
            if (graphError?.message === "ROUTE_ANALYSIS_CANCELLED") throw graphError;
            graphResult = { available: false, error: graphError?.message || String(graphError) };
            lastGraphFailure = graphResult.error;
            console.warn("[Haidian v9 graph] nationwide + Overpass graph routing unavailable; falling back to provider candidates.", graphError);
            setStatus(`Graph 暫時未完成（${graphResult.error}）；改用一般步行候選繼續分析。`, "warning");
          }
        }
      }
      if (serial !== analysisSerial) return;

      const providerCandidates = await providerPromise;
      if (serial !== analysisSerial) return;
      let exploratoryCandidates = [];
      if (!graphCandidates.length && config.exploreCandidates !== false) {
        try { exploratoryCandidates = await fetchExploratoryCandidates(aPoint, bPoint); }
        catch (_) { exploratoryCandidates = []; }
      }
      if (serial !== analysisSerial) return;

      const manualMatch = buildManualCandidate(aPoint, bPoint, speedMps);
      let experimentalFusion = { candidate: null, status: { available: false, reason: "not-run" } };
      if (graphResult?.available !== false && graphCandidates.length && config.autoCompareVerifiedFusion !== false) {
        const fusionStarted = nowMs();
        try {
          setStatus("dev28：在 detached local graph 產生 verified official-fusion min-sun 候選…", "loading");
          experimentalFusion = await buildAutomaticExperimentalFusionCandidate({
            departure,
            speedMps,
            detourPct,
            shadeConcurrency: config.graphRouting?.shadeConcurrency || 2,
            canopyTimeoutMs: config.canopyTimeoutMs,
            maxExpandedStates: config.graphRouting?.maxExpandedStates,
            maxShadeEdgeEvaluations: config.graphRouting?.maxShadeEdgeEvaluations,
            cooperativeYieldMs: config.graphRouting?.cooperativeYieldMs,
            yieldEveryExpanded: config.graphRouting?.yieldEveryExpanded,
            shouldCancel: () => serial !== analysisSerial
          });
        } catch (fusionError) {
          experimentalFusion = { candidate: null, status: { available: false, reason: fusionError?.message || String(fusionError) } };
          console.warn("[Haidian dev28 fusion] automatic comparison unavailable", fusionError);
        } finally {
          perf.fusionMs = nowMs() - fusionStarted;
        }
      }
      if (serial !== analysisSerial) return;
      const candidates = dedupeCandidates(providerCandidates.concat(graphCandidates, exploratoryCandidates));
      if (manualMatch?.matched && manualMatch.candidate) candidates.push(manualMatch.candidate);
      if (experimentalFusion?.candidate) candidates.push(experimentalFusion.candidate);
      lastCandidates = candidates;

      setStatus(`正在用同一套 dense ShadeMap 重新精算 ${candidates.length} 條候選的曝曬…`, "loading");
      const scoreStarted = nowMs();
      const bundle = await scoreCandidates(candidates, {
        serial,
        departure,
        sampleSpacingM: spacingFromPanel(),
        speedMps,
        detourPct
      });
      perf.denseScoreMs = nowMs() - scoreStarted;
      if (serial !== analysisSerial) return;
      bundle.manualMatch = manualMatch;
      bundle.manualEligible = bundle.scored.some((candidate) => candidate.id === "manual-drawn" && candidate.eligible !== false);
      bundle.experimentalFusion = experimentalFusion;
      bundle.experimentalFusionStatus = experimentalFusion?.status || null;
      bundle.fusionManualComparison = buildFusionManualComparison(bundle);
      bundle.graphDiagnostics = graphResult?.diagnostics || null;
      bundle.graphError = graphResult?.error || null;
      bundle.graphLoadAttempts = graphLoadAttempts;
      bundle.graphDebugAvailable = Boolean(window.HaidianPedestrianGraph?.getDebugSnapshot?.()?.edges?.length);
      // dev28: forensic manual-route diagnostics are explicitly on-demand.  The
      // automatic O(samples×edges) scan was a major latency source on nationwide graphs.
      lastManualGraphDiagnosis = null;
      perf.totalMs = nowMs() - perfStart;
      bundle.performance = Object.assign({}, perf, { graphSearch: bundle.graphDiagnostics?.performance || null });
      lastCandidateBundle = bundle;
      lastSelectedCandidate = bundle.best;
      lastAnalysis = bundle.best?.analysis || null;
      renderCandidateBundle(bundle);

      // Evidence is useful for overlays/provenance but is not required to find the
      // primary route. Load it after the result is already visible so it cannot
      // compete with graph fetch/decode/search on the critical path.
      if (config.nationwideTiles?.deferEvidenceUntilRouteReady !== false) {
        const evidenceSeed = bundle.best?.points?.length ? bundle.best.points : nationwideSeed;
        void prefetchNationwideEvidence(evidenceSeed).then(() => { if (serial === analysisSerial && lastCandidateBundle === bundle) renderCandidateBundle(bundle, { fit:false }); });
      } else {
        void prefetchNationwideEvidence(nationwideSeed);
      }

      if (bundle.comparisonValid) {
        const graphText = bundle.graphDiagnostics ? (bundle.graphDiagnostics.graphBackend === 'nationwide-hgr1' ? "；已加入 dev28 全臺 HGR1 直接搜尋結果" : "；已加入 v9 OSM Graph 直接搜尋結果") : "";
        const fusionText = bundle.experimentalFusionStatus?.available ? "；已加入 dev28 verified official-fusion 候選" : "";
        setStatus(`完成：已比較 ${bundle.eligibleScored.length} 條符合繞路上限的候選${graphText}${fusionText}。耗時 ${(perf.totalMs/1000).toFixed(1)} 秒。`, "ok");
      } else {
        const suffix = bundle.graphError ? ` OSM Graph：${bundle.graphError}` : "";
        setStatus(`目前只有 1 條符合條件的候選；已完成曝曬分析，但尚不能判定真正的「最不曬」。${suffix}`, "warning");
      }
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
    downloadBlob(`haidian-route-exposure-${VERSION}.json`, JSON.stringify(clean, null, 2), "application/json;charset=utf-8");
  }

  function exportEngineBenchmark() {
    const payload = lastManualGraphDiagnosis?.replay?.engineBenchmark || null;
    if (!payload) return setStatus("目前沒有可匯出的 mature-engine benchmark；請先按『驗證手繪 Graph 路徑』。", "warning");
    const withResult = lastManualGraphDiagnosis?.replay?.matureEngineCrossCheck
      ? Object.assign({}, payload, { liveCrossCheck: lastManualGraphDiagnosis.replay.matureEngineCrossCheck })
      : payload;
    downloadBlob(`haidian-engine-benchmark-${VERSION}.json`, JSON.stringify(withResult, null, 2), "application/json;charset=utf-8");
    setStatus("已匯出 Valhalla / GraphHopper 對照 benchmark JSON；這份資料不會修改 OSM 或 production graph。", "ok");
  }

  async function runSourceGapCounterfactualLive() {
    const replay = lastManualGraphDiagnosis?.replay || null;
    const api = window.HaidianPedestrianGraph;
    const replayPoints = currentManualReplayPoints();
    if (!replay || !replayPoints.length || !api?.runSourceGapCounterfactualAudit) {
      setStatus("目前沒有可執行的 source-gap 因果測試；請先按『驗證手繪 Graph 路徑』。", "warning");
      return;
    }
    const button = panel?.querySelector("[data-re-source-gap-live]");
    if (button) { button.disabled = true; button.textContent = "source-gap 因果測試中…"; }
    setStatus("正在只對診斷副本補 source-gap，重新跑 faithful path、dense ShadeMap 與 patched global min-sun；production graph 不會改動…", "loading");
    let lastUiAt = 0;
    try {
      const result = await api.runSourceGapCounterfactualAudit(replayPoints, {
        departure: departureDateFromPanel(),
        speedMps: speedMpsFromPanel(),
        detourPct: detourCapFromPanel(),
        manualReplayFidelityThresholdM: config.graphRouting?.manualReplayFidelityThresholdM || 14,
        sourceGapCounterfactualEnabled: true,
        sourceGapCounterfactualMaxGapM: config.graphRouting?.sourceGapCounterfactualMaxGapM || 55,
        sourceGapCounterfactualStrictM: config.graphRouting?.sourceGapCounterfactualStrictM || 14,
        shadeConcurrency: config.graphRouting?.shadeConcurrency || 2,
        canopyTimeoutMs: config.canopyTimeoutMs,
        onProgress: (info) => {
          const now = Date.now();
          if (now - lastUiAt < 160 && info?.stage !== 'source-gap-complete') return;
          lastUiAt = now;
          if (info?.message) setStatus(info.message, 'loading');
        }
      });
      if (!result?.available) throw new Error(result?.reason || 'source-gap audit unavailable');
      replay.sourceGapCounterfactualAudit = result.audit;
      replay.connectorSafetyPolicy = result.connectorSafetyPolicy;
      replay.engineBenchmark = result.engineBenchmark || replay.engineBenchmark;
      replay.corridorComponentTraceAudit = result.corridorComponentTraceAudit || replay.corridorComponentTraceAudit;
      replay.rawOsmJunctionAudit = result.rawOsmJunctionAudit || replay.rawOsmJunctionAudit;
      const box = panel?.querySelector("[data-re-graph-diagnosis]");
      if (box) box.innerHTML = graphDiagnosisHtml(lastManualGraphDiagnosis);
      setStatus(`完整 source-gap 因果測試完成：${result.audit?.outcome || 'done'}。production graph 未修改。`, result.audit?.outcome === 'source-gaps-causally-explain-search-miss' ? 'ok' : 'warning');
    } catch (error) {
      setStatus(`source-gap 因果測試失敗：${error?.message || error}。已保留快速 topology / engine benchmark 結果。`, "warning");
    } finally {
      const fresh = panel?.querySelector("[data-re-source-gap-live]");
      if (fresh) { fresh.disabled = false; fresh.textContent = "重新執行完整 source-gap 因果測試"; }
    }
  }

  async function runMatureEngineCrossCheck() {
    const replay = lastManualGraphDiagnosis?.replay || null;
    const manifest = replay?.engineBenchmark || null;
    const api = window.HaidianPedestrianGraph;
    if (!manifest || !api?.runMatureEngineBenchmark) {
      setStatus("目前沒有可執行的 mature-engine benchmark；請先按『驗證手繪 Graph 路徑』。", "warning");
      return;
    }
    const button = panel?.querySelector("[data-re-engine-live]");
    if (button) { button.disabled = true; button.textContent = "成熟引擎比對中…"; }
    setStatus("正在用同一 A/B 與手繪 shape 對照 Valhalla pedestrian routing / map matching；GraphHopper 需 API key 才會一起執行。", "loading");
    try {
      const live = await api.runMatureEngineBenchmark(manifest, {
        matureEngineCrossCheckEnabled: config.graphRouting?.matureEngineCrossCheckEnabled !== false,
        timeoutMs: config.graphRouting?.matureEngineTimeoutMs || 15000,
        maxShapePoints: config.graphRouting?.matureEngineShapeMaxPoints || 180,
        fidelityThresholdM: config.graphRouting?.manualReplayFidelityThresholdM || 14,
        valhallaEndpoint: config.graphRouting?.valhallaBenchmarkEndpoint,
        valhallaClientId: config.graphRouting?.valhallaClientId,
        valhallaMinIntervalMs: config.graphRouting?.valhallaMinIntervalMs,
        graphHopperEndpoint: config.graphRouting?.graphHopperBenchmarkEndpoint,
        graphHopperApiKey: config.graphRouting?.graphHopperApiKey
      });
      replay.matureEngineCrossCheck = live;
      if (api?._internals?.sourceGapConnectorSafetyPolicy) {
        replay.connectorSafetyPolicy = api._internals.sourceGapConnectorSafetyPolicy(
          replay.rawOsmJunctionAudit,
          replay.sourceGapCounterfactualAudit,
          live,
          {
            safeConnectorNearTouchM: config.graphRouting?.safeConnectorNearTouchM,
            safeConnectorReviewGapM: config.graphRouting?.safeConnectorReviewGapM
          }
        );
      }
      renderMatureEngineOverlay(live);
      const box = panel?.querySelector("[data-re-graph-diagnosis]");
      if (box) box.innerHTML = graphDiagnosisHtml(lastManualGraphDiagnosis);
      const outcome = live?.outcome || "engine-crosscheck-inconclusive";
      const tone = outcome === "ordinary-engine-finds-faithful-corridor" || outcome === "map-matching-only-follows-faithful-corridor" ? "ok" : "warning";
      setStatus(`成熟引擎對照完成：${outcome}。這只作交叉驗證，不會修改 production graph 或 OSM。`, tone);
    } catch (error) {
      setStatus(`成熟引擎對照失敗：${error?.message || error}。仍可匯出 benchmark JSON 後以外部/self-hosted 引擎重跑。`, "warning");
    } finally {
      const fresh = panel?.querySelector("[data-re-engine-live]");
      if (fresh) { fresh.disabled = false; fresh.textContent = "重新執行成熟引擎對照"; }
    }
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
    downloadBlob(`haidian-route-exposure-${VERSION}.csv`, rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8");
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
      body.haidian-v4 #rightToolsWrapper>.route-exposure-tool,body.haidian-v4-mode-idle #rightToolsWrapper>.route-exposure-tool,body.haidian-v4-mode-walk #rightToolsWrapper>.route-exposure-tool,body.haidian-v4-mode-data #rightToolsWrapper>.route-exposure-tool{pointer-events:auto!important}
      @media(min-width:601px){#rightToolsWrapper>.route-exposure-tool{order:3!important;width:52px!important;min-width:52px!important;height:52px!important;min-height:52px!important;margin:0!important;flex:0 0 52px!important;align-self:flex-end!important;z-index:4504!important}#rightToolsWrapper>.tools-toggle-btn[onclick*="toggleRightToolsPanel"]{order:4!important}#rightToolsWrapper>.tools-menu-container{order:5!important}#rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden)>button.route-exposure-tool{order:3!important;position:relative!important;inset:auto!important;width:32px!important;min-width:32px!important;height:32px!important;min-height:32px!important;margin:0!important;padding:0!important;flex:0 0 32px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;color:#12333b!important;background:rgba(255,255,255,.98)!important;border:1px solid #b7d8d4!important;border-radius:10px!important;box-shadow:0 5px 14px rgba(13,47,53,.14)!important;pointer-events:auto!important;transform:none!important;z-index:4516!important}#rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden)>.tools-toggle-btn[onclick*="toggleRightToolsPanel"]{order:4!important}#rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden)>#rightToolsCompactClose{order:5!important}#rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden)>.tools-menu-container{order:6!important}#rightToolsWrapper.open:not(.haidian-v4-tools-user-hidden)>button.route-exposure-tool svg{width:16px!important;height:16px!important;max-width:16px!important;max-height:16px!important;pointer-events:none!important}}
      .re-panel{position:absolute;top:86px;right:74px;z-index:4600;width:min(430px,calc(100vw - 96px));max-height:calc(100dvh - 110px);overflow:auto;box-sizing:border-box;color:#153d47;background:rgba(255,255,255,.98);border:1px solid rgba(15,118,110,.18);border-radius:22px;box-shadow:0 24px 64px rgba(15,23,42,.24);font-family:"Helvetica Neue",Arial,"Microsoft JhengHei",sans-serif;opacity:0;visibility:hidden;transform:translateY(-8px) scale(.985);transition:.18s ease;pointer-events:none}
      .re-panel.is-open{opacity:1;visibility:visible;transform:none;pointer-events:auto}.re-panel[hidden],[hidden]{display:none!important}.re-head{position:sticky;top:0;z-index:4;display:flex;justify-content:space-between;align-items:center;padding:15px 17px 12px;background:rgba(255,255,255,.97);backdrop-filter:blur(10px);border-bottom:1px solid #e7efee}.re-head small{display:block;color:#0f766e;font-size:11.5px;font-weight:900;letter-spacing:.07em}.re-head h2{margin:3px 0 0;font-size:20px}.re-close{width:34px;height:34px;display:grid;place-items:center;border:1px solid #d8e5e3;border-radius:11px;background:#fff;color:#31545b;cursor:pointer}.re-close svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2.2}.re-body{padding:15px 17px 18px}
      .re-home-intro{margin:0 0 14px;color:#475569;font-size:14px;line-height:1.65}.re-mode-grid{display:grid;gap:10px}.re-mode-card{width:100%;display:grid;grid-template-columns:42px 1fr auto;gap:11px;align-items:center;padding:14px;text-align:left;border:1px solid #dbe8e6;border-radius:16px;background:#fff;cursor:pointer;transition:.18s}.re-mode-card:hover{border-color:#6ee7b7;box-shadow:0 10px 24px rgba(15,118,110,.1);transform:translateY(-1px)}.re-mode-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:#ecfdf5;font-size:20px}.re-mode-copy b{display:block;color:#134e4a;font-size:16px}.re-mode-copy span{display:block;margin-top:4px;color:#64748b;font-size:13px;line-height:1.5}.re-mode-arrow{color:#94a3b8;font-size:20px}
      .re-workflow-top{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px}.re-back{border:0;background:#f1f5f9;color:#475569;border-radius:9px;padding:7px 9px;font-weight:900;cursor:pointer}.re-workflow-top h3{margin:0;color:#123f46;font-size:17px}.re-workflow-top p{margin:4px 0 0;color:#64748b;font-size:13px;line-height:1.5}.re-step{margin-top:10px;padding:12px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}.re-step-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}.re-step-no{width:23px;height:23px;display:grid;place-items:center;border-radius:50%;background:#0f766e;color:#fff;font-size:11px;font-weight:950}.re-step-head b{font-size:14px;color:#334155}.re-field label{display:block;margin:0 0 6px;color:#64748b;font-size:12.5px;font-weight:850}.re-field input{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #cfdedc;border-radius:10px;background:#fff;color:#163d44;font-weight:750;font-size:13px}.re-progress{margin:8px 0 11px;padding:9px 10px;border-radius:9px;background:#f8fafc;color:#475569;font-size:12.5px;font-weight:750}.re-primary,.re-secondary,.re-link-btn,.re-chip,.re-export button,.re-candidate-alert button{border-radius:11px;font-weight:900;cursor:pointer}.re-primary{width:100%;min-height:44px;border:1px solid #0f766e;background:#0f766e;color:#fff;padding:10px 12px;font-size:14px}.re-secondary{width:100%;min-height:40px;margin-top:7px;border:1px solid #99c7c1;background:#fff;color:#0f766e;font-size:13px}.re-primary:disabled,.re-secondary:disabled,.re-link-btn:disabled{opacity:.45;cursor:not-allowed}.re-endpoints{padding:10px 11px;margin-bottom:10px;border-radius:10px;background:#f8fafc;color:#475569;font-size:12.5px;font-weight:800}.re-endpoints span{display:inline-flex;padding:2px 6px;border-radius:999px;background:#e2e8f0;color:#475569}.re-endpoints span.ok{background:#dcfce7;color:#166534}.re-chips{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.re-chip{min-height:38px;border:1px solid #cfdedc;background:#fff;color:#475569;font-size:13px}.re-chip.is-active{border-color:#0f766e;background:#ecfdf5;color:#047857}.re-detour-custom{display:grid;grid-template-columns:1fr 90px;gap:8px;align-items:center;margin-top:8px;color:#64748b;font-size:12px;font-weight:750}.re-detour-custom input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #d7e2e0;border-radius:9px}.re-manual-note{margin-top:9px;padding:9px 10px;border-radius:9px;background:#fff1f2;color:#9f1239;font-size:12px;font-weight:750;line-height:1.5}
      .re-advanced{margin-top:11px;border-top:1px solid #edf2f1;padding-top:9px}.re-advanced summary,.re-export summary{cursor:pointer;color:#64748b;font-size:12px;font-weight:850}.re-advanced-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.re-bottom-actions{display:flex;justify-content:center;margin-top:12px}.re-link-btn{border:0;background:transparent;color:#64748b;padding:7px 10px;text-decoration:underline;text-underline-offset:3px}.re-cancel-wrap{margin-top:10px;padding:9px;border-radius:10px;background:#eff6ff;color:#1d4ed8;text-align:center;font-size:12px;font-weight:800}.re-cancel-wrap button{margin-left:8px;border:1px solid #93c5fd;border-radius:8px;background:#fff;color:#1d4ed8;font-weight:900;cursor:pointer}
      .re-status{margin:12px 0 0;padding:10px 11px;border-radius:10px;background:#f8fafc;color:#475569;font-size:13px;font-weight:750;line-height:1.55}.re-status[data-tone="error"]{background:#fff1f2;color:#be123c}.re-status[data-tone="ok"]{background:#ecfdf5;color:#047857}.re-status[data-tone="loading"]{background:#eff6ff;color:#1d4ed8}.re-status[data-tone="drawing"]{background:#fffbeb;color:#a16207}.re-status[data-tone="warning"]{background:#fff7ed;color:#9a3412}
      .re-results{margin-top:12px}.re-result-card{padding:13px;border:1px solid #dce9e7;border-radius:16px;background:linear-gradient(145deg,#fff,#f7fbfa)}.re-result-eyebrow{color:#0f766e;font-size:11.5px;font-weight:900;letter-spacing:.04em}.re-result-card h3{margin:5px 0 12px;color:#123f46;font-size:17px}.re-result-hero{display:grid;grid-template-columns:1fr 1fr;gap:8px}.re-result-hero>div{padding:12px;border-radius:13px}.re-result-hero span{display:block;font-size:12px;font-weight:850}.re-result-hero b{display:block;margin-top:3px;font-size:24px}.re-result-hero .shade{background:#ecfdf5;color:#047857}.re-result-hero .night{background:#f1f5f9;color:#475569}.re-result-hero .sun{background:#fff7ed;color:#c2410c}.re-result-sentence{margin:11px 0 0;color:#334155;font-size:13.5px;line-height:1.6}.re-result-details{margin-top:10px}.re-result-details summary{cursor:pointer;color:#64748b;font-size:12px;font-weight:850}.re-summary-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:8px}.re-summary-grid>div{padding:9px 7px;border:1px solid #e2e8f0;border-radius:11px;background:#fff}.re-summary-grid span{display:block;color:#64748b;font-size:11.5px;font-weight:800}.re-summary-grid b{display:block;margin-top:3px;color:#0f3d46;font-size:14px}.re-note,.re-warn,.re-heat{margin-top:9px;padding:10px 11px;border-radius:10px;font-size:12px;line-height:1.55;font-weight:700}.re-note{background:#f1f5f9;color:#475569}.re-note--manual{background:#fff1f2;color:#9f1239}.re-warn{background:#fff7ed;color:#9a3412}.re-heat{display:grid;gap:3px;background:#fff7ed;color:#9a3412}.re-heat small{color:#7c5a45}
      .re-candidates{margin-top:11px}.re-candidate-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;color:#334155;font-size:13px}.re-candidate-head span{color:#64748b;font-size:11.5px}.re-candidate-alert,.re-candidate-success{display:grid;gap:5px;padding:11px;border-radius:11px;font-size:12.5px;line-height:1.55}.re-candidate-alert{background:#fff7ed;color:#9a3412}.re-candidate-success{background:#ecfdf5;color:#047857}.re-quality-note{margin-top:8px;padding:10px 11px;border-radius:11px;background:#f8fafc;border:1px solid #cbd5e1;color:#475569;font-size:12.5px;line-height:1.55;font-weight:750}.re-candidate-alert button{justify-self:start;margin-top:3px;padding:6px 8px;border:1px solid #fdba74;background:#fff;color:#9a3412}.re-candidate{width:100%;display:grid;gap:5px;padding:12px;margin-top:8px;border:1px solid #dbe5e4;border-radius:12px;background:#fff;text-align:left;font:inherit;cursor:pointer;transition:.16s}.re-candidate:hover{border-color:#5eead4;box-shadow:0 6px 16px rgba(15,118,110,.10);transform:translateY(-1px)}.re-candidate.is-selected{border-color:#10b981;background:#ecfdf5;box-shadow:0 0 0 2px rgba(16,185,129,.10)}.re-candidate-title{display:flex;justify-content:space-between;gap:8px}.re-candidate-title b{font-size:14px;color:#0f766e}.re-candidate-title em{display:inline-block;margin-left:4px;padding:2px 6px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:10px;font-style:normal;font-weight:900}.re-candidate-title em.best{background:#dcfce7;color:#166534}.re-candidate-title em.manual{background:#ffe4e6;color:#9f1239}.re-candidate-title em.explore{background:#e0f2fe;color:#0369a1}.re-candidate-title em.graph{background:#ede9fe;color:#6d28d9}.re-candidate-title em.fusion{background:#ccfbf1;color:#0f766e}.re-candidate-title em.over{background:#ffedd5;color:#9a3412}.re-candidate-title em.viewing{background:#ccfbf1;color:#115e59}.re-candidate-metrics{display:flex;flex-wrap:wrap;gap:10px;color:#334155;font-size:12.5px;font-weight:750}.re-candidate small{color:#64748b;font-size:11.5px;line-height:1.45}.re-graph-note{display:grid;gap:4px;margin:8px 0;padding:10px 11px;border-radius:11px;background:#f5f3ff;border:1px solid #ddd6fe;color:#5b21b6;font-size:12.5px;line-height:1.5}.re-graph-note b{font-size:13px}.re-fusion-compare{display:grid;gap:5px;margin:9px 0;padding:11px;border-radius:11px;background:#f0fdfa;border:1px solid #99f6e4;color:#115e59;font-size:12.5px;line-height:1.55}.re-fusion-compare b{font-size:13px;color:#0f766e}.re-method-note{margin-top:9px;color:#64748b;font-size:11px;line-height:1.55}.re-export{margin-top:10px}.re-export div{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.re-export button{min-height:36px;border:1px solid #cfdedc;background:#fff;color:#0f766e}
      .re-graph-note.is-error{background:#fff7ed;border-color:#fdba74;color:#9a3412}.re-graph-note.is-error .re-graph-actions button{border-color:#fdba74;color:#9a3412}
      .re-graph-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.re-graph-actions button{min-height:36px;padding:8px 11px;border:1px solid #c4b5fd;border-radius:10px;background:#fff;color:#5b21b6;font-size:12.5px;font-weight:900;cursor:pointer}.re-graph-actions button:hover{background:#f5f3ff}.re-graph-diagnosis{display:grid;gap:5px;margin-top:9px;padding:10px 11px;border-radius:11px;background:#f8fafc;border:1px solid #cbd5e1;color:#334155;font-size:12.5px;line-height:1.5}.re-graph-diagnosis b{font-size:13px}.re-graph-diagnosis span{display:block}.re-graph-diagnosis p{margin:2px 0 0;font-weight:800}.re-graph-diagnosis.is-good{background:#ecfdf5;border-color:#86efac;color:#166534}.re-graph-diagnosis.is-warning{background:#fffbeb;border-color:#fde68a;color:#92400e}.re-graph-diagnosis.is-bad{background:#fff1f2;border-color:#fecdd3;color:#9f1239}
      .re-time-step{border-color:#99d9cf;background:linear-gradient(145deg,#f0fdfa,#ffffff)}
      .re-time-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;margin-bottom:9px;border-radius:11px;background:#fff;border:1px solid #cce8e3}.re-time-summary span{color:#64748b;font-size:12.5px;font-weight:800}.re-time-summary strong{color:#075a63;font-size:16px;font-weight:950}
      .re-time-quick{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px}.re-time-quick button{min-height:38px;border:1px solid #b8d9d4;border-radius:10px;background:#fff;color:#0f766e;font-size:13px;font-weight:900;cursor:pointer}.re-time-quick button:hover{background:#ecfdf5;border-color:#5eead4}
      .re-time-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:8px;margin-bottom:10px}.re-time-grid label{display:grid;gap:5px;color:#64748b;font-size:12px;font-weight:850}.re-time-grid input{width:100%;box-sizing:border-box;min-height:42px;padding:8px 10px;border:1px solid #cfdedc;border-radius:10px;background:#fff;color:#123f46;font-size:14px;font-weight:800}
      .re-time-next{margin-top:2px;box-shadow:0 7px 18px rgba(15,118,110,.18)}.re-time-hint{margin:8px 1px 0;color:#64748b;font-size:12px;line-height:1.5;font-weight:700}
      .re-draw-warning{margin:8px 0 10px;padding:10px 11px;border:1px solid #fdba74;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:12.5px;line-height:1.55;font-weight:800}
      .re-multisource-note{display:grid;gap:7px;margin:9px 0;padding:10px 11px;border:1px solid #bae6fd;border-radius:12px;background:#f0f9ff;color:#0c4a6e;font-size:12px;line-height:1.5}.re-multisource-note>b{font-size:13px}.re-multisource-note.is-error{background:#fff1f2;border-color:#fecdd3;color:#9f1239}.re-multisource-actions{display:flex;flex-wrap:wrap;gap:6px}.re-multisource-actions button{min-height:34px;padding:7px 9px;border:1px solid #7dd3fc;border-radius:9px;background:#fff;color:#075985;font-size:11.5px;font-weight:900;cursor:pointer}.re-multisource-actions button:disabled{opacity:.5;cursor:not-allowed}.re-multisource-actions small{font-size:9px;opacity:.7}.re-evidence-gap{border-top:1px solid #bae6fd;padding-top:6px}.re-evidence-gap summary{cursor:pointer;font-weight:850}.re-evidence-matrix{display:grid;gap:4px;margin-top:6px}.re-evidence-matrix>div{display:grid;grid-template-columns:105px 1fr;gap:6px;padding:5px 6px;border-radius:7px;background:rgba(255,255,255,.75)}.re-evidence-matrix strong{font-size:11px}.re-evidence-matrix span{font-size:11px}.re-evidence-gap p,.re-fusion-note{margin:4px 0 0;font-size:11px}
      .route-exposure-drawing{cursor:crosshair!important}
      @media(max-width:700px){.re-panel{top:auto;right:8px;left:8px;bottom:8px;width:auto;max-height:82vh;border-radius:18px}.re-head{padding:13px 14px 10px}.re-body{padding:12px 14px 14px}.re-mode-card{grid-template-columns:38px 1fr auto;padding:12px}.re-mode-icon{width:38px;height:38px}.re-result-hero b{font-size:21px}}
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    if (document.querySelector(".re-panel")) return document.querySelector(".re-panel");
    const node = document.createElement("section");
    node.className = "re-panel";
    node.setAttribute("aria-label", "路線曝曬分析");
    node.innerHTML = `
      <header class="re-head"><div><small>${VERSION}・Route Exposure</small><h2>路線曝曬分析</h2></div><button type="button" class="re-close" data-re-close aria-label="關閉">${icon.close}</button></header>
      <div class="re-body">
        <section data-re-home>
          <p class="re-home-intro">先選你現在要做的事。兩種模式會分開顯示，不需要猜哪一顆按鈕先按。</p>
          <div class="re-mode-grid">
            <button type="button" class="re-mode-card" data-re-mode-draw><span class="re-mode-icon">✏️</span><span class="re-mode-copy"><b>分析我自己的路線</b><span>我已經知道想走哪一條路</span></span><span class="re-mode-arrow">›</span></button>
            <button type="button" class="re-mode-card" data-re-mode-ab><span class="re-mode-icon">🌳</span><span class="re-mode-copy"><b>幫我找「最不曬」</b><span>我只知道起點和終點</span></span><span class="re-mode-arrow">›</span></button>
          </div>
        </section>

        <section data-re-workflow hidden>
          <div class="re-workflow-top"><button type="button" class="re-back" data-re-back>‹ 返回</button><div><h3 data-re-mode-title></h3><p data-re-mode-desc></p></div></div>

          <div class="re-step re-time-step">
            <div class="re-step-head"><span class="re-step-no">1</span><b>先選出發時間</b></div>
            <div class="re-time-summary"><span>目前設定</span><strong data-re-departure-summary></strong></div>
            <div class="re-time-quick" aria-label="快速選擇出發時間">
              <button type="button" data-re-time-preset="0">現在</button>
              <button type="button" data-re-time-preset="30">30 分後</button>
              <button type="button" data-re-time-preset="60">1 小時後</button>
            </div>
            <div class="re-time-grid">
              <label>日期<input data-re-date type="date" aria-label="出發日期"></label>
              <label>時間<input data-re-time type="time" step="300" aria-label="出發時間"></label>
            </div>
            <input data-re-departure type="hidden" value="${nowLocalInputValue()}">
            <button type="button" class="re-primary re-time-next" data-re-time-next></button>
            <p class="re-time-hint" data-re-time-hint></p>
          </div>

          <section data-re-screen="draw" hidden>
            <div class="re-step" data-re-draw-step>
              <div class="re-step-head"><span class="re-step-no">2</span><b>畫出你想走的路線</b></div>
              <div class="re-progress" data-re-draw-progress></div>
              <div class="re-draw-warning" data-re-draw-warning hidden></div>
              <button type="button" class="re-primary" data-re-draw-start>開始畫路線</button>
              <button type="button" class="re-primary" data-re-analyze-draw hidden>分析這條路線</button>
              <button type="button" class="re-secondary" data-re-redraw hidden>重新畫</button>
            </div>
          </section>

          <section data-re-screen="ab" hidden>
            <div class="re-step" data-re-ab-step>
              <div class="re-step-head"><span class="re-step-no">2</span><b>設定起點與終點</b></div>
              <div class="re-endpoints" data-re-endpoint-state></div>
              <button type="button" class="re-primary" data-re-ab>在地圖設定 A → B</button>
              <div class="re-manual-note" data-re-manual-note hidden></div>
            </div>
            <div class="re-step">
              <div class="re-step-head"><span class="re-step-no">3</span><b>最多願意多走多少？</b></div>
              <div class="re-chips"><button type="button" class="re-chip" data-re-detour-chip="10">10%</button><button type="button" class="re-chip" data-re-detour-chip="20">20%</button><button type="button" class="re-chip" data-re-detour-chip="30">30%</button></div>
              <div class="re-detour-custom"><span>自訂繞路上限</span><input data-re-detour type="number" min="0" max="60" step="5" value="${config.detourCapPct}" aria-label="最大繞路百分比"></div>
            </div>
            <div class="re-step">
              <div class="re-step-head"><span class="re-step-no">4</span><b>開始比較</b></div>
              <button type="button" class="re-primary" data-re-analyze-ab disabled>開始找「最不曬」</button>
            </div>
          </section>

          <details class="re-advanced">
            <summary>進階設定</summary>
            <div class="re-advanced-grid"><div class="re-field"><label>步行速度 km/h</label><input data-re-speed type="number" min="1.5" max="8" step="0.1" value="${config.walkingSpeedKmh}"></div><div class="re-field"><label>採樣間距 m</label><input data-re-spacing type="number" min="5" max="25" step="1" value="${config.sampleSpacingM}"></div></div>
          </details>

          <div class="re-status" data-re-status hidden></div>
          <div class="re-cancel-wrap" data-re-cancel-wrap hidden>正在運算中… <button type="button" data-re-cancel>取消分析</button></div>
          <div class="re-results" data-re-results></div>
          <details class="re-export" data-re-export hidden><summary>匯出研究資料</summary><div><button type="button" data-re-json>匯出 JSON</button><button type="button" data-re-csv>匯出 CSV</button></div></details>
          <div class="re-bottom-actions"><button type="button" class="re-link-btn" data-re-reset>重新開始</button></div>
        </section>
      </div>`;
    document.body.appendChild(node);

    node.querySelector("[data-re-close]").addEventListener("click", () => togglePanel(false));
    node.querySelector("[data-re-mode-draw]").addEventListener("click", () => setUiMode("draw"));
    node.querySelector("[data-re-mode-ab]").addEventListener("click", () => setUiMode("ab"));
    node.querySelector("[data-re-back]").addEventListener("click", () => setUiMode("home"));
    node.querySelectorAll("[data-re-time-preset]").forEach((preset) => preset.addEventListener("click", () => setDeparturePreset(Number(preset.dataset.reTimePreset || 0))));
    node.querySelector("[data-re-date]").addEventListener("change", syncDepartureFromParts);
    node.querySelector("[data-re-time]").addEventListener("change", syncDepartureFromParts);
    node.querySelector("[data-re-time-next]").addEventListener("click", advanceFromTime);
    node.querySelector("[data-re-draw-start]").addEventListener("click", () => startDrawMode({ reset: true }));
    node.querySelector("[data-re-redraw]").addEventListener("click", () => startDrawMode({ reset: true }));
    node.querySelector("[data-re-analyze-draw]").addEventListener("click", () => void analyzeDrawnRoute());
    node.querySelector("[data-re-ab]").addEventListener("click", startABMode);
    node.querySelector("[data-re-analyze-ab]").addEventListener("click", () => void analyzeAB());
    node.querySelectorAll("[data-re-detour-chip]").forEach((chip) => chip.addEventListener("click", () => setDetourPct(Number(chip.dataset.reDetourChip))));
    node.querySelector("[data-re-detour]").addEventListener("input", syncUiState);
    node.querySelector("[data-re-reset]").addEventListener("click", () => clearAll(true));
    node.querySelector("[data-re-cancel]").addEventListener("click", () => { analysisSerial += 1; setBusy(false); setStatus("已取消目前運算。", ""); });
    node.querySelector("[data-re-json]").addEventListener("click", exportJson);
    node.querySelector("[data-re-csv]").addEventListener("click", exportCsv);
    node.addEventListener("click", (event) => {
      const candidate = event.target?.closest?.("[data-re-candidate-id]");
      if (candidate) {
        selectCandidate(candidate.dataset.reCandidateId);
        return;
      }
      const graphToggle = event.target?.closest?.("[data-re-graph-toggle]");
      if (graphToggle) { toggleGraphDiagnostics(); return; }
      const graphDiagnose = event.target?.closest?.("[data-re-graph-diagnose]");
      if (graphDiagnose) { void diagnoseSavedManualRoute(); return; }
      const sourceGapLive = event.target?.closest?.("[data-re-source-gap-live]");
      if (sourceGapLive) { void runSourceGapCounterfactualLive(); return; }
      const multiLoad = event.target?.closest?.("[data-re-multisource-load]");
      if (multiLoad) { void loadMultiSourceEvidence(); return; }
      const multiSource = event.target?.closest?.("[data-re-multisource-source]");
      if (multiSource) { void toggleMultiSourceOverlay(multiSource.dataset.reMultisourceSource); return; }
      const multiFusion = event.target?.closest?.("[data-re-multisource-fusion-run]");
      if (multiFusion) { void runExperimentalFusion(); return; }
      const engineLive = event.target?.closest?.("[data-re-engine-live]");
      if (engineLive) { void runMatureEngineCrossCheck(); return; }
      const engineMap = event.target?.closest?.("[data-re-engine-map]");
      if (engineMap) { toggleMatureEngineOverlay(); return; }
      const benchmarkExport = event.target?.closest?.("[data-re-engine-benchmark]");
      if (benchmarkExport) { exportEngineBenchmark(); return; }
      const action = event.target?.closest?.("[data-re-result-draw]");
      if (!action) return;
      setUiMode("draw");
      startDrawMode({ reset: true });
    });
    try {
      window.L.DomEvent.disableClickPropagation(node);
      window.L.DomEvent.disableScrollPropagation(node);
    } catch (_) {}
    const initialDeparture = localInputParts(node.querySelector("[data-re-departure]")?.value || nowLocalInputValue());
    if (node.querySelector("[data-re-date]")) node.querySelector("[data-re-date]").value = initialDeparture.date;
    if (node.querySelector("[data-re-time]")) node.querySelector("[data-re-time]").value = initialDeparture.time;
    syncUiState();
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
    if (next) {
      quietCompetingMapTools();
      if (!["home", "draw", "ab"].includes(uiMode)) uiMode = "home";
      syncUiState();
    }
    panel.classList.toggle("is-open", next);
    if (button) {
      button.classList.toggle("is-on", next);
      button.setAttribute("aria-pressed", String(next));
    }
    if (!next) { stopDrawMode(); clearGraphDiagnostics(); }
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

  function suppressMapPointAfterDrag(message = true) {
    mapDragSuppressUntil = Math.max(mapDragSuppressUntil, Date.now() + 650);
    if (message && (drawMode === "a" || drawMode === "b")) {
      setStatus(drawMode === "b"
        ? "已拖曳地圖，這次不會設定 B。移到想要的位置後，再單擊一次設定 B。"
        : "已拖曳地圖，這次不會設定 A。移到想要的位置後，再單擊一次設定 A。", "drawing");
    }
  }

  function mapPointClickSuppressed() {
    return Date.now() < mapDragSuppressUntil;
  }

  function onMapClick(event) {
    if (!event?.latlng) return;
    if (mapPointClickSuppressed()) return;
    const point = { lat: Number(event.latlng.lat), lng: Number(event.latlng.lng) };
    if (drawMode === "route") {
      if (drawPoints.length >= Number(config.maxDrawPoints || 80)) {
        setStatus(`手繪節點已達上限 ${config.maxDrawPoints}。`, "error");
        return;
      }
      drawPoints.push(point);
      savedDrawnAnalysis = null;
      drawEditableRoute();
      setStatus(drawPoints.length < 2 ? "已放 1 個節點，請再點至少 1 個。" : "可以繼續加節點；完成後直接按「分析這條路線」。", "drawing");
      syncUiState();
      return;
    }
    if (drawMode === "a") {
      aPoint = point;
      if (!endpointsLayer) endpointsLayer = createLayerGroup();
      clearLayer(endpointsLayer);
      setEndpointMarker(aPoint, "A", "#2563eb");
      drawMode = "b";
      setStatus("A 已設定；請點選 B 終點。", "drawing");
      syncUiState();
      return;
    }
    if (drawMode === "b") {
      bPoint = point;
      setEndpointMarker(bPoint, "B", "#e11d48");
      drawMode = "idle";
      map.getContainer().classList.remove("route-exposure-drawing");
      setStatus("A、B 都設定好了。下一步選擇最多願意多走多少，再按「開始找『最不曬』」。", "ok");
      syncUiState();
    }
  }

  function boot() {
    addStyles();
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      map = map || window.map || null;
      if (map && window.L && addButton()) {
        try { window.HaidianMultiSourceEvidence?.attachMap?.(map); } catch (_) {}
        try { window.HaidianExperimentalFusionRouter?.attachMap?.(map); } catch (_) {}
        panel = createPanel();
        map.on("click", onMapClick);
        map.on("dragstart", () => suppressMapPointAfterDrag(false));
        map.on("dragend", () => suppressMapPointAfterDrag(true));
        window.clearInterval(timer);
      } else if (attempts > 80) {
        window.clearInterval(timer);
        console.warn("[Haidian Route Exposure] map / rightToolsWrapper not found.");
      }
    }, 400);
  }

  window.HaidianRouteExposure = {
    version: VERSION,
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
    get lastCandidateBundle() { return lastCandidateBundle; },
    get savedDrawnRoute() { return savedDrawnRoute.slice(); },
    get graphDiagnostics() { return window.HaidianPedestrianGraph?.lastDiagnostics || null; },
    get lastGraphFailure() { return lastGraphFailure; },
    _internals: {
      buildSampleSegments,
      aggregateExposure,
      routeDistanceM,
      routeToGeoJsonCoords,
      candidateWithinDetour,
      buildManualCandidate,
      buildManualCandidateFromRoute,
      dedupeCandidates,
      fetchExploratoryCandidates,
      evaluateRouteQuality,
      applyRouteQuality,
      directionalRouteFidelity,
      compareRouteFidelity,
      experimentalFusionCandidateFromRun,
      buildFusionManualComparison
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
