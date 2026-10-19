# ASTRA 正式首頁 GBA＋CHMv2 接入候選｜2026-10-19

本包把已驗收的估計引擎接入「目前正式 ASTRA 首頁」；不是再加一個 experimental 展示頁。

已完成：正式 index.html 入口、同一張 Leaflet 地圖、唯讀南北 prepared、建築與精細 CHMv2 樹蔭、原路由器安全候選的估計評分與地圖顯示、取消／防止舊結果覆寫、逐頁 SHA、原核心保護及可重跑測試。

尚未完成：新首頁的 Windows／正式網站 Native 驗收、所有訪客免本機資料的雲端供應、真實陰影準確度驗證。未發布、未更新 GitHub。不得把本包稱為已上線或 Verified Proof 完成。

## 使用哪一包

- ASTRA-GITHUB-ROOT-INTEGRATION-UPDATE.zip：上傳用。解壓後把 index.html、gba-estimated/ 及隨附的整合說明／Manifest 放在原 repository 根目錄。不要多包一層資料夾，也不要刪除原有 src、data、vendor 或 config。
- ASTRA-GITHUB-COMPLETE-INTEGRATED-SITE.zip：目前公開 repository 的完整快照加上本次入口與模組，供完整備份／整站部署比對。原 workflow 保留；平常更新優先用前一包。
- ASTRA-MAIN-PAGE-INTEGRATION-ENGINEERING.zip：本工程包。含完整候選站點、原公開 baseline、實際 Native 選定圖磚與樹冠樣本、測試、執行日誌、回滾資料。其資料 fixtures 供本人私人非商業工程驗證，不可整包放到公開 GitHub。

## 上傳後的正常使用

1. 開啟原 ASTRA 網站，按地圖右上的「GBA 估計」。
2. 按「連接南北 GBA 資料」，選含兩區資料的共同資料夾；或分別選取已存在的南區、北區 prepared。這是瀏覽器安全的唯讀權限，不重做原始預處理、不 FULL_READBACK、不上傳 HF。
3. 放大至 17 級以上顯示估計陰影。沿用原頁面 A/B 分析後，面板會估計最多兩條既有 source-supported 候選；可按「顯示這條估計候選」。路線時間取自原路線面板，圖層時間只控制視覺圖層。

必須使用支援 File System Access 的桌面 Chrome／Edge 及 HTTPS。私人 HF 的正式 Round-trip PASS 不會自動讓公開 GitHub Pages 可讀私人資料；本包不把 Token 放前端，也不公開 GBA 圖磚。全體訪客雲端模式仍需要受控供應器與再散布授權閘門。

## 工程驗證

工程環境 Python 3.12.14、Node v24.19.0。測試依賴只有 @napi-rs/canvas 0.1.100；若沒有預裝，先在 integration-tests 執行 npm install。正式網站不需要 Node、Python 或 npm。

```sh
python3 integration-tools/run-integration.py --output ../astra-new-empty-results
```

輸出包含命令、stdout、stderr、退出碼、時間與 machine-readable 結果。測試使用真正 Native 選定 prepared 頁面與 15 張原生 CHMv2 raster；Node 目錄／DOM adapter、快取預載不能冒充新瀏覽器權限測試或新網路採集。

Proof=INCOMPLETE；winnerId=null；unknownSafelyResolved=0；PRODUCTION_MERGE_HOLD。已部署 Production／原 Graph／Route 核心未修改；候選首頁有兩個新增標籤，必須如實稱為待驗收入口修改。
