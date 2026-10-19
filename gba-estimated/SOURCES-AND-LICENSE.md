# 來源與授權範圍

當前公開 ASTRA repository： https://github.com/twranger-glitch/haidian-soundscape ，commit 1165748cd9660843d232b55796188ab8d33a0a10。首頁來源 https://twranger-glitch.github.io/haidian-soundscape/ 與該 commit index 相同。原始接收 SHA、HTTP 收據、檔案 bytes 與完整 archive 附 integration-live-baseline。

GBA：南 e120_n25_e125_n20、北 e120_n30_e125_n25，精確 release／manifest SHA 見 gba-estimated/config/ACCEPTED-TAIWAN-REGISTRY.json。ODbL geometry、LoD1／linked height CC BY-NC 與 mixed prepared 的不同條件，依 retained native engineering license decision；私人非商業儲存不等於公開／商業重散布授權。本 Github 套件只含程式、notice、索引身份與 hash，不含本次 GBA 衍生圖磚。工程測試 fixtures 是使用者已提供之本人私人驗證資料，不可整包公開。

CHMv2：Meta/WRI、Taylor Geospatial Engine Labs cloud-native packaging，CC BY 4.0，保留來源。
- https://source.coop/tge-labs/meta-chm-v2
- https://registry.opendata.aws/dataforgood-fb-forestsv2/
- https://data.source.coop/tge-labs/meta-chm-v2/chm/

GeoTIFF 2.1.3 UMD 原位元組與 MIT notice 附 vendor/geotiff-2.1.3。診斷的 decoded raster SHA 並不是完整 TIFF 的 SHA；原 Range pin／window 身份保留。0/nodata 仍 UNKNOWN。

OSM 步行路線來源的原圖與使用者提供的 Native 路線證據只在私人工程包作測試。© OpenStreetMap contributors，ODbL；本輪不新增手繪／synthetic 步行 surface。

Chrome File System Access： https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
DirectoryHandle 可序列化傳給同 origin worker 的規格： https://fs.spec.whatwg.org/
本輪只要求使用者明確選取目錄的 read 權限，不使用私有 Token／自行繞過權限或系統目錄保護。
