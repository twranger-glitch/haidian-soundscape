(function () {
  'use strict';

  function ready(fn) {
    if ((document.readyState === 'loading' || window.__ssDCL === false)) {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function applyCopy() {
    var hint = document.querySelector('.listening-hint');
    if (hint) {
      hint.childNodes.forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          node.textContent = ' 點擊退出專注模式';
        }
      });
      hint.setAttribute('title', '點擊退出專注模式');
      hint.setAttribute('aria-label', '點擊退出專注模式');
    }

    var dock = document.querySelector('.haidian-v4-dock');
    if (!dock) return;

    var title = dock.querySelector('.haidian-v4-dock-title strong');
    var subtitle = dock.querySelector('.haidian-v4-dock-title span');
    var toggle = dock.querySelector('.haidian-v4-dock-toggle');

    if (title) title.textContent = '課程模組｜探索主線';
    if (subtitle) subtitle.textContent = '聲音 × SEL × 在地探究｜點一下打開對應工具面板';
    if (toggle) {
      toggle.textContent = '';
      toggle.setAttribute('aria-label', '收合或展開課程模組');
      toggle.setAttribute('title', '收合或展開課程模組');
    }

    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
      dock.classList.add('is-minimized');
    }
  }

  ready(function () {
    applyCopy();
    setTimeout(applyCopy, 120);
    setTimeout(applyCopy, 450);
  });
})();
