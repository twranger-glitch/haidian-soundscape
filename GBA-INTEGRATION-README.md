# ASTRA 網站整合更新｜2026-10-20 第二版

本版另修正原 SDK 清理邏輯誤刪 GBA 畫布；明確標示畫布擁有權，不影響舊 SDK 過期畫布清理，也不修改陰影分類或 Verified 證據。GBA 圖層標示的臺灣時間另固定按 UTC+8 解析，避免不同電腦時區將下午錯算成夜間；原路線出發時間的解析與比較語義未改。

本版直接整合到原網站：保留上一版已確認端點先檢查再去重的修補；新增完整 mapped source 證據交接，避免最快路線在去重後丟失通行來源，無法進入獨立 GBA Estimated Shade 比較。

僅接受全段相同、有方向、來源 node 連續且沒有未驗證銜接段的幾何。相近路線、私人通行、來源不完整、障礙衝突或 UNKNOWN 均不會自動取得資格。不增加來源請求或陰影模型查詢，不修改 Graph、terminal、detour、eligibility 或 comparator。

首頁右側「GBA 估計」可開啟既有功能。prepared 資料仍由使用者明確選取本機唯讀資料夾，網站不保存私人 HF Token。資料不足時顯示不足，Estimated Shade 不作 Verified Proof。Graph/Route base core 版本保持原值；具名未封版修補的實際 SHA 請見 ASTRA-RELEASE.json 和 LIVE-CORE-LOCKS.json。

更新包解壓後，將內容直接覆蓋 GitHub 網站根目錄（index.html 同一層），保留 src/ 與 gba-estimated/ 目錄結構，不要再套一層資料夾。完整網站包可取代網站檔案；兩包擇一。本次沒有推送 GitHub 或部署網站。

不含私人 GBA 圖磚、Live JSON、Token、測試或本機資料路徑。ML_ESTIMATED 不是 measured/reported。Production merge 維持 HOLD；Proof=INCOMPLETE、winnerId=null、unknownSafelyResolved=0。
