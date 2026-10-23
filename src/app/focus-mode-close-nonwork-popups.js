(function () {
  "use strict";

  function isNonWorkPopup(popup) {
    var className = String(
      popup &&
      popup.options &&
      popup.options.className
        ? popup.options.className
        : ""
    );

    return /(?:hr-popup|flood-popup)/.test(className);
  }

  function closeNonWorkPopup() {
    var map = window.map;

    if (!map || typeof map.closePopup !== "function") {
      return;
    }

    var activePopup = map._popup;

    if (activePopup && isNonWorkPopup(activePopup)) {
      map.closePopup(activePopup);
    }
  }

  function blockNonWorkPopupDuringFocus() {
    var map = window.map;

    if (!map || map.__focusModePopupGuardInstalled) {
      return;
    }

    map.__focusModePopupGuardInstalled = true;

    map.on("popupopen", function (event) {
      if (!document.body.classList.contains("listening-mode")) {
        return;
      }

      if (isNonWorkPopup(event.popup)) {
        window.requestAnimationFrame(function () {
          map.closePopup(event.popup);
        });
      }
    });
  }

  function install() {
    var originalToggle = window.toggleListeningMode;

    if (typeof originalToggle !== "function") {
      window.setTimeout(install, 120);
      return;
    }

    if (originalToggle.__focusModePopupPatch) {
      blockNonWorkPopupDuringFocus();
      return;
    }

    function patchedToggleListeningMode() {
      var enteringFocusMode =
        !document.body.classList.contains("listening-mode");

      var result = originalToggle.apply(this, arguments);

      if (
        enteringFocusMode &&
        document.body.classList.contains("listening-mode")
      ) {
        closeNonWorkPopup();
      }

      return result;
    }

    patchedToggleListeningMode.__focusModePopupPatch = true;
    window.toggleListeningMode = patchedToggleListeningMode;

    blockNonWorkPopupDuringFocus();
  }

  install();
})();
