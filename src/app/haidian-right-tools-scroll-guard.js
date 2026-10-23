(function () {
  function setupRightToolsScrollGuard() {
    const wrapper = document.getElementById("rightToolsWrapper");
    const menu = wrapper && wrapper.querySelector(".tools-menu-container");
    const panel = wrapper && wrapper.querySelector(".custom-layer-control");

    if (!wrapper || !menu || !panel) return;

    let frameId = 0;

    function refreshScrollableHeight() {
      const viewportHeight = window.visualViewport
        ? window.visualViewport.height
        : window.innerHeight;

      const menuTop = Math.max(0, menu.getBoundingClientRect().top);

      const availableHeight = Math.max(
        160,
        Math.floor(viewportHeight - menuTop - 12)
      );

      panel.style.setProperty(
        "--right-tools-scroll-max-height",
        `${availableHeight}px`
      );
    }

    function scheduleRefresh() {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(refreshScrollableHeight);
    }

    if (panel.dataset.scrollGuardBound !== "true") {
      panel.dataset.scrollGuardBound = "true";

      /*
       * 不使用 preventDefault：
       * 保留面板捲動、checkbox、select、range slider、button 的正常行為。
       */
      ["wheel", "touchstart", "touchmove", "pointerdown"].forEach(function (type) {
        panel.addEventListener(type, function (event) {
          event.stopPropagation();
        }, { passive: true });
      });

      if (window.L && L.DomEvent) {
        L.DomEvent.disableScrollPropagation(panel);
        L.DomEvent.disableClickPropagation(panel);
      }
    }

    if (!wrapper.dataset.scrollGuardObserverBound) {
      wrapper.dataset.scrollGuardObserverBound = "true";

      const observer = new MutationObserver(scheduleRefresh);

      observer.observe(wrapper, {
        attributes: true,
        attributeFilter: ["class", "style"]
      });

      if (window.ResizeObserver) {
        new ResizeObserver(scheduleRefresh).observe(menu);
      }

      window.addEventListener("resize", scheduleRefresh, {
        passive: true
      });

      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", scheduleRefresh, {
          passive: true
        });
      }
    }

    scheduleRefresh();
  }

  if ((document.readyState === "loading" || window.__ssDCL === false)) {
    document.addEventListener(
      "DOMContentLoaded",
      setupRightToolsScrollGuard,
      { once: true }
    );
  } else {
    setupRightToolsScrollGuard();
  }
})();
