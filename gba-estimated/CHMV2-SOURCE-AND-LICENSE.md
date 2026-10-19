# CHMv2 來源與模型界限

本次核對官方 primary sources（2026-10-18）：
- https://source.coop/tge-labs/meta-chm-v2
- https://registry.opendata.aws/dataforgood-fb-forestsv2/
- 原 ASTRA shade integration 來源及 SHA 見 evidence/canopy-source。

來源為 Meta/WRI CHMv2，Taylor Geospatial Engine Labs 作 cloud-native repackaging，標示 CC BY 4.0。實際 public Range 路徑固定 https://data.source.coop/tge-labs/meta-chm-v2/chm/ 。衍生 rasters 為不重新估計高度的原窗口擷取，逐 tile 保存原 quadkey/window、URL、remote pin、decoded SHA；不是整張官方 TIFF 的完整 SHA。

Native格網為 EPSG:3857、z10 quadkey 32768² COG、uint8米；本程式取native z17 256²窗口。0 同時可能是零／nodata，不能判為 SUN。CHMv2 ML 高度、vertical-column renderer 與本版建築資料均無提升為 measured/reported。保留 Meta/WRI、Taylor Geospatial、原影像權利與版本資料。

GeoTIFF 2.1.3 原 ASTRA vendor bytes 與 MIT notice 保留，沒有在runtime連第三方CDN。

GBA 授權仍依原 evidence/RETAINED-LICENSE-DECISION.md。此次只做本人私人工程資料讀取與測試，並未新增可公開／商用 mixed GBA derivatives 的授權。GitHub runtime不含這些數據。正式 PRIVATE HF 不因本次工作改動。
