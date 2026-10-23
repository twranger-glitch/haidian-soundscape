/*
 * 探究地景分站：右側圖資選單的分組整理。
 * - 動態插進來的區塊（氣象署熱風險／溫度、日照與樹蔭模擬）收進「氣候與日照」群組。
 * - 每個群組的標題列顯示目前勾選了幾個圖層，收合時也看得出哪一組正在用。
 * - 「聲音地景點位」預設不顯示，勾選後才把聲景標記疊上來。
 * - 桌機進站直接打開圖資面板；手機先看地圖。
 */
(function () {
  'use strict';

  if (document.documentElement.getAttribute('data-site') !== 'gis') return;

  var LS_WORKS = 'ss-gis-works';
  var control = null;
  var slot = null;
  var frame = 0;

  function ready(fn) {
    if (document.readyState === 'loading' || window.__ssDCL === false) document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function replaceText(root, from, to) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.indexOf(from) >= 0) node.nodeValue = node.nodeValue.split(from).join(to);
    }
  }

  // ---- 把動態插入的區塊收進對的群組 ----

  function adopt() {
    var cwa = document.getElementById('haidian-cwa-temperature-layer');
    if (cwa && cwa.parentNode !== slot) {
      replaceText(cwa, '中央氣象署全臺溫度分布', '熱風險分布圖');
      replaceText(cwa, '顯示全臺官方溫度分布', '顯示熱風險分布圖');
      slot.appendChild(cwa);
    }
    var shade = document.getElementById('haidianShadeSection');
    if (shade && shade.parentNode !== slot) slot.appendChild(shade);

    var empty = control.querySelector('[data-ss-climate-empty]');
    if (empty) empty.hidden = slot.children.length > 0;

    var note = control.querySelector('.haidian-v4-data-note');
    if (note) note.remove();
  }

  // ---- 群組標題列：顯示啟用中的圖層數 ----

  // 日照與樹蔭區塊有幾個預設勾選的子選項，主開關沒開就不算在內
  function isLayerOn(input) {
    var shade = input.closest('#haidianShadeSection');
    if (!shade || input.id === 'haidianShadeToggle') return true;
    var main = document.getElementById('haidianShadeToggle');
    return !!(main && main.checked);
  }

  function countGroups() {
    Array.prototype.forEach.call(control.querySelectorAll('.ss-group'), function (group) {
      var summary = group.querySelector(':scope > summary');
      if (!summary) return;
      var n = Array.prototype.filter.call(group.querySelectorAll('input[type="checkbox"]:checked'), isLayerOn).length;
      var badge = summary.querySelector('.ss-group-count');
      if (!badge) {
        badge = document.createElement('b');
        badge.className = 'ss-group-count';
        badge.setAttribute('aria-label', '啟用中的圖層數');
        var small = summary.querySelector('small');
        summary.insertBefore(badge, small ? small.nextSibling : null);
      }
      badge.textContent = n ? String(n) : '';
      badge.hidden = !n;
      group.classList.toggle('is-active', n > 0);
    });
  }

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () { adopt(); countGroups(); });
  }

  // ---- 聲音地景點位：預設不疊上來 ----

  function worksOn() { return readLS(LS_WORKS) === '1'; }

  function applyWorks(on) {
    document.body.classList.toggle('ss-works-off', !on);
    if (!window.map || !window.markerCluster) return;
    if (on && !map.hasLayer(markerCluster)) map.addLayer(markerCluster);
    if (!on && map.hasLayer(markerCluster)) map.removeLayer(markerCluster);
  }

  function wrapRenderMarkers() {
    var orig = window.renderMarkers;
    if (typeof orig !== 'function' || orig.__ssGisWrapped) return;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      if (!worksOn()) applyWorks(false);
      return r;
    };
    wrapped.__ssGisWrapped = true;
    window.renderMarkers = wrapped;
  }

  function bindWorks() {
    var toggle = document.getElementById('ssWorksToggle');
    if (!toggle) return;
    toggle.checked = worksOn();
    applyWorks(toggle.checked);
    toggle.addEventListener('change', function () {
      writeLS(LS_WORKS, toggle.checked ? '1' : '0');
      applyWorks(toggle.checked);
      if (toggle.checked && typeof window.filterMarkers === 'function') window.filterMarkers();
    });
    // 標記資料載好之後 renderMarkers 會把叢集加回地圖，這裡再依設定拿掉
    var tries = 0;
    (function waitRender() {
      if (typeof window.renderMarkers === 'function') { wrapRenderMarkers(); applyWorks(worksOn()); return; }
      if (tries++ < 200) setTimeout(waitRender, 100);
    })();
  }

  // ---- 桌機：進站就把圖資面板打開 ----

  function openOnDesktop() {
    if (!window.matchMedia('(min-width: 901px)').matches) return;
    var tries = 0;
    (function go() {
      if (typeof window.haidianSwitchMode === 'function') { window.haidianSwitchMode('data', true); return; }
      if (tries++ < 50) setTimeout(go, 100);
    })();
  }

  function init() {
    control = document.querySelector('#rightToolsWrapper .custom-layer-control');
    slot = document.getElementById('ssClimateSlot');
    if (!control || !slot) return;

    new MutationObserver(schedule).observe(control, { childList: true, subtree: true });
    control.addEventListener('change', countGroups);
    schedule();
    bindWorks();
    setTimeout(openOnDesktop, 300);
  }

  ready(init);
})();
