(function () {
  'use strict';

  /*
   * 事件預覽採用官方 layer metadata 的 uniqueValueInfos。
   * 這份清單比 legend 圖檔輕，可先一次建立所有事件文字；legend 回來後再補回官方色票。
   */
  var tainanHistoryFloodLoadSerial = 0;

  function getTainanHistoryFloodPreviewPayloadForDataset(datasetId) {
    var meta = window.tainanHistoryFloodMeta &&
      window.tainanHistoryFloodMeta[datasetId];

    if (!meta || datasetId === 'history_all') {
      return Promise.reject(new Error('UNKNOWN_HISTORY_FLOOD_SOURCE'));
    }

    return getTainanHistoryFloodMetadata(meta.layerId)
      .then(function (metadata) {
        var renderer = metadata && metadata.drawingInfo ?
          metadata.drawingInfo.renderer : null;

        var fieldName = renderer && (renderer.field1 || renderer.field) ?
          (renderer.field1 || renderer.field) : 'NAME';

        var uniqueValueInfos = renderer &&
          Array.isArray(renderer.uniqueValueInfos) ?
          renderer.uniqueValueInfos : [];

        var events = uniqueValueInfos
          .map(function (info) {
            var label = String(
              info && info.label !== undefined && info.label !== null ?
                info.label :
                (info && info.value !== undefined && info.value !== null ?
                  info.value : '')
            ).trim();

            var value = info && info.value !== undefined &&
              info.value !== null ?
              info.value : label;

            if (!label || value === '') {
              return null;
            }

            return {
              label: label,
              sourceLabel: label,
              value: value,
              imageData: '',
              sourceDataset: datasetId
            };
          })
          .filter(Boolean);

        if (!events.length) {
          throw new Error('NO_METADATA_EVENTS');
        }

        return {
          fieldNames: (function () {
            var fields = {};
            fields[datasetId] = fieldName;
            return fields;
          })(),
          events: events
        };
      });
  }

  function getTainanHistoryFloodPreviewPayloadForSelection(selectedId) {
    var datasetIds = selectedId === 'history_all' ?
      TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS.slice() :
      [selectedId];

    return Promise.all(
      datasetIds.map(getTainanHistoryFloodPreviewPayloadForDataset)
    ).then(function (payloads) {
      return payloads.reduce(function (merged, payload) {
        Object.assign(merged.fieldNames, payload.fieldNames || {});
        merged.events = merged.events.concat(payload.events || []);
        return merged;
      }, {
        fieldNames: {},
        events: []
      });
    });
  }

  function applyTainanHistoryFloodPayloadIfCurrent(
    selectedId,
    loadSerial,
    payload
  ) {
    if (
      loadSerial !== tainanHistoryFloodLoadSerial ||
      selectedId !== getTainanHistoryFloodSelectedId()
    ) {
      return false;
    }

    setTainanHistoryFloodEventsFromPayload(payload);
    renderTainanHistoryFloodEvents();

    var toggleEl = document.getElementById('tainanHistoryFloodToggle');

    if (toggleEl && toggleEl.checked) {
      setTainanHistoryFloodActiveLayersEnabled(true);
      applyTainanHistoryFloodEventFilter();
    }

    return true;
  }

  /*
   * 覆寫原本「先清空、再等 legend」的流程：
   * metadata 清單先完整顯示，官方 legend 完成後只更新色票，不會逐筆補列。
   */
  window.loadTainanHistoryFloodEvents = function () {
    var selectedId = getTainanHistoryFloodSelectedId();
    var sourceDatasetIds = selectedId === 'history_all' ?
      TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS.slice() :
      [selectedId];
    var loadSerial = ++tainanHistoryFloodLoadSerial;

    sourceDatasetIds.forEach(function (datasetId) {
      setTainanHistoryFloodDatasetLoadState(datasetId, 'loading');
    });

    tainanHistoryFloodEvents = [];
    tainanHistoryFloodFilterField = null;
    tainanHistoryFloodFilterFields = {};
    renderTainanHistoryFloodEvents();

    /* 先取較輕的 metadata，讓所有事件名稱同時出現。 */
    getTainanHistoryFloodPreviewPayloadForSelection(selectedId)
      .then(function (payload) {
        applyTainanHistoryFloodPayloadIfCurrent(
          selectedId,
          loadSerial,
          payload
        );
      })
      .catch(function () {
        /* 若 metadata 不含 renderer，仍由完整官方 legend 流程接手。 */
      });

    /* 再取得完整 legend，將預覽色塊換成官方色票。 */
    return getTainanHistoryFloodPayloadForSelection(selectedId)
      .then(function (payload) {
        sourceDatasetIds.forEach(function (datasetId) {
          setTainanHistoryFloodDatasetLoadState(datasetId, 'ready');
        });

        applyTainanHistoryFloodPayloadIfCurrent(
          selectedId,
          loadSerial,
          payload
        );
      })
      .catch(function () {
        sourceDatasetIds.forEach(function (datasetId) {
          setTainanHistoryFloodDatasetLoadState(datasetId, 'error');
        });

        /* metadata 預覽成功時保留可操作的完整事件清單，不覆蓋成錯誤訊息。 */
        if (
          loadSerial !== tainanHistoryFloodLoadSerial ||
          selectedId !== getTainanHistoryFloodSelectedId() ||
          tainanHistoryFloodEvents.length
        ) {
          return;
        }

        var root = document.getElementById('tainanHistoryFloodEvents');
        var countEl = document.getElementById('tainanHistoryFloodEventCount');
        var showAllButton = document.getElementById('tainanHistoryFloodShowAll');
        var hideAllButton = document.getElementById('tainanHistoryFloodHideAll');

        if (root) {
          root.innerHTML =
            '<div class="hf-events-fallback">' +
            '官方事件清單暫時無法取得；地圖仍維持官方原始配色，請稍後重新整理再試。' +
            '</div>';
        }

        if (countEl) {
          countEl.textContent = '官方事件清單暫時無法取得';
        }

        if (showAllButton) showAllButton.disabled = true;
        if (hideAllButton) hideAllButton.disabled = true;
      });
  };

  /* 頁面載入後立刻並行暖機兩科資料，不再等待 120ms 或分段 80ms。 */
  function prewarmTainanHistoryFloodSourcesImmediately() {
    if (!window.TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS) return;

    TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS.forEach(function (datasetId) {
      prefetchTainanHistoryFloodDataset(datasetId)
        .catch(function () {
          /* 個別來源失敗不影響其他既有功能。 */
        });
    });
  }

  prewarmTainanHistoryFloodSourcesImmediately();

  /* Right-control geometry intentionally lives in the final CSS-only drawer rule. */
})();
