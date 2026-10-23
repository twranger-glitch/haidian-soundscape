(function () {
  const PANEL_SELECTOR = '#rightToolsWrapper .custom-layer-control';

  const heatRiskPattern =
    /中央氣象署\s*全臺溫度分布|顯示全臺官方溫度分布|熱風險分布圖|顯示熱風險分布圖/;

  function replaceText(root, from, to) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );

    let node;

    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes(from)) {
        node.nodeValue = node.nodeValue.split(from).join(to);
      }
    }
  }

  function getDirectPanelChild(panel, node) {
    let current = node;

    while (current && current.parentElement !== panel) {
      current = current.parentElement;
    }

    return current || null;
  }

  function findHeatRiskUnit(panel) {
    const label = Array.from(panel.querySelectorAll('label')).find(function (el) {
      return heatRiskPattern.test(el.textContent || '');
    });

    if (label) {
      return getDirectPanelChild(panel, label);
    }

    const block = Array.from(
      panel.querySelectorAll('section, div')
    ).find(function (el) {
      return heatRiskPattern.test(el.textContent || '');
    });

    return block ? getDirectPanelChild(panel, block) : null;
  }

  function moveHeatRiskLayer() {
    const panel = document.querySelector(PANEL_SELECTOR);

    if (!panel) return;

    replaceText(panel, '中央氣象署全臺溫度分布', '熱風險分布圖');
    replaceText(panel, '顯示全臺官方溫度分布', '顯示熱風險分布圖');

    const floodFolder = panel.querySelector('.layer-folder-flood');
    const heatRiskUnit = findHeatRiskUnit(panel);

    if (!floodFolder || !heatRiskUnit) return;

    const insertBefore =
      floodFolder.previousElementSibling &&
      floodFolder.previousElementSibling.tagName === 'HR'
        ? floodFolder.previousElementSibling
        : floodFolder;

    const previous = heatRiskUnit.previousElementSibling;

    const titleUnit =
      previous &&
      heatRiskPattern.test(previous.textContent || '')
        ? previous
        : null;

    if (heatRiskUnit.nextElementSibling === insertBefore) return;

    if (titleUnit) {
      panel.insertBefore(titleUnit, insertBefore);
    }

    panel.insertBefore(heatRiskUnit, insertBefore);
  }

  function init() {
    const panel = document.querySelector(PANEL_SELECTOR);

    if (!panel) {
      window.setTimeout(init, 120);
      return;
    }

    let frameId = 0;

    function scheduleMove() {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(moveHeatRiskLayer);
    }

    const observer = new MutationObserver(scheduleMove);

    observer.observe(panel, {
      childList: true,
      subtree: true
    });

    scheduleMove();
  }

  if ((document.readyState === 'loading' || window.__ssDCL === false)) {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
