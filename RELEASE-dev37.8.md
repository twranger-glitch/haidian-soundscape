# ASTRA v9.0.0-dev37.8

完整 GitHub Pages 靜態網站根目錄。核心新增全球官方 Overture PMTiles 按需 Range 讀取、自託管 MVT Worker、有限快取與取消、建築高度來源分級、共用自有建築投影，以及點位與路線 source snapshot。保留 CHMv2 精細樹蔭及原 production graph。

以自有陰影為預設工作方向；ShadeMap SDK 授權不是核心依賴。全球 PMTiles 為概化資料，估計／未知高度或缺資料保持 partial / unknown；不能宣稱全域測量精度或完整地形遮蔽。

部署須完整更新 index.html、src/、vendor/、licenses/、config、data/ 與 buildings/。DEPLOY-MANIFEST.json 提供網站每檔 SHA256。data/ 下 runtime/evidence/*.hdt 是既有模型執行資料，並非可刪除的測試報告。

完整變更、來源授權、測試與已知限制在同次 ASTRA-HANDOFF-next.zip。新增六組回歸 PASS；原始斷言總計 105：66 PASS / 39 FAIL（25 承襲、12 版本字串鎖、2 舊契約鎖），詳細歸因與獨立遷移檢查分開保留。正式 GitHub Pages、實機與現場通行尚未驗收；臺南精度來源在本機直接網路測試有 CORS 失敗、路線部分 CHMv2 查詢逾時。不得把不足資料當日照或宣稱完整比例。
