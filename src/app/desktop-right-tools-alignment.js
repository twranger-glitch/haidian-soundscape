(function () {
  "use strict";

  var desktopQuery = window.matchMedia("(min-width: 601px)");
  var frameId = 0;

  function getWrapper() {
    return document.getElementById("rightToolsWrapper");
  }

  function alignCollapseEar() {
    var wrapper = getWrapper();
    var menu = wrapper && wrapper.querySelector(".tools-menu-container");

    if (!wrapper || !menu) {
      return;
    }

    if (!desktopQuery.matches) {
      wrapper.style.removeProperty("--right-tools-collapse-ear-top");
      return;
    }

    if (!wrapper.classList.contains("open")) {
      return;
    }

    var wrapperRect = wrapper.getBoundingClientRect();
    var menuRect = menu.getBoundingClientRect();

    if (!menuRect.height || !menuRect.width) {
      return;
    }

    /*
     * 耳朵貼在圖資選單左側，並距離選單頂端 18px。
     * 不碰熱風險控制、卡片或關閉按鈕。
     */
    var earTop = Math.round(
      menuRect.top - wrapperRect.top + 18
    );

    wrapper.style.setProperty(
      "--right-tools-collapse-ear-top",
      earTop + "px"
    );
  }

  function scheduleAlign() {
    window.cancelAnimationFrame(frameId);

    frameId = window.requestAnimationFrame(function () {
      alignCollapseEar();
      window.setTimeout(alignCollapseEar, 260);
    });
  }

  function init() {
    var wrapper = getWrapper();

    if (!wrapper) {
      window.setTimeout(init, 120);
      return;
    }

    var observer = new MutationObserver(scheduleAlign);

    observer.observe(wrapper, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    window.addEventListener("resize", scheduleAlign);

    if (desktopQuery.addEventListener) {
      desktopQuery.addEventListener("change", scheduleAlign);
    } else {
      desktopQuery.addListener(scheduleAlign);
    }

    scheduleAlign();
  }

  if ((document.readyState === "loading" || window.__ssDCL === false)) {
    document.addEventListener("DOMContentLoaded", init, {
      once: true
    });
  } else {
    init();
  }
})();
