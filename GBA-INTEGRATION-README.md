# ASTRA 建築＋CHMv2 估計接入候選｜2026-10-19.3

沿用正式首頁、Leaflet 地圖與原路線分析；Graph 37.9.9.16.18／Route 37.9.9.16.11 原始位元組未改。本包未部署，新版 Windows Native 尚未驗收。

## 使用

1. 開啟原 ASTRA 首頁右上的「GBA 估計」。
2. 按「連接南北 GBA 資料」，選既有兩區 prepared 的共同上層資料夾；亦可分別選取兩區 prepared。只讀取已驗收成果，不做預處理、FULL_READBACK 或 HF 上傳。
3. 放大至 17 級以上查看建築與精細樹蔭估計。圖層時間在此面板設定；路線採用原路線面板的出發時間與步速。
4. 原路線分析後，只有來源通行條件合格的候選進入估計比較。全部不合格時顯示拒絕原因，不更改原分析結果。
5. 另可按「預覽未驗證候選陰影（不作導航）」：僅沿最多兩條原生成幾何估計，不證明可通行、不導航、不排名或推薦最不曬。未驗證端點參考段不納入長度與時間。

ML_ESTIMATED 保持估計，資料缺失或來源衝突保持 UNKNOWN。Verified Proof、原 comparator、Realm 12 秒預算、terminal 8m 及明確端點同意政策不變。Proof=INCOMPLETE；winnerId=null；unknownSafelyResolved=0。

## 資料與環境

使用 HTTPS 桌面 Chrome／Edge 的唯讀資料夾授權。私人 HF Round-trip PASS 不會讓公開網站自動讀取私人資料；本包沒有 HF Token、prepared 圖磚或 GBA 原始資料。所有訪客免本機檔案的受控雲端供應仍未完成，真實陰影準確度尚未驗證。

## 更新及回滾

使用 GitHub 更新 ZIP：將 index.html、gba-estimated/、本說明及整合 Manifest 放到原 repository 根目錄；保留原 src、data、vendor、config。請勿把私人工程包與測試 fixtures 放到公開 repository。

入口版本為 main-page-20261019.3。完整工程包提供回滾原檔、逐檔變更 SHA、可重跑測試與一鍵 Console；回滾不影響 prepared 資料或原核心。

PROTECTED_GRAPH_ROUTE_UNCHANGED / PRODUCTION_MERGE_HOLD。


## .3 入口修復

原首頁刻意隱藏 Leaflet 右上角，.2 的 GBA 按鈕因此無法看見。.3 改由 body 直屬的固定按鈕開啟面板，不取消原首頁的隱藏規則。桌面位置在右上工具列第一個圓形圖示左側，文字為「GBA 估計」。

新 Console 檢查 11 個來源 SHA，並核對入口非零大小、無隱藏祖先、固定位置及面板可開啟；程式 SHA PASS 不再代替 UI 可用性驗證。單元／CSSOM 通過不等於 Windows Native 或正式網站新版 PASS。
