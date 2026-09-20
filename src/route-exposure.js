/*
 * Haidian Soundscape — Route Exposure Foundation v9.0.0-dev3 Graph Reveal + Drag-safe Endpoints
 *
 * Capabilities:
 * - hand-drawn fixed-route shade exposure analysis;
 * - time-dependent shade evaluation at each segment traversal time;
 * - nearby realtime heat-risk context for near-now departures;
 * - guided two-mode UX plus A→B candidate comparison with optional user-drawn route.
 *
 * Important: this is candidate-route scoring, not full-network shade-optimal routing.
 */
(function () {
  "use strict";

  const VERSION = "v9.0.0-dev3";

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

  const icon = {
    route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="18" r="2.2"></circle><circle cx="19" cy="6" r="2.2"></circle><path d="M7.1 17.4c4.7-1 2.1-8.1 6.5-8.7l3.2-.4"></path></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
  };

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
    if (shadePct != null) {
      if (shadePct >= 75) verdict = "這條路大部分有遮蔭";
      else if (shadePct >= 50) verdict = "這條路有一半以上路段可遮蔭";
      else verdict = "這條路直接日照較多";
    }
    const title = escapeHtml(options.title || verdict);
    const eyebrow = options.eyebrow ? `<div class="re-result-eyebrow">${escapeHtml(options.eyebrow)}</div>` : "";
    return `
      <section class="re-result-card">
        ${eyebrow}
        <h3>${title}</h3>
        <div class="re-result-hero">
          <div class="shade"><span>遮蔭</span><b>${shade}</b></div>
          <div class="sun"><span>直接日照</span><b>${sun}</b></div>
        </div>
        <p class="re-result-sentence">約 ${formatMinutes(s.walkSeconds)} 路程，其中約 <strong>${formatMinutes(s.directSunSeconds)}</strong> 會直接曬到太陽。</p>
        <details class="re-result-details">
          <summary>查看詳細資料</summary>
          <div class="re-summary-grid">
            <div><span>路線距離</span><b>${formatDistance(s.totalDistanceM)}</b></div>
            <div><span>估計步行</span><b>${formatMinutes(s.walkSeconds)}</b></div>
            <div><span>遮蔭時間</span><b>${formatMinutes(s.shadedSeconds)}</b></div>
            <div><span>日照時間</span><b>${formatMinutes(s.directSunSeconds)}</b></div>
            <div><span>最長連續日照</span><b>${formatDistance(s.longestSunM)}</b></div>
            <div><span>最長連續遮蔭</span><b>${formatDistance(s.longestShadeM)}</b></div>
          </div>
          ${s.nightSeconds > 0 ? `<div class="re-note">夜間 ${formatMinutes(s.nightSeconds)} 已獨立計算，不會灌進遮蔭百分比。</div>` : ""}
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
      if (candidate.kind === 'manual') { out.push(candidate); continue; }
      const duplicate = out.some((existing) => {
        if (existing.kind === 'manual') return false;
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
    const baselineCandidates = qualityValid.filter((c) => c?.kind !== "manual");
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
      const mustKeep = new Set([fastest?.id, ...eligible.filter((c) => c.kind === "manual").map((c) => c.id)].filter(Boolean));
      const chosen = [];
      for (const c of eligible) if (mustKeep.has(c.id) && !chosen.some((x) => x.id === c.id)) chosen.push(c);
      for (const c of eligible) {
        if (chosen.length >= maxScored) break;
        if (!chosen.some((x) => x.id === c.id)) chosen.push(c);
      }
      eligible = chosen;
    }
    const eligibleIds = new Set(eligible.map((c) => c.id));
    // Even when a hand-drawn route is just outside the detour cap, score it once
    // so the user can inspect it and understand the trade-off instead of having
    // it silently disappear from the comparison UI.
    const manualOutside = qualityChecked.filter((c) => c?.kind === "manual" && c?.routeQuality?.valid !== false && !eligibleIds.has(c.id));
    const scoringPool = eligible.concat(manualOutside);
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
    if (candidate?.kind === "graph-shade") return "OSM Graph 最不曬候選";
    if (candidate?.kind === "graph-fastest") return "OSM Graph 最快";
    if (candidate?.kind === "manual") return "我的手繪路線";
    if (candidate?.id === bundle.fastest?.id) return "最快";
    if (candidate?.kind === "explore") {
      const explored = bundle.scored.filter((c) => c.kind === "explore");
      return `探索路線 ${explored.findIndex((c) => c.id === candidate.id) + 1}`;
    }
    const providers = bundle.scored.filter((c) => c.kind !== "manual" && c.kind !== "explore" && c.id !== bundle.fastest?.id);
    return `替代路線 ${providers.findIndex((c) => c.id === candidate.id) + 1}`;
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
      ? `<br>graph 估計：直接日照 ${Math.round(shade.directSunFraction * 100)}%・遮蔭 ${Math.round((shade.shadedFraction || 0) * 100)}%・${Math.round(shade.samples || 0)} samples`
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
        .bindTooltip(`A 吸附點・誤差 ${Math.round(snapshot.snapA.distanceM || 0)} m`, { permanent: false }).addTo(graphDebugLayer);
    }
    if (snapshot.snapB) {
      window.L.circleMarker(snapshot.snapB, { radius: 7, weight: 3, color: "#dc2626", fillColor: "#fee2e2", fillOpacity: 1 })
        .bindTooltip(`B 吸附點・誤差 ${Math.round(snapshot.snapB.distanceM || 0)} m`, { permanent: false }).addTo(graphDebugLayer);
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

  function graphDiagnosisHtml(diagnosis) {
    if (!diagnosis?.available) return '<div class="re-graph-diagnosis is-warning">目前沒有可診斷的手繪路線或 OSM Graph。</div>';
    const coverage = Math.round((diagnosis.coverageRatio || 0) * 100);
    const overlap = Math.round((diagnosis.overlapWithSelectedRatio || 0) * 100);
    const cls = coverage >= 80 ? "is-good" : coverage < 50 ? "is-bad" : "is-warning";
    const types = (diagnosis.matchedEdges || []).slice(0, 5).map((e) => `${escapeHtml(e.highway)} (${e.count})`).join("、") || "—";
    return `<div class="re-graph-diagnosis ${cls}"><b>手繪路線 ↔ OSM Graph 對照</b>` +
      `<span>約 <strong>${coverage}%</strong> 的手繪採樣點落在 graph ${Math.round(diagnosis.thresholdM)} m 內；與目前自動路線 edge 重疊約 <strong>${overlap}%</strong>。</span>` +
      `<span>平均離 graph ${Number(diagnosis.averageDistanceM || 0).toFixed(1)} m；最長疑似缺口約 ${Math.round(diagnosis.longestGapApproxM || 0)} m。</span>` +
      `<span>主要對應：${types}</span><p>${escapeHtml(diagnosis.interpretation || "")}</p></div>`;
  }

  function diagnoseSavedManualRoute() {
    if (!savedDrawnRoute?.length || savedDrawnRoute.length < 2) {
      setStatus("還沒有手繪路線。請先用『分析我自己的路線』沿河堤/道路畫一條，再回來跑 A→B。", "warning");
      return;
    }
    const api = window.HaidianPedestrianGraph;
    if (!api?.diagnosePolyline) {
      setStatus("目前版本沒有 OSM Graph 手繪診斷 API。", "error");
      return;
    }
    const diagnosis = api.diagnosePolyline(savedDrawnRoute);
    lastManualGraphDiagnosis = diagnosis;
    const box = panel?.querySelector("[data-re-graph-diagnosis]");
    if (box) box.innerHTML = graphDiagnosisHtml(diagnosis);
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
      }
      const button = panel?.querySelector("[data-re-graph-toggle]");
      if (button) button.textContent = "隱藏 OSM Graph";
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
      if (c.kind === 'explore') badges.push('<em class="explore">探索</em>');
      if (c.kind === 'graph-shade' || c.kind === 'graph-fastest') badges.push('<em class="graph">OSM Graph</em>');
      if (c.id === bestId && bundle.comparisonValid) badges.push('<em class="best">最不曬</em>');
      if (c.eligible === false) badges.push('<em class="over">超過上限</em>');
      if (c.id === activeId) badges.push('<em class="viewing">目前顯示</em>');
      return `<button type="button" class="re-candidate${c.id === activeId ? " is-selected" : ""}" data-re-candidate-id="${escapeHtml(c.id)}" aria-pressed="${c.id === activeId ? "true" : "false"}">
        <div class="re-candidate-title"><b>${escapeHtml(candidateName(c, bundle))}</b><span>${badges.join('')}</span></div>
        <div class="re-candidate-metrics"><span>${formatDistance(s.totalDistanceM)}</span><span>遮蔭 ${s.shadeRatio == null ? "—" : Math.round(s.shadeRatio * 100) + "%"}</span><span>日照 ${formatMinutes(s.directSunSeconds)}</span></div>
        <small>${detour > 0.5 ? `比最短路線多約 ${Math.round(detour)}%` : "接近最短路線"} · 點一下可切換地圖</small>
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
      graphNote = `<div class="re-graph-note"><b>v9 OSM Graph 已啟用</b><span>本次直接搜尋 ${Math.round(graphDiag.contractedNodes || 0)} 個步行交會節點／${Math.round(graphDiag.contractedEdges || 0)} 條 graph edge；A、B 吸附誤差約 ${Math.round(graphDiag.snapA?.distanceM || 0)} m／${Math.round(graphDiag.snapB?.distanceM || 0)} m。最長 contracted edge 約 ${Math.round(graphStats.longestEdgeM || 0)} m。</span><div class="re-graph-actions"><button type="button" data-re-graph-toggle>${graphDebugVisible ? "隱藏" : "顯示"} OSM Graph</button><button type="button" data-re-graph-diagnose>對照我的手繪路線</button></div><div data-re-graph-diagnosis>${lastManualGraphDiagnosis ? graphDiagnosisHtml(lastManualGraphDiagnosis) : ""}</div></div>`;
    } else if (bundle.graphError || graphDebugAvailable) {
      graphNote = `<div class="re-graph-note is-error"><b>OSM Graph 路由沒有完成</b><span>${escapeHtml(bundle.graphError || lastGraphFailure || "graph search 未產生候選")}</span>${graphDebugAvailable ? '<span>但步行 graph 已成功建立，所以仍可直接顯示 graph、對照你的手繪河堤路線，判斷是拓樸/connector 還是搜尋成本問題。</span><div class="re-graph-actions"><button type="button" data-re-graph-toggle>顯示 OSM Graph</button><button type="button" data-re-graph-diagnose>對照我的手繪路線</button></div><div data-re-graph-diagnosis>' + (lastManualGraphDiagnosis ? graphDiagnosisHtml(lastManualGraphDiagnosis) : '') + '</div>' : '<span>這次連 graph 都沒有建立成功；可直接再按一次「開始找最不曬」重試 Overpass。</span>'}</div>`;
    }

    return `<section class="re-candidates">
      <div class="re-candidate-head"><b>候選路線比較</b><span>最多繞路 ${Math.round(bundle.detourPct)}%</span></div>
      ${notice}${graphNote}${manualState}${qualityNote}${rows}
      <div class="re-method-note">評選以「直接日照時間」為核心，不以提高遮蔭百分比為目的。走進無尾巷再原路走回、或反向重走同一條實體走廊會先淘汰；一般街廓轉彎與合理側向繞行仍可參加比較。</div>
    </section>`;
  }

  function renderCandidateOutlines(bundle, activeId) {
    if (!comparisonLayer) comparisonLayer = createLayerGroup();
    clearLayer(comparisonLayer);
    for (const candidate of bundle.scored || []) {
      if (!candidate?.points?.length || candidate.id === activeId) continue;
      const isManual = candidate.kind === 'manual';
      window.L.polyline(candidate.points, {
        color: isManual ? '#be123c' : '#64748b',
        weight: isManual ? 4 : 3,
        opacity: isManual ? 0.48 : 0.28,
        dashArray: isManual ? '8 7' : '5 7',
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
    try {
      const departure = departureDateFromPanel();
      const speedMps = speedMpsFromPanel();
      const detourPct = detourCapFromPanel();

      setStatus("正在取得一般步行候選…", "loading");
      const providerCandidates = await fetchRouteCandidates(aPoint, bPoint);
      if (serial !== analysisSerial) return;

      let graphResult = null;
      let graphCandidates = [];
      lastGraphFailure = null;
      if (config.graphRouting?.enabled !== false && window.HaidianPedestrianGraph?.findRoutes) {
        try {
          await ensureShadeReady();
          setStatus("v9：正在讀取 OSM 步行路網並直接搜尋『最不曬』graph 路徑…", "loading");
          let lastGraphUi = 0;
          graphResult = await window.HaidianPedestrianGraph.findRoutes(aPoint, bPoint, {
            departure,
            speedMps,
            detourPct,
            shouldCancel: () => serial !== analysisSerial,
            onProgress(info) {
              const now = Date.now();
              if (now - lastGraphUi < 180 && info?.stage === "search") return;
              lastGraphUi = now;
              if (serial !== analysisSerial) return;
              setStatus(info?.message || "正在搜尋 OSM pedestrian graph…", "loading");
            }
          });
          graphCandidates = Array.isArray(graphResult?.candidates) ? graphResult.candidates : [];
        } catch (graphError) {
          if (graphError?.message === "ROUTE_ANALYSIS_CANCELLED") throw graphError;
          graphResult = { available: false, error: graphError?.message || String(graphError) };
          lastGraphFailure = graphResult.error;
          console.warn("[Haidian v9 graph] local graph routing unavailable; falling back to provider candidates.", graphError);
          setStatus(`OSM Graph 暫時未完成（${graphResult.error}）；改用一般步行候選繼續分析。`, "warning");
        }
      }
      if (serial !== analysisSerial) return;

      // Legacy waypoint exploration is fallback-only. v9 prefers direct graph search.
      let exploratoryCandidates = [];
      if (!graphCandidates.length && config.exploreCandidates !== false) {
        try { exploratoryCandidates = await fetchExploratoryCandidates(aPoint, bPoint); }
        catch (_) { exploratoryCandidates = []; }
      }
      if (serial !== analysisSerial) return;

      const manualMatch = buildManualCandidate(aPoint, bPoint, speedMps);
      const candidates = dedupeCandidates(providerCandidates.concat(graphCandidates, exploratoryCandidates));
      if (manualMatch?.matched && manualMatch.candidate) candidates.push(manualMatch.candidate);
      lastCandidates = candidates;

      setStatus(`正在用實際到達時間重新精算 ${candidates.length} 條候選的 ShadeMap 曝曬…`, "loading");
      const bundle = await scoreCandidates(candidates, {
        serial,
        departure,
        sampleSpacingM: spacingFromPanel(),
        speedMps,
        detourPct
      });
      if (serial !== analysisSerial) return;
      bundle.manualMatch = manualMatch;
      bundle.manualEligible = bundle.scored.some((candidate) => candidate.id === "manual-drawn" && candidate.eligible !== false);
      bundle.graphDiagnostics = graphResult?.diagnostics || null;
      bundle.graphError = graphResult?.error || null;
      bundle.graphDebugAvailable = Boolean(window.HaidianPedestrianGraph?.getDebugSnapshot?.()?.edges?.length);
      if (savedDrawnRoute?.length >= 2 && bundle.graphDebugAvailable && window.HaidianPedestrianGraph?.diagnosePolyline) {
        try {
          lastManualGraphDiagnosis = window.HaidianPedestrianGraph.diagnosePolyline(savedDrawnRoute);
        } catch (diagnosisError) {
          console.warn("[Haidian v9 graph] automatic manual-route diagnosis failed", diagnosisError);
        }
      }
      lastCandidateBundle = bundle;
      lastSelectedCandidate = bundle.best;
      lastAnalysis = bundle.best?.analysis || null;
      renderCandidateBundle(bundle);
      if (bundle.comparisonValid) {
        const graphText = bundle.graphDiagnostics ? "；已加入 v9 OSM Graph 直接搜尋結果" : "";
        setStatus(`完成：已比較 ${bundle.eligibleScored.length} 條符合繞路上限的候選${graphText}。下方可逐條點選切換地圖。`, "ok");
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
      .re-results{margin-top:12px}.re-result-card{padding:13px;border:1px solid #dce9e7;border-radius:16px;background:linear-gradient(145deg,#fff,#f7fbfa)}.re-result-eyebrow{color:#0f766e;font-size:11.5px;font-weight:900;letter-spacing:.04em}.re-result-card h3{margin:5px 0 12px;color:#123f46;font-size:17px}.re-result-hero{display:grid;grid-template-columns:1fr 1fr;gap:8px}.re-result-hero>div{padding:12px;border-radius:13px}.re-result-hero span{display:block;font-size:12px;font-weight:850}.re-result-hero b{display:block;margin-top:3px;font-size:24px}.re-result-hero .shade{background:#ecfdf5;color:#047857}.re-result-hero .sun{background:#fff7ed;color:#c2410c}.re-result-sentence{margin:11px 0 0;color:#334155;font-size:13.5px;line-height:1.6}.re-result-details{margin-top:10px}.re-result-details summary{cursor:pointer;color:#64748b;font-size:12px;font-weight:850}.re-summary-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:8px}.re-summary-grid>div{padding:9px 7px;border:1px solid #e2e8f0;border-radius:11px;background:#fff}.re-summary-grid span{display:block;color:#64748b;font-size:11.5px;font-weight:800}.re-summary-grid b{display:block;margin-top:3px;color:#0f3d46;font-size:14px}.re-note,.re-warn,.re-heat{margin-top:9px;padding:10px 11px;border-radius:10px;font-size:12px;line-height:1.55;font-weight:700}.re-note{background:#f1f5f9;color:#475569}.re-note--manual{background:#fff1f2;color:#9f1239}.re-warn{background:#fff7ed;color:#9a3412}.re-heat{display:grid;gap:3px;background:#fff7ed;color:#9a3412}.re-heat small{color:#7c5a45}
      .re-candidates{margin-top:11px}.re-candidate-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;color:#334155;font-size:13px}.re-candidate-head span{color:#64748b;font-size:11.5px}.re-candidate-alert,.re-candidate-success{display:grid;gap:5px;padding:11px;border-radius:11px;font-size:12.5px;line-height:1.55}.re-candidate-alert{background:#fff7ed;color:#9a3412}.re-candidate-success{background:#ecfdf5;color:#047857}.re-quality-note{margin-top:8px;padding:10px 11px;border-radius:11px;background:#f8fafc;border:1px solid #cbd5e1;color:#475569;font-size:12.5px;line-height:1.55;font-weight:750}.re-candidate-alert button{justify-self:start;margin-top:3px;padding:6px 8px;border:1px solid #fdba74;background:#fff;color:#9a3412}.re-candidate{width:100%;display:grid;gap:5px;padding:12px;margin-top:8px;border:1px solid #dbe5e4;border-radius:12px;background:#fff;text-align:left;font:inherit;cursor:pointer;transition:.16s}.re-candidate:hover{border-color:#5eead4;box-shadow:0 6px 16px rgba(15,118,110,.10);transform:translateY(-1px)}.re-candidate.is-selected{border-color:#10b981;background:#ecfdf5;box-shadow:0 0 0 2px rgba(16,185,129,.10)}.re-candidate-title{display:flex;justify-content:space-between;gap:8px}.re-candidate-title b{font-size:14px;color:#0f766e}.re-candidate-title em{display:inline-block;margin-left:4px;padding:2px 6px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:10px;font-style:normal;font-weight:900}.re-candidate-title em.best{background:#dcfce7;color:#166534}.re-candidate-title em.manual{background:#ffe4e6;color:#9f1239}.re-candidate-title em.explore{background:#e0f2fe;color:#0369a1}.re-candidate-title em.graph{background:#ede9fe;color:#6d28d9}.re-candidate-title em.over{background:#ffedd5;color:#9a3412}.re-candidate-title em.viewing{background:#ccfbf1;color:#115e59}.re-candidate-metrics{display:flex;flex-wrap:wrap;gap:10px;color:#334155;font-size:12.5px;font-weight:750}.re-candidate small{color:#64748b;font-size:11.5px;line-height:1.45}.re-graph-note{display:grid;gap:4px;margin:8px 0;padding:10px 11px;border-radius:11px;background:#f5f3ff;border:1px solid #ddd6fe;color:#5b21b6;font-size:12.5px;line-height:1.5}.re-graph-note b{font-size:13px}.re-method-note{margin-top:9px;color:#64748b;font-size:11px;line-height:1.55}.re-export{margin-top:10px}.re-export div{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.re-export button{min-height:36px;border:1px solid #cfdedc;background:#fff;color:#0f766e}
      .re-graph-note.is-error{background:#fff7ed;border-color:#fdba74;color:#9a3412}.re-graph-note.is-error .re-graph-actions button{border-color:#fdba74;color:#9a3412}
      .re-graph-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.re-graph-actions button{min-height:36px;padding:8px 11px;border:1px solid #c4b5fd;border-radius:10px;background:#fff;color:#5b21b6;font-size:12.5px;font-weight:900;cursor:pointer}.re-graph-actions button:hover{background:#f5f3ff}.re-graph-diagnosis{display:grid;gap:5px;margin-top:9px;padding:10px 11px;border-radius:11px;background:#f8fafc;border:1px solid #cbd5e1;color:#334155;font-size:12.5px;line-height:1.5}.re-graph-diagnosis b{font-size:13px}.re-graph-diagnosis span{display:block}.re-graph-diagnosis p{margin:2px 0 0;font-weight:800}.re-graph-diagnosis.is-good{background:#ecfdf5;border-color:#86efac;color:#166534}.re-graph-diagnosis.is-warning{background:#fffbeb;border-color:#fde68a;color:#92400e}.re-graph-diagnosis.is-bad{background:#fff1f2;border-color:#fecdd3;color:#9f1239}
      .re-time-step{border-color:#99d9cf;background:linear-gradient(145deg,#f0fdfa,#ffffff)}
      .re-time-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;margin-bottom:9px;border-radius:11px;background:#fff;border:1px solid #cce8e3}.re-time-summary span{color:#64748b;font-size:12.5px;font-weight:800}.re-time-summary strong{color:#075a63;font-size:16px;font-weight:950}
      .re-time-quick{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px}.re-time-quick button{min-height:38px;border:1px solid #b8d9d4;border-radius:10px;background:#fff;color:#0f766e;font-size:13px;font-weight:900;cursor:pointer}.re-time-quick button:hover{background:#ecfdf5;border-color:#5eead4}
      .re-time-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:8px;margin-bottom:10px}.re-time-grid label{display:grid;gap:5px;color:#64748b;font-size:12px;font-weight:850}.re-time-grid input{width:100%;box-sizing:border-box;min-height:42px;padding:8px 10px;border:1px solid #cfdedc;border-radius:10px;background:#fff;color:#123f46;font-size:14px;font-weight:800}
      .re-time-next{margin-top:2px;box-shadow:0 7px 18px rgba(15,118,110,.18)}.re-time-hint{margin:8px 1px 0;color:#64748b;font-size:12px;line-height:1.5;font-weight:700}
      .re-draw-warning{margin:8px 0 10px;padding:10px 11px;border:1px solid #fdba74;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:12.5px;line-height:1.55;font-weight:800}
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
      if (graphDiagnose) { diagnoseSavedManualRoute(); return; }
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
      applyRouteQuality
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
