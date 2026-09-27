# 自有陰影資料與費用說明 — dev37.5

預設自有 Canvas 與路線分析不使用 ShadeMap SDK、API key 或付費帳號。ShadeMap 僅為使用者明確選擇、另具授權的參考圖層。本版沒有複製其 SDK／shader，沒有新增付費 API。

| 元件／資料 | 來源與授權 | 使用與限制 |
|---|---|---|
| 自有 Canvas | 本專案原創 `src/own-shade-renderer.js` | 共用既有 route-ray-v1。樹高／建築高度與 footprint 有誤差；不是測量成果。 |
| Leaflet 1.9.4 | BSD-2-Clause；同目錄 LICENSE | 沿用 Leaflet；保留 copyright 與地圖 attribution。 |
| GeoTIFF.js 2.1.3 | MIT；同目錄 LICENSE | 沿用 COG reader；並未新增第三方陰影引擎。 |
| CHMv2 raster | Meta / WRI, CC BY 4.0；https://registry.opendata.aws/dataforgood-fb-forestsv2/ | 2026-09-26 取用。包含樹高視窗重取樣／轉存；非即時植被狀態。原始影像 © 2016 Vantor；此處只使用已發布 CHM raster，不重配發原始衛星影像或模型權重。 |
| CHMv2 COG mirror | `https://data.source.coop/tge-labs/meta-chm-v2/chm/` | 現有 mirror 可讀；不能保證永久服務。mirror README 本次直接取得為 404，原始 raster 授權已核對；沒有取用其程式碼。 |
| OSM 資料／建築／路徑 | © OpenStreetMap contributors；ODbL 1.0；https://www.openstreetmap.org/copyright | 保留顯名與資料庫授權。公開讀取不代表不受 API 用量政策約束；本包只附有限區域測試快照。 |
| Overture buildings / transportation | © OpenStreetMap contributors, Overture Maps Foundation；相關主題 ODbL；https://docs.overturemaps.org/attribution/ | 延用原包 HGR2 與建築管線；來源日期見各 manifest。不能將所有 Overture 主題誤標同一授權。 |
| Terrarium 地形 | Mapzen / Tilezen；逐來源授權見 `terrain-attribution.md`；https://registry.opendata.aws/terrain-tiles/ | 公開資料不等於單一 CC 授權。本版修正 z15 父磚與裁切；自有畫面尚未整合遠距地形遮蔽。 |
| 台灣官方 DTM／其他原有資料 | 逐資料集 metadata 與原包來源文件 | 未新增下載或重配發官方 DTM。不能以政府開放授權條款推定任何未核對 API 都可無限制使用。 |
| 底圖 | 由目前選用的底圖各自授權與政策決定 | 引擎獨立不代表底圖供應商免費。保留原有 attribution；不得大量離線預取 OSM 標準底圖。 |

來源日期／版本：CHM 與 OSM/HGR2 取用時間、URL、SHA-256 見完整交接包 `evidence/dev37.5/`。HGR2 網路快照由既有公開資料庫下載；它不等於當日重新測繪。幾何接縫沿用來源同節點連接關係，較大的接縫仍須現地確認。

費用邊界（核對於 2026-09-26）：自有引擎本身不需要訂閱。GitHub Free 的公開 repository 可使用 Pages，但 Pages 有發布大小 1 GB、軟性流量每月 100 GB 等限制；https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits 。未建立或修改任何付費服務，也未驗證使用者帳號配額／帳單。既有 Hugging Face、Source Cooperative、Overpass、Worker、底圖與網路流量仍取決於各服務可用性和使用政策；不承諾永久零費用。來源失敗時顯示未知，不偷偷轉往付費供應商。

OSM 用量政策：https://operations.osmfoundation.org/policies/tiles/ 與 https://operations.osmfoundation.org/policies/api/ 。大量部署應使用可承受負載的已授權快照或資料服務，不把公共編輯 API 當無限讀取後端。

資料庫檔案的 ODbL、CHM 的 CC BY 4.0，以及程式碼各自的授權互相獨立；本說明未改變原專案程式碼授權。公開再散布資料時需保留各自顯名／授權／變更說明。
