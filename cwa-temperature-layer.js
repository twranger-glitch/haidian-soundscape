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
      title: "熱風險分布圖",
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
  let pointQueryButton;

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
      /*
       * 熱風險分布圖控制：
       * 僅改這個元件外觀，不改圖層下載、透明度、全臺檢視或地圖查詢邏輯。
       */
      #${CONTROL_ID} {
        margin: 14px 0 18px;
        padding: 14px;
        color: #173b45;
        background:
          linear-gradient(145deg, rgba(255,255,255,.97), rgba(241,250,250,.92));
        border: 1px solid rgba(11, 123, 127, .22);
        border-radius: 18px;
        box-shadow:
          0 10px 24px rgba(13,47,53,.08),
          inset 0 1px 0 rgba(255,255,255,.88);
      }

      #${CONTROL_ID} .cwa-temp-head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 13px;
        padding: 0 0 12px;
        border-bottom: 1px solid rgba(11,123,127,.16);
      }

      #${CONTROL_ID} .cwa-temp-title-icon {
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        display: grid;
        place-items: center;
        color: #c85a17;
        background: linear-gradient(145deg, #fff8ed, #ffedd5);
        border: 1px solid rgba(249,115,22,.24);
        border-radius: 11px;
      }

      #${CONTROL_ID} .cwa-temp-title-icon svg {
        width: 18px;
        height: 18px;
      }

      #${CONTROL_ID} .cwa-temp-kicker {
        display: block;
        margin-bottom: 2px;
        color: #0f766e;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .07em;
      }

      #${CONTROL_ID} .cwa-temp-title {
        display: block;
        color: #153d47;
        font-size: 15px;
        line-height: 1.2;
        font-weight: 900;
        letter-spacing: .02em;
      }

      #${CONTROL_ID} .cwa-temp-toggle-card {
        display: flex !important;
        align-items: center;
        gap: 10px;
        margin: 0 !important;
        padding: 11px 12px;
        color: #174650;
        background: rgba(231,246,245,.86);
        border: 1px solid rgba(11,123,127,.20);
        border-radius: 13px;
        cursor: pointer;
      }

      #${CONTROL_ID} input[type="checkbox"] {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        margin: 0;
        accent-color: #087f86;
        cursor: pointer;
      }

      #${CONTROL_ID} .cwa-temp-toggle-copy {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      #${CONTROL_ID} .cwa-temp-toggle-copy strong {
        color: #174650;
        font-size: 13px;
        line-height: 1.25;
        font-weight: 900;
      }

      #${CONTROL_ID} .cwa-temp-toggle-copy small {
        color: #607887;
        font-size: 10.5px;
        line-height: 1.35;
        font-weight: 700;
      }

      #${CONTROL_ID} .cwa-temp-status {
        margin: 9px 2px 0;
        color: #5d7582;
        font-size: 11px;
        line-height: 1.5;
        font-weight: 700;
      }

      #${CONTROL_ID} .cwa-temp-status:empty {
        display: none;
      }

      #${CONTROL_ID} .cwa-temp-status.error {
        color: #b42318;
      }

      #${CONTROL_ID} .cwa-temp-controls {
        display: none;
        margin-top: 12px;
        padding: 12px;
        background: rgba(255,255,255,.75);
        border: 1px solid rgba(11,123,127,.18);
        border-radius: 14px;
      }

      #${CONTROL_ID}.ready .cwa-temp-controls {
        display: block;
      }

      #${CONTROL_ID} .cwa-temp-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #235460;
        font-size: 11px;
        font-weight: 900;
      }

      #${CONTROL_ID} .cwa-temp-opacity-value {
        padding: 3px 7px;
        color: #0f766e;
        background: #e8f7f5;
        border-radius: 999px;
        font-variant-numeric: tabular-nums;
      }

      #${CONTROL_ID} input[type="range"] {
        width: 100%;
        min-height: 28px;
        margin: 6px 0 8px;
        accent-color: #087f86;
        cursor: pointer;
      }

      #${CONTROL_ID} .cwa-temp-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 6px;
      }

      #${CONTROL_ID} button {
        min-height: 38px;
        padding: 8px 10px;
        color: #17616a;
        background: #fff;
        border: 1px solid rgba(11,123,127,.38);
        border-radius: 10px;
        font-size: 11px;
        font-weight: 850;
        cursor: pointer;
        transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease;
      }

      #${CONTROL_ID} button:hover:not(:disabled),
      #${CONTROL_ID} button:focus-visible:not(:disabled) {
        color: #fff;
        background: #087f86;
        border-color: #087f86;
        outline: 3px solid rgba(8,127,134,.20);
        outline-offset: 2px;
      }

      #${CONTROL_ID} button:active:not(:disabled) {
        transform: translateY(1px);
      }

      #${CONTROL_ID} button:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      #${CONTROL_ID} .cwa-temp-legend {
        margin-top: 12px;
        padding: 11px;
        border: 1px solid rgba(249,115,22,.26);
        border-radius: 13px;
        background: linear-gradient(145deg, #fffdfa, #fff7ed);
      }

      #${CONTROL_ID} .cwa-temp-legend-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        color: #8c3c13;
        font-size: 10.5px;
        font-weight: 900;
      }

      #${CONTROL_ID} .cwa-temp-legend-head em {
        color: #c85a17;
        font-size: 10px;
        font-style: normal;
        font-weight: 850;
      }

      #${CONTROL_ID} .cwa-temp-legend-body {
        display: flex;
        align-items: stretch;
        gap: 9px;
        height: 132px;
        margin-top: 9px;
      }

      #${CONTROL_ID} .cwa-temp-legend-scale {
        width: 16px;
        flex: 0 0 16px;
        border: 1px solid rgba(15,23,42,.14);
        border-radius: 5px;
        background: linear-gradient(to top, #27758b 0%, #4fadc4 16%, #9bd7dc 27%, #15965d 43%, #a5d475 55%, #f4f08a 65%, #f5af31 76%, #ef6a25 84%, #df2851 91%, #b31679 96%, #8b3aa5 100%);
      }

      #${CONTROL_ID} .cwa-temp-legend-ticks {
        display: flex;
        flex: 1;
        flex-direction: column;
        justify-content: space-between;
        color: #7c2d12;
        font-size: 10px;
        font-weight: 750;
        line-height: 1;
      }

      #${CONTROL_ID} .cwa-temp-legend-note {
        margin: 8px 0 0;
        color: #9a4a1d;
        font-size: 9.5px;
        line-height: 1.45;
        font-weight: 650;
      }

      #${CONTROL_ID} .cwa-temp-query {
        width: 100%;
        margin-top: 12px;
        color: #fff;
        background: linear-gradient(135deg, #0c8a8e, #08757b);
        border-color: #08757b;
      }

      #${CONTROL_ID} .cwa-temp-query:hover:not(:disabled),
      #${CONTROL_ID} .cwa-temp-query:focus-visible:not(:disabled) {
        color: #fff;
        background: #07656b;
        border-color: #07656b;
      }

      #${CONTROL_ID} .cwa-temp-query-note {
        margin: 7px 0 0;
        color: #5c7480;
        font-size: 9.5px;
        line-height: 1.48;
        font-weight: 650;
      }

      #${CONTROL_ID} .cwa-temp-details {
        margin-top: 11px;
        padding-top: 10px;
        border-top: 1px dashed rgba(11,123,127,.23);
        color: #647a83;
        font-size: 9.5px;
        line-height: 1.48;
        font-weight: 650;
      }

      @media (max-width: 600px) {
        #${CONTROL_ID} {
          margin: 12px 0 16px;
          padding: 12px;
          border-radius: 16px;
        }

        #${CONTROL_ID} .cwa-temp-actions {
          grid-template-columns: 1fr;
        }
      }
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
      <header class="cwa-temp-head">
        <div class="cwa-temp-title-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2.5v2.1M12 19.4v2.1M2.5 12h2.1M19.4 12h2.1"></path><path d="m5.3 5.3 1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"></path></svg>
        </div>
        <div>
          <span class="cwa-temp-kicker">官方圖資 · 中央氣象署</span>
          <strong class="cwa-temp-title">${escapeHtml(CONFIG.title)}</strong>
        </div>
      </header>

      <label class="cwa-temp-toggle-card" for="haidian-cwa-temperature-toggle">
        <input id="haidian-cwa-temperature-toggle" class="cwa-temp-toggle" type="checkbox" aria-label="顯示熱風險分布圖">
        <span class="cwa-temp-toggle-copy">
          <strong>顯示熱風險分布圖</strong>
          <small>官方小時溫度分析圖層</small>
        </span>
      </label>

      <div class="cwa-temp-status" aria-live="polite"></div>

      <div class="cwa-temp-controls">
        <div class="cwa-temp-label">
          <span>圖層透明度</span>
          <output class="cwa-temp-opacity-value"></output>
        </div>

        <input class="cwa-temp-opacity" type="range" min="0.1" max="1" step="0.05" aria-label="調整熱風險分布圖透明度">

        <div class="cwa-temp-actions">
          <button type="button" class="cwa-temp-refresh">重新載入圖層</button>
          <button type="button" class="cwa-temp-fit">查看全臺</button>
        </div>

        <section class="cwa-temp-legend" aria-label="熱風險分布圖溫度色階">
          <div class="cwa-temp-legend-head">
            <span>溫度色階（攝氏）</span>
            <em>冷 → 熱</em>
          </div>

          <div class="cwa-temp-legend-body">
            <div class="cwa-temp-legend-scale" aria-hidden="true"></div>
            <div class="cwa-temp-legend-ticks" aria-hidden="true">
              <span>38°C 以上</span><span>35°C</span><span>30°C</span><span>25°C</span><span>20°C</span><span>15°C</span><span>10°C</span><span>5°C</span><span>0°C</span><span>−1°C 以下</span>
            </div>
          </div>

          <p class="cwa-temp-legend-note">色彩為連續變化；調低透明度時會與底圖混合。欲查詢特定位置數值，請使用下方功能。</p>
        </section>

        <button type="button" class="cwa-temp-query">點選地圖查詢溫濕度與熱風險</button>
        <p class="cwa-temp-query-note">查詢結果會分別呈現官方區域分析與附近即時觀測，方便對照閱讀。</p>
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
    pointQueryButton = panel.querySelector(".cwa-temp-query");

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

    pointQueryButton.addEventListener("click", () => {
      const heatRiskButton = document.querySelector("#rightToolsWrapper .heat-risk-tool");
      if (!heatRiskButton) {
        setStatus("找不到地圖選點工具；請確認 heat-risk.js 仍在此檔案之前載入。", true);
        return;
      }

      if (!heatRiskButton.classList.contains("is-on")) heatRiskButton.click();
      setStatus("已進入查詢模式：請點選地圖任一位置，將並列官方格點與附近即時觀測。", false);
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

  function kmlPaths(zip) {
    const names = Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir && /\.kml$/i.test(name));

    // doc.kml is normally the entry point, but CWA KMZ files can place the
    // actual GroundOverlay in a linked/sub-folder KML.  Keep doc.kml first,
    // then inspect every other KML in the archive.
    return names.sort((a, b) => {
      const aIsDoc = /(^|\/)doc\.kml$/i.test(a);
      const bIsDoc = /(^|\/)doc\.kml$/i.test(b);
      if (aIsDoc !== bIsDoc) return aIsDoc ? -1 : 1;
      return a.localeCompare(b);
    });
  }

  function localNameOf(element) {
    return String(element?.localName || element?.nodeName || "")
      .split(":")
      .pop();
  }

  function firstDescendantByLocalName(parent, name) {
    const expected = String(name || "").toLowerCase();
    const elements = parent?.getElementsByTagName?.("*") || [];
    for (const element of elements) {
      if (localNameOf(element).toLowerCase() === expected) return element;
    }
    return null;
  }

  function textFromElement(parent, name) {
    const element = firstDescendantByLocalName(parent, name);
    return element ? String(element.textContent || "").trim() : "";
  }

  function validTaiwanBounds(north, south, east, west) {
    if (![north, south, east, west].every(Number.isFinite)) return false;
    if (south >= north || west >= east) return false;

    // Accept a Taiwan-wide layer plus a modest buffer. This deliberately
    // rejects legends/world-base overlays that sometimes coexist in KMZs.
    return north > 20 && south < 27.5 && east > 117 && west < 124.5;
  }

  function boundsFromLatLonBox(overlay) {
    const box = firstDescendantByLocalName(overlay, "LatLonBox") ||
      firstDescendantByLocalName(overlay, "LatLonAltBox");
    if (!box) return null;

    const north = Number(textFromElement(box, "north"));
    const south = Number(textFromElement(box, "south"));
    const east = Number(textFromElement(box, "east"));
    const west = Number(textFromElement(box, "west"));
    if (!validTaiwanBounds(north, south, east, west)) return null;

    return [[south, west], [north, east]];
  }

  function boundsFromLatLonQuad(overlay) {
    const quad = firstDescendantByLocalName(overlay, "LatLonQuad");
    const coordinatesText = textFromElement(quad, "coordinates");
    if (!coordinatesText) return null;

    const points = coordinatesText
      .trim()
      .split(/\s+/)
      .map((token) => token.split(",").map(Number))
      .filter((parts) => Number.isFinite(parts[0]) && Number.isFinite(parts[1]));

    if (points.length < 4) return null;
    const longitudes = points.map((point) => point[0]);
    const latitudes = points.map((point) => point[1]);
    const north = Math.max(...latitudes);
    const south = Math.min(...latitudes);
    const east = Math.max(...longitudes);
    const west = Math.min(...longitudes);
    if (!validTaiwanBounds(north, south, east, west)) return null;

    return [[south, west], [north, east]];
  }

  function resolveZipPath(kmlPath, href) {
    const raw = String(href || "").trim().replaceAll("\\", "/");
    if (!raw || raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      throw new Error("KMZ 內的影像檔路徑不正確");
    }

    const base = String(kmlPath || "").split("/").slice(0, -1);
    const output = [...base];
    for (const part of raw.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!output.length) throw new Error("KMZ 內的影像檔路徑超出封包範圍");
        output.pop();
        continue;
      }
      output.push(part);
    }

    const resolved = output.join("/");
    if (!resolved) throw new Error("KMZ 內的影像檔路徑不正確");
    return resolved;
  }

  function groundOverlayCandidate(overlay, kmlPath) {
    const href = textFromElement(overlay, "href");
    if (!href) return null;

    const bounds = boundsFromLatLonBox(overlay) || boundsFromLatLonQuad(overlay);
    if (!bounds) return null;

    const name = textFromElement(overlay, "name");
    const haystack = `${name} ${href}`.toLowerCase();
    const score =
      (/(temp|temperature|溫度|o-a0038)/i.test(haystack) ? 100 : 0) +
      (/\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(href) ? 10 : 0) +
      // Prefer a genuinely Taiwan-wide layer over a small inset/legend.
      ((bounds[1][0] - bounds[0][0]) * (bounds[1][1] - bounds[0][1]));

    return { href, bounds, kmlPath, score };
  }

  async function parseGroundOverlay(zip) {
    const paths = kmlPaths(zip);
    if (!paths.length) throw new Error("KMZ 中找不到 KML 描述檔");

    const candidates = [];
    for (const kmlPath of paths) {
      const file = zip.file(kmlPath);
      if (!file) continue;

      const kmlText = await file.async("string");
      const xml = new DOMParser().parseFromString(kmlText, "application/xml");
      if (xml.querySelector("parsererror")) continue;

      const overlays = Array.from(xml.getElementsByTagName("GroundOverlay"));
      for (const overlay of overlays) {
        const candidate = groundOverlayCandidate(overlay, kmlPath);
        if (candidate) candidates.push(candidate);
      }
    }

    if (!candidates.length) {
      throw new Error(`KMZ 中找不到可用的全臺溫度圖層範圍（已檢查 ${paths.length} 個 KML 檔）`);
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  async function imageBlobFromKmz(zip, href, kmlPath) {
    const imageRef = String(href || "").trim();
    if (/^https:\/\//i.test(imageRef)) {
      const response = await fetch(imageRef, { mode: "cors" });
      if (!response.ok) throw new Error(`KMZ 外部影像下載失敗（HTTP ${response.status}）`);
      return response.blob();
    }

    const normalized = resolveZipPath(kmlPath, imageRef);
    const imageFile = zip.file(normalized);
    if (!imageFile) throw new Error(`KMZ 中找不到溫度分布圖檔：${normalized}`);
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
    if (details) details.textContent = "";
    setStatus("", false);
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
      const { href, bounds, kmlPath } = await parseGroundOverlay(zip);
      const imageBlob = await imageBlobFromKmz(zip, href, kmlPath);
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
      details.innerHTML = "資料來源：中央氣象署 O-A0038-002 去背景 1 小時溫度分布圖。色階對照採用中央氣象署溫度圖的 −1°C 至 38°C 範圍；本圖層為官方分析產品，並非本站自行內插。";
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
