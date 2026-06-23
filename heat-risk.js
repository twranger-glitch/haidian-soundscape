/*
 * Haidian Soundscape — heat-risk map tool
 *
 * Install:
 * 1. Put this file beside index.html as heat-risk.js
 * 2. Edit ONLY the HEAT_API_BASE value below.
 * 3. Add: <script src="./heat-risk.js"></script> just before </body> in index.html.
 *
 * This file expects the existing soundscape page to have Leaflet's global `L`
 * and its global `map` variable already initialized.
 */
(function () {
  "use strict";

  const HEAT_API_BASE = "https://haidian-heat-risk-api.yhzkiki.workers.dev";
  const REQUEST_TIMEOUT_MS = 12000;

  if (!window.L || !window.map) {
    console.error("Heat risk tool needs Leaflet and the global map variable.");
    return;
  }

  function apiIsConfigured() {
    return (
      HEAT_API_BASE.startsWith("https://") &&
      !HEAT_API_BASE.includes("REPLACE-WITH-YOUR-WORKER")
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTaipeiTime(isoText) {
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return "時間未提供";

    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function riskClass(code) {
    const classes = {
      normal: "heat-risk-normal",
      caution: "heat-risk-caution",
      extreme_caution: "heat-risk-extreme-caution",
      danger: "heat-risk-danger",
      extreme_danger: "heat-risk-extreme-danger",
    };
    return classes[code] || "heat-risk-normal";
  }

  function popupShell(content) {
    return `<div class="heat-risk-card">${content}</div>`;
  }

  function renderLoadingPopup() {
    return popupShell(`
      <div class="heat-risk-kicker">即時熱風險</div>
      <div class="heat-risk-loading"><span class="heat-risk-spinner"></span>正在找最近的合格測點…</div>
    `);
  }

  function renderResultPopup(payload) {
    const assessment = payload.assessment;
    const source = payload.source;
    const risk = assessment.risk;

    return popupShell(`
      <div class="heat-risk-kicker">地圖選點・即時熱風險</div>
      <div class="heat-risk-title-row">
        <strong>${escapeHtml(risk.label)}</strong>
        <span class="heat-risk-badge ${riskClass(risk.code)}">${assessment.heatIndexC.toFixed(1)} °C</span>
      </div>
      <div class="heat-risk-metrics">
        <div><span>氣溫</span><b>${assessment.temperatureC.toFixed(1)} °C</b></div>
        <div><span>相對濕度</span><b>${assessment.relativeHumidity.toFixed(0)} %</b></div>
      </div>
      <p class="heat-risk-advice">${escapeHtml(risk.advice)}</p>
      <div class="heat-risk-source">
        <b>資料來源</b><br>
        ${escapeHtml(source.stationName)}・${escapeHtml(source.qualityLabel)}<br>
        距選點 ${source.sourceDistanceKm.toFixed(2)} km・觀測 ${escapeHtml(formatTaipeiTime(source.observedAt))}<br>
        資料年齡約 ${source.ageMinutes.toFixed(0)} 分鐘
      </div>
      <p class="heat-risk-caveat">${escapeHtml(payload.caveat)}</p>
    `);
  }

  function renderErrorPopup(message) {
    return popupShell(`
      <div class="heat-risk-kicker">即時熱風險</div>
      <div class="heat-risk-error">${escapeHtml(message)}</div>
      <p class="heat-risk-caveat">系統不會以距離過遠或過期資料勉強產生評估。</p>
    `);
  }

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .heat-risk-control {
        background: rgba(255,255,255,.96);
        border: 1px solid rgba(15,23,42,.10);
        border-radius: 12px;
        box-shadow: 0 6px 18px rgba(15,23,42,.14);
        overflow: hidden;
      }
      .heat-risk-control button {
        appearance: none; border: 0; background: transparent; cursor: pointer;
        color: #0f172a; font: 800 13px/1.2 "Helvetica Neue", Arial, "Microsoft JhengHei", sans-serif;
        padding: 10px 12px; min-height: 42px;
      }
      .heat-risk-control button.is-active { background: #fff7ed; color: #c2410c; }
      #map.heat-risk-selecting { cursor: crosshair; }
      .heat-risk-card { min-width: 270px; max-width: 320px; font-family: "Helvetica Neue", Arial, "Microsoft JhengHei", sans-serif; color: #334155; line-height: 1.48; }
      .heat-risk-kicker { color:#64748b; font-size:10px; letter-spacing:.08em; font-weight:900; margin-bottom:4px; }
      .heat-risk-title-row { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:17px; color:#0f172a; margin-bottom:10px; }
      .heat-risk-badge { font-size:13px; line-height:1; padding:7px 9px; border-radius:999px; font-weight:900; white-space:nowrap; }
      .heat-risk-normal { background:#ecfdf5; color:#047857; }
      .heat-risk-caution { background:#fffbeb; color:#b45309; }
      .heat-risk-extreme-caution { background:#fff7ed; color:#c2410c; }
      .heat-risk-danger { background:#fff1f2; color:#be123c; }
      .heat-risk-extreme-danger { background:#4c0519; color:#fff; }
      .heat-risk-metrics { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:10px 0; }
      .heat-risk-metrics > div { background:#f8fafc; border:1px solid #e2e8f0; padding:8px; border-radius:9px; }
      .heat-risk-metrics span { display:block; color:#64748b; font-size:11px; font-weight:700; }
      .heat-risk-metrics b { font-size:15px; color:#0f172a; }
      .heat-risk-advice { margin:10px 0; padding:9px 10px; background:#f8fafc; border-left:3px solid #fb923c; border-radius:0 8px 8px 0; font-size:12.5px; }
      .heat-risk-source { border-top:1px solid #e2e8f0; padding-top:8px; color:#475569; font-size:11.5px; }
      .heat-risk-caveat { margin:8px 0 0; color:#64748b; font-size:10.5px; }
      .heat-risk-loading { display:flex; align-items:center; gap:8px; padding:12px 0; font-size:13px; }
      .heat-risk-spinner { width:14px; height:14px; border:2px solid #cbd5e1; border-top-color:#f97316; border-radius:50%; animation: heat-risk-spin .8s linear infinite; }
      .heat-risk-error { color:#b91c1c; font-weight:800; padding:10px 0 2px; font-size:13px; }
      @keyframes heat-risk-spin { to { transform:rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  let selectMode = false;
  let selectedMarker = null;
  let requestController = null;
  let controlButton = null;

  function updateControlButton() {
    if (!controlButton) return;
    controlButton.classList.toggle("is-active", selectMode);
    controlButton.textContent = selectMode ? "點地圖評估中…" : "🌡 熱風險選點";
    map.getContainer().classList.toggle("heat-risk-selecting", selectMode);
  }

  function setSelectMode(value) {
    selectMode = value;
    updateControlButton();
  }

  function ensureSelectionMarker(latlng) {
    if (selectedMarker) map.removeLayer(selectedMarker);
    selectedMarker = L.circleMarker(latlng, {
      radius: 8,
      weight: 3,
      color: "#ea580c",
      fillColor: "#fff7ed",
      fillOpacity: 0.95,
      interactive: false,
    }).addTo(map);
  }

  function openPopup(latlng, html) {
    L.popup({
      className: "heat-risk-popup",
      autoClose: true,
      closeOnClick: false,
      maxWidth: 350,
    })
      .setLatLng(latlng)
      .setContent(html)
      .openOn(map);
  }

  async function requestHeatRisk(latlng) {
    if (!apiIsConfigured()) {
      openPopup(
        latlng,
        renderErrorPopup("尚未設定 heat-risk.js 裡的 Worker 網址。")
      );
      return;
    }

    if (requestController) requestController.abort();
    requestController = new AbortController();
    const timer = window.setTimeout(
      () => requestController?.abort(),
      REQUEST_TIMEOUT_MS
    );

    try {
      const url = new URL("/risk", HEAT_API_BASE);
      url.searchParams.set("lat", latlng.lat.toFixed(6));
      url.searchParams.set("lon", latlng.lng.toFixed(6));

      const response = await fetch(url.toString(), {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        signal: requestController.signal,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.error?.message || `熱風險服務暫時無法使用（HTTP ${response.status}）。`
        );
      }

      openPopup(latlng, renderResultPopup(payload));
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "查詢逾時，請稍後再試。"
          : error?.message || "熱風險服務暫時無法使用。";
      openPopup(latlng, renderErrorPopup(message));
    } finally {
      window.clearTimeout(timer);
      requestController = null;
    }
  }

  function addControl() {
    const HeatRiskControl = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const container = L.DomUtil.create("div", "heat-risk-control");
        controlButton = L.DomUtil.create("button", "", container);
        controlButton.type = "button";
        controlButton.title = "選取地圖上一點，查看鄰近即時熱風險";
        controlButton.textContent = "🌡 熱風險選點";
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        L.DomEvent.on(controlButton, "click", () => setSelectMode(!selectMode));
        return container;
      },
    });

    map.addControl(new HeatRiskControl());
  }

  addStyles();
  addControl();

  // The soundscape page already uses right-click / long-press to submit sound
  // contributions. A separate tool mode keeps that interaction unchanged.
  map.on("click", (event) => {
    if (!selectMode) return;
    setSelectMode(false);
    ensureSelectionMarker(event.latlng);
    openPopup(event.latlng, renderLoadingPopup());
    requestHeatRisk(event.latlng);
  });
})();
