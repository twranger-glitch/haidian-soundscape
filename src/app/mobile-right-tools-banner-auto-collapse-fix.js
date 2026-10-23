(function () {
  'use strict';

  var mobileQuery = window.matchMedia('(max-width: 600px)');
  var autoHiddenByRightTools = false;
  var classObserver = null;

  function getHeader() {
    return document.querySelector('.glass-header');
  }

  function getPullTab() {
    return document.getElementById('headerPullTab');
  }

  function getRightTools() {
    return document.getElementById('rightToolsWrapper');
  }

  function rightToolsAreOpen() {
    var wrapper = getRightTools();
    return !!(
      wrapper &&
      wrapper.classList.contains('open') &&
      !wrapper.classList.contains('haidian-v4-tools-user-hidden')
    );
  }

  function setHeaderVisibility(hide) {
    if (typeof window.updateHeaderVisibility === 'function') {
      window.updateHeaderVisibility(hide);
      return;
    }

    var header = getHeader();
    var pullTab = getPullTab();
    if (!header) return;
    header.classList.toggle('hidden-up', !!hide);
    if (pullTab) pullTab.classList.toggle('visible', !!hide);
  }

  function syncMobileHeaderWithRightTools() {
    var header = getHeader();
    var pullTab = getPullTab();
    if (!header) return;

    /* 離開手機寬度時，還原完整 banner，避免把桌機版留在隱藏狀態。 */
    if (!mobileQuery.matches) {
      header.classList.remove('hidden-up');
      if (pullTab) pullTab.classList.remove('visible');
      autoHiddenByRightTools = false;
      return;
    }

    if (rightToolsAreOpen()) {
      /* 只記錄這次是否由圖資面板自動收合，避免覆寫使用者原本的 header 狀態。 */
      if (!header.classList.contains('hidden-up')) {
        autoHiddenByRightTools = true;
      }
      setHeaderVisibility(true);
      return;
    }

    if (autoHiddenByRightTools) {
      setHeaderVisibility(false);
      autoHiddenByRightTools = false;
    }
  }

  function bind() {
    var wrapper = getRightTools();
    if (!wrapper) return;

    if (classObserver) classObserver.disconnect();
    classObserver = new MutationObserver(function () {
      window.requestAnimationFrame(syncMobileHeaderWithRightTools);
    });
    classObserver.observe(wrapper, {
      attributes: true,
      attributeFilter: ['class']
    });

    window.addEventListener('resize', syncMobileHeaderWithRightTools, { passive: true });
    if (mobileQuery.addEventListener) {
      mobileQuery.addEventListener('change', syncMobileHeaderWithRightTools);
    } else if (mobileQuery.addListener) {
      mobileQuery.addListener(syncMobileHeaderWithRightTools);
    }

    syncMobileHeaderWithRightTools();
  }

  if ((document.readyState === 'loading' || window.__ssDCL === false)) {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
