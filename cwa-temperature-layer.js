/*
 * Haidian Soundscape — Central Weather Administration temperature overlay
 *
 * Safe add-on contract:
 * - Load this file AFTER heat-risk.js.
 * - It adds its own control to the existing right-side layer menu.
 * - It does nothing until a visitor enables the checkbox.
 * - Removing the <script> tag disables it immediately.
 */
(function () {
  "use strict";

  const CONFIG = Object.assign(
    {
      endpoint: "https://haidian-heat-risk-api.yhzkiki.workers.dev/temperature-kmz",
      title: "中央氣象署全臺溫度分布（實驗）",
      initialOpacity: 0.64,
      zIndex: 420,
      maxAgeMinutes: 150,
      jsZipUrl: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
    },
    window.HAIDIAN_CWA_TEMPERATURE_CONFIG || {}
  );

  const CONTROL_SELECTOR = "#rightToolsWrapper .custom-layer-control";
  const CONTROL_ID = "haidian-cwa-temperature-layer";

  if (!window.L || !window.map) {
    console.error("CWA temperature layer needs Leaflet and the global map variable.");
    return;
  }

  const map = window.map;
  const state = {
    overlay: null,
    objectUrl: null,
    controller: null,
    loading: false,
    opacity: clamp(CONFIG.initialOpacity, 0.1, 1, 0.64),
    observedAt: "",
  };

  let panel;
  let toggle;
  let opacityInput;
  let opacityValue;
  let status;
  let details;
  let refreshButton;
  let fitButton;

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function addStyles() {
    if (document.getElementById(`${CONTROL_ID}-styles`)) return;

    const style = document.createElement("style");
    style.id = `${CONTROL_ID}-styles`;
    style.textContent = `
      #${CONTROL_ID} { margin: 12px 0; padding: 12px 0; border-top: 1px solid rgba(148,163,184,.35); border-bottom: 1px solid rgba(148,163,184,.35); }
      #${CONTROL_ID} .cwa-temp-title { color: var(--text-muted, #64748b); font-size: 11px; margin-bottom: 8px; font-weight: 800; display: flex; align-items: center; gap: 5px; }
      #${CONTROL_ID} .cwa-temp-row { display: flex; align-items: center; gap: 8px; }
      #${CONTROL_ID} .cwa-temp-row label { margin: 0; cursor: pointer; }
      #${CONTROL_ID} input[type="checkbox"] { width: 17px; height: 17px; margin: 0; accent-color: #f97316; flex: 0 0 auto; }
      #${CONTROL_ID} .cwa-temp-status { min-height: 17px; margin-top: 7px; color: #64748b; font-size: 11px; line-height: 1.45; font-weight: 650; }
      #${CONTROL_ID} .cwa-temp-status.error { color: #b91c1c; }
      #${CONTROL_ID} .cwa-temp-controls { display: none; margin-top: 8px; padding: 9px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; }
      #${CONTROL_ID}.ready .cwa-temp-controls { display: block; }
      #${CONTROL_ID} .cwa-temp-label { display: flex; justify-content: space-between; gap: 8px; color: #9a3412; font-size: 11px; font-weight: 800; margin-bottom: 4px; }
      #${CONTROL_ID} input[type="range"] { width: 100%; margin: 0; accent-color: #f97316; }
      #${CONTROL_ID} .cwa-temp-actions { display: flex; gap: 6px; margin-top: 8px; }
      #${CONTROL_ID} button { flex: 1; min-height: 30px; padding: 5px 7px; border: 1px solid #fdba74; border-radius: 7px; background: #fff; color: #9a3412; font-size: 11px; font-weight: 800; cursor: pointer; }
      #${CONTROL_ID} button:disabled { opacity: .55; cursor: not-allowed; }
      #${CONTROL_ID} .cwa-temp-details { margin-top: 8px; color: #7c2d12; font-size: 10px; line-height: 1.48; }
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    const control = document.querySelector(CONTROL_SELECTOR);
    if (!control || document.getElementById(CONTROL_ID)) return false;

    panel = document.createElement("section");
    panel.id = CONTROL_ID;
    panel.setAttribute("aria-label", "中央氣象署官方溫度分布圖層");
    panel.innerHTML = `
      <div class="cwa-temp-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2.5v2.1M12 19.4v2.1M2.5 12h2.1M19.4 12h2.1"></path><path d="m5.3 5.3 1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"></path></svg>
        ${escapeHtml(CONFIG.title)}
      </div>
      <div class="cwa-temp-row">
        <input class="cwa-temp-toggle" type="checkbox" aria-label="顯示中央氣象署官方溫度分布圖">
        <label for="">顯示全臺官方溫度分布</label>
      </div>
      <div class="cwa-temp-status" aria-live="polite">關閉時不下載資料。</div>
      <div class="cwa-temp-controls">
        <div class="cwa-temp-label"><span>圖層透明度</span><output class="cwa-temp-opacity-value"></output></div>
        <input class="cwa-temp-opacity" type="range" min="0.1" max="1" step="0.05" aria-label="溫度圖透明度">
        <div class="cwa-temp-actions">
          <button type="button" class="cwa-temp-refresh">重新載入圖層</button>
          <button type="button" class="cwa-temp-fit">查看全臺</button>
        </div>
        <div class="cwa-temp-details"></div>
      </div>
    `;

    control.insertBefore(panel, control.firstChild);
    toggle = panel.querySelector(".cwa-temp-toggle");
    opacityInput = panel.querySelector(".cwa-temp-opacity");
    opacityValue = panel.querySelector(".cwa-temp-opacity-value");
    status = panel.querySelector(".cwa-temp-status");
    details = panel.querySelector(".cwa-temp-details");
    refreshButton = panel.querySelector(".cwa-temp-refresh");
    fitButton = panel.querySelector(".cwa-temp-fit");

    opacityInput.value = String(state.opacity);
    renderOpacity();

    toggle.addEventListener("change", () => {
      if (toggle.checked) void loadTemperatureLayer();
      else removeLayer();
    });

    opacityInput.addEventListener("input", () => {
      state.opacity = clamp(opacityInput.value, 0.1, 1, state.opacity);
      if (state.overlay) state.overlay.setOpacity(state.opacity);
      renderOpacity();
    });

    refreshButton.addEventListener("click", () => {
      if (!state.loading) void loadTemperatureLayer({ keepView: true });
    });

    fitButton.addEventListener("click", () => {
      if (state.overlay) map.fitBounds(state.overlay.getBounds(), { padding: [22, 22] });
    });

    try {
      window.L.DomEvent.disableClickPropagation(panel);
      window.L.DomEvent.disableScrollPropagation(panel);
    } catch (_) {}

    return true;
  }

  function renderOpacity() {
    if (opacityValue) opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
  }

  function setStatus(message, isError) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
  }

  function setLoading(loading) {
    state.loading = Boolean(loading);
    if (toggle) toggle.disabled = state.loading;
    if (refreshButton) refreshButton.disabled = state.loading;
  }

  function taipeiTime(isoText) {
    const date = new Date(isoText);
    if (!isoText || Number.isNaN(date.getTime())) return "資料時間未提供";
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function ageText(isoText) {
    const age = (Date.now() - Date.parse(isoText)) / 60000;
    if (!Number.isFinite(age)) return "";
    if (age < 1) return "剛更新";
    if (age < 60) return `約 ${Math.round(age)} 分鐘前`;
    return `約 ${(age / 60).toFixed(1)} 小時前`;
  }

  function ensureJsZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);

    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-haidian-jszip="1"]');
      if (existing) {
        existing.addEventListener("load", () => window.JSZip ? resolve(window.JSZip) : reject(new Error("JSZip 載入失敗")), { once: true });
        existing.addEventListener("error", () => reject(new Error("JSZip 載入失敗")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = CONFIG.jsZipUrl;
      script.async = true;
      script.dataset.haidianJszip = "1";
      script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error("JSZip 載入失敗"));
      script.onerror = () => reject(new Error("無法下載 KMZ 解壓縮元件"));
      document.head.appendChild(script);
    });
  }

  function normalizedZipPath(path) {
    const text = String(path || "").trim().replaceAll("\\", "/");
    if (!text || text.startsWith("/") || text.split("/").includes("..")) {
      throw new Error("KMZ 圖檔路徑不正確");
    }
    return text;
  }

  function firstKmlPath(zip) {
    const names = Object.keys(zip.files);
    return names.find((name) => name.toLowerCase() === "doc.kml") ||
      names.find((name) => /\.kml$/i.test(name));
  }

  function textFromElement(parent, name) {
    const element = parent.getElementsByTagName(name)[0];
    return element ? String(element.textContent || "").trim() : "";
  }

  function parseGroundOverlay(kmlText) {
    const xml = new DOMParser().parseFromString(kmlText, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("KMZ 的 KML 資料無法解析");

    const overlays = Array.from(xml.getElementsByTagName("GroundOverlay"));
    for (const overlay of overlays) {
      const href = textFromElement(overlay, "href");
      const boxes = overlay.getElementsByTagName("LatLonBox");
      const box = boxes[0];
      if (!href || !box) continue;

      const north = Number(textFromElement(box, "north"));
      const south = Number(textFromElement(box, "south"));
      const east = Number(textFromElement(box, "east"));
      const west = Number(textFromElement(box, "west"));
      if (![north, south, east, west].every(Number.isFinite)) continue;
      if (south >= north || west >= east) continue;
      if (south < 15 || north > 30 || west < 110 || east > 130) continue;

      return { href, bounds: [[south, west], [north, east]] };
    }

    throw new Error("KMZ 中找不到可用的全臺溫度圖層範圍");
  }

  async function imageBlobFromKmz(zip, href) {
    const imageRef = String(href || "").trim();
    if (/^https:\/\//i.test(imageRef)) {
      const response = await fetch(imageRef, { mode: "cors" });
      if (!response.ok) throw new Error(`KMZ 外部影像下載失敗（HTTP ${response.status}）`);
      return response.blob();
    }

    const normalized = normalizedZipPath(imageRef);
    const imageFile = zip.file(normalized) || zip.file(normalized.split("/").pop());
    if (!imageFile) throw new Error("KMZ 中找不到溫度分布圖檔");
    return imageFile.async("blob");
  }

  function removeLayer() {
    if (state.controller) {
      state.controller.abort();
      state.controller = null;
    }
    if (state.overlay) {
      map.removeLayer(state.overlay);
      state.overlay = null;
    }
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
    panel?.classList.remove("ready");
    setStatus("已關閉；不會繼續下載資料。", false);
  }

  async function loadTemperatureLayer(options = {}) {
    if (state.loading) return;
    setLoading(true);
    setStatus("正在讀取中央氣象署官方溫度分布圖…", false);

    try {
      const [JSZip] = await Promise.all([ensureJsZip()]);
      const controller = new AbortController();
      state.controller = controller;

      const url = new URL(CONFIG.endpoint, window.location.href);

      const response = await fetch(url.href, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "";
        try {
          const payload = await response.json();
          detail = payload?.error?.detail || payload?.error?.message || "";
        } catch (_) {}
        throw new Error(detail || `溫度圖服務回應 HTTP ${response.status}`);
      }

      const observedAt = response.headers.get("X-Haidian-Temperature-Observed-At") || "";
      const kmzBytes = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(kmzBytes);
      const kmlPath = firstKmlPath(zip);
      if (!kmlPath) throw new Error("KMZ 中找不到 KML 描述檔");
      const kmlText = await zip.file(kmlPath).async("string");
      const { href, bounds } = parseGroundOverlay(kmlText);
      const imageBlob = await imageBlobFromKmz(zip, href);
      if (!imageBlob || imageBlob.size < 64) throw new Error("KMZ 內的溫度圖檔大小異常");

      const nextObjectUrl = URL.createObjectURL(imageBlob);
      const nextOverlay = window.L.imageOverlay(nextObjectUrl, bounds, {
        opacity: state.opacity,
        interactive: false,
        zIndex: CONFIG.zIndex,
        className: "haidian-cwa-temperature-overlay",
      });

      const previousOverlay = state.overlay;
      const previousUrl = state.objectUrl;
      state.overlay = nextOverlay;
      state.objectUrl = nextObjectUrl;
      state.observedAt = observedAt;

      if (previousOverlay) map.removeLayer(previousOverlay);
      if (previousUrl) URL.revokeObjectURL(previousUrl);

      nextOverlay.addTo(map);
      if (!options.keepView) map.fitBounds(bounds, { padding: [22, 22] });

      panel.classList.add("ready");
      const timeDescription = observedAt ? `${taipeiTime(observedAt)}（${ageText(observedAt)}）` : "官方圖資時間未提供";
      setStatus(`已顯示官方溫度分布圖；資料時間：${timeDescription}`, false);
      details.innerHTML = "資料來源：中央氣象署 O-A0038-002 去背景 1 小時溫度分布圖。此圖層為官方分析產品，並非本站自行內插。";
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (toggle) toggle.checked = Boolean(state.overlay);
      panel?.classList.toggle("ready", Boolean(state.overlay));
      setStatus(`無法載入：${error instanceof Error ? error.message : String(error)}`, true);
      console.error("CWA temperature layer failed", error);
    } finally {
      state.controller = null;
      setLoading(false);
    }
  }

  function init() {
    addStyles();
    if (!createPanel()) {
      console.warn("CWA temperature layer could not find the existing layer panel.");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
