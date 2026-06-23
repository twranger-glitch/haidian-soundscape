/*
 * Haidian Soundscape — Heat Risk Tool
 * Replace the ENTIRE contents of heat-risk.js with this file.
 */
(function () {
  "use strict";

  const API_BASE = "https://haidian-heat-risk-api.yhzkiki.workers.dev";
  const TIMEOUT_MS = 12000;
  const STYLE_ID = "heat-risk-screen-styles";

  if (!window.L || !window.map) {
    console.error("Heat risk tool requires Leaflet and the global map variable.");
    return;
  }

  const map = window.map;
  let selecting = false;
  let marker = null;
  let popup = null;
  let controller = null;
let button = null;

const icon = {
  heat: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.4"></circle>
      <path d="M12 2.5v2.1M12 19.4v2.1M2.5 12h2.1M19.4 12h2.1"></path>
      <path d="m5.3 5.3 1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"></path>
    </svg>`,
  air: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10h10.5a3.5 3.5 0 1 0-3.3-4.7"></path>
      <path d="M4 14h14a3 3 0 1 1-2.7 4.3"></path>
      <path d="M4 18h5"></path>
    </svg>`,
  pin: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z"></path>
      <circle cx="12" cy="10" r="2.5"></circle>
    </svg>`,
  shield: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 20 6v5c0 5.4-3.4 8.8-8 10-4.6-1.2-8-4.6-8-10V6l8-3Z"></path>
      <path d="m9 12 2 2 4-4"></path>
    </svg>`,
  close: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18"></path>
    </svg>`
};
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.4"></circle>
        <path d="M12 2.5v2.1M12 19.4v2.1M2.5 12h2.1M19.4 12h2.1"></path>
        <path d="m5.3 5.3 1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"></path>
      </svg>`,
        air: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10h10.5a3.5 3.5 0 1 0-3.3-4.7"></path>
        <path d="M4 14h14a3 3 0 1 1-2.7 4.3"></path>
        <path d="M4 18h5"></path>
      </svg>`,
    pin: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z"></path>
        <circle cx="12" cy="10" r="2.5"></circle>
      </svg>`,
    shield: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 20 6v5c0 5.4-3.4 8.8-8 10-4.6-1.2-8-4.6-8-10V6l8-3Z"></path>
        <path d="m9 12 2 2 4-4"></path>
      </svg>`,
    close: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18"></path>
      </svg>`
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function fixed(value, digits, fallback = "—") {
    const number = asNumber(value);
    return number === null ? fallback : number.toFixed(digits);
  }

  function riskTone(code) {
    const tones = {
      normal: "normal",
      caution: "caution",
      extreme_caution: "extreme-caution",
      danger: "danger",
      extreme_danger: "extreme-danger"
    };
    return tones[String(code || "").toLowerCase()] || "caution";
  }

  function taipeiTime(isoText) {
    const date = new Date(isoText);
    if (!isoText || Number.isNaN(date.getTime())) return "時間未提供";

    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function ageText(value) {
    const minutes = asNumber(value);
    if (minutes === null) return "時間未提供";
    if (minutes < 1) return "1 分鐘內";
    if (minutes < 60) return `${Math.round(minutes)} 分鐘前`;
    return `${(minutes / 60).toFixed(1)} 小時前`;
  }

  function distanceText(value) {
    const km = asNumber(value);
    if (km === null) return "距離未提供";
    if (km < 1) return `距選點 ${Math.max(1, Math.round(km * 1000))} m`;
    return `距選點 ${km.toFixed(2)} km`;
  }

  function pm25Risk(pm25, declaredRisk) {
    const declaredCode = String(declaredRisk?.code || "")
      .trim()
      .toLowerCase();

    const declaredLabel = String(declaredRisk?.label || "").trim();

    const declaredMap = {
      low: { code: "low", label: "低風險" },
      low_risk: { code: "low", label: "低風險" },
      attention: { code: "attention", label: "要注意" },
      caution: { code: "attention", label: "要注意" },
      high: { code: "high", label: "高風險" },
      high_risk: { code: "high", label: "高風險" },
    };

    if (declaredMap[declaredCode]) {
      return {
        ...declaredMap[declaredCode],
        label: declaredLabel || declaredMap[declaredCode].label,
      };
    }

    const value = asNumber(pm25);

    if (value === null) {
      return { code: "unavailable", label: "暫無資料" };
    }

    if (value <= 15) return { code: "low", label: "低風險" };
    if (value <= 35) return { code: "attention", label: "要注意" };

    return { code: "high", label: "高風險" };
  }

  function airQualitySection(payload) {
    const air = payload?.airQuality || payload?.air_quality || {};
    const source = air?.source || {};
    const pm25 = asNumber(air?.pm25 ?? air?.pm25UgM3 ?? air?.PM25);

    const caveat = escapeHtml(
      air?.caveat || "微型感測器即時監測，僅供參考"
    );

    if (air?.available === false || pm25 === null) {
      return `
        <section class="hr-air hr-air--unavailable" aria-label="微型感測器空氣品質">
          <div class="hr-air-icon">${icon.air}</div>
          <div>
            <span>微型感測器・空氣品質</span>
            <b>附近暫時無PM2.5資料</b>
            <p>${caveat}</p>
          </div>
        </section>`;
    }

    const risk = pm25Risk(pm25, air?.risk);

    const stationName = escapeHtml(
      source?.stationName || "附近微型感測器"
    );

    return `
      <section class="hr-air hr-air--${risk.code}" aria-label="微型感測器空氣品質">
        <div class="hr-air-head">
          <div>
            <span>微型感測器・空氣品質</span>
            <b>PM2.5 即時濃度</b>
          </div>
          <i>${escapeHtml(risk.label)}</i>
        </div>

        <div class="hr-air-reading">
          <div class="hr-air-number">
            <strong>${fixed(pm25, 1)}</strong><em>μg/m³</em>
          </div>

          <div class="hr-air-meta">
            <b>${stationName}</b>
            <span>${distanceText(source?.sourceDistanceKm)}・${ageText(source?.ageMinutes)}</span>
          </div>

          <div class="hr-air-icon">${icon.air}</div>
        </div>

        <p>${caveat}</p>
      </section>`;
  }
  
  function closeButton() {
    return `
      <button class="hr-close" type="button" data-hr-close aria-label="關閉熱風險卡片">
        ${icon.close}
      </button>`;
  }

  function loadingCard() {
    return `
      <article class="hr-card hr-card--loading" aria-live="polite">
        <header class="hr-top">
          <div>
            <div class="hr-eyebrow">地圖選點・即時熱風險</div>
            <h2>正在讀取附近測點</h2>
          </div>
          ${closeButton()}
        </header>

        <div class="hr-state">
          <span class="hr-spinner"></span>
          <div>
            <b>正在整合溫度、濕度與 PM2.5</b>
            <p>尋找最近、且仍在有效時間內的觀測資料。</p>
          </div>
        </div>
      </article>`;
  }

  function errorCard(message) {
    return `
      <article class="hr-card hr-card--error" aria-live="polite">
        <header class="hr-top">
          <div>
            <div class="hr-eyebrow">地圖選點・即時熱風險</div>
            <h2>目前無法完成評估</h2>
          </div>
          ${closeButton()}
        </header>

        <div class="hr-state">
          <span class="hr-error-mark">!</span>
          <div>
            <b>${escapeHtml(message)}</b>
            <p>系統不會用距離過遠或過期的資料勉強產生評估，請稍後再試。</p>
          </div>
        </div>
      </article>`;
  }

  function resultCard(payload) {
    const assessment = payload?.assessment || {};
    const source = payload?.source || {};
    const risk = assessment?.risk || {};

    const tone = riskTone(risk.code);
    const label = escapeHtml(risk.label || "熱風險評估");
    const advice = escapeHtml(
      risk.advice || "請留意身體狀況，適時補充水分並降低曝曬。"
    );
    const station = escapeHtml(source.stationName || "最近合格測點");
    const quality = escapeHtml(source.qualityLabel || "即時觀測資料");
    const caveat = escapeHtml(
      payload?.caveat || "此結果由鄰近合格測點推估，並非選點位置的直接實測。"
    );

    return `
      <article class="hr-card hr-card--${tone}" aria-live="polite">
        <header class="hr-top">
          <div>
            <div class="hr-eyebrow"><i></i>地圖選點・即時熱風險</div>
            <div class="hr-title-row">
              <h2>${label}</h2>
              <span class="hr-status">${icon.shield} 即時判讀</span>
            </div>
          </div>
          ${closeButton()}
        </header>

        <section class="hr-hero">
          <div>
            <span>推估熱指數</span>
            <div class="hr-index">
              <strong>${fixed(assessment.heatIndexC, 1)}</strong>
              <em>°C</em>
            </div>
          </div>
          <div class="hr-heat-icon">${icon.heat}</div>
        </section>

        <section class="hr-metrics" aria-label="即時氣象條件">
          <div>
            <span>氣溫</span>
            <b>${fixed(assessment.temperatureC, 1)}<small>°C</small></b>
          </div>
          <div>
            <span>相對濕度</span>
            <b>${fixed(assessment.relativeHumidity, 0)}<small>%</small></b>
          </div>
        </section>
        ${airQualitySection(payload)}
        <section class="hr-advice">
          <span>現在最重要</span>
          <p>${advice}</p>
        </section>

        <section class="hr-source">
          <div class="hr-pin">${icon.pin}</div>

          <div class="hr-source-copy">
            <span>最近合格測點</span>
            <b>${station}</b>
            <p>${quality}・${distanceText(source.sourceDistanceKm)}</p>
          </div>

          <div class="hr-time">
            <b>${ageText(source.ageMinutes)}</b>
            <span>${taipeiTime(source.observedAt)}</span>
          </div>
        </section>

        <footer class="hr-foot">
          <span>資料說明</span>
          <p>${caveat}</p>
        </footer>
      </article>`;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
      #rightToolsWrapper .heat-risk-tool {
        pointer-events: auto;
        position: relative;
        width: 48px;
        height: 48px;
        margin: 0 0 12px;
        padding: 0;
        display: grid;
        place-items: center;
        border: 1px solid rgba(234, 88, 12, 0.2);
        border-radius: 16px;
        cursor: pointer;
        color: #ea580c;
        background:
          radial-gradient(circle at 28% 20%, rgba(255,255,255,.98) 0 15%, transparent 16%),
          linear-gradient(145deg, #fffaf2, #ffead3);
        box-shadow:
          0 10px 24px rgba(194,65,12,.16),
          inset 0 1px 0 rgba(255,255,255,.9);
        transition:
          transform .2s ease,
          box-shadow .2s ease,
          background .2s ease,
          color .2s ease;
        -webkit-tap-highlight-color: transparent;
      }

      #rightToolsWrapper .heat-risk-tool:hover {
        transform: translateY(-2px) scale(1.03);
        color: #c2410c;
        box-shadow:
          0 15px 30px rgba(194,65,12,.24),
          inset 0 1px 0 #fff;
      }

      #rightToolsWrapper .heat-risk-tool:focus-visible {
        outline: 3px solid rgba(251,146,60,.4);
        outline-offset: 3px;
      }

      #rightToolsWrapper .heat-risk-tool svg {
        width: 22px;
        height: 22px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.15;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      #rightToolsWrapper .heat-risk-tool::after {
        content: attr(data-tip);
        position: absolute;
        right: 58px;
        top: 50%;
        transform: translate(6px, -50%);
        opacity: 0;
        visibility: hidden;
        white-space: nowrap;
        padding: 8px 10px;
        border: 1px solid rgba(15,23,42,.08);
        border-radius: 10px;
        color: #334155;
        background: rgba(255,255,255,.97);
        box-shadow: 0 10px 24px rgba(15,23,42,.16);
        font: 800 12px/1.2 "Helvetica Neue", Arial, "Microsoft JhengHei", sans-serif;
        transition: opacity .18s ease, transform .18s ease, visibility .18s ease;
        pointer-events: none;
      }

      #rightToolsWrapper .heat-risk-tool:hover::after,
      #rightToolsWrapper .heat-risk-tool.is-on::after {
        opacity: 1;
        visibility: visible;
        transform: translate(0, -50%);
      }

      #rightToolsWrapper .heat-risk-tool.is-on {
        color: #fff;
        border-color: rgba(190,24,93,.38);
        background: linear-gradient(145deg, #fb7185, #e11d48);
        box-shadow: 0 12px 28px rgba(225,29,72,.32);
        animation: hr-pulse 1.6s ease-in-out infinite;
      }

      #rightToolsWrapper .heat-risk-tool.is-on::after {
        color: #9f1239;
        background: #fff1f2;
        border-color: rgba(251,113,133,.25);
      }

      #map.heat-risk-selecting {
        cursor: crosshair;
      }

      .leaflet-popup.hr-popup .leaflet-popup-content-wrapper {
        padding: 0;
        overflow: hidden;
        border-radius: 24px;
        background: transparent;
        box-shadow: 0 20px 55px rgba(15,23,42,.26);
      }

      .leaflet-popup.hr-popup .leaflet-popup-content {
        width: var(--hr-popup-width, 360px) !important;
        max-width: none !important;
        min-width: 0;
        margin: 0 !important;
      }

      .leaflet-popup.hr-popup .leaflet-popup-tip {
        background: #fff;
      }

      .hr-card {
        --hr: #f59e0b;
        --hr-deep: #b45309;
        --hr-soft: #fffbeb;
        --hr-tint: rgba(245,158,11,.14);

        width: var(--hr-popup-width, 360px);
        box-sizing: border-box;
        overflow: hidden;
        color: #1e293b;
        background: #fff;
        font-family: "Helvetica Neue", Arial, "Microsoft JhengHei", sans-serif;
      }

      .hr-card--normal {
        --hr: #14b8a6;
        --hr-deep: #0f766e;
        --hr-soft: #f0fdfa;
        --hr-tint: rgba(20,184,166,.13);
      }

      .hr-card--caution {
        --hr: #f59e0b;
        --hr-deep: #b45309;
        --hr-soft: #fffbeb;
        --hr-tint: rgba(245,158,11,.14);
      }

      .hr-card--extreme-caution {
        --hr: #f97316;
        --hr-deep: #c2410c;
        --hr-soft: #fff7ed;
        --hr-tint: rgba(249,115,22,.15);
      }

      .hr-card--danger {
        --hr: #e11d48;
        --hr-deep: #9f1239;
        --hr-soft: #fff1f2;
        --hr-tint: rgba(225,29,72,.14);
      }

      .hr-card--extreme-danger {
        --hr: #be123c;
        --hr-deep: #4c0519;
        --hr-soft: #fff1f2;
        --hr-tint: rgba(190,18,60,.16);
      }

      .hr-card--loading,
      .hr-card--error {
        --hr: #f97316;
        --hr-deep: #c2410c;
        --hr-soft: #fff7ed;
        --hr-tint: rgba(249,115,22,.14);
      }

      .hr-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        padding: 18px 18px 15px;
        border-bottom: 1px solid rgba(148,163,184,.14);
        background:
          radial-gradient(circle at 90% -25%, var(--hr-tint) 0 38%, transparent 39%),
          linear-gradient(145deg, #fff, var(--hr-soft));
      }

      .hr-eyebrow {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 6px;
        color: #64748b;
        font-size: 10.5px;
        line-height: 1.1;
        font-weight: 900;
        letter-spacing: .095em;
      }

      .hr-eyebrow i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--hr);
        box-shadow: 0 0 0 4px var(--hr-tint);
      }

      .hr-title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      .hr-top h2 {
        margin: 0;
        color: #0f172a;
        font-size: 21px;
        line-height: 1.16;
        font-weight: 900;
        letter-spacing: .01em;
      }

      .hr-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 7px;
        border: 1px solid var(--hr-tint);
        border-radius: 999px;
        color: var(--hr-deep);
        background: rgba(255,255,255,.74);
        font-size: 10.5px;
        font-weight: 850;
        line-height: 1;
      }

      .hr-status svg {
        width: 12px;
        height: 12px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .hr-close {
        width: 34px;
        height: 34px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        margin: -4px -4px 0 0;
        padding: 0;
        color: #64748b;
        background: rgba(255,255,255,.78);
        border: 1px solid rgba(148,163,184,.22);
        border-radius: 50%;
        cursor: pointer;
        transition: transform .18s ease, background .18s ease, color .18s ease;
      }

      .hr-close:hover {
        color: #fff;
        background: #e11d48;
        transform: rotate(90deg) scale(1.05);
      }

      .hr-close svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.3;
        stroke-linecap: round;
      }

      .hr-hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 18px 13px;
      }

      .hr-hero > div > span,
      .hr-advice > span,
      .hr-foot > span {
        display: block;
        color: #64748b;
        font-size: 10.5px;
        font-weight: 850;
        letter-spacing: .07em;
        line-height: 1.1;
      }

      .hr-index {
        display: flex;
        align-items: baseline;
        gap: 5px;
        margin-top: 4px;
        color: var(--hr-deep);
      }

      .hr-index strong {
        font-size: 46px;
        line-height: .95;
        font-weight: 950;
        letter-spacing: -.055em;
      }

      .hr-index em {
        font-style: normal;
        font-size: 15px;
        font-weight: 900;
      }

      .hr-heat-icon {
        width: 60px;
        height: 60px;
        display: grid;
        place-items: center;
        border: 1px solid var(--hr-tint);
        border-radius: 20px;
        color: var(--hr-deep);
        background:
          radial-gradient(circle at 30% 25%, #fff 0 15%, transparent 16%),
          linear-gradient(145deg, var(--hr-soft), #fff);
        box-shadow: inset 0 1px 0 #fff, 0 8px 18px var(--hr-tint);
      }

      .hr-heat-icon svg {
        width: 31px;
        height: 31px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.85;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .hr-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 0 18px 13px;
      }

      .hr-metrics > div {
        padding: 10px 11px 9px;
        border: 1px solid #eef2f6;
        border-radius: 13px;
        background: #f8fafc;
      }

      .hr-metrics span {
        display: block;
        color: #64748b;
        font-size: 10.5px;
        font-weight: 800;
      }

      .hr-metrics b {
        display: block;
        margin-top: 3px;
        color: #0f172a;
        font-size: 18px;
        font-weight: 900;
        letter-spacing: -.02em;
      }

      .hr-metrics small {
        margin-left: 3px;
        color: #64748b;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .hr-air {
        --hr-air-deep: #334155;
        --hr-air-soft: #f8fafc;
        --hr-air-tint: rgba(100,116,139,.14);
        margin: 0 18px 13px;
        padding: 12px;
        border: 1px solid var(--hr-air-tint);
        border-radius: 16px;
        background: linear-gradient(135deg, var(--hr-air-soft), #fff);
      }

      .hr-air--low {
        --hr-air-deep: #047857;
        --hr-air-soft: #ecfdf5;
        --hr-air-tint: rgba(5,150,105,.16);
      }

      .hr-air--attention {
        --hr-air-deep: #b45309;
        --hr-air-soft: #fffbeb;
        --hr-air-tint: rgba(217,119,6,.18);
      }

      .hr-air--high {
        --hr-air-deep: #be123c;
        --hr-air-soft: #fff1f2;
        --hr-air-tint: rgba(225,29,72,.17);
      }

      .hr-air--unavailable {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .hr-air-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }

      .hr-air-head span,
      .hr-air--unavailable span {
        display: block;
        color: #64748b;
        font-size: 10.5px;
        font-weight: 850;
        letter-spacing: .065em;
      }

      .hr-air-head b,
      .hr-air--unavailable b {
        display: block;
        margin-top: 3px;
        color: #334155;
        font-size: 13px;
        font-weight: 900;
      }

      .hr-air-head i {
        padding: 6px 8px;
        border: 1px solid var(--hr-air-tint);
        border-radius: 999px;
        color: var(--hr-air-deep);
        background: rgba(255,255,255,.78);
        font-size: 10.5px;
        font-style: normal;
        font-weight: 900;
      }

      .hr-air-reading {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr) 42px;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
      }

      .hr-air-number {
        color: var(--hr-air-deep);
        white-space: nowrap;
      }

      .hr-air-number strong {
        font-size: 30px;
        line-height: 1;
        font-weight: 950;
        letter-spacing: -.045em;
      }

      .hr-air-number em {
        margin-left: 4px;
        font-size: 10px;
        font-style: normal;
        font-weight: 850;
      }

      .hr-air-meta {
        min-width: 0;
        padding-left: 8px;
        border-left: 1px solid var(--hr-air-tint);
      }

      .hr-air-meta b {
        display: block;
        overflow: hidden;
        color: #475569;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hr-air-meta span {
        display: block;
        margin-top: 2px;
        color: #64748b;
        font-size: 10px;
        font-weight: 750;
        white-space: nowrap;
      }

      .hr-air-icon {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border: 1px solid var(--hr-air-tint);
        border-radius: 13px;
        color: var(--hr-air-deep);
        background: rgba(255,255,255,.72);
      }

      .hr-air-icon svg {
        width: 22px;
        height: 22px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.9;
        stroke-linecap: round;
      }

      .hr-air > p,
      .hr-air--unavailable p {
        margin: 8px 0 0;
        color: #64748b;
        font-size: 10px;
        line-height: 1.4;
        font-weight: 750;
      }

      .hr-advice {
        margin: 0 18px 13px;
        padding: 11px 12px;
        border: 1px solid var(--hr-tint);
        border-left: 4px solid var(--hr);
        border-radius: 0 13px 13px 0;
        background: var(--hr-soft);
      }

      .hr-advice p {
        margin: 5px 0 0;
        color: #334155;
        font-size: 12px;
        font-weight: 750;
        line-height: 1.55;
      }

      .hr-source {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        padding: 12px 18px;
        border-top: 1px solid #edf2f7;
      }

      .hr-pin {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 11px;
        color: #64748b;
        background: #f1f5f9;
      }

      .hr-pin svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .hr-source-copy {
        min-width: 0;
      }

      .hr-source-copy span,
      .hr-source-copy p,
      .hr-time span {
        color: #64748b;
        font-size: 10.5px;
        line-height: 1.35;
        font-weight: 750;
      }

      .hr-source-copy b {
        display: block;
        overflow: hidden;
        margin: 1px 0;
        color: #334155;
        font-size: 12px;
        line-height: 1.25;
        font-weight: 850;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hr-source-copy p {
        margin: 0;
      }

      .hr-time {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        padding-left: 7px;
        text-align: right;
      }

      .hr-time b {
        color: var(--hr-deep);
        font-size: 10.5px;
        line-height: 1.2;
        font-weight: 900;
        white-space: nowrap;
      }

      .hr-foot {
        padding: 9px 18px 13px;
        border-top: 1px solid #edf2f7;
        background: #f8fafc;
      }

      .hr-foot p {
        margin: 3px 0 0;
        color: #64748b;
        font-size: 10.5px;
        line-height: 1.45;
        font-weight: 700;
      }

      .hr-state {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 20px 18px 22px;
      }

      .hr-state b {
        display: block;
        color: #334155;
        font-size: 13px;
        line-height: 1.35;
        font-weight: 850;
      }

      .hr-state p {
        margin: 5px 0 0;
        color: #64748b;
        font-size: 11.5px;
        line-height: 1.55;
        font-weight: 700;
      }

      .hr-spinner {
        width: 22px;
        height: 22px;
        flex: 0 0 22px;
        box-sizing: border-box;
        border: 3px solid #fed7aa;
        border-top-color: #f97316;
        border-radius: 50%;
        animation: hr-spin .8s linear infinite;
      }

      .hr-error-mark {
        width: 25px;
        height: 25px;
        flex: 0 0 25px;
        display: grid;
        place-items: center;
        margin-top: 1px;
        border-radius: 50%;
        color: #fff;
        background: #e11d48;
        font-size: 15px;
        line-height: 1;
        font-weight: 950;
      }

      @keyframes hr-pulse {
        0%, 100% {
          box-shadow: 0 12px 28px rgba(225,29,72,.30);
        }
        50% {
          box-shadow:
            0 12px 0 8px rgba(251,113,133,.14),
            0 16px 34px rgba(225,29,72,.35);
        }
      }

      @keyframes hr-spin {
        to { transform: rotate(360deg); }
      }

      @media (max-width: 600px) {


        .hr-top { padding: 16px 16px 13px; }
        .hr-hero { padding: 13px 16px 12px; }
        .hr-metrics { padding: 0 16px 12px; }
        .hr-air,
        .hr-advice { margin: 0 16px 12px; }
        .hr-source { padding: 12px 16px; }
        .hr-foot { padding: 8px 16px 12px; }

        #rightToolsWrapper .heat-risk-tool::after {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function removeMarker() {
    if (marker) map.removeLayer(marker);
    marker = null;
  }

  function setMarker(latlng) {
    removeMarker();

    marker = L.circleMarker(latlng, {
      radius: 8,
      weight: 3,
      color: "#e11d48",
      fillColor: "#fff7ed",
      fillOpacity: 0.96,
      interactive: false
    }).addTo(map);
  }
  function getHeatPopupWidth() {
    return Math.max(240, Math.min(360, map.getSize().x - 28));
  }

  function openCard(latlng, html) {
    const popupWidth = getHeatPopupWidth();

    map
      .getContainer()
      .style.setProperty("--hr-popup-width", `${popupWidth}px`);

    if (!popup) {
      popup = L.popup({
        className: "hr-popup",
        closeButton: false,
        closeOnClick: false,
        autoClose: true,
        autoPan: true,
        autoPanPaddingTopLeft: [24, 104],
        autoPanPaddingBottomRight: [24, 160],
        maxWidth: popupWidth,
        minWidth: popupWidth
      });
    }

    popup.options.maxWidth = popupWidth;
    popup.options.minWidth = popupWidth;

    popup.setLatLng(latlng).setContent(html).openOn(map);
  }

  function closeCard() {
    if (popup) map.closePopup(popup);
    removeMarker();
  }

  function updateButton() {
    if (!button) return;

    button.classList.toggle("is-on", selecting);
    button.setAttribute("aria-pressed", String(selecting));
    button.setAttribute(
      "aria-label",
      selecting ? "正在選取熱風險位置，請點擊地圖" : "啟用熱風險地圖選點"
    );

    button.dataset.tip = selecting
      ? "點地圖任一處開始評估"
      : "熱風險選點";

    map.getContainer().classList.toggle("heat-risk-selecting", selecting);
  }

  function setSelecting(value) {
    selecting = Boolean(value);
    updateButton();
  }

  function friendlyError(payload, status) {
    const code = payload?.error?.code || payload?.error;
    const message = payload?.error?.message || payload?.message;

    if (code === "NO_QUALIFIED_SOURCE") {
      return "附近暫無可用的合格測點";
    }

    if (status === 429) {
      return "目前查詢量較高，請稍後再試";
    }

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }

    return status
      ? `熱風險服務暫時無法使用（HTTP ${status}）`
      : "熱風險服務暫時無法使用";
  }

  async function assess(latlng) {
    if (!API_BASE.startsWith("https://") || API_BASE.includes("REPLACE-WITH")) {
      openCard(latlng, errorCard("尚未設定熱風險服務網址"));
      return;
    }

    if (controller) controller.abort();

    const request = new AbortController();
    controller = request;

    const timeout = window.setTimeout(() => request.abort(), TIMEOUT_MS);

    try {
      const url = new URL("/risk", API_BASE);
      url.searchParams.set("lat", latlng.lat.toFixed(6));
      url.searchParams.set("lon", latlng.lng.toFixed(6));

      const response = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: request.signal
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(friendlyError(payload, response.status));
      }

      openCard(latlng, resultCard(payload));
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "查詢逾時，請稍後再試"
          : (error?.message || "熱風險服務暫時無法使用");

      openCard(latlng, errorCard(message));
    } finally {
      window.clearTimeout(timeout);

      if (controller === request) {
        controller = null;
      }
    }
  }

  function addButton() {
    const wrapper = document.getElementById("rightToolsWrapper");
    const menu = wrapper?.querySelector(".tools-menu-container");

    if (!wrapper || !menu) {
      console.error("Heat risk tool could not find #rightToolsWrapper.");
      return;
    }

    button = document.createElement("button");
    button.type = "button";
    button.className = "heat-risk-tool";
    button.title = "選取地圖上的位置，評估即時熱風險";
    button.innerHTML = icon.heat;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setSelecting(!selecting);
    });

    // 視覺順序：耳機 → 圖層 → 熱風險 → 展開的圖層面板
    wrapper.insertBefore(button, menu);

    updateButton();
  }

  addStyles();
  addButton();

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-hr-close]")) {
      event.preventDefault();
      event.stopPropagation();
      closeCard();
    }
  });

  map.on("click", (event) => {
    if (!selecting) return;

    setSelecting(false);
    setMarker(event.latlng);
    openCard(event.latlng, loadingCard());
    assess(event.latlng);
  });

  map.on("popupclose", (event) => {
    if (event.popup === popup) {
      removeMarker();
    }
  });
})();
