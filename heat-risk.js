/* Replace the ENTIRE contents of heat-risk.js with this file. */
(function () {
  "use strict";

  const API_BASE = "https://haidian-heat-risk-api.yhzkiki.workers.dev";
  const TIMEOUT_MS = 12000;
  const STYLE_ID = "haidian-heat-risk-styles";

  if (!window.L || !window.map) {
    console.error("Heat risk tool needs Leaflet and the global map variable.");
    return;
  }

  const map = window.map;
  let selecting = false;
  let button;
  let marker;
  let popup;
  let controller;

  const icons = {
    heat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.7V5a4 4 0 0 0-8 0v9.7a6 6 0 1 0 8 0Z"></path><path d="M10 10v6M18 8h2M18 12h2M18 16h2"></path></svg>`,
    air: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h10.5a3.5 3.5 0 1 0-3.3-4.7"></path><path d="M4 14h14a3 3 0 1 1-2.7 4.3"></path><path d="M4 18h5"></path></svg>`,
    pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>`,
    shield: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5.4-3.4 8.8-8 10-4.6-1.2-8-4.6-8-10V6l8-3Z"></path><path d="m9 12 2 2 4-4"></path></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>`
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function number(value) {
    const output = Number(value);
    return Number.isFinite(output) ? output : null;
  }

  function fixed(value, digits, fallback = "—") {
    const output = number(value);
    return output === null ? fallback : output.toFixed(digits);
  }

  function distance(value) {
    const km = number(value);
    if (km === null) return "距離未提供";
    return km < 1
      ? `距選點 ${Math.max(1, Math.round(km * 1000))} m`
      : `距選點 ${km.toFixed(2)} km`;
  }

  function age(value) {
    const minutes = number(value);
    if (minutes === null) return "時間未提供";
    if (minutes < 1) return "1 分鐘內";
    if (minutes < 60) return `${Math.round(minutes)} 分鐘前`;
    return `${(minutes / 60).toFixed(1)} 小時前`;
  }

  function taipeiTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "時間未提供";

    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function heatTone(code) {
    return {
      normal: "normal",
      caution: "caution",
      extreme_caution: "extreme-caution",
      danger: "danger",
      extreme_danger: "extreme-danger"
    }[String(code || "").toLowerCase()] || "caution";
  }

  function pm25Risk(value, suppliedRisk) {
    const supplied = String(suppliedRisk?.code || "").toLowerCase();
    const suppliedLabel = String(suppliedRisk?.label || "").trim();

    const known = {
      low: ["low", "低風險"],
      low_risk: ["low", "低風險"],
      attention: ["attention", "要注意"],
      caution: ["attention", "要注意"],
      high: ["high", "高風險"],
      high_risk: ["high", "高風險"]
    };

    if (known[supplied]) {
      return {
        code: known[supplied][0],
        label: suppliedLabel || known[supplied][1]
      };
    }

    const pm25 = number(value);
    if (pm25 === null) return { code: "unavailable", label: "暫無資料" };
    if (pm25 <= 15) return { code: "low", label: "低風險" };
    if (pm25 <= 35) return { code: "attention", label: "要注意" };
    return { code: "high", label: "高風險" };
  }

  function closeButton() {
    return `<button class="hr-close" type="button" data-hr-close aria-label="關閉熱風險卡片">${icons.close}</button>`;
  }

  function airBlock(payload) {
    const air = payload?.airQuality || payload?.air_quality || {};
    const pm25 = number(air.pm25 ?? air.pm25UgM3 ?? air.PM25);
    const source = air.source || {};
    const caveat = escapeHtml(
      air.caveat || "微型感測器即時監測，僅供參考"
    );

    if (air.available === false || pm25 === null) {
      return `<section class="hr-air hr-air--unavailable">
        <div class="hr-air-icon">${icons.air}</div>
        <div>
          <span>微型感測器・空氣品質</span>
          <b>附近暫無新鮮 PM2.5 資料</b>
          <p>${caveat}</p>
        </div>
      </section>`;
    }

    const risk = pm25Risk(pm25, air.risk);
    const station = escapeHtml(
      source.stationName || air.stationName || "附近微型感測器"
    );

    const sourceDistance =
      source.sourceDistanceKm ?? air.sourceDistanceKm;
    const sourceAge = source.ageMinutes ?? air.ageMinutes;

    return `<section class="hr-air hr-air--${risk.code}">
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
          <b>${station}</b>
          <span>${distance(sourceDistance)}・${age(sourceAge)}</span>
        </div>
        <div class="hr-air-icon">${icons.air}</div>
      </div>
      <p>${caveat}</p>
    </section>`;
  }

  function loadingCard() {
    return `<article class="hr-card hr-card--loading">
      <header>
        <div>
          <span class="hr-kicker">地圖選點・即時熱風險</span>
          <h2>正在讀取附近測點</h2>
        </div>
        ${closeButton()}
      </header>
      <div class="hr-state">
        <i class="hr-spinner"></i>
        <div>
          <b>正在整合溫度、濕度與 PM2.5</b>
          <p>尋找最近、且仍在有效時間內的觀測資料。</p>
        </div>
      </div>
    </article>`;
  }

  function errorCard(message) {
    return `<article class="hr-card hr-card--error">
      <header>
        <div>
          <span class="hr-kicker">地圖選點・即時熱風險</span>
          <h2>目前無法完成評估</h2>
        </div>
        ${closeButton()}
      </header>
      <div class="hr-state">
        <i class="hr-error">!</i>
        <div>
          <b>${escapeHtml(message)}</b>
          <p>系統不會用距離過遠或過期的資料勉強產生評估，請稍後再試。</p>
        </div>
      </div>
    </article>`;
  }

  function resultCard(payload) {
    const assessment = payload?.assessment || {};
    const heatSource = payload?.source || {};
    const risk = assessment?.risk || {};
    const tone = heatTone(risk.code);
    const label = escapeHtml(risk.label || "熱風險評估");
    const advice = escapeHtml(
      risk.advice || "請留意身體狀況，適時補充水分並降低曝曬。"
    );
    const station = escapeHtml(heatSource.stationName || "最近合格測點");
    const quality = escapeHtml(heatSource.qualityLabel || "即時觀測資料");
    const caveat = escapeHtml(
      payload?.caveat ||
        "熱指數由鄰近合格測點推估，並非選點位置的直接實測。"
    );

    return `<article class="hr-card hr-card--${tone}" aria-live="polite">
      <header>
        <div>
          <span class="hr-kicker"><i></i>地圖選點・即時熱風險</span>
          <div class="hr-title">
            <h2>${label}</h2>
            <small>${icons.shield} 即時判讀</small>
          </div>
        </div>
        ${closeButton()}
      </header>

      <section class="hr-hero">
        <div>
          <span>推估熱指數</span>
          <div><strong>${fixed(assessment.heatIndexC, 1)}</strong><em>°C</em></div>
        </div>
        <div class="hr-heat-icon">${icons.heat}</div>
      </section>

      <section class="hr-metrics">
        <div><span>氣溫</span><b>${fixed(assessment.temperatureC, 1)}<small>°C</small></b></div>
        <div><span>相對濕度</span><b>${fixed(assessment.relativeHumidity, 0)}<small>%</small></b></div>
      </section>

      ${airBlock(payload)}

      <section class="hr-advice">
        <span>現在最重要</span>
        <p>${advice}</p>
      </section>

      <section class="hr-source">
        <div class="hr-pin">${icons.pin}</div>
        <div>
          <span>最近合格測點</span>
          <b>${station}</b>
          <p>${quality}・${distance(heatSource.sourceDistanceKm)}</p>
        </div>
        <div class="hr-time">
          <b>${age(heatSource.ageMinutes)}</b>
          <span>${taipeiTime(heatSource.observedAt)}</span>
        </div>
      </section>

      <footer>
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
      #rightToolsWrapper .heat-risk-tool{pointer-events:auto;position:relative;width:48px;height:48px;margin:0 0 12px;padding:0;display:grid;place-items:center;border:1px solid rgba(234,88,12,.2);border-radius:16px;color:#ea580c;background:radial-gradient(circle at 28% 20%,#fff 0 15%,transparent 16%),linear-gradient(145deg,#fffaf2,#ffead3);box-shadow:0 10px 24px rgba(194,65,12,.16),inset 0 1px 0 #fff;cursor:pointer;transition:.2s;-webkit-tap-highlight-color:transparent}
      #rightToolsWrapper .heat-risk-tool:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 15px 30px rgba(194,65,12,.24)}
      #rightToolsWrapper .heat-risk-tool:focus-visible{outline:3px solid rgba(251,146,60,.4);outline-offset:3px}
      #rightToolsWrapper .heat-risk-tool svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.15;stroke-linecap:round;stroke-linejoin:round}
      #rightToolsWrapper .heat-risk-tool::after{content:attr(data-tip);position:absolute;right:58px;top:50%;padding:8px 10px;border:1px solid rgba(15,23,42,.08);border-radius:10px;color:#334155;background:rgba(255,255,255,.97);box-shadow:0 10px 24px rgba(15,23,42,.16);font:800 12px/1.2 "Helvetica Neue",Arial,"Microsoft JhengHei",sans-serif;white-space:nowrap;opacity:0;visibility:hidden;transform:translate(6px,-50%);transition:.18s;pointer-events:none}
      #rightToolsWrapper .heat-risk-tool:hover::after,#rightToolsWrapper .heat-risk-tool.is-on::after{opacity:1;visibility:visible;transform:translate(0,-50%)}
      #rightToolsWrapper .heat-risk-tool.is-on{color:#fff;border-color:rgba(190,24,93,.38);background:linear-gradient(145deg,#fb7185,#e11d48);box-shadow:0 12px 28px rgba(225,29,72,.32);animation:hr-pulse 1.6s ease-in-out infinite}
      #rightToolsWrapper .heat-risk-tool.is-on::after{color:#9f1239;background:#fff1f2}
      .heat-risk-selecting{cursor:crosshair}

      .leaflet-popup.hr-popup .leaflet-popup-content-wrapper{padding:0;overflow:hidden;border-radius:24px;background:transparent;box-shadow:0 20px 55px rgba(15,23,42,.26)}
      .leaflet-popup.hr-popup .leaflet-popup-content{width:min(360px,calc(100vw - 36px))!important;margin:0!important}
      .leaflet-popup.hr-popup .leaflet-popup-tip{background:#fff}

      .hr-card{--hr:#f59e0b;--deep:#b45309;--soft:#fffbeb;--tint:rgba(245,158,11,.14);width:min(360px,calc(100vw - 36px));overflow:hidden;color:#1e293b;background:#fff;font-family:"Helvetica Neue",Arial,"Microsoft JhengHei",sans-serif}
      .hr-card--normal{--hr:#14b8a6;--deep:#0f766e;--soft:#f0fdfa;--tint:rgba(20,184,166,.13)}
      .hr-card--caution{--hr:#f59e0b;--deep:#b45309;--soft:#fffbeb;--tint:rgba(245,158,11,.14)}
      .hr-card--extreme-caution{--hr:#f97316;--deep:#c2410c;--soft:#fff7ed;--tint:rgba(249,115,22,.15)}
      .hr-card--danger{--hr:#e11d48;--deep:#9f1239;--soft:#fff1f2;--tint:rgba(225,29,72,.14)}
      .hr-card--extreme-danger{--hr:#be123c;--deep:#4c0519;--soft:#fff1f2;--tint:rgba(190,18,60,.16)}

      .hr-card header{display:flex;justify-content:space-between;gap:12px;padding:18px 18px 15px;border-bottom:1px solid rgba(148,163,184,.14);background:radial-gradient(circle at 90% -25%,var(--tint) 0 38%,transparent 39%),linear-gradient(145deg,#fff,var(--soft))}
      .hr-kicker{display:flex;align-items:center;gap:7px;margin-bottom:6px;color:#64748b;font-size:10.5px;font-weight:900;letter-spacing:.095em}
      .hr-kicker i{width:7px;height:7px;border-radius:50%;background:var(--hr);box-shadow:0 0 0 4px var(--tint)}
      .hr-card h2{margin:0;color:#0f172a;font-size:21px;line-height:1.16;font-weight:900}
      .hr-title{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
      .hr-title small{display:inline-flex;align-items:center;gap:4px;padding:5px 7px;border:1px solid var(--tint);border-radius:999px;color:var(--deep);background:rgba(255,255,255,.74);font-size:10.5px;font-weight:850}
      .hr-title small svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2}
      .hr-close{width:34px;height:34px;display:grid;place-items:center;flex:0 0 auto;margin:-4px -4px 0 0;padding:0;border:1px solid rgba(148,163,184,.22);border-radius:50%;color:#64748b;background:rgba(255,255,255,.78);cursor:pointer;transition:.18s}
      .hr-close:hover{color:#fff;background:#e11d48;transform:rotate(90deg) scale(1.05)}
      .hr-close svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.3;stroke-linecap:round}

      .hr-hero{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 13px}
      .hr-hero span,.hr-advice>span,.hr-card footer>span{display:block;color:#64748b;font-size:10.5px;font-weight:850;letter-spacing:.07em}
      .hr-hero strong{font-size:46px;line-height:.95;color:var(--deep);font-weight:950;letter-spacing:-.055em}
      .hr-hero em{margin-left:5px;color:var(--deep);font-size:15px;font-style:normal;font-weight:900}
      .hr-heat-icon{width:60px;height:60px;display:grid;place-items:center;border:1px solid var(--tint);border-radius:20px;color:var(--deep);background:linear-gradient(145deg,var(--soft),#fff);box-shadow:0 8px 18px var(--tint)}
      .hr-heat-icon svg{width:31px;height:31px;fill:none;stroke:currentColor;stroke-width:1.85;stroke-linecap:round;stroke-linejoin:round}

      .hr-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 18px 13px}
      .hr-metrics>div{padding:10px 11px 9px;border:1px solid #eef2f6;border-radius:13px;background:#f8fafc}
      .hr-metrics span{display:block;color:#64748b;font-size:10.5px;font-weight:800}
      .hr-metrics b{display:block;margin-top:3px;color:#0f172a;font-size:18px;font-weight:900}
      .hr-metrics small{margin-left:3px;color:#64748b;font-size:10px}

      .hr-air{--air:#64748b;--air-deep:#334155;--air-soft:#f8fafc;--air-tint:rgba(100,116,139,.14);margin:0 18px 13px;padding:12px;border:1px solid var(--air-tint);border-radius:16px;background:linear-gradient(135deg,var(--air-soft),#fff)}
      .hr-air--low{--air:#059669;--air-deep:#047857;--air-soft:#ecfdf5;--air-tint:rgba(5,150,105,.16)}
      .hr-air--attention{--air:#d97706;--air-deep:#b45309;--air-soft:#fffbeb;--air-tint:rgba(217,119,6,.18)}
      .hr-air--high{--air:#e11d48;--air-deep:#be123c;--air-soft:#fff1f2;--air-tint:rgba(225,29,72,.17)}
      .hr-air--unavailable{display:flex;align-items:center;gap:10px}
      .hr-air-head{display:flex;justify-content:space-between;gap:10px}
      .hr-air-head span,.hr-air--unavailable span{display:block;color:#64748b;font-size:10.5px;font-weight:850;letter-spacing:.065em}
      .hr-air-head b,.hr-air--unavailable b{display:block;margin-top:3px;color:#334155;font-size:13px;font-weight:900}
      .hr-air-head i{padding:6px 8px;border:1px solid var(--air-tint);border-radius:999px;color:var(--air-deep);background:rgba(255,255,255,.78);font-size:10.5px;font-style:normal;font-weight:900}
      .hr-air-reading{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr) 42px;align-items:center;gap:8px;margin-top:8px}
      .hr-air-number{color:var(--air-deep);white-space:nowrap}
      .hr-air-number strong{font-size:30px;line-height:1;font-weight:950;letter-spacing:-.045em}
      .hr-air-number em{margin-left:4px;font-size:10px;font-style:normal;font-weight:850}
      .hr-air-meta{min-width:0;padding-left:8px;border-left:1px solid var(--air-tint)}
      .hr-air-meta b{display:block;overflow:hidden;color:#475569;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      .hr-air-meta span{display:block;margin-top:2px;color:#64748b;font-size:10px;font-weight:750;white-space:nowrap}
      .hr-air-icon{width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--air-tint);border-radius:13px;color:var(--air-deep);background:rgba(255,255,255,.72)}
      .hr-air-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round}
      .hr-air>p,.hr-air--unavailable p{margin:8px 0 0;color:#64748b;font-size:10px;line-height:1.4;font-weight:750}

      .hr-advice{margin:0 18px 13px;padding:11px 12px;border:1px solid var(--tint);border-left:4px solid var(--hr);border-radius:0 13px 13px 0;background:var(--soft)}
      .hr-advice p{margin:5px 0 0;color:#334155;font-size:12px;font-weight:750;line-height:1.55}

      .hr-source{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;padding:12px 18px;border-top:1px solid #edf2f7}
      .hr-pin{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:#64748b;background:#f1f5f9}
      .hr-pin svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2}
      .hr-source>div:nth-child(2){min-width:0}
      .hr-source span,.hr-source p,.hr-time span{color:#64748b;font-size:10.5px;line-height:1.35;font-weight:750}
      .hr-source b{display:block;overflow:hidden;margin:1px 0;color:#334155;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
      .hr-source p{margin:0}
      .hr-time{display:flex;flex-direction:column;align-items:flex-end;padding-left:7px;text-align:right}
      .hr-time b{color:var(--deep);font-size:10.5px;white-space:nowrap}

      .hr-card footer{padding:9px 18px 13px;border-top:1px solid #edf2f7;background:#f8fafc}
      .hr-card footer p{margin:3px 0 0;color:#64748b;font-size:10.5px;line-height:1.45;font-weight:700}

      .hr-state{display:flex;gap:12px;padding:20px 18px 22px}
      .hr-state b{display:block;color:#334155;font-size:13px;font-weight:850}
      .hr-state p{margin:5px 0 0;color:#64748b;font-size:11.5px;line-height:1.55;font-weight:700}
      .hr-spinner{width:22px;height:22px;flex:0 0 22px;border:3px solid #fed7aa;border-top-color:#f97316;border-radius:50%;animation:hr-spin .8s linear infinite}
      .hr-error{width:25px;height:25px;display:grid;place-items:center;flex:0 0 25px;border-radius:50%;color:#fff;background:#e11d48;font-style:normal;font-weight:950}
      @keyframes hr-pulse{50%{box-shadow:0 12px 0 8px rgba(251,113,133,.14),0 16px 34px rgba(225,29,72,.35)}}
      @keyframes hr-spin{to{transform:rotate(360deg)}}

      @media(max-width:600px){
        .leaflet-popup.hr-popup .leaflet-popup-content,.hr-card{width:min(338px,calc(100vw - 28px))!important}
        .hr-card header{padding:16px 16px 13px}
        .hr-hero{padding:13px 16px 12px}
        .hr-metrics{padding:0 16px 12px}
        .hr-air,.hr-advice{margin:0 16px 12px}
        .hr-source{padding:12px 16px}
        .hr-card footer{padding:8px 16px 12px}
        #rightToolsWrapper .heat-risk-tool::after{display:none}
      }
    `;

    document.head.appendChild(style);
  }

  function setMarker(latlng) {
    if (marker) map.removeLayer(marker);

    marker = L.circleMarker(latlng, {
      radius: 8,
      weight: 3,
      color: "#e11d48",
      fillColor: "#fff7ed",
      fillOpacity: 0.96,
      interactive: false
    }).addTo(map);
  }

  function closeCard() {
    if (popup) map.closePopup(popup);
    if (marker) map.removeLayer(marker);
    marker = null;
  }

  function openCard(latlng, html) {
    if (!popup) {
      popup = L.popup({
        className: "hr-popup",
        closeButton: false,
        closeOnClick: false,
        autoClose: true,
        autoPan: true,
        autoPanPaddingTopLeft: [20, 112],
        autoPanPaddingBottomRight: [24, 154],
        maxWidth: 390
      });
    }

    popup.setLatLng(latlng).setContent(html).openOn(map);
  }

  function setSelecting(value) {
    selecting = Boolean(value);
    button.classList.toggle("is-on", selecting);
    button.setAttribute("aria-pressed", String(selecting));
    button.dataset.tip = selecting
      ? "點地圖任一處開始評估"
      : "熱風險選點";

    map.getContainer().classList.toggle("heat-risk-selecting", selecting);
  }

  function errorMessage(payload, status) {
    const code = payload?.error?.code || payload?.error;

    if (code === "NO_QUALIFIED_SOURCE") {
      return "附近暫無可用的合格測點";
    }

    if (status === 429) {
      return "目前查詢量較高，請稍後再試";
    }

    return (
      payload?.error?.message ||
      payload?.message ||
      `熱風險服務暫時無法使用（HTTP ${status}）`
    );
  }

  async function assess(latlng) {
    if (controller) controller.abort();

    controller = new AbortController();
    const current = controller;
    const timer = window.setTimeout(
      () => current.abort(),
      TIMEOUT_MS
    );

    try {
      const url = new URL("/risk", API_BASE);
      url.searchParams.set("lat", latlng.lat.toFixed(6));
      url.searchParams.set("lon", latlng.lng.toFixed(6));

      const response = await fetch(url.toString(), {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: current.signal
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(errorMessage(payload, response.status));
      }

      openCard(latlng, resultCard(payload));
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "查詢逾時，請稍後再試"
          : error?.message || "熱風險服務暫時無法使用";

      openCard(latlng, errorCard(message));
    } finally {
      window.clearTimeout(timer);
      if (controller === current) controller = null;
    }
  }

  function addButton() {
    const wrapper = document.getElementById("rightToolsWrapper");
    const menu = wrapper?.querySelector(".tools-menu-container");

    if (!wrapper || !menu) {
      console.error("Cannot find #rightToolsWrapper.");
      return;
    }

    button = document.createElement("button");
    button.type = "button";
    button.className = "heat-risk-tool";
    button.title = "選取地圖上的位置，評估即時熱風險";
    button.dataset.tip = "熱風險選點";
    button.innerHTML = icons.heat;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setSelecting(!selecting);
    });

    wrapper.insertBefore(button, menu);
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
    if (event.popup === popup && marker) {
      map.removeLayer(marker);
      marker = null;
    }
  });
})();
