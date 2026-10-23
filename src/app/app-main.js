        
        /* ===== [FIX START] 路線播放中，點地圖不關閉作品卡片 + 支援雙擊放大 ===== */
var map = L.map('map', {
    zoomControl: false,
    tap: true,                // 🌟 恢復手機版觸控偵測
    doubleClickZoom: true,    // 🌟 確保雙擊放大開啟 (預設是 true，明確寫出來更保險)
    closePopupOnClick: false
}).setView([23.0278, 120.2004], 15);
/* ===== [FIX END] ===== */
        
        var taiwanLayer = L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', { attribution: '&copy; <a href="https://maps.nlsc.gov.tw/" target="_blank">內政部國土測繪中心</a>', maxZoom: 20, zIndex: 1 });
        
        // 🌟 新增 ESRI 衛星與 OSM 標準圖資
        var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxNativeZoom: 19, maxZoom: 22, zIndex: 1 });
        var esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxNativeZoom: 19, maxZoom: 20, zIndex: 1 });

        var attrSinica = '&copy; <a href="https://gissrv4.sinica.edu.tw/" target="_blank">中央研究院 臺灣百年歷史地圖</a>';
        
        var history1875Layer = L.tileLayer('https://gis.sinica.edu.tw/tainan/file-exists.php?img=Tainan_1875-png-{z}-{x}-{y}', { attribution: attrSinica, maxZoom: 19, maxNativeZoom: 18, opacity: 0.8, zIndex: 2, keepBuffer: 4, updateWhenIdle: false });
        var history1904Layer = L.tileLayer('https://gis.sinica.edu.tw/tileserver/file-exists.php?img=JM20K_1904-jpg-{z}-{x}-{y}', { attribution: attrSinica, maxZoom: 19, maxNativeZoom: 18, opacity: 0.8, zIndex: 2, keepBuffer: 4, updateWhenIdle: false });
        var history1921Layer = L.tileLayer('https://gis.sinica.edu.tw/tileserver/file-exists.php?img=JM20K_1921-jpg-{z}-{x}-{y}', { attribution: attrSinica, maxZoom: 19, maxNativeZoom: 18, opacity: 0.8, zIndex: 2, keepBuffer: 4, updateWhenIdle: false });
        var historyTainanLayer = L.tileLayer('https://gis.sinica.edu.tw/tainan/file-exists.php?img=Tainan_1896B-png-{z}-{x}-{y}', { attribution: attrSinica, maxZoom: 19, maxNativeZoom: 18, opacity: 0.8, zIndex: 2, keepBuffer: 4, updateWhenIdle: false });
        var history1900Layer = L.tileLayer('https://gis.sinica.edu.tw/tainan/file-exists.php?img=Tainan_1900-png-{z}-{x}-{y}', { attribution: attrSinica, maxZoom: 19, maxNativeZoom: 18, opacity: 0.8, zIndex: 2, keepBuffer: 4, updateWhenIdle: false });
        var history1920Layer = L.tileLayer('https://gis.sinica.edu.tw/tainan/file-exists.php?img=Tainan_1920-png-{z}-{x}-{y}', { attribution: attrSinica, maxZoom: 19, maxNativeZoom: 18, opacity: 0.8, zIndex: 2, keepBuffer: 4, updateWhenIdle: false });
        var history1944Layer = L.tileLayer('https://gis.sinica.edu.tw/tileserver/file-exists.php?img=AM25K_1944B-jpg-{z}-{x}-{y}', { attribution: attrSinica, maxZoom: 19, maxNativeZoom: 18, opacity: 0.8, zIndex: 2, keepBuffer: 4, updateWhenIdle: false });

        var allHistoryLayers = [history1904Layer, history1921Layer, historyTainanLayer, history1875Layer, history1900Layer, history1920Layer, history1944Layer];
        var allModernLayers = [taiwanLayer, osmLayer, esriSatLayer];
        // 🌟 地點搜尋功能：進階排版與定位系統
        var placeSearchMarker = null;

        var placeSearchIcon = L.divIcon({
            className: 'place-search-marker',
            iconSize: [36, 44],
            iconAnchor: [18, 42],
            popupAnchor: [0, -35], // 修正 Popup 彈出高度
            html: `
                <div style="position:relative; width:36px; height:44px;">
                    <div style="position:absolute; left:4px; top:0; width:28px; height:28px; background:#e74c3c; border:3px solid #ffffff; border-radius:50% 50% 50% 0; transform:rotate(-45deg); box-shadow:0 6px 14px rgba(231,76,60,0.35);"></div>
                    <div style="position:absolute; left:0; top:5px; width:36px; text-align:center; color:#ffffff; font-size:13px; font-weight:900; pointer-events:none;">地</div>
                </div>
            `
        });

        function getPlaceSearchResultsBox() {
            var container = document.getElementById('placeSearchResultsContainer');
            var box = document.getElementById('placeSearchResults');
            if (!box) {
                box = document.createElement('div');
                box.id = 'placeSearchResults';
                box.style.cssText = 'margin-top:8px; max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; scrollbar-width:thin; padding-right:4px;';
                if(container) container.appendChild(box);
            }
            return box;
        }

        function escapePlaceRegex(text) { return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
        function escapePlaceHtml(text) { return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function searchPlaceName() {
    var input = document.getElementById('placeSearchInput');
    if (!input) return;

    var keyword = input.value.trim();
    var resultBox = getPlaceSearchResultsBox();

    if (!keyword) {
        alert('請先輸入地點關鍵字，例如：海佃、四草、台江。');
        return;
    }

    resultBox.innerHTML = `
        <div style="padding:10px 12px; border-radius:8px; background:#f8fafc; color:#64748b; font-size:12px; font-weight:700; text-align:center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: badgeShine 2s linear infinite; vertical-align:middle;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
            多重圖資引擎定位中...
        </div>
    `;

    var places = [];
    var seen = {};

    function addPlace(name, lat, lon, typeText, contextText) {
        if (!name || lat == null || lon == null) return;
        lat = parseFloat(lat);
        lon = parseFloat(lon);
        if (isNaN(lat) || isNaN(lon)) return;
        if (lat < 21.5 || lat > 26.5 || lon < 118.0 || lon > 122.5) return;

        var key = name + '|' + Math.round(lat * 100) + '|' + Math.round(lon * 100);
        if (!seen[key]) {
            seen[key] = true;
            places.push({
                name: name,
                lat: lat,
                lon: lon,
                type: typeText || '地點',
                context: contextText || ''
            });
        }
    }

    // 🚀 引擎 1：透過 Worker 攔截器呼叫 OSM (最強主力)
    const fetchNominatim = async () => {
        try {
            var nomUrl = 'https://haidian-gis-cache.yhzkiki.workers.dev/search?q=' + encodeURIComponent(keyword);
            var nomRes = await fetch(nomUrl);
            if (nomRes.ok) {
                var nomData = await nomRes.json();
                nomData.forEach(function(item) {
                    addPlace(item.name || keyword, item.lat, item.lon, item.type === 'administrative' ? '行政區' : '在地地標', 'Nominatim');
                });
            }
        } catch (e) { console.warn("Nominatim 引擎失敗", e); }
    };

    // 🚀 引擎 2：Photon (加上 2 秒極限防拖累機制)
    const fetchPhoton = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 嚴格 2 秒超時！
        try {
            var photonUrl = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(keyword) + '&lat=23.00&lon=120.20&limit=15';
            var photonRes = await fetch(photonUrl, { signal: controller.signal });
            if (photonRes.ok) {
                var dataPhoton = await photonRes.json();
                if (dataPhoton.features) {
                    dataPhoton.features.forEach(function(feature) {
                        var props = feature.properties || {};
                        var name = props.name || '';
                        var coords = feature.geometry && feature.geometry.coordinates;
                        if (name && coords) addPlace(name, coords[1], coords[0], props.osm_value || '地點', 'Photon');
                    });
                }
            }
        } catch (err) { 
            console.warn("Photon 引擎超時，已無情放生", err); 
        } finally {
            clearTimeout(timeoutId);
        }
    };

    // 🚀 引擎 3：ArcGIS (補足門牌)
    const fetchArcGIS = async () => {
        try {
            var arcUrl = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=' + encodeURIComponent(keyword) + '&outFields=Addr_type&maxLocations=10&countryCode=TWN';
            var arcRes = await fetch(arcUrl);
            if (arcRes.ok) {
                var dataArc = await arcRes.json();
                if (dataArc.candidates) {
                    dataArc.candidates.forEach(function(cand) {
                        var name = String(cand.address || keyword).split(',')[0].replace('台灣', '').trim();
                        if (cand.location) addPlace(name, cand.location.y, cand.location.x, cand.attributes && cand.attributes.Addr_type ? cand.attributes.Addr_type : '地址/區劃', 'ArcGIS');
                    });
                }
            }
        } catch (err) { console.warn("ArcGIS 引擎失敗", err); }
    };

    // 🏆 神級優化：三個引擎「同時出發賽跑」(Promise.allSettled)！不用再排隊等當機！
    await Promise.allSettled([fetchNominatim(), fetchPhoton(), fetchArcGIS()]);

    // 🎨 渲染結果
    if (places.length > 0) {
        places.sort(function(a, b) {
            var aExact = (a.name === keyword) ? -10 : 0;
            var bExact = (b.name === keyword) ? -10 : 0;
            var aTainan = (a.name.includes('台南') || a.name.includes('臺南') || a.name.includes('永康') || a.name.includes('安南')) ? -5 : 0;
            var bTainan = (b.name.includes('台南') || b.name.includes('臺南') || b.name.includes('永康') || b.name.includes('安南')) ? -5 : 0;

            var scoreA = aExact + aTainan;
            var scoreB = bExact + bTainan;

            if (scoreA !== scoreB) return scoreA - scoreB;
            return a.name.localeCompare(b.name, 'zh-Hant');
        });

        renderPlaceSearchResults(places, keyword);

        if (places.length === 1) {
            focusPlaceFromList(places[0].lat, places[0].lon, places[0].name, places[0].type);
        }
    } else {
        resultBox.innerHTML =
            '<div style="padding:8px 12px; border-radius:8px; background:#fff1f2; color:#be123c; font-size:12px; font-weight:800; border:1px solid #fecdd3; text-align:center;">找不到「' +
            escapePlaceHtml(keyword) +
            '」，請嘗試其他關鍵字。</div>';
    }
}


        function focusPlaceFromList(lat, lon, name, typeText) {
            map.flyTo([lat, lon], 17, { animate: true, duration: 1.2 });
            if (placeSearchMarker && map.hasLayer(placeSearchMarker)) map.removeLayer(placeSearchMarker);

            // ✨ 100分醫美的地標 Popup
            placeSearchMarker = L.marker([lat, lon], { icon: placeSearchIcon, zIndexOffset: 3000 }).addTo(map)
                .bindPopup(`
                    <div style="padding: 8px; text-align: center; min-width: 140px;">
                        <div style="font-weight:900; font-size:16px; color:#e74c3c; margin-bottom:8px; border-bottom: 2px dashed #fecdd3; padding-bottom: 8px;">
                            ${escapePlaceHtml(name)}
                        </div>
                        <span style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#64748b; font-weight:800; background:#f1f5f9; padding:4px 10px; border-radius:12px; border: 1px solid #e2e8f0;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg> 類型：${escapePlaceHtml(typeText)}
                        </span>
                    </div>
                `, { offset: [0, -35], closeButton: true, minWidth: 150 })
                .openPopup();
            
            // 讓手機版使用者也能直接看清楚地點，暫時收起側邊欄
            if(window.innerWidth <= 600) closeAllDrawers();
        }

                // ==========================================
        // 🌊 水利署圖資：改用 Cloudflare Worker 快取 Hugging Face GeoJSON
        // ==========================================

        var gisWorkerBaseUrl = 'https://haidian-gis-cache.yhzkiki.workers.dev/data/gis/';
        var gisHfBaseUrl = 'https://huggingface.co/datasets/yhzkiki/haidian-soundscape-gis/resolve/main/data/gis/';

        var geoJsonDataCache = {};
        var geoJsonRenderer = L.canvas({ padding: 0.5 });

        var floodScenarioMeta = {
    'flood_200mm_24hr': {
        label: '24 小時 200 mm',
        path: 'flood/Flood_200mm_24HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_200mm_24HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_350mm_24hr': {
        label: '24 小時 350 mm',
        path: 'flood/Flood_350mm_24HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_350mm_24HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_500mm_24hr': {
        label: '24 小時 500 mm',
        path: 'flood/Flood_500mm_24HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_500mm_24HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_650mm_24hr': {
        label: '24 小時 650 mm',
        path: 'flood/Flood_650mm_24HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_650mm_24HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_200mm_12hr': {
        label: '12 小時 200 mm',
        path: 'flood/Flood_200mm_12HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_200mm_12HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_300mm_12hr': {
        label: '12 小時 300 mm',
        path: 'flood/Flood_300mm_12HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_300mm_12HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_400mm_12hr': {
        label: '12 小時 400 mm',
        path: 'flood/Flood_400mm_12HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_400mm_12HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_150mm_6hr': {
        label: '6 小時 150 mm',
        path: 'flood/Flood_150mm_6HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_150mm_6HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_250mm_6hr': {
        label: '6 小時 250 mm',
        path: 'flood/Flood_250mm_6HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_250mm_6HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    },

    'flood_350mm_6hr': {
        label: '6 小時 350 mm',
        path: 'flood/Flood_350mm_6HR.json',
        pmtilesPath: 'flood-pmtiles/Flood_350mm_6HR_v2.pmtiles',
        pmtilesDataLayer: 'flood'
    }
};

        var hydrologyLayerMeta = {
            'tainan_water_texture': {
                label: '府城歷史水系紋理',
                path: './tainan_water_texture.geojson', 
                color: '#3b82f6',     
                weight: 3,            
                opacity: 0.85
            },
            'SEAWALLZONE': {
                label: '海堤區域',
                path: 'hydrology/SEAWALLZONE.json',
                color: '#0f766e',
                fillColor: '#99f6e4',
                weight: 1.5,
                fillOpacityRatio: 0.35
            },
            'CoastalBufferZone': {
                label: '海岸緩衝區',
                path: 'hydrology/CoastalBufferZone.json',
                color: '#0891b2',
                fillColor: '#a5f3fc',
                weight: 1,
                fillOpacityRatio: 0.35
            },
            'CoastalProtectionZone': {
                label: '海岸保護區',
                path: 'hydrology/CoastalProtectionZone.json',
                color: '#16a34a',
                fillColor: '#bbf7d0',
                weight: 1,
                fillOpacityRatio: 0.35
            },
            'REGDAREA': {
                label: '區域排水治理區',
                path: 'hydrology/REGDAREA.json',
                color: '#7c3aed',
                fillColor: '#ddd6fe',
                weight: 1,
                fillOpacityRatio: 0.35
            },
            'reservoir': {
    label: '水庫範圍',
    path: 'hydrology/ressub.json',
    color: '#2563eb',
    fillColor: '#bfdbfe',
    weight: 1,
    fillOpacityRatio: 0.45
},
            'TWQPROT': {
    label: '水質水量保護區',
    path: 'hydrology/TWQPROT1.json',
    color: '#15803d',
    fillColor: '#bbf7d0',
    weight: 1,
    fillOpacityRatio: 0.3
},
            'Salinizationzone': {
                label: '地下水鹽化區',
                path: 'hydrology/Salinizationzone.json',
                color: '#d97706',
                fillColor: '#fed7aa',
                weight: 1,
                fillOpacityRatio: 0.38
            },
            'LASUBSTA': {
                label: '地層下陷監測站',
                path: 'hydrology/LASUBSTA.json',
                color: '#dc2626',
                fillColor: '#ef4444',
                weight: 1,
                fillOpacityRatio: 0.85,
                pointRadius: 5
            }
        };

        var recommendedHydrologyIds = [
            'SEAWALLZONE',
            'CoastalBufferZone',
            'CoastalProtectionZone',
            'REGDAREA',
            'reservoir',
            'TWQPROT',
            'Salinizationzone',
            'LASUBSTA'
        ];

        var currentFloodLayer = null;
        var currentFloodLayerId = null;
        var hydrologyLayers = {};

        map.createPane('hydrologyPane');
        map.getPane('hydrologyPane').style.zIndex = 340;
        map.getPane('hydrologyPane').style.pointerEvents = 'none';

                map.createPane('floodPane');
        map.getPane('floodPane').style.zIndex = 350;
        map.getPane('floodPane').style.pointerEvents = 'auto';

        /* ===== START: TAINAN_HISTORY_FLOOD_V5_SCRIPT ===== */
if (!map.getPane('tainanHistoryFloodPane')) {
    map.createPane('tainanHistoryFloodPane');
}

map.getPane('tainanHistoryFloodPane').style.zIndex = 355;
map.getPane('tainanHistoryFloodPane').style.pointerEvents = 'none';

var TAINAN_HISTORY_FLOOD_MAPSERVER_URL =
    'https://water.tainan.gov.tw/tnwrbarcgis104/rest/services/WRB/TNWRB_HistoryData/MapServer';

var TAINAN_HISTORY_FLOOD_MIN_ZOOM = 9;
var TAINAN_HISTORY_FLOOD_BUFFER_PX = 560;
var TAINAN_HISTORY_FLOOD_MAX_IMAGE_SIZE = 1600;

var tainanHistoryFloodMeta = {
    history_all: {
        label: '歷年淹水災情',
        layerId: 2
    },
    history_stormwater: {
        label: '歷年淹水災情（雨水科）',
        layerId: 0
    },
    history_planning: {
        label: '歷年淹水災情（綜企科）',
        layerId: 1
    }
};

var tainanHistoryFloodLayer = null;
var tainanHistoryFloodLayerId = null;
var tainanHistoryFloodLayers = {};
var tainanHistoryFloodEvents = [];
var tainanHistoryFloodSelectedValues = new Set();
var tainanHistoryFloodSelectionState = Object.create(null);
var tainanHistoryFloodFilterField = null;
var tainanHistoryFloodFilterFields = {};
var TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS = [
    'history_stormwater',
    'history_planning'
];
var tainanHistoryFloodEventCache = {};
var tainanHistoryFloodEventRequests = {};
var tainanHistoryFloodLegendPayload = null;
var tainanHistoryFloodLegendRequest = null;
var tainanHistoryFloodMetadataRequests = {};
var tainanHistoryFloodDatasetLoadState = {
    history_all: 'idle',
    history_stormwater: 'idle',
    history_planning: 'idle'
};

var StableArcGisExportLayer = L.Layer.extend({
    initialize: function(options) {
        L.setOptions(this, options || {});
        this._activeImage = null;
        this._pendingImage = null;
        this._refreshTimer = null;
        this._requestId = 0;
        this._enabled = false;
        this._map = null;
    },

    onAdd: function(attachedMap) {
        this._map = attachedMap;
        this._onMapChange = this._schedule.bind(this, false);
        attachedMap.on('moveend zoomend resize', this._onMapChange);
    },

    onRemove: function(attachedMap) {
        attachedMap.off('moveend zoomend resize', this._onMapChange);
        window.clearTimeout(this._refreshTimer);
        this._removeImage(this._activeImage);
        this._removeImage(this._pendingImage);
        this._activeImage = null;
        this._pendingImage = null;
        this._map = null;
    },

    setEnabled: function(enabled) {
        this._enabled = !!enabled;

        if (!this._shouldRender()) {
            this._cancelPendingRequest();
            this._setVisible(false);
            return this;
        }

        this._setVisible(true);
        this._schedule(true);
        return this;
    },

    setLayerId: function(layerId) {
        this.options.layerId = Number(layerId);
        if (this._enabled) this._schedule(true);
        return this;
    },

    setOpacity: function(opacity) {
        this.options.opacity = Number(opacity);
        if (this._activeImage) {
            this._activeImage.setOpacity(this.options.opacity);
        }
        return this;
    },

    setEventFilter: function(fieldName, values, allSelected) {
        this.options.filterField = fieldName || null;
        this.options.filterValues = Array.isArray(values) ? values.slice() : [];
        this.options.allSelected = !!allSelected;

        if (!this._shouldRender()) {
            this._cancelPendingRequest();
            this._setVisible(false);
            return this;
        }

        this._setVisible(true);
        this._schedule(true);
        return this;
    },

    _shouldRender: function() {
        if (!this._map || !this._enabled) return false;
        if (this._map.getZoom() < this.options.minZoom) return false;
        if (this.options.allSelected) return true;

        return Array.isArray(this.options.filterValues) &&
            this.options.filterValues.length > 0;
    },

    _setVisible: function(visible) {
        if (this._activeImage) {
            this._activeImage.setOpacity(
                visible ? this.options.opacity : 0
            );
        }

        if (this._pendingImage) {
            this._pendingImage.setOpacity(0);
        }
    },

    _removeImage: function(image) {
        if (image && this._map && this._map.hasLayer(image)) {
            this._map.removeLayer(image);
        }
    },

    _cancelPendingRequest: function() {
        this._requestId += 1;
        this._removeImage(this._pendingImage);
        this._pendingImage = null;
    },

    _schedule: function(immediate) {
        var self = this;

        window.clearTimeout(this._refreshTimer);

        this._refreshTimer = window.setTimeout(function() {
            self._refresh();
        }, immediate ? 0 : 130);
    },

    _refresh: function() {
        if (!this._shouldRender()) return;

        var request = this._buildExportRequest();
        var requestId = ++this._requestId;
        var self = this;

        if (typeof this.options.onLoadStart === 'function') {
            this.options.onLoadStart();
        }

        this._removeImage(this._pendingImage);

        var nextImage = L.imageOverlay(request.url, request.bounds, {
            pane: this.options.pane,
            opacity: 0,
            interactive: false,
            className: 'tainan-history-flood-export-image'
        });

        this._pendingImage = nextImage;

        nextImage.once('load', function() {
            if (
                !self._map ||
                requestId !== self._requestId ||
                self._pendingImage !== nextImage
            ) {
                return;
            }

            var previousImage = self._activeImage;

            self._activeImage = nextImage;
            self._pendingImage = null;

            window.requestAnimationFrame(function() {
                nextImage.setOpacity(self.options.opacity);
            });

            window.setTimeout(function() {
                self._removeImage(previousImage);
            }, 180);

            if (typeof self.options.onLoadEnd === 'function') {
                self.options.onLoadEnd();
            }
        });

        nextImage.once('error', function() {
            if (self._pendingImage === nextImage) {
                self._pendingImage = null;
            }

            self._removeImage(nextImage);

            if (typeof self.options.onLoadError === 'function') {
                self.options.onLoadError();
            }
        });

        nextImage.addTo(this._map);
    },

    _buildExportRequest: function() {
        var zoom = this._map.getZoom();
        var pixelBounds = this._map.getPixelBounds();

        var min = pixelBounds.min.subtract([
            TAINAN_HISTORY_FLOOD_BUFFER_PX,
            TAINAN_HISTORY_FLOOD_BUFFER_PX
        ]);

        var max = pixelBounds.max.add([
            TAINAN_HISTORY_FLOOD_BUFFER_PX,
            TAINAN_HISTORY_FLOOD_BUFFER_PX
        ]);

        var paddedSouthWest = this._map.unproject(
            L.point(min.x, max.y),
            zoom
        );

        var paddedNorthEast = this._map.unproject(
            L.point(max.x, min.y),
            zoom
        );

        var projectedSouthWest =
            this._map.options.crs.project(paddedSouthWest);

        var projectedNorthEast =
            this._map.options.crs.project(paddedNorthEast);

        var size = this._map.getSize().add([
            TAINAN_HISTORY_FLOOD_BUFFER_PX * 2,
            TAINAN_HISTORY_FLOOD_BUFFER_PX * 2
        ]);

        var scale = Math.min(
            1,
            TAINAN_HISTORY_FLOOD_MAX_IMAGE_SIZE /
                Math.max(size.x, size.y)
        );

        var imageWidth = Math.max(1, Math.round(size.x * scale));
        var imageHeight = Math.max(1, Math.round(size.y * scale));

        var params = new URLSearchParams({
            bbox: [
                projectedSouthWest.x,
                projectedSouthWest.y,
                projectedNorthEast.x,
                projectedNorthEast.y
            ].join(','),

            bboxSR: '3857',
            imageSR: '3857',
            size: imageWidth + ',' + imageHeight,
            dpi: '96',
            format: 'png32',
            transparent: 'true',
            layers: 'show:' + this.options.layerId,
            f: 'image'
        });

        if (
            !this.options.allSelected &&
            this.options.filterField
        ) {
            var values = Array.isArray(this.options.filterValues) ?
                this.options.filterValues :
                [];

            var where = values.length ?
                this.options.filterField + ' IN (' +
                    values.map(function(value) {
                        return "'" +
                            String(value).replace(/'/g, "''") +
                            "'";
                    }).join(',') +
                    ')' :
                '1=0';

            var layerDefinitions = {};
            layerDefinitions[this.options.layerId] = where;

            params.set(
                'layerDefs',
                JSON.stringify(layerDefinitions)
            );
        }

        return {
            url: TAINAN_HISTORY_FLOOD_MAPSERVER_URL +
                '/export?' +
                params.toString(),

            bounds: L.latLngBounds(
                paddedSouthWest,
                paddedNorthEast
            )
        };
    }
});

function getTainanHistoryFloodSelectedId() {
    var selectEl = document.getElementById(
        'tainanHistoryFloodDataset'
    );

    return selectEl ? selectEl.value : 'history_all';
}

function getTainanHistoryFloodOpacityValue() {
    var opacityEl = document.getElementById(
        'tainanHistoryFloodOpacity'
    );

    return opacityEl ? parseFloat(opacityEl.value) : 0.65;
}

function setTainanHistoryFloodState(message, isWarning) {
    var stateEl = document.getElementById(
        'tainanHistoryFloodState'
    );

    if (!stateEl) return;

    stateEl.textContent = message;
    stateEl.classList.toggle('is-warning', !!isWarning);
}

function syncTainanHistoryFloodState() {
    var toggleEl = document.getElementById(
        'tainanHistoryFloodToggle'
    );

    var zoomHintEl = document.getElementById(
        'tainanHistoryFloodZoomHint'
    );

    var isEnabled = !!(toggleEl && toggleEl.checked);
    var zoom = map.getZoom();

    if (!isEnabled) {
        setTainanHistoryFloodState('圖層未啟用', false);

        if (zoomHintEl) {
            zoomHintEl.textContent =
                '需放大至 z ' +
                TAINAN_HISTORY_FLOOD_MIN_ZOOM;
        }

        return;
    }

    if (zoom < TAINAN_HISTORY_FLOOD_MIN_ZOOM) {
        setTainanHistoryFloodState(
            '請放大至 z ' +
                TAINAN_HISTORY_FLOOD_MIN_ZOOM,
            true
        );

        if (zoomHintEl) {
            zoomHintEl.textContent =
                '目前 z ' +
                Math.round(zoom) +
                '，尚未載入';
        }

        return;
    }

    if (
        tainanHistoryFloodEvents.length &&
        getTainanHistoryFloodVisibleEventCount() === 0
    ) {
        setTainanHistoryFloodState('所有事件均已隱藏', true);

        if (zoomHintEl) {
            zoomHintEl.textContent =
                '目前 z ' +
                Math.round(zoom) +
                '，未顯示事件';
        }

        return;
    }

    setTainanHistoryFloodState('已顯示官方圖資', false);

    if (zoomHintEl) {
        zoomHintEl.textContent =
            '目前 z ' +
            Math.round(zoom) +
            '，已載入';
    }
}

function getTainanHistoryFloodActiveDatasetIds() {
    var selectedId = getTainanHistoryFloodSelectedId();

    return selectedId === 'history_all' ?
        TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS.slice() :
        [selectedId];
}

function createTainanHistoryFloodExportLayer(datasetId) {
    var meta = tainanHistoryFloodMeta[datasetId];

    if (!meta || datasetId === 'history_all') {
        return null;
    }

    if (!tainanHistoryFloodLayers[datasetId]) {
        tainanHistoryFloodLayers[datasetId] =
            new StableArcGisExportLayer({
                layerId: meta.layerId,
                pane: 'tainanHistoryFloodPane',
                opacity: getTainanHistoryFloodOpacityValue(),
                minZoom: TAINAN_HISTORY_FLOOD_MIN_ZOOM,
                filterField: null,
                filterValues: [],
                allSelected: true,

                onLoadStart: function() {
                    var toggleEl = document.getElementById(
                        'tainanHistoryFloodToggle'
                    );

                    if (
                        toggleEl &&
                        toggleEl.checked &&
                        map.getZoom() >=
                            TAINAN_HISTORY_FLOOD_MIN_ZOOM
                    ) {
                        setTainanHistoryFloodState(
                            '正在更新地圖…',
                            false
                        );
                    }
                },

                onLoadEnd: syncTainanHistoryFloodState,

                onLoadError: function() {
                    setTainanHistoryFloodState(
                        '官方服務暫時無回應',
                        true
                    );
                }
            });
    } else {
        tainanHistoryFloodLayers[datasetId].setLayerId(
            meta.layerId
        );
    }

    return tainanHistoryFloodLayers[datasetId];
}

function getTainanHistoryFloodActiveLayers() {
    return getTainanHistoryFloodActiveDatasetIds()
        .map(createTainanHistoryFloodExportLayer)
        .filter(function(layer) {
            return !!layer;
        });
}

function setTainanHistoryFloodActiveLayersEnabled(enabled) {
    var activeDatasetIds = getTainanHistoryFloodActiveDatasetIds();

    Object.keys(tainanHistoryFloodLayers).forEach(
        function(datasetId) {
            var layer = tainanHistoryFloodLayers[datasetId];
            var isActive = activeDatasetIds.indexOf(datasetId) !== -1;

            if (!enabled || !isActive) {
                layer.setEnabled(false);

                if (map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            }
        }
    );

    if (!enabled) {
        tainanHistoryFloodLayer = null;
        return [];
    }

    var activeLayers = getTainanHistoryFloodActiveLayers();

    activeLayers.forEach(function(layer) {
        layer.setOpacity(getTainanHistoryFloodOpacityValue());

        if (!map.hasLayer(layer)) {
            map.addLayer(layer);
        }

        layer.setEnabled(true);
    });

    tainanHistoryFloodLayer = activeLayers[0] || null;
    tainanHistoryFloodLayerId = getTainanHistoryFloodSelectedId();

    return activeLayers;
}

/* Legacy call-site compatibility: returns the first active source layer. */
function createTainanHistoryFloodLayer() {
    var activeLayers = getTainanHistoryFloodActiveLayers();

    tainanHistoryFloodLayer = activeLayers[0] || null;
    tainanHistoryFloodLayerId = getTainanHistoryFloodSelectedId();

    return tainanHistoryFloodLayer;
}

function getTainanHistoryFloodStorageKey(layerId) {
    return 'tainanHistoryFloodEventsV5:' + String(layerId);
}

function getTainanHistoryFloodCachedEvents(layerId) {
    var key = String(layerId);

    if (tainanHistoryFloodEventCache[key]) {
        return tainanHistoryFloodEventCache[key];
    }

    try {
        var raw = sessionStorage.getItem(
            getTainanHistoryFloodStorageKey(layerId)
        );

        var saved = raw ? JSON.parse(raw) : null;

        if (
            !saved ||
            !Array.isArray(saved.events) ||
            Date.now() - saved.savedAt > 86400000
        ) {
            return null;
        }

        tainanHistoryFloodEventCache[key] = saved;

        return saved;
    } catch (error) {
        return null;
    }
}

function saveTainanHistoryFloodCachedEvents(layerId, payload) {
    var key = String(layerId);

    tainanHistoryFloodEventCache[key] = payload;

    try {
        sessionStorage.setItem(
            getTainanHistoryFloodStorageKey(layerId),
            JSON.stringify(payload)
        );
    } catch (error) {
        /* sessionStorage 不可用時仍保留本頁記憶體快取 */
    }
}

function getTainanHistoryFloodLegend() {
    if (tainanHistoryFloodLegendPayload) {
        return Promise.resolve(tainanHistoryFloodLegendPayload);
    }

    if (tainanHistoryFloodLegendRequest) {
        return tainanHistoryFloodLegendRequest;
    }

    var legendUrl =
        TAINAN_HISTORY_FLOOD_MAPSERVER_URL +
        '/legend?f=pjson';

    tainanHistoryFloodLegendRequest = fetch(legendUrl, {
        cache: 'force-cache'
    })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('LEGEND_HTTP_' + response.status);
            }

            return response.json();
        })
        .then(function(payload) {
            tainanHistoryFloodLegendPayload = payload;
            return payload;
        })
        .finally(function() {
            tainanHistoryFloodLegendRequest = null;
        });

    return tainanHistoryFloodLegendRequest;
}

function getTainanHistoryFloodMetadata(layerId) {
    var requestKey = String(layerId);

    if (tainanHistoryFloodMetadataRequests[requestKey]) {
        return tainanHistoryFloodMetadataRequests[requestKey];
    }

    var metadataUrl =
        TAINAN_HISTORY_FLOOD_MAPSERVER_URL +
        '/' + layerId + '?f=pjson';

    var request = fetch(metadataUrl, { cache: 'force-cache' })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('METADATA_HTTP_' + response.status);
            }

            return response.json();
        })
        .finally(function() {
            delete tainanHistoryFloodMetadataRequests[requestKey];
        });

    tainanHistoryFloodMetadataRequests[requestKey] = request;

    return request;
}

function getTainanHistoryFloodLayerEvents(layerId) {
    var cached = getTainanHistoryFloodCachedEvents(layerId);

    if (cached) {
        return Promise.resolve(cached);
    }

    var requestKey = String(layerId);

    if (tainanHistoryFloodEventRequests[requestKey]) {
        return tainanHistoryFloodEventRequests[requestKey];
    }

    var request = Promise.all([
        getTainanHistoryFloodLegend(),
        getTainanHistoryFloodMetadata(layerId)
    ])
        .then(function(results) {
            var legendPayload = results[0];
            var metadata = results[1];

            var legendLayer =
                (legendPayload.layers || []).find(
                    function(item) {
                        return Number(item.layerId) ===
                            Number(layerId);
                    }
                );

            var renderer =
                metadata && metadata.drawingInfo ?
                    metadata.drawingInfo.renderer :
                    null;

            var fieldName =
                renderer &&
                (renderer.field1 || renderer.field) ?
                    (renderer.field1 || renderer.field) :
                    'NAME';

            var uniqueValueInfos =
                renderer &&
                Array.isArray(renderer.uniqueValueInfos) ?
                    renderer.uniqueValueInfos :
                    [];

            var legendEntries =
                legendLayer &&
                Array.isArray(legendLayer.legend) ?
                    legendLayer.legend :
                    [];

            var events = legendEntries
                .filter(function(entry) {
                    return entry &&
                        String(entry.label || '').trim();
                })
                .map(function(entry, index) {
                    var label = String(entry.label).trim();

                    var uniqueValue = uniqueValueInfos.find(
                        function(info) {
                            return String(
                                info.label || ''
                            ).trim() === label;
                        }
                    ) ||
                    uniqueValueInfos[index] ||
                    null;

                    return {
                        label: label,
                        value:
                            uniqueValue &&
                            uniqueValue.value !== undefined &&
                            uniqueValue.value !== null ?
                                uniqueValue.value :
                                label,

                        imageData: entry.imageData || ''
                    };
                });

            if (!events.length) {
                throw new Error('NO_LEGEND_EVENTS');
            }

            var payload = {
                savedAt: Date.now(),
                fieldName: fieldName,
                events: events
            };

            saveTainanHistoryFloodCachedEvents(
                layerId,
                payload
            );

            return payload;
        })
        .finally(function() {
            delete tainanHistoryFloodEventRequests[requestKey];
        });

    tainanHistoryFloodEventRequests[requestKey] = request;

    return request;
}

function getTainanHistoryFloodSwatch(entry) {
    if (entry.imageData) {
        return 'data:image/png;base64,' + entry.imageData;
    }

    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="22" height="16"%3E%3Crect width="22" height="16" fill="%23e2e8f0"/%3E%3C/svg%3E';
}

function escapeTainanHistoryFloodHtml(value) {
    return String(value == null ? '' : value)
        .replace(/[&<>'"]/g, function(character) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#039;',
                '"': '&quot;'
            }[character];
        });
}


/* ===== START: TAINAN_HISTORY_FLOOD_EVENT_PRESENTATION ===== */
/*
 * 前端只正名顯示文字；ArcGIS 的原始 value 與官方色票維持不變。
 * 同一災害事件若來自雨水科與綜企科，必須維持兩筆獨立清單項目，
 * 讓使用者能各自切換、比較；每一列只送回該筆原始 value。
 */
var tainanHistoryFloodUserHasChangedSelection = false;

var TAINAN_HISTORY_FLOOD_EVENT_DEFINITIONS = [
    {
        label: '1994 凱特琳颱風',
        selectionKey: '1994-kaitlin',
        order: 199400,
        aliases: [
            '凱特琳颱風', '凱特琳淹水範圍', '凱特琳淹水'
        ]
    },
    {
        label: '2001 納莉颱風',
        selectionKey: '2001-nari',
        order: 200100,
        aliases: [
            '90納莉颱風', '90納莉淹水範圍', '90納莉淹水',
            '納莉颱風', '納莉淹水範圍', '納莉淹水'
        ]
    },
    {
        label: '2004 敏督利颱風',
        selectionKey: '2004-mindulle',
        order: 200400,
        aliases: [
            '93敏督利颱風', '93敏督利淹水範圍', '93敏督利淹水',
            '敏督利颱風', '敏督利淹水範圍', '敏督利淹水'
        ]
    },
    {
        label: '2005 06.12 豪雨',
        selectionKey: '2005-06-12-heavy-rain',
        order: 200501,
        aliases: [
            '940612豪雨', '940612淹水範圍', '940612淹水'
        ]
    },
    {
        label: '2005 海棠颱風',
        selectionKey: '2005-haitang',
        order: 200502,
        aliases: [
            '94海棠颱風', '94海棠淹水範圍', '94海棠淹水',
            '海棠颱風', '海棠淹水範圍', '海棠淹水'
        ]
    },
    {
        label: '2006 碧利斯颱風',
        selectionKey: '2006-bilis',
        order: 200600,
        aliases: [
            '碧利斯颱風', '碧利斯淹水範圍', '碧利斯淹水'
        ]
    },
    {
        label: '2008 卡玫基颱風',
        selectionKey: '2008-kalmaegi',
        order: 200800,
        aliases: [
            '97卡玫基颱風', '97卡玫基淹水範圍', '97卡玫基淹水',
            '卡玫基颱風', '卡玫基淹水範圍', '卡玫基淹水'
        ]
    },
    {
        label: '2009 莫拉克颱風',
        selectionKey: '2009-morakot',
        order: 200900,
        aliases: [
            '88水災', '八八水災',
            '98莫拉克颱風', '98莫拉克淹水範圍', '98莫拉克淹水',
            '莫拉克颱風', '莫拉克淹水範圍', '莫拉克淹水'
        ]
    },
    {
        label: '2010 凡那比颱風',
        selectionKey: '2010-fanapi',
        order: 201000,
        aliases: [
            '99凡那比颱風', '99凡那比淹水範圍', '99凡那比淹水',
            '凡那比颱風', '凡那比淹水範圍', '凡那比淹水'
        ]
    },
    {
        label: '2013 康芮颱風',
        selectionKey: '2013-kong-rey',
        order: 201300,
        aliases: [
            '102康芮颱風', '102康芮淹水範圍', '102康芮淹水',
            '康芮颱風', '康芮淹水範圍', '康芮淹水'
        ]
    }
];

function getTainanHistoryFloodEventPresentationKey(value) {
    return String(value == null ? '' : value)
        .trim()
        .replace(/\s+/g, '')
        .replace(/[．。.]/g, '')
        .replace(/[／/]/g, '')
        .replace(/[－—–-]/g, '');
}

var TAINAN_HISTORY_FLOOD_EVENT_PRESENTATION =
    TAINAN_HISTORY_FLOOD_EVENT_DEFINITIONS.reduce(
        function(index, event) {
            event.aliases.forEach(function(alias) {
                index[
                    getTainanHistoryFloodEventPresentationKey(alias)
                ] = {
                    label: event.label,
                    selectionKey: event.selectionKey,
                    order: event.order
                };
            });

            return index;
        },
        {}
    );

function getTainanHistoryFloodEventSelectionKey(entry) {
    return String(
        entry &&
        entry.selectionKey !== undefined &&
        entry.selectionKey !== null ?
            entry.selectionKey :
            ''
    );
}

function getTainanHistoryFloodEntryRawValues(entry) {
    var values = entry && Array.isArray(entry.values) ?
        entry.values :
        [entry && entry.value];

    return values
        .filter(function(value) {
            return value !== undefined && value !== null &&
                String(value).trim() !== '';
        })
        .map(function(value) {
            return String(value);
        });
}

function getTainanHistoryFloodEventStateKey(entry, kind) {
    var department = String(
        entry && entry.department ?
            entry.department :
            getTainanHistoryFloodDepartmentLabel(
                entry && entry.sourceLabels ?
                    entry.sourceLabels[0] :
                    ''
            )
    ).trim();

    var valueKey = kind === 'logical' ?
        String(entry && entry.eventKey ? entry.eventKey : '') :
        String(
            entry && entry.rawValueKey ?
                entry.rawValueKey :
                getTainanHistoryFloodEntryRawValues(entry)
                    .map(getTainanHistoryFloodEventPresentationKey)
                    .join('|')
        );

    return 'history-flood:' + department + ':' + kind + ':' + valueKey;
}

function hasTainanHistoryFloodSelectionState(key) {
    return Object.prototype.hasOwnProperty.call(
        tainanHistoryFloodSelectionState,
        key
    );
}

function isTainanHistoryFloodEventSelected(entry) {
    var exactKey = getTainanHistoryFloodEventStateKey(
        entry,
        'raw'
    );

    if (hasTainanHistoryFloodSelectionState(exactKey)) {
        return !!tainanHistoryFloodSelectionState[exactKey];
    }

    var logicalKey = getTainanHistoryFloodEventStateKey(
        entry,
        'logical'
    );

    if (hasTainanHistoryFloodSelectionState(logicalKey)) {
        return !!tainanHistoryFloodSelectionState[logicalKey];
    }

    /* First-seen events retain the original default: display them. */
    return true;
}

function setTainanHistoryFloodEventSelected(entry, selected) {
    var checked = !!selected;

    tainanHistoryFloodSelectionState[
        getTainanHistoryFloodEventStateKey(entry, 'raw')
    ] = checked;

    tainanHistoryFloodSelectionState[
        getTainanHistoryFloodEventStateKey(entry, 'logical')
    ] = checked;
}

function syncTainanHistoryFloodSelectedValues() {
    tainanHistoryFloodSelectedValues.clear();

    tainanHistoryFloodEvents.forEach(function(entry) {
        if (isTainanHistoryFloodEventSelected(entry)) {
            tainanHistoryFloodSelectedValues.add(
                getTainanHistoryFloodEventSelectionKey(entry)
            );
        }
    });
}

function getTainanHistoryFloodSelectedRawValues() {
    var seen = new Set();
    var values = [];

    tainanHistoryFloodEvents.forEach(function(entry) {
        if (!isTainanHistoryFloodEventSelected(entry)) {
            return;
        }

        getTainanHistoryFloodEntryRawValues(entry).forEach(
            function(value) {
                if (!seen.has(value)) {
                    seen.add(value);
                    values.push(value);
                }
            }
        );
    });

    return values;
}

function getTainanHistoryFloodVisibleEventCount() {
    return tainanHistoryFloodEvents.filter(function(entry) {
        return isTainanHistoryFloodEventSelected(entry);
    }).length;
}

function selectAllTainanHistoryFloodEventsInCurrentDataset() {
    tainanHistoryFloodEvents.forEach(function(entry) {
        setTainanHistoryFloodEventSelected(entry, true);
    });

    syncTainanHistoryFloodSelectedValues();
}

function ensureTainanHistoryFloodDefaultSelection() {
    /* No reset here: new/unknown events default to visible, known states persist. */
    syncTainanHistoryFloodSelectedValues();
}

function addUniqueTainanHistoryFloodValue(list, value) {
    var normalized = String(value == null ? '' : value).trim();

    if (normalized && list.indexOf(normalized) === -1) {
        list.push(normalized);
    }
}

function addUniqueTainanHistoryFloodImageData(list, imageData) {
    var normalized = String(imageData == null ? '' : imageData).trim();

    if (normalized && list.indexOf(normalized) === -1) {
        list.push(normalized);
    }
}

function getTainanHistoryFloodDepartmentLabel(
    sourceLabel,
    sourceDataset
) {
    if (sourceDataset === 'history_stormwater') {
        return '雨水科';
    }

    if (sourceDataset === 'history_planning') {
        return '綜企科';
    }

    var selectedDataset = getTainanHistoryFloodSelectedId();

    if (selectedDataset === 'history_stormwater') {
        return '雨水科';
    }

    if (selectedDataset === 'history_planning') {
        return '綜企科';
    }

    /* Backwards-compatible fallback for any future, unannotated source. */
    return /淹水範圍|淹水/.test(sourceLabel) ?
        '綜企科' :
        '雨水科';
}

function presentTainanHistoryFloodEvents(events) {
    /*
     * 同一科別的官方圖例有時會以不同原始名稱重複描述同一場事件，
     * 例如「88 水災」與「98 莫拉克颱風」。
     *
     * 清單以「來源科別 + 標準化事件」為單位收斂：
     * - 同一科別內的同一事件只顯示一列；所有原始 values 仍完整保留，
     *   供 ArcGIS 篩選時一起送出。
     * - 雨水科與綜企科仍使用不同 groupKey，因此絕不跨科別合併。
     */
    var groups = new Map();

    (Array.isArray(events) ? events : []).forEach(
        function(entry, sourceIndex) {
            var sourceLabel = String(
                entry && entry.sourceLabel !== undefined ?
                    entry.sourceLabel :
                    (entry && entry.label ? entry.label : '')
            ).trim();

            var sourceKey =
                getTainanHistoryFloodEventPresentationKey(sourceLabel);

            var sourceDataset = String(
                entry && entry.sourceDataset ?
                    entry.sourceDataset :
                    ''
            );

            var config =
                TAINAN_HISTORY_FLOOD_EVENT_PRESENTATION[sourceKey];

            var rawValue = String(
                entry && entry.value !== undefined &&
                entry.value !== null ?
                    entry.value :
                    sourceLabel
            ).trim();

            var department =
                getTainanHistoryFloodDepartmentLabel(
                    sourceLabel,
                    sourceDataset
                );

            var eventKey = config ? config.selectionKey :
                'source:' + sourceKey;

            /* sourceDataset is part of the key: do not merge two departments. */
            var groupKey = String(sourceDataset || department) +
                '|' + eventKey;

            var event = groups.get(groupKey);

            if (!event) {
                event = {
                    label: (config ? config.label : sourceLabel) +
                        '（' + department + '）',
                    baseLabel: config ? config.label : sourceLabel,
                    department: department,
                    sourceDataset: sourceDataset,
                    eventKey: eventKey,
                    rawValueKey: '',
                    selectionKey: 'source:' +
                        String(sourceDataset || department) + ':' +
                        eventKey,
                    _presentationOrder: config ?
                        config.order :
                        999999 + sourceIndex,
                    _sourceIndex: sourceIndex,
                    values: [],
                    sourceLabels: [],
                    imageDataList: []
                };

                groups.set(groupKey, event);
            }

            /* Keep the earliest appearance for deterministic sort order. */
            event._presentationOrder = Math.min(
                event._presentationOrder,
                config ? config.order : 999999 + sourceIndex
            );
            event._sourceIndex = Math.min(event._sourceIndex, sourceIndex);

            addUniqueTainanHistoryFloodValue(event.values, rawValue);
            addUniqueTainanHistoryFloodValue(
                event.sourceLabels,
                sourceLabel
            );
            addUniqueTainanHistoryFloodImageData(
                event.imageDataList,
                entry && entry.imageData
            );
        }
    );

    return Array.from(groups.values())
        .map(function(event) {
            /*
             * A stable canonical raw key lets per-event selection survive
             * switching among「全部來源／雨水科／綜企科」.
             */
            event.rawValueKey = event.values
                .map(getTainanHistoryFloodEventPresentationKey)
                .sort()
                .join('|') || event.eventKey;

            return event;
        })
        .sort(function(a, b) {
            return (
                a._presentationOrder - b._presentationOrder ||
                a._sourceIndex - b._sourceIndex
            );
        });
}

function getTainanHistoryFloodSwatchMarkup(entry) {
    var imageDataList = entry && Array.isArray(entry.imageDataList) ?
        entry.imageDataList :
        [];

    var imageData = imageDataList.length ?
        imageDataList[0] :
        (entry && entry.imageData ? entry.imageData : '');

    /*
     * Each rendered row represents one event in one department, so only show
     * one representative official swatch.  Any duplicate raw legend values
     * remain in entry.values for filtering, not as duplicate squares in UI.
     */
    if (!imageData) {
        return '<span class="hf-swatch">' +
            '<img alt="" src="' +
            getTainanHistoryFloodSwatch(entry) +
            '">' +
            '</span>';
    }

    return '<span class="hf-swatch">' +
        '<img alt="" src="data:image/png;base64,' +
        imageData +
        '">' +
        '</span>';
}
/* ===== END: TAINAN_HISTORY_FLOOD_EVENT_PRESENTATION ===== */

function filterTainanHistoryFloodEvents() {
    /* Retained as a harmless compatibility hook; the event search UI was removed. */
    renderTainanHistoryFloodEvents();
}

function renderTainanHistoryFloodEvents() {
    var root = document.getElementById(
        'tainanHistoryFloodEvents'
    );

    var countEl = document.getElementById(
        'tainanHistoryFloodEventCount'
    );

    var showAllButton = document.getElementById(
        'tainanHistoryFloodShowAll'
    );

    var hideAllButton = document.getElementById(
        'tainanHistoryFloodHideAll'
    );

    if (!root || !countEl || !showAllButton || !hideAllButton) {
        return;
    }

    if (!tainanHistoryFloodEvents.length) {
        showAllButton.disabled = true;
        hideAllButton.disabled = true;
        countEl.textContent = '正在整理官方事件…';
        root.innerHTML =
            '<div class="hf-events-loading">' +
            '正在背景整理目前科別的官方事件。' +
            '</div>';
        return;
    }

    syncTainanHistoryFloodSelectedValues();

    showAllButton.disabled = false;
    hideAllButton.disabled = false;

    countEl.textContent =
        '已選 ' +
        getTainanHistoryFloodVisibleEventCount() +
        ' / ' +
        tainanHistoryFloodEvents.length +
        ' 個事件';

    root.innerHTML = tainanHistoryFloodEvents
        .map(function(entry, index) {
            var visible = isTainanHistoryFloodEventSelected(entry);
            var rawLabel = String(entry.baseLabel || entry.label || '');
            var labelMatch = rawLabel.match(/^(\d{4})\s+(.+)$/);
            var eventYear = labelMatch ? labelMatch[1] : '';
            var eventName = escapeTainanHistoryFloodHtml(
                labelMatch ? labelMatch[2] : rawLabel
            );
            var department = escapeTainanHistoryFloodHtml(
                entry.department || ''
            );
            var sourceNames = escapeTainanHistoryFloodHtml(
                (entry.sourceLabels || []).join('／')
            );
            var datasetId = String(entry.sourceDataset || '');
            var sourceClass = datasetId === 'history_planning' ?
                ' is-planning' :
                (datasetId === 'history_stormwater' ?
                    ' is-stormwater' : ' is-unknown');
            var status = visible ? '顯示' : '隱藏';

            return '<label class="hf-event-row' +
                (visible ? ' is-visible' : '') +
                '" title="' +
                escapeTainanHistoryFloodHtml(rawLabel) +
                (sourceNames ? '（官方原始名稱：' + sourceNames + '）' : '') +
                '">' +

                '<input type="checkbox" class="tainan-history-event-toggle" data-event-index="' +
                index +
                '"' +
                (visible ? ' checked' : '') +
                '>' +

                '<span class="hf-event-copy">' +
                    '<span class="hf-event-title-line">' +
                        (eventYear ? '<span class="hf-event-year">' + eventYear + '</span>' : '') +
                        '<span class="hf-event-name">' + eventName + '</span>' +
                    '</span>' +
                    '<span class="hf-event-meta">' +
                        '<span class="hf-event-origin">資料來源</span>' +
                        '<span class="hf-source-chip' + sourceClass + '">' +
                            department +
                        '</span>' +
                    '</span>' +
                '</span>' +

                '<span class="hf-event-status" aria-label="目前' + status + '">' + status + '</span>' +
                '</label>';
        })
        .join('');
}

function getTainanHistoryFloodSelectedRawValuesForDataset(datasetId) {
    var seen = new Set();
    var values = [];

    tainanHistoryFloodEvents.forEach(function(entry) {
        if (
            entry.sourceDataset !== datasetId ||
            !isTainanHistoryFloodEventSelected(entry)
        ) {
            return;
        }

        getTainanHistoryFloodEntryRawValues(entry).forEach(
            function(value) {
                if (!seen.has(value)) {
                    seen.add(value);
                    values.push(value);
                }
            }
        );
    });

    return values;
}

function isTainanHistoryFloodDatasetFullySelected(datasetId) {
    var entries = tainanHistoryFloodEvents.filter(
        function(entry) {
            return entry.sourceDataset === datasetId;
        }
    );

    return entries.length > 0 && entries.every(
        isTainanHistoryFloodEventSelected
    );
}

function applyTainanHistoryFloodEventFilter() {
    var activeDatasetIds = getTainanHistoryFloodActiveDatasetIds();

    if (!activeDatasetIds.length) return;

    activeDatasetIds.forEach(function(datasetId) {
        var layer = createTainanHistoryFloodExportLayer(datasetId);

        if (!layer) return;

        layer.setEventFilter(
            tainanHistoryFloodFilterFields[datasetId] ||
                tainanHistoryFloodFilterField ||
                'NAME',
            getTainanHistoryFloodSelectedRawValuesForDataset(datasetId),
            isTainanHistoryFloodDatasetFullySelected(datasetId)
        );
    });

    renderTainanHistoryFloodEvents();
    syncTainanHistoryFloodState();
}

function setTainanHistoryFloodEventsFromPayload(payload) {
    tainanHistoryFloodEvents =
        presentTainanHistoryFloodEvents(payload.events);

    tainanHistoryFloodFilterFields = payload.fieldNames || {};
    tainanHistoryFloodFilterField = payload.fieldName ||
        tainanHistoryFloodFilterFields.history_stormwater ||
        tainanHistoryFloodFilterFields.history_planning ||
        null;

    ensureTainanHistoryFloodDefaultSelection();
}

function getTainanHistoryFloodPayloadForDataset(datasetId) {
    var meta = tainanHistoryFloodMeta[datasetId];

    if (!meta || datasetId === 'history_all') {
        return Promise.reject(new Error('UNKNOWN_HISTORY_FLOOD_SOURCE'));
    }

    return getTainanHistoryFloodLayerEvents(meta.layerId)
        .then(function(payload) {
            return {
                fieldNames: {
                    [datasetId]: payload.fieldName
                },
                events: (payload.events || []).map(function(entry) {
                    var copiedEntry = Object.assign({}, entry);
                    copiedEntry.sourceDataset = datasetId;
                    return copiedEntry;
                })
            };
        });
}

function getTainanHistoryFloodPayloadForSelection(selectedId) {
    var sourceDatasetIds = selectedId === 'history_all' ?
        TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS :
        [selectedId];

    return Promise.all(
        sourceDatasetIds.map(getTainanHistoryFloodPayloadForDataset)
    ).then(function(payloads) {
        return payloads.reduce(function(merged, payload) {
            Object.assign(merged.fieldNames, payload.fieldNames || {});
            merged.events = merged.events.concat(payload.events || []);
            return merged;
        }, {
            fieldNames: {},
            events: []
        });
    });
}

function syncTainanHistoryFloodDatasetPicker() {
    var selectedId = getTainanHistoryFloodSelectedId();
    var buttons = document.querySelectorAll(
        '[data-tainan-history-dataset]'
    );

    buttons.forEach(function(button) {
        var active = button.dataset.tainanHistoryDataset === selectedId;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function setTainanHistoryFloodDataset(datasetId) {
    if (!tainanHistoryFloodMeta[datasetId]) return;

    var selectEl = document.getElementById(
        'tainanHistoryFloodDataset'
    );

    if (!selectEl) return;

    if (selectEl.value === datasetId) {
        syncTainanHistoryFloodDatasetPicker();
        return;
    }

    selectEl.value = datasetId;
    syncTainanHistoryFloodDatasetPicker();
    changeTainanHistoryFloodDataset();
}

function updateTainanHistoryFloodPreloadStatus() {
    /* Preload is intentionally silent; events themselves show their loading state. */
}

function setTainanHistoryFloodDatasetLoadState(datasetId, state) {
    if (!tainanHistoryFloodMeta[datasetId]) return;

    tainanHistoryFloodDatasetLoadState[datasetId] = state;
    updateTainanHistoryFloodPreloadStatus();
}

function prefetchTainanHistoryFloodDataset(datasetId) {
    var meta = tainanHistoryFloodMeta[datasetId];

    if (!meta || datasetId === 'history_all') {
        return Promise.resolve();
    }

    var cached = getTainanHistoryFloodCachedEvents(meta.layerId);

    if (cached) {
        setTainanHistoryFloodDatasetLoadState(datasetId, 'ready');
        return Promise.resolve(cached);
    }

    setTainanHistoryFloodDatasetLoadState(datasetId, 'loading');

    return getTainanHistoryFloodLayerEvents(meta.layerId)
        .then(function(payload) {
            setTainanHistoryFloodDatasetLoadState(datasetId, 'ready');
            return payload;
        })
        .catch(function(error) {
            setTainanHistoryFloodDatasetLoadState(datasetId, 'error');
            throw error;
        });
}

function loadTainanHistoryFloodEvents() {
    var selectedId = getTainanHistoryFloodSelectedId();
    var sourceDatasetIds = selectedId === 'history_all' ?
        TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS :
        [selectedId];

    sourceDatasetIds.forEach(function(datasetId) {
        setTainanHistoryFloodDatasetLoadState(datasetId, 'loading');
    });

    tainanHistoryFloodEvents = [];
    tainanHistoryFloodFilterField = null;
    tainanHistoryFloodFilterFields = {};
    renderTainanHistoryFloodEvents();

    return getTainanHistoryFloodPayloadForSelection(selectedId)
        .then(function(payload) {
            sourceDatasetIds.forEach(function(datasetId) {
                setTainanHistoryFloodDatasetLoadState(datasetId, 'ready');
            });

            if (selectedId !== getTainanHistoryFloodSelectedId()) {
                return;
            }

            setTainanHistoryFloodEventsFromPayload(payload);
            renderTainanHistoryFloodEvents();

            var toggleEl = document.getElementById(
                'tainanHistoryFloodToggle'
            );

            if (toggleEl && toggleEl.checked) {
                setTainanHistoryFloodActiveLayersEnabled(true);
                applyTainanHistoryFloodEventFilter();
            }
        })
        .catch(function() {
            sourceDatasetIds.forEach(function(datasetId) {
                setTainanHistoryFloodDatasetLoadState(datasetId, 'error');
            });

            var root = document.getElementById(
                'tainanHistoryFloodEvents'
            );

            var countEl = document.getElementById(
                'tainanHistoryFloodEventCount'
            );

            var showAllButton = document.getElementById(
                'tainanHistoryFloodShowAll'
            );

            var hideAllButton = document.getElementById(
                'tainanHistoryFloodHideAll'
            );

            if (root) {
                root.innerHTML =
                    '<div class="hf-events-fallback">' +
                    '官方事件清單暫時無法取得；地圖仍維持官方原始配色，請稍後重新整理再試。' +
                    '</div>';
            }

            if (countEl) {
                countEl.textContent =
                    '官方事件清單暫時無法取得';
            }

            if (showAllButton) {
                showAllButton.disabled = true;
            }

            if (hideAllButton) {
                hideAllButton.disabled = true;
            }
        });
}

function toggleTainanHistoryFloodLayer(checked) {
    var panel = document.getElementById(
        'tainanHistoryFloodControlPanel'
    );

    if (panel) {
        panel.hidden = !checked;
    }

    if (!checked) {
        setTainanHistoryFloodActiveLayersEnabled(false);
        syncTainanHistoryFloodState();
        return;
    }

    setTainanHistoryFloodActiveLayersEnabled(true);

    if (!tainanHistoryFloodEvents.length) {
        loadTainanHistoryFloodEvents();
    } else {
        applyTainanHistoryFloodEventFilter();
    }

    syncTainanHistoryFloodState();
}

function changeTainanHistoryFloodDataset() {
    syncTainanHistoryFloodDatasetPicker();

    var toggleEl = document.getElementById(
        'tainanHistoryFloodToggle'
    );

    var isEnabled = !!(toggleEl && toggleEl.checked);

    setTainanHistoryFloodActiveLayersEnabled(false);

    loadTainanHistoryFloodEvents()
        .then(function() {
            if (isEnabled && toggleEl && toggleEl.checked) {
                setTainanHistoryFloodActiveLayersEnabled(true);
                applyTainanHistoryFloodEventFilter();
            }

            syncTainanHistoryFloodState();
        });
}

function updateTainanHistoryFloodOpacity(value) {
    var opacity = parseFloat(value);

    var valueEl = document.getElementById(
        'tainanHistoryFloodOpacityValue'
    );

    if (valueEl) {
        valueEl.textContent =
            Math.round(opacity * 100) + '%';
    }

    Object.keys(tainanHistoryFloodLayers).forEach(
        function(datasetId) {
            tainanHistoryFloodLayers[datasetId].setOpacity(opacity);
        }
    );
}

document.addEventListener('change', function(event) {
    var input = event.target;

    if (
        !input ||
        !input.classList.contains(
            'tainan-history-event-toggle'
        )
    ) {
        return;
    }

    var index = Number(input.dataset.eventIndex);
    var entry = tainanHistoryFloodEvents[index];

    if (!entry) return;

    tainanHistoryFloodUserHasChangedSelection = true;

    setTainanHistoryFloodEventSelected(entry, input.checked);
    syncTainanHistoryFloodSelectedValues();

    applyTainanHistoryFloodEventFilter();
});

document.getElementById(
    'tainanHistoryFloodShowAll'
).addEventListener('click', function() {
    tainanHistoryFloodUserHasChangedSelection = true;
    selectAllTainanHistoryFloodEventsInCurrentDataset();
    applyTainanHistoryFloodEventFilter();
});

document.getElementById(
    'tainanHistoryFloodHideAll'
).addEventListener('click', function() {
    tainanHistoryFloodUserHasChangedSelection = true;

    tainanHistoryFloodEvents.forEach(function(entry) {
        setTainanHistoryFloodEventSelected(entry, false);
    });

    syncTainanHistoryFloodSelectedValues();
    applyTainanHistoryFloodEventFilter();
});

map.on('zoomend', function() {
    syncTainanHistoryFloodState();
});

/* ===== START: HISTORY_FLOOD_EARLY_ALL_SOURCE_PREFETCH ===== */
function prefetchTainanHistoryFloodWhenIdle() {
    var selectedId = getTainanHistoryFloodSelectedId();
    var datasetIds = TAINAN_HISTORY_FLOOD_SOURCE_DATASET_IDS.slice();

    if (selectedId !== 'history_all') {
        datasetIds.sort(function(a, b) {
            return (a === selectedId ? -1 : 0) -
                (b === selectedId ? -1 : 0);
        });
    }

    datasetIds.forEach(function(datasetId, index) {
        window.setTimeout(function() {
            prefetchTainanHistoryFloodDataset(datasetId)
                .catch(function() {
                    /* Each source can fail independently without affecting other features. */
                });
        }, index * 80);
    });
}

if ((document.readyState === 'loading' || window.__ssDCL === false)) {
    document.addEventListener(
        'DOMContentLoaded',
        function() {
            window.setTimeout(prefetchTainanHistoryFloodWhenIdle, 120);
        },
        { once: true }
    );
} else {
    window.setTimeout(prefetchTainanHistoryFloodWhenIdle, 120);
}
/* ===== END: HISTORY_FLOOD_EARLY_ALL_SOURCE_PREFETCH ===== */



/* ===== START: NIMBY_FACILITY_LAYER_V1_SCRIPT ===== */
/*
 * COM_012 查詢鄰避設施（國土測繪中心開放 API）
 * 預設直接使用公開端點；若部署環境的 CSP 或瀏覽器 CORS 策略阻擋跨網域請求，
 * 可在此程式之前設定 window.HAIDIAN_NIMBY_FACILITY_CONFIG.endpointBase 為同源代理端點。
 * 同源代理須接受 {lng}/{lat}/{radius} 路徑段，並回傳原始 JSON 陣列。
 */
if (!map.getPane('nimbyFacilityPane')) {
    map.createPane('nimbyFacilityPane');
}
map.getPane('nimbyFacilityPane').style.zIndex = 362;
map.getPane('nimbyFacilityPane').style.pointerEvents = 'auto';

var NIMBY_FACILITY_DEFAULT_CONFIG = {
    endpointBase: 'https://api.nlsc.gov.tw/other/MarkBufferAnlys/dis',
    sourceLabel: '國土測繪中心 COM_012 查詢鄰避設施',
    maxRadius: 5000
};
var nimbyFacilityConfig = Object.assign(
    {},
    NIMBY_FACILITY_DEFAULT_CONFIG,
    window.HAIDIAN_NIMBY_FACILITY_CONFIG || {}
);
var nimbyFacilityEnabled = false;
var nimbyFacilityLayer = null;
var nimbyFacilityCenterLayer = null;
var nimbyFacilityQueryCenter = null;
var nimbyFacilityPickMode = false;
var nimbyFacilityRequestId = 0;
var nimbyFacilityAbortController = null;
var nimbyFacilityRows = [];

function getNimbyFacilityElement(id) {
    return document.getElementById(id);
}

function escapeNimbyFacilityHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function(character) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#039;',
            '"': '&quot;'
        }[character];
    });
}

function setNimbyFacilityState(text, warning) {
    var state = getNimbyFacilityElement('nimbyFacilityState');
    if (!state) return;
    state.textContent = text;
    state.classList.toggle('is-warning', !!warning);
}

function setNimbyFacilityResults(title, detail) {
    var root = getNimbyFacilityElement('nimbyFacilityResults');
    if (!root) return;
    root.innerHTML = '<strong>' + escapeNimbyFacilityHtml(title) + '</strong><span>' +
        escapeNimbyFacilityHtml(detail || '') + '</span>';
}

function getNimbyFacilityRadius() {
    var field = getNimbyFacilityElement('nimbyFacilityRadius');
    var requested = Number(field ? field.value : 1000);
    if (!Number.isFinite(requested) || requested <= 0) requested = 1000;
    return Math.min(Math.round(requested), Number(nimbyFacilityConfig.maxRadius) || 5000);
}

function getNimbyFacilityQueryCenter() {
    return nimbyFacilityQueryCenter || map.getCenter();
}

function setNimbyFacilityQueryInfo(latlng, radius) {
    var hint = getNimbyFacilityElement('nimbyFacilityHint');
    var info = getNimbyFacilityElement('nimbyFacilityQueryInfo');
    if (!latlng) {
        if (hint) hint.textContent = '以目前地圖中心查詢';
        if (info) info.textContent = '查詢中心：尚未設定';
        return;
    }

    var text = latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5) + '｜' + radius + ' m';
    if (hint) hint.textContent = '已顯示最近一次查詢結果';
    if (info) info.textContent = '查詢中心：' + text;
}

function getNimbyFacilityLayer() {
    if (nimbyFacilityLayer) return nimbyFacilityLayer;

    nimbyFacilityLayer = L.layerGroup([], {
        pane: 'nimbyFacilityPane'
    });
    return nimbyFacilityLayer;
}

function getNimbyFacilityCenterLayer() {
    if (nimbyFacilityCenterLayer) return nimbyFacilityCenterLayer;

    nimbyFacilityCenterLayer = L.layerGroup([], {
        pane: 'nimbyFacilityPane'
    });
    return nimbyFacilityCenterLayer;
}

function clearNimbyFacilityMapLayers() {
    getNimbyFacilityLayer().clearLayers();
    getNimbyFacilityCenterLayer().clearLayers();
}

function getNimbyFacilityPopupHtml(row) {
    var title = escapeNimbyFacilityHtml(row.name || row.sname || '鄰避設施');
    var shortName = escapeNimbyFacilityHtml(row.sname || '—');
    var address = escapeNimbyFacilityHtml(row.addr || '未提供地址');
    var phone = escapeNimbyFacilityHtml(row.tel || '未提供電話');
    var markType = escapeNimbyFacilityHtml(row.marktype || '未提供');
    var recordId = escapeNimbyFacilityHtml(row.id || '未提供');
    var distanceValue = Number(row.distance);
    var distance = Number.isFinite(distanceValue) ? Math.round(distanceValue) + ' m' : '—';

    return '<article class="nimby-popup-card">' +
        '<header class="nimby-popup-top">' +
            '<span class="nimby-popup-glyph" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"></path><path d="M5 20V10l7-5 7 5v10"></path><path d="M9 20v-5h6v5"></path></svg>' +
            '</span>' +
            '<div><span class="nimby-popup-kicker">NIMBY FACILITY</span><h3 class="nimby-popup-title">' + title + '</h3></div>' +
        '</header>' +
        '<div class="nimby-popup-body">' +
            '<div class="nimby-popup-metrics">' +
                '<div class="nimby-popup-address">' + address + '</div>' +
                '<div class="nimby-popup-distance"><strong>' + distance + '</strong><span>距離</span></div>' +
            '</div>' +
            '<dl class="nimby-popup-grid">' +
                '<div class="nimby-popup-data"><dt>簡稱</dt><dd>' + shortName + '</dd></div>' +
                '<div class="nimby-popup-data"><dt>電話</dt><dd>' + phone + '</dd></div>' +
                '<div class="nimby-popup-data"><dt>設施類別</dt><dd>' + markType + '</dd></div>' +
                '<div class="nimby-popup-data"><dt>資料識別碼</dt><dd>' + recordId + '</dd></div>' +
            '</dl>' +
            '<p class="nimby-popup-source">資料來源：' + escapeNimbyFacilityHtml(nimbyFacilityConfig.sourceLabel) + '</p>' +
        '</div>' +
    '</article>';
}

function renderNimbyFacilityRows(rows, center, radius) {
    clearNimbyFacilityMapLayers();

    var featureLayer = getNimbyFacilityLayer();
    var centerLayer = getNimbyFacilityCenterLayer();

    var queryCircle = L.circle(center, {
        pane: 'nimbyFacilityPane',
        radius: radius,
        color: '#fb923c',
        weight: 1.5,
        dashArray: '5 6',
        fillColor: '#fed7aa',
        fillOpacity: 0.06,
        interactive: false
    });
    var centerMarker = L.circleMarker(center, {
        pane: 'nimbyFacilityPane',
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#ea580c',
        fillOpacity: 1,
        interactive: false
    });
    centerLayer.addLayer(queryCircle);
    centerLayer.addLayer(centerMarker);

    rows.forEach(function(row) {
        var lng = Number(row.lon);
        var lat = Number(row.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

        var marker = L.circleMarker([lat, lng], {
            pane: 'nimbyFacilityPane',
            radius: 7,
            color: '#7c2d12',
            weight: 2,
            fillColor: '#fb923c',
            fillOpacity: 0.92
        });
        marker.bindTooltip(String(row.name || row.sname || '鄰避設施'), {
            direction: 'top',
            offset: [0, -8],
            opacity: 0.94
        });
        marker.bindPopup(getNimbyFacilityPopupHtml(row), {
            maxWidth: 310,
            closeButton: true,
            autoPanPadding: [24, 24]
        });
        featureLayer.addLayer(marker);
    });

    if (nimbyFacilityEnabled) {
        if (!map.hasLayer(centerLayer)) map.addLayer(centerLayer);
        if (!map.hasLayer(featureLayer)) map.addLayer(featureLayer);
    }
}

function removeNimbyFacilityFromMap() {
    if (nimbyFacilityLayer && map.hasLayer(nimbyFacilityLayer)) {
        map.removeLayer(nimbyFacilityLayer);
    }
    if (nimbyFacilityCenterLayer && map.hasLayer(nimbyFacilityCenterLayer)) {
        map.removeLayer(nimbyFacilityCenterLayer);
    }
}

function buildNimbyFacilityRequestUrl(center, radius) {
    var base = String(nimbyFacilityConfig.endpointBase || NIMBY_FACILITY_DEFAULT_CONFIG.endpointBase)
        .replace(/\/+$/, '');
    return base + '/' + encodeURIComponent(center.lng.toFixed(6)) + '/' +
        encodeURIComponent(center.lat.toFixed(6)) + '/' + encodeURIComponent(radius);
}

function normalizeNimbyFacilityPayload(payload) {
    if (!Array.isArray(payload)) return [];

    return payload.filter(function(row) {
        return row && Number.isFinite(Number(row.lon)) && Number.isFinite(Number(row.lat));
    }).map(function(row) {
        return Object.assign({}, row, {
            lon: Number(row.lon),
            lat: Number(row.lat),
            distance: Number.isFinite(Number(row.distance)) ? Number(row.distance) : null
        });
    }).sort(function(a, b) {
        var aDistance = a.distance == null ? Infinity : a.distance;
        var bDistance = b.distance == null ? Infinity : b.distance;
        return aDistance - bDistance;
    });
}

function refreshNimbyFacilityQuery() {
    if (!nimbyFacilityEnabled) return;

    var center = map.getCenter();
    nimbyFacilityQueryCenter = null;
    requestNimbyFacilityQuery(center, getNimbyFacilityRadius());
}

function enableNimbyFacilityPickMode() {
    if (!nimbyFacilityEnabled) return;
    nimbyFacilityPickMode = true;
    map.getContainer().style.cursor = 'crosshair';
    setNimbyFacilityState('請點選地圖', false);
    setNimbyFacilityResults('請指定查詢中心', '請在地圖上點選位置；選定後會立即查詢鄰避設施。');
    var pickButton = getNimbyFacilityElement('nimbyFacilityPickPoint');
    if (pickButton) pickButton.textContent = '請點選地圖…';
}

function resetNimbyFacilityPickMode() {
    nimbyFacilityPickMode = false;
    map.getContainer().style.cursor = '';
    var pickButton = getNimbyFacilityElement('nimbyFacilityPickPoint');
    if (pickButton) pickButton.textContent = '點地圖指定中心';
}

function requestNimbyFacilityQuery(center, radius) {
    if (!nimbyFacilityEnabled) return Promise.resolve();

    var requestId = ++nimbyFacilityRequestId;
    var refreshButton = getNimbyFacilityElement('nimbyFacilityRefresh');
    var radiusField = getNimbyFacilityElement('nimbyFacilityRadius');

    if (nimbyFacilityAbortController && typeof nimbyFacilityAbortController.abort === 'function') {
        nimbyFacilityAbortController.abort();
    }
    nimbyFacilityAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

    if (refreshButton) refreshButton.disabled = true;
    if (radiusField) radiusField.disabled = true;
    setNimbyFacilityState('正在查詢…', false);
    setNimbyFacilityResults('正在查詢鄰避設施…', '查詢半徑 ' + radius + ' 公尺；請稍候。');

    return fetch(buildNimbyFacilityRequestUrl(center, radius), {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
        signal: nimbyFacilityAbortController ? nimbyFacilityAbortController.signal : undefined
    }).then(function(response) {
        if (!response.ok) {
            throw new Error('HTTP_' + response.status);
        }
        return response.json();
    }).then(function(payload) {
        if (requestId !== nimbyFacilityRequestId || !nimbyFacilityEnabled) return;

        nimbyFacilityRows = normalizeNimbyFacilityPayload(payload);
        nimbyFacilityQueryCenter = L.latLng(center.lat, center.lng);
        renderNimbyFacilityRows(nimbyFacilityRows, nimbyFacilityQueryCenter, radius);
        setNimbyFacilityQueryInfo(nimbyFacilityQueryCenter, radius);
        setNimbyFacilityState('已載入 ' + nimbyFacilityRows.length + ' 筆', false);
        setNimbyFacilityResults(
            nimbyFacilityRows.length ? '已顯示 ' + nimbyFacilityRows.length + ' 筆設施' : '此範圍沒有回傳設施',
            nimbyFacilityRows.length ? '點選標記可查看名稱、地址、電話、距離與設施類別代碼。' : '可改用較大的查詢半徑，或移動地圖後重新查詢。'
        );
    }).catch(function(error) {
        if (error && error.name === 'AbortError') return;
        if (requestId !== nimbyFacilityRequestId || !nimbyFacilityEnabled) return;

        nimbyFacilityRows = [];
        clearNimbyFacilityMapLayers();
        setNimbyFacilityState('查詢失敗', true);
        setNimbyFacilityResults(
            '無法讀取鄰避設施資料',
            '請確認網路連線與 API 可用性；若網站啟用跨網域限制，可設定 HAIDIAN_NIMBY_FACILITY_CONFIG.endpointBase 使用同源代理。'
        );
    }).finally(function() {
        if (requestId !== nimbyFacilityRequestId) return;
        if (refreshButton) refreshButton.disabled = false;
        if (radiusField) radiusField.disabled = false;
    });
}

function toggleNimbyFacilityLayer(enabled) {
    nimbyFacilityEnabled = !!enabled;
    var panel = getNimbyFacilityElement('nimbyFacilityControlPanel');
    if (panel) panel.hidden = !nimbyFacilityEnabled;

    resetNimbyFacilityPickMode();

    if (!nimbyFacilityEnabled) {
        removeNimbyFacilityFromMap();
        setNimbyFacilityState('圖層未啟用', false);
        return;
    }

    requestNimbyFacilityQuery(map.getCenter(), getNimbyFacilityRadius());
}

map.on('click', function(event) {
    if (!nimbyFacilityEnabled || !nimbyFacilityPickMode) return;
    resetNimbyFacilityPickMode();
    requestNimbyFacilityQuery(event.latlng, getNimbyFacilityRadius());
});
/* ===== END: NIMBY_FACILITY_LAYER_V1_SCRIPT ===== */

/* ===== START: NATIONAL_HISTORY_FLOOD_V1_SCRIPT ===== */
/*
 * 全國歷史淹水案件圖層：
 * - 預設讀取同源 GeoJSON，適合純靜態網站部署；
 * - 正式環境可在本檔案前方設定 window.HAIDIAN_NATIONAL_HISTORY_FLOOD_CONFIG.endpoint，
 *   指向同源後端 API。API 可接受 bbox / county / yearStart / yearEnd 參數並回傳 GeoJSON；
 * - API 金鑰不得放入本頁前端程式碼。水利署需認證的服務應由後端代理與快取。
 */
if (!map.getPane('nationalHistoryFloodPane')) {
    map.createPane('nationalHistoryFloodPane');
}

map.getPane('nationalHistoryFloodPane').style.zIndex = 356;
map.getPane('nationalHistoryFloodPane').style.pointerEvents = 'auto';

var NATIONAL_HISTORY_FLOOD_DEFAULT_CONFIG = {
    endpoint: './national-historical-flood.geojson',
    sourceLabel: '全國官方整合 GeoJSON',
    maxFeaturesForFit: 3000
};

var nationalHistoryFloodConfig = Object.assign(
    {},
    NATIONAL_HISTORY_FLOOD_DEFAULT_CONFIG,
    window.HAIDIAN_NATIONAL_HISTORY_FLOOD_CONFIG || {}
);

var nationalHistoryFloodRawFeatures = [];
var nationalHistoryFloodFilteredFeatures = [];
var nationalHistoryFloodLayer = null;
var nationalHistoryFloodEnabled = false;
var nationalHistoryFloodLoaded = false;
var nationalHistoryFloodManualSource = false;
var nationalHistoryFloodRequestId = 0;
var nationalHistoryFloodLastLoadError = null;

function escapeNationalHistoryFloodHtml(value) {
    return String(value == null ? '' : value)
        .replace(/[&<>'"]/g, function(character) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#039;',
                '"': '&quot;'
            }[character];
        });
}

function getNationalHistoryFloodElement(id) {
    return document.getElementById(id);
}

function setNationalHistoryFloodState(text, warning) {
    var state = getNationalHistoryFloodElement('nationalHistoryFloodState');
    if (!state) return;
    state.textContent = text;
    state.classList.toggle('is-warning', !!warning);
}

function setNationalHistoryFloodResults(title, detail) {
    var root = getNationalHistoryFloodElement('nationalHistoryFloodResults');
    if (!root) return;
    root.innerHTML = '<div><strong>' +
        escapeNationalHistoryFloodHtml(title) +
        '</strong><span>' +
        escapeNationalHistoryFloodHtml(detail || '') +
        '</span></div>';
}

function getNationalFloodProperty(props, aliases) {
    var source = props || {};
    var keys = Object.keys(source);

    for (var i = 0; i < aliases.length; i++) {
        var wanted = aliases[i];
        if (source[wanted] !== undefined && source[wanted] !== null) {
            return source[wanted];
        }

        var match = keys.find(function(key) {
            return String(key).toLowerCase() ===
                String(wanted).toLowerCase();
        });

        if (match && source[match] !== undefined && source[match] !== null) {
            return source[match];
        }
    }

    return '';
}

function getNationalFloodFeatureYear(feature) {
    var props = feature && feature.properties ? feature.properties : {};
    var direct = getNationalFloodProperty(props, [
        'year', 'YEAR', '年份', '資料年度', '事件年度', 'FLOOD_YEAR'
    ]);
    var matched = String(direct || '').match(/(?:19|20)\d{2}/);
    if (matched) return Number(matched[0]);

    var dateValue = getNationalFloodProperty(props, [
        'event_date', 'date', 'DATE', '時間', '淹水時間', 'TIME',
        'start_time', 'START_TIME', '災害日期'
    ]);
    matched = String(dateValue || '').match(/(?:19|20)\d{2}/);
    return matched ? Number(matched[0]) : null;
}

function normaliseNationalFloodFeature(feature) {
    if (!feature || typeof feature !== 'object') return null;

    var normalised = {
        type: 'Feature',
        properties: Object.assign({}, feature.properties || {}),
        geometry: feature.geometry || null
    };

    if (!normalised.geometry) {
        var longitude = Number(getNationalFloodProperty(normalised.properties, [
            'longitude', 'lng', 'lon', 'X', '經度', 'LONGITUDE'
        ]));
        var latitude = Number(getNationalFloodProperty(normalised.properties, [
            'latitude', 'lat', 'Y', '緯度', 'LATITUDE'
        ]));

        if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
            normalised.geometry = {
                type: 'Point',
                coordinates: [longitude, latitude]
            };
        }
    }

    if (!normalised.geometry || !normalised.geometry.type) return null;
    return normalised;
}

function normaliseNationalFloodGeoJson(payload) {
    var features = [];

    if (payload && payload.type === 'FeatureCollection') {
        features = payload.features || [];
    } else if (payload && payload.type === 'Feature') {
        features = [payload];
    } else if (Array.isArray(payload)) {
        features = payload;
    } else if (payload && Array.isArray(payload.features)) {
        features = payload.features;
    }

    return features
        .map(normaliseNationalFloodFeature)
        .filter(function(feature) { return !!feature; });
}

function getNationalHistoryFloodFilterState() {
    var county = getNationalHistoryFloodElement('nationalHistoryFloodCounty');
    var start = getNationalHistoryFloodElement('nationalHistoryFloodYearStart');
    var end = getNationalHistoryFloodElement('nationalHistoryFloodYearEnd');
    var boundsOnly = getNationalHistoryFloodElement('nationalHistoryFloodMapBoundsOnly');

    return {
        county: county ? county.value : '',
        yearStart: start && start.value ? Number(start.value) : null,
        yearEnd: end && end.value ? Number(end.value) : null,
        boundsOnly: !!(boundsOnly && boundsOnly.checked)
    };
}

function buildNationalHistoryFloodRequestUrl() {
    var endpoint = nationalHistoryFloodConfig.endpoint ||
        NATIONAL_HISTORY_FLOOD_DEFAULT_CONFIG.endpoint;
    var url = new URL(endpoint, window.location.href);
    var filters = getNationalHistoryFloodFilterState();
    var bounds = map.getBounds();

    url.searchParams.set('west', bounds.getWest().toFixed(6));
    url.searchParams.set('south', bounds.getSouth().toFixed(6));
    url.searchParams.set('east', bounds.getEast().toFixed(6));
    url.searchParams.set('north', bounds.getNorth().toFixed(6));
    if (filters.county) url.searchParams.set('county', filters.county);
    if (filters.yearStart) url.searchParams.set('yearStart', filters.yearStart);
    if (filters.yearEnd) url.searchParams.set('yearEnd', filters.yearEnd);
    return url.toString();
}

function normaliseNationalFloodCountyName(value) {
    return String(value == null ? '' : value)
        .trim()
        .replace(/台/g, '臺');
}

function getNationalFloodFeatureCounty(feature) {
    var props = feature && feature.properties ? feature.properties : {};
    return normaliseNationalFloodCountyName(getNationalFloodProperty(props, [
        'county', 'COUNTY', 'COUNTY_NAME', '縣市', '縣市名稱', '縣市別'
    ]));
}

function nationalFloodFeaturePassesFilters(feature, filters, bounds) {
    var year = getNationalFloodFeatureYear(feature);
    var county = getNationalFloodFeatureCounty(feature);
    var requestedCounty = normaliseNationalFloodCountyName(filters.county);

    if (requestedCounty && county && county !== requestedCounty) return false;
    if (requestedCounty && !county) return false;
    if (filters.yearStart && year && year < filters.yearStart) return false;
    if (filters.yearEnd && year && year > filters.yearEnd) return false;

    if (filters.boundsOnly && bounds) {
        try {
            if (feature.geometry && feature.geometry.type === 'Point') {
                var coords = feature.geometry.coordinates || [];
                if (!bounds.contains([coords[1], coords[0]])) return false;
            }
        } catch (error) {
            return false;
        }
    }

    return true;
}

function getNationalFloodFeatureLabel(feature) {
    var props = feature && feature.properties ? feature.properties : {};
    var eventName = getNationalFloodProperty(props, [
        'event_name', 'EVENT_NAME', '災害事件', '事件名稱', 'event', 'EVENT'
    ]);
    var location = getNationalFloodProperty(props, [
        'location', 'LOCATION', '位置', '地址', '地點'
    ]);
    var year = getNationalFloodFeatureYear(feature);

    if (eventName) return String(eventName);
    if (location) return (year ? year + ' ' : '') + String(location);
    return year ? year + ' 歷史淹水案件' : '歷史淹水案件';
}

function getNationalFloodPopupHtml(feature) {
    var props = feature && feature.properties ? feature.properties : {};
    var fields = [
        ['事件', getNationalFloodProperty(props, ['event_name','EVENT_NAME','災害事件','事件名稱','event','EVENT'])],
        ['縣市', getNationalFloodFeatureCounty(feature)],
        ['鄉鎮市區', getNationalFloodProperty(props, ['town','TOWN','TOWN_NAME','鄉鎮市區','行政區'])],
        ['位置', getNationalFloodProperty(props, ['location','LOCATION','位置','地址','地點'])],
        ['發生時間', getNationalFloodProperty(props, ['event_date','date','DATE','時間','淹水時間','TIME','start_time','START_TIME','災害日期'])],
        ['退水時間', getNationalFloodProperty(props, ['receded_date','RECEDEDDATE','退水時間','end_time','END_TIME'])],
        ['最高淹水深度', getNationalFloodProperty(props, ['depth_cm','DEPTH_MAX','最大深度','最高淹水深度','depth'])],
        ['資料來源', getNationalFloodProperty(props, ['source','SOURCE','資料來源','source_name'])]
    ].filter(function(row) {
        return row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '';
    });

    var body = '<div class="national-history-flood-popup">' +
        '<strong style="display:block;margin-bottom:8px;color:#0f172a;font-size:14px;line-height:1.35;">' +
        escapeNationalHistoryFloodHtml(getNationalFloodFeatureLabel(feature)) +
        '</strong>';

    if (fields.length) {
        body += '<dl style="display:grid;grid-template-columns:74px 1fr;gap:5px 8px;margin:0;color:#334155;font-size:12px;line-height:1.45;">';
        fields.forEach(function(row) {
            body += '<dt style="font-weight:800;color:#64748b;">' +
                escapeNationalHistoryFloodHtml(row[0]) +
                '</dt><dd style="margin:0;overflow-wrap:anywhere;font-weight:650;">' +
                escapeNationalHistoryFloodHtml(row[1]) + '</dd>';
        });
        body += '</dl>';
    } else {
        body += '<p style="margin:0;color:#64748b;font-size:12px;">此筆 GeoJSON 未提供可顯示的屬性欄位。</p>';
    }

    return body + '</div>';
}

function createNationalHistoryFloodLayer() {
    if (nationalHistoryFloodLayer) return nationalHistoryFloodLayer;

    nationalHistoryFloodLayer = L.geoJSON(null, {
        pane: 'nationalHistoryFloodPane',
        pointToLayer: function(feature, latlng) {
            return L.circleMarker(latlng, {
                pane: 'nationalHistoryFloodPane',
                radius: 6,
                color: '#ffffff',
                weight: 2,
                fillColor: '#0369a1',
                fillOpacity: 0.9
            });
        },
        style: function() {
            return {
                pane: 'nationalHistoryFloodPane',
                color: '#0369a1',
                weight: 2,
                fillColor: '#38bdf8',
                fillOpacity: 0.28
            };
        },
        onEachFeature: function(feature, layer) {
            layer.bindPopup(getNationalFloodPopupHtml(feature), {
                maxWidth: 300,
                closeButton: true,
                autoPanPadding: [24, 24]
            });
        }
    });

    return nationalHistoryFloodLayer;
}

function renderNationalHistoryFloodLayer() {
    var layer = createNationalHistoryFloodLayer();
    layer.clearLayers();

    if (nationalHistoryFloodEnabled && nationalHistoryFloodFilteredFeatures.length) {
        layer.addData({
            type: 'FeatureCollection',
            features: nationalHistoryFloodFilteredFeatures
        });
    }

    if (nationalHistoryFloodEnabled && !map.hasLayer(layer)) {
        map.addLayer(layer);
    }

    if (!nationalHistoryFloodEnabled && map.hasLayer(layer)) {
        map.removeLayer(layer);
    }
}

function syncNationalHistoryFloodSummary() {
    var hint = getNationalHistoryFloodElement('nationalHistoryFloodHint');
    var rawCount = nationalHistoryFloodRawFeatures.length;
    var visibleCount = nationalHistoryFloodFilteredFeatures.length;
    var filters = getNationalHistoryFloodFilterState();
    var hasData = rawCount > 0;

    if (!nationalHistoryFloodEnabled) {
        setNationalHistoryFloodState('圖層未啟用', false);
        if (hint) hint.textContent = hasData ? '已暫存 ' + rawCount + ' 件官方案件' : '待載入官方整合資料';
        return;
    }

    if (!hasData) {
        setNationalHistoryFloodState(
            nationalHistoryFloodLastLoadError ? '資料尚未部署' : '尚無符合條件案件',
            !!nationalHistoryFloodLastLoadError
        );
        if (hint) hint.textContent = nationalHistoryFloodLastLoadError ? '可匯入已核定 GeoJSON 測試' : '未找到符合目前篩選的案件';
        return;
    }

    setNationalHistoryFloodState('已載入 ' + visibleCount + ' / ' + rawCount + ' 件', false);
    if (hint) {
        hint.textContent = (filters.county || '全國') + '｜' +
            (filters.yearStart || '不限') + '–' +
            (filters.yearEnd || '不限') +
            (filters.boundsOnly ? '｜目前範圍' : '');
    }
}

function applyNationalHistoryFloodFilters() {
    var filters = getNationalHistoryFloodFilterState();
    var bounds = filters.boundsOnly ? map.getBounds() : null;

    nationalHistoryFloodFilteredFeatures = nationalHistoryFloodRawFeatures.filter(
        function(feature) {
            return nationalFloodFeaturePassesFilters(feature, filters, bounds);
        }
    );

    renderNationalHistoryFloodLayer();

    if (nationalHistoryFloodRawFeatures.length) {
        setNationalHistoryFloodResults(
            '已顯示 ' + nationalHistoryFloodFilteredFeatures.length + ' / ' + nationalHistoryFloodRawFeatures.length + ' 件案件',
            '資料來源：' + (nationalHistoryFloodManualSource ? '本次匯入 GeoJSON' : nationalHistoryFloodConfig.sourceLabel) + '。點選圖徵可查看事件、位置與資料來源欄位。'
        );
    }

    syncNationalHistoryFloodSummary();
}

function applyNationalHistoryFloodPayload(payload, sourceLabel, manual) {
    nationalHistoryFloodRawFeatures = normaliseNationalFloodGeoJson(payload);
    nationalHistoryFloodLoaded = true;
    nationalHistoryFloodManualSource = !!manual;
    nationalHistoryFloodLastLoadError = null;

    if (sourceLabel) {
        nationalHistoryFloodConfig.sourceLabel = sourceLabel;
    }

    applyNationalHistoryFloodFilters();

    if (!nationalHistoryFloodRawFeatures.length) {
        setNationalHistoryFloodResults(
            '尚無已發布案件',
            '資料檔已讀取，但目前沒有可呈現的 GeoJSON 圖徵。請確認資料已轉成 WGS84（EPSG:4326）並包含 FeatureCollection。'
        );
    }
}

function refreshNationalHistoryFloodData() {
    if (nationalHistoryFloodManualSource && nationalHistoryFloodLoaded) {
        applyNationalHistoryFloodFilters();
        return Promise.resolve();
    }

    var requestId = ++nationalHistoryFloodRequestId;
    var url = buildNationalHistoryFloodRequestUrl();

    setNationalHistoryFloodState('正在載入官方資料…', false);
    setNationalHistoryFloodResults('正在載入案件…', '已套用目前的縣市、年份與地圖範圍條件。');

    return fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/geo+json, application/json' }
    })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('HTTP_' + response.status);
            }
            return response.json();
        })
        .then(function(payload) {
            if (requestId !== nationalHistoryFloodRequestId) return;
            applyNationalHistoryFloodPayload(
                payload,
                nationalHistoryFloodConfig.sourceLabel,
                false
            );
        })
        .catch(function(error) {
            if (requestId !== nationalHistoryFloodRequestId) return;
            nationalHistoryFloodLastLoadError = error;
            nationalHistoryFloodRawFeatures = [];
            nationalHistoryFloodFilteredFeatures = [];
            renderNationalHistoryFloodLayer();
            setNationalHistoryFloodState('資料尚未部署', true);
            setNationalHistoryFloodResults(
                '無法讀取全國整合資料',
                '請在網站同層部署 national-historical-flood.geojson，或將 HAIDIAN_NATIONAL_HISTORY_FLOOD_CONFIG.endpoint 設為同源後端 API。'
            );
            syncNationalHistoryFloodSummary();
        });
}

function toggleNationalHistoryFloodLayer(enabled) {
    nationalHistoryFloodEnabled = !!enabled;
    var panel = getNationalHistoryFloodElement('nationalHistoryFloodControlPanel');
    if (panel) panel.hidden = !nationalHistoryFloodEnabled;

    if (nationalHistoryFloodEnabled && !nationalHistoryFloodLoaded) {
        refreshNationalHistoryFloodData();
    } else {
        applyNationalHistoryFloodFilters();
    }
}

function fitNationalHistoryFloodLayer() {
    if (!nationalHistoryFloodFilteredFeatures.length) {
        setNationalHistoryFloodResults('尚無可縮放結果', '先載入或匯入至少一筆含座標的歷史淹水案件。');
        return;
    }

    var tempLayer = L.geoJSON({
        type: 'FeatureCollection',
        features: nationalHistoryFloodFilteredFeatures.slice(
            0,
            Number(nationalHistoryFloodConfig.maxFeaturesForFit) || 3000
        )
    });

    var bounds = tempLayer.getBounds();
    if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.12), { maxZoom: 12 });
    }
}

function importNationalHistoryFloodGeoJson(files) {
    var file = files && files[0];
    if (!file) return;

    var reader = new FileReader();
    setNationalHistoryFloodState('正在讀取匯入檔…', false);

    reader.onload = function(event) {
        try {
            var payload = JSON.parse(String(event.target.result || ''));
            var features = normaliseNationalFloodGeoJson(payload);
            if (!features.length && payload && payload.type !== 'FeatureCollection') {
                throw new Error('INVALID_GEOJSON');
            }
            applyNationalHistoryFloodPayload(payload, file.name, true);
        } catch (error) {
            nationalHistoryFloodLastLoadError = error;
            setNationalHistoryFloodState('匯入格式不正確', true);
            setNationalHistoryFloodResults('GeoJSON 匯入失敗', '請使用 FeatureCollection / Feature / Feature 陣列，並確認檔案為 UTF-8 JSON。');
        }
    };

    reader.onerror = function() {
        setNationalHistoryFloodState('無法讀取檔案', true);
        setNationalHistoryFloodResults('GeoJSON 匯入失敗', '瀏覽器無法讀取這個檔案，請重新選取。');
    };

    reader.readAsText(file, 'utf-8');
}

function populateNationalHistoryFloodYearControls() {
    var start = getNationalHistoryFloodElement('nationalHistoryFloodYearStart');
    var end = getNationalHistoryFloodElement('nationalHistoryFloodYearEnd');
    if (!start || !end || start.options.length || end.options.length) return;

    var currentYear = new Date().getFullYear();
    var years = [];
    for (var year = currentYear; year >= 2000; year--) years.push(year);

    var allOption = '<option value="">不限</option>';
    var options = years.map(function(year) {
        return '<option value="' + year + '">' + year + '</option>';
    }).join('');

    start.innerHTML = allOption + options;
    end.innerHTML = allOption + options;
    start.value = '2000';
    end.value = String(currentYear);
}

function initialiseNationalHistoryFloodModule() {
    populateNationalHistoryFloodYearControls();

    map.on('moveend', function() {
        var boundsOnly = getNationalHistoryFloodElement('nationalHistoryFloodMapBoundsOnly');
        if (nationalHistoryFloodEnabled && boundsOnly && boundsOnly.checked) {
            applyNationalHistoryFloodFilters();
        }
    });
}

if ((document.readyState === 'loading' || window.__ssDCL === false)) {
    document.addEventListener('DOMContentLoaded', initialiseNationalHistoryFloodModule, { once: true });
} else {
    initialiseNationalHistoryFloodModule();
}
/* ===== END: NATIONAL_HISTORY_FLOOD_V1_SCRIPT ===== */

/* ===== END: TAINAN_HISTORY_FLOOD_V5_SCRIPT ===== */

        function getGeoJsonUrls(path) {
            if (path.startsWith('./') || path.startsWith('http')) {
                return [path];
            }
            return [
                gisWorkerBaseUrl + path,
                gisHfBaseUrl + path
            ];
        }

        async function fetchGeoJsonWithFallback(path) {
            if (geoJsonDataCache[path]) {
                return geoJsonDataCache[path];
            }

            var urls = getGeoJsonUrls(path);
            var lastError = null;

            for (var i = 0; i < urls.length; i++) {
                var url = urls[i];

                try {
                    var res = await fetch(url, {
                        method: 'GET',
                        cache: 'force-cache'
                    });

                    if (!res.ok) {
                        throw new Error('HTTP ' + res.status + '：' + url);
                    }

                    var text = await res.text();
                    var trimmed = text.trim();

                    if (!trimmed.startsWith('{')) {
                        throw new Error('不是 JSON / GeoJSON：' + url);
                    }

                    var data = JSON.parse(trimmed);

                    if (!data || data.type !== 'FeatureCollection') {
                        throw new Error('不是 FeatureCollection：' + url);
                    }

                    geoJsonDataCache[path] = data;
                    return data;
                } catch (err) {
                    lastError = err;
                    console.warn('GeoJSON 來源失敗，準備改用下一個來源：', err);
                }
            }

            throw lastError || new Error('GeoJSON 載入失敗：' + path);
        }

        function createManagedGeoJsonLayer(options) {
            var currentOpacity = options.opacity || 0.55;

            var layer = L.geoJSON(null, {
                pane: options.pane,
                renderer: geoJsonRenderer,

                style: function(feature) {
                    if (options.kind === 'flood') {
                        return getFloodFeatureStyle(feature, currentOpacity);
                    }

                    return getHydrologyFeatureStyle(options.meta, currentOpacity);
                },

                pointToLayer: function(feature, latlng) {
                    var meta = options.meta || {};
                    return L.circleMarker(latlng, {
                        pane: options.pane,
                        renderer: geoJsonRenderer,
                        radius: meta.pointRadius || 5,
                        color: meta.color || '#dc2626',
                        weight: meta.weight || 1,
                        opacity: currentOpacity,
                        fillColor: meta.fillColor || meta.color || '#dc2626',
                        fillOpacity: currentOpacity * (meta.fillOpacityRatio || 0.8)
                    });
                },

                                onEachFeature: function(feature, featureLayer) {
                    if (!feature || !feature.properties) return;

                    var props = feature.properties;

                    if (options.kind === 'flood') {
                        var depthInfo = getFloodDepthInfo(feature);
                        var floodTitle = options.label || '淹水潛勢圖';

                        var floodHtml = `
                            <div style="font-size:12px; line-height:1.6; max-width:260px;">
                                <div style="font-weight:900; color:#92400e; margin-bottom:6px;">${escapeGISHtml(floodTitle)}</div>
                                <div style="font-size:14px; font-weight:900; color:#7c2d12;">
                                    淹水深度：${escapeGISHtml(depthInfo.label)}
                                </div>
                            </div>
                        `;

                        featureLayer.bindPopup(floodHtml);

                        featureLayer.bindTooltip(depthInfo.label, {
                            sticky: true,
                            direction: 'top',
                            className: 'flood-depth-tooltip'
                        });

                        return;
                    }

                    var title =
                        props.NAME ||
                        props.Name ||
                        props.name ||
                        props.COUNTYNAME ||
                        props.TOWNNAME ||
                        options.label ||
                        '圖資屬性';

                    var html = '<div style="font-size:12px; line-height:1.6; max-width:260px;">';
                    html += '<div style="font-weight:900; color:#0f172a; margin-bottom:6px;">' + escapeGISHtml(title) + '</div>';

                    Object.keys(props).slice(0, 10).forEach(function(key) {
                        var value = props[key];
                        if (value === null || value === undefined || value === '') return;
                        html += '<div><b>' + escapeGISHtml(key) + '</b>：' + escapeGISHtml(value) + '</div>';
                    });

                    html += '</div>';

                    featureLayer.bindPopup(html);
                }
            });

            layer.__loaded = false;
            layer.__loading = false;
            layer.__loadError = null;

            layer.setOpacity = function(opacityValue) {
                currentOpacity = parseFloat(opacityValue);

                layer.eachLayer(function(child) {
                    if (child.setStyle) {
                        if (options.kind === 'flood') {
                            child.setStyle(getFloodFeatureStyle(child.feature, currentOpacity));
                        } else {
                            child.setStyle(getHydrologyFeatureStyle(options.meta, currentOpacity));
                        }
                    }
                });
            };

            layer.loadData = async function() {
                if (layer.__loaded || layer.__loading) return layer;

                layer.__loading = true;

                try {
                    var data = await fetchGeoJsonWithFallback(options.path);
                    layer.addData(data);
                    layer.setOpacity(currentOpacity);
                    layer.__loaded = true;
                    layer.__loadError = null;
                } catch (err) {
                    layer.__loadError = err;
                    console.error('圖資載入失敗：', options.label, err);
                    alert('⚠️ 圖資載入失敗：' + options.label + '\n\n請稍後再試，或檢查 Hugging Face / Worker 檔案路徑。');
                } finally {
                    layer.__loading = false;
                }

                return layer;
            };

            return layer;
        }

        function escapeGISHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getHydrologyFeatureStyle(meta, opacityValue) {
            meta = meta || {};
            return {
                color: meta.color || '#0f766e',
                weight: meta.weight || 1,
                opacity: opacityValue,
                fillColor: meta.fillColor || meta.color || '#99f6e4',
                fillOpacity: opacityValue * (meta.fillOpacityRatio || 0.35)
            };
        }

                function getFloodDepthInfo(feature) {
            var props = feature && feature.properties ? feature.properties : {};

            var explicitKeys = [
                'flood_dept',
                'FLOOD_DEPT',
                'flood_depth',
                'FLOOD_DEPTH',
                'FloodDepth',
                'Class',
                'class',
                'DEPTH',
                'Depth',
                'depth',
                'DEPTH_M',
                'DEPTHM',
                'FLOODDEPTH',
                'FLOOD_DEPTH',
                'FLD_DEPTH',
                '淹水深度',
                '水深',
                '深度',
                '淹水深',
                'gridcode',
                'GRIDCODE',
                'VALUE',
                'Value',
                'value',
                'DN'
            ];

            // 1. 先找常見欄位
            for (var i = 0; i < explicitKeys.length; i++) {
                var key = explicitKeys[i];
                if (props[key] !== null && props[key] !== undefined && props[key] !== '') {
                    var info = parseFloodDepthValue(props[key]);
                    if (info) return info;
                }
            }

            // 2. 如果欄位名稱不明，就掃描所有屬性值，找像「0.5-1.0公尺」的字串
            var propKeys = Object.keys(props);
            for (var j = 0; j < propKeys.length; j++) {
                var value = props[propKeys[j]];
                var text = String(value || '');

                if (
                    text.indexOf('公尺') !== -1 ||
                    text.indexOf('m') !== -1 ||
                    /^\s*\d+(\.\d+)?\s*[-~－–]\s*\d+(\.\d+)?/.test(text) ||
                    /^\s*\d+(\.\d+)?\s*以上/.test(text) ||
                    /^\s*小於\s*\d+(\.\d+)?/.test(text)
                ) {
                    var scannedInfo = parseFloodDepthValue(text);
                    if (scannedInfo) return scannedInfo;
                }
            }

            return {
                min: 0,
                max: 0,
                avg: 0,
                label: '淹水潛勢區'
            };
        }

        function parseFloodDepthValue(rawValue) {
            if (rawValue === null || rawValue === undefined || rawValue === '') return null;

            var text = String(rawValue).trim()
                .replace(/ｍ/g, 'm')
                .replace(/公尺/g, 'm')
                .replace(/米/g, 'm')
                .replace(/－/g, '-')
                .replace(/–/g, '-')
                .replace(/~/g, '-')
                .replace(/～/g, '-');

            // 例如：0.5-1.0m
            var rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
            if (rangeMatch) {
                var min = parseFloat(rangeMatch[1]);
                var max = parseFloat(rangeMatch[2]);
                return {
                    min: min,
                    max: max,
                    avg: (min + max) / 2,
                    label: min + '-' + max + ' 公尺'
                };
            }

            // 例如：3.0m以上、3以上
            var aboveMatch = text.match(/(\d+(?:\.\d+)?)\s*m?\s*以上/);
            if (aboveMatch) {
                var above = parseFloat(aboveMatch[1]);
                return {
                    min: above,
                    max: null,
                    avg: above,
                    label: above + ' 公尺以上'
                };
            }

            // 例如：小於0.3m
            var belowMatch = text.match(/小於\s*(\d+(?:\.\d+)?)/);
            if (belowMatch) {
                var below = parseFloat(belowMatch[1]);
                return {
                    min: 0,
                    max: below,
                    avg: below / 2,
                    label: '小於 ' + below + ' 公尺'
                };
            }

            // 純數字：可能是水深，也可能是分級代碼
            var numeric = parseFloat(text.replace(/[^\d.\-]/g, ''));
            if (!isNaN(numeric)) {
                // 常見淹水潛勢分級代碼，保守轉成深度區間
                if (/^\s*[1-5]\s*$/.test(text)) {
                    var codeMap = {
                        1: { min: 0, max: 0.3, avg: 0.15, label: '0-0.3 公尺' },
                        2: { min: 0.3, max: 0.5, avg: 0.4, label: '0.3-0.5 公尺' },
                        3: { min: 0.5, max: 1.0, avg: 0.75, label: '0.5-1.0 公尺' },
                        4: { min: 1.0, max: 2.0, avg: 1.5, label: '1.0-2.0 公尺' },
                        5: { min: 2.0, max: null, avg: 2.5, label: '2.0 公尺以上' }
                    };
                    return codeMap[numeric];
                }

                return {
                    min: numeric,
                    max: numeric,
                    avg: numeric,
                    label: numeric + ' 公尺'
                };
            }

            return null;
        }

                var FLOOD_DEPTH_STYLE_STOPS = [
            {
                min: 3,
                color: "#991b1b",
                label: "3 公尺以上"
            },
            {
                min: 2,
                color: "#dc2626",
                label: "2 至未滿 3 公尺"
            },
            {
                min: 1,
                color: "#f97316",
                label: "1 至未滿 2 公尺"
            },
            {
                min: 0.5,
                color: "#f59e0b",
                label: "0.5 至未滿 1 公尺"
            },
            {
                min: 0.3,
                color: "#facc15",
                label: "0.3 至未滿 0.5 公尺"
            },
            {
                min: 0,
                color: "#fef08a",
                label: "0 至未滿 0.3 公尺"
            }
        ];

        function getFloodColorByDepth(depthInfo) {
            var depth =
                depthInfo &&
                Number.isFinite(depthInfo.avg)
                    ? depthInfo.avg
                    : 0;

            for (
                var i = 0;
                i < FLOOD_DEPTH_STYLE_STOPS.length;
                i++
            ) {
                if (
                    depth >=
                    FLOOD_DEPTH_STYLE_STOPS[i].min
                ) {
                    return FLOOD_DEPTH_STYLE_STOPS[i].color;
                }
            }

            return FLOOD_DEPTH_STYLE_STOPS[
                FLOOD_DEPTH_STYLE_STOPS.length - 1
            ].color;
        }

        function getFloodFeatureStyle(feature, opacityValue) {
            var depthInfo = getFloodDepthInfo(feature);

            return {
                fill: true,
                stroke: true,
                color: getFloodColorByDepth(depthInfo),
                weight: 0.15,
                opacity: 0.35,
                fillColor: getFloodColorByDepth(depthInfo),
                fillOpacity: Math.max(parseFloat(opacityValue || 0.55), 0.45)
            };
        }
        function createFloodPmtilesLayer(meta) {
            if (!window.protomapsL) {
                alert('PMTiles 圖層套件尚未載入，請檢查 protomaps-leaflet script。');
                return null;
            }

            // 🌟 終極神級優化：PMTiles 直接向 Hugging Face (AWS 全球 CDN) 請求，不經過 Cloudflare 代購員！
            // 這樣可以避免代購員因為發送太多 Range Request 而被 Hugging Face 判定為攻擊 (403 Forbidden)
            // 加上 ?v=3 強制破除瀏覽器之前記住的錯誤快取
            var pmtilesUrlObject = new URL(
                meta.pmtilesPath,
                gisHfBaseUrl
            );

            pmtilesUrlObject.searchParams.set("v", "3");

            var pmtilesUrl = pmtilesUrlObject.toString();

            var dataLayer = meta.pmtilesDataLayer || 'flood';

            return protomapsL.leafletLayer({
                url: pmtilesUrl,
                pane: 'floodPane',
                maxDataZoom: 17,
                paintRules: [
                    {
                        dataLayer: dataLayer,
                        symbolizer: new FloodPmtilesPolygonSymbolizer()
                    }
                ],
                labelRules: [
                    {
                        dataLayer: dataLayer,
                        minzoom: 14,
                        symbolizer: new FloodPmtilesDepthLabelSymbolizer()
                    }
                ]
            });
        }

class FloodPmtilesPolygonSymbolizer {
    draw(context, geom, z, feature) {
        var props = feature && feature.props ? feature.props : {};
        var depthInfo = getFloodDepthInfo({ properties: props });
        var fill = getFloodColorByDepth(depthInfo);

        context.save();
        context.fillStyle = fill;
        context.strokeStyle = fill;
        context.globalAlpha = 0.9;
        context.lineWidth = 0.35;

        context.beginPath();

        for (var poly of geom) {
            for (var p = 0; p < poly.length; p++) {
                var pt = poly[p];
                if (p === 0) {
                    context.moveTo(pt.x, pt.y);
                } else {
                    context.lineTo(pt.x, pt.y);
                }
            }
        }

        context.fill('evenodd');

        context.globalAlpha = 0.35;
        context.stroke();

        context.restore();
    }
}

class FloodPmtilesDepthLabelSymbolizer {
    place(layout, geom, feature) {
        var props = feature && feature.props ? feature.props : {};
        var depthInfo = getFloodDepthInfo({ properties: props });
        var label = depthInfo.label;

        if (!label || label === '淹水潛勢區') return [];

        var center = getPmtilesGeomCenter(geom);
        if (!center) return [];

        var font = '700 11px Arial, "Microsoft JhengHei", sans-serif';

        layout.scratch.font = font;
        var metrics = layout.scratch.measureText(label);
        var width = metrics.width + 8;
        var height = 16;

        var bbox = {
            minX: center.x - width / 2,
            minY: center.y - height / 2,
            maxX: center.x + width / 2,
            maxY: center.y + height / 2
        };

        var draw = function(ctx) {
            ctx.font = font;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.strokeText(label, 0, 0);

            ctx.fillStyle = 'rgba(100, 80, 40, 0.85)';
            ctx.fillText(label, 0, 0);
        };

        return [
            {
                anchor: center,
                bboxes: [bbox],
                draw: draw
            }
        ];
    }
}

function getPmtilesGeomCenter(geom) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var found = false;

    for (var poly of geom) {
        for (var pt of poly) {
            if (!pt) continue;

            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;

            found = true;
        }
    }

    if (!found) return null;

    return {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2
    };
}

        function getFloodSelectedId() {
            var scenarioEl = document.getElementById('floodScenario');
            return scenarioEl ? scenarioEl.value : 'flood_200mm_24hr';
        }

        function getFloodOpacityValue() {
            var opacityEl = document.getElementById('floodOpacity');
            return opacityEl ? parseFloat(opacityEl.value) : 0.55;
        }

        function ensureFloodLayer() {
    var selectedId = getFloodSelectedId();
    var meta = floodScenarioMeta[selectedId] || floodScenarioMeta['flood_200mm_24hr'];

    if (!currentFloodLayer || currentFloodLayerId !== selectedId) {
        if (currentFloodLayer && map.hasLayer(currentFloodLayer)) {
            map.removeLayer(currentFloodLayer);
        }

        if (meta.pmtilesPath) {
            currentFloodLayer = createFloodPmtilesLayer(meta);
            if (currentFloodLayer) {
                currentFloodLayer.__isPmtiles = true;
            }
        } else {
            currentFloodLayer = createManagedGeoJsonLayer({
                kind: 'flood',
                label: meta.label,
                path: meta.path,
                pane: 'floodPane',
                opacity: getFloodOpacityValue()
            });
        }

        currentFloodLayerId = selectedId;
    }

    return currentFloodLayer;
}

        function updateFloodLabels() {
            var selectedId = getFloodSelectedId();
            var meta = floodScenarioMeta[selectedId];
            var titleEl = document.getElementById('floodLayerTitle');
            if (titleEl && meta) titleEl.innerText = meta.label;
        }

        function toggleFloodLayer(checked) {
    var panel = document.getElementById('floodControlPanel');
    if (panel) panel.style.display = checked ? 'block' : 'none';

    updateFloodLabels();
    updateFloodOpacity(getFloodOpacityValue());

    if (!checked) {
        if (currentFloodLayer && map.hasLayer(currentFloodLayer)) {
            map.removeLayer(currentFloodLayer);
        }
        return;
    }

    var layer = ensureFloodLayer();
    if (!layer) return;

    if (layer.setOpacity) {
        layer.setOpacity(getFloodOpacityValue());
    }

    if (!map.hasLayer(layer)) {
        map.addLayer(layer);
    }

    if (layer.loadData) {
        layer.loadData();
    }
}

        function changeFloodScenario(val) {
    var toggleEl = document.getElementById('floodToggle');
    var wasEnabled = toggleEl && toggleEl.checked;

    if (currentFloodLayer && map.hasLayer(currentFloodLayer)) {
        map.removeLayer(currentFloodLayer);
    }

    currentFloodLayer = null;
    currentFloodLayerId = null;
    updateFloodLabels();
    updateFloodOpacity(getFloodOpacityValue());

    if (wasEnabled) {
        var layer = ensureFloodLayer();
        if (!layer) return;

        if (layer.setOpacity) {
            layer.setOpacity(getFloodOpacityValue());
        }

        map.addLayer(layer);

        if (layer.loadData) {
            layer.loadData();
        }
    }
}

        function updateFloodOpacity(val) {
    var opacity = parseFloat(val);

    var opacityValueEl = document.getElementById('floodOpacityValue');
    if (opacityValueEl) {
        opacityValueEl.innerText = Math.round(opacity * 100) + '%';
    }

    var floodPane = map.getPane('floodPane');
    if (floodPane) {
        floodPane.style.opacity = opacity;
    }

    if (currentFloodLayer && currentFloodLayer.setOpacity) {
        currentFloodLayer.setOpacity(opacity);
    }
}

                function openFloodLegend() {
            var selectedId = getFloodSelectedId();
            var meta = floodScenarioMeta[selectedId] || {};
            var title = meta.label || "淹水潛勢圖";

            var rowsHtml = FLOOD_DEPTH_STYLE_STOPS
                .slice()
                .reverse()
                .map(function(stop) {
                    return `
                        <div style="display:flex; align-items:center; gap:7px; margin:3px 0;">
                            <span style="display:inline-block;width:18px;height:10px;background:${stop.color};border:1px solid rgba(71,85,105,.2);border-radius:2px;"></span>
                            <span>${stop.label}</span>
                        </div>
                    `;
                })
                .join("");

            var html = `
                <div style="font-size:12px; line-height:1.6; min-width:205px;">
                    <div style="font-weight:900; color:#92400e; margin-bottom:6px;">
                        ${escapeGISHtml(title)} 圖例
                    </div>

                    ${rowsHtml}

                    <div style="margin-top:7px; color:#64748b; font-size:11px;">
                        色階與目前 PMTiles 圖層的實際繪製規則一致；此圖為降雨情境下的淹水潛勢，非即時災情。
                    </div>
                </div>
            `;

            L.popup({
                closeButton: true,
                autoClose: true,
                className: "glass-popup"
            })
                .setLatLng(map.getCenter())
                .setContent(html)
                .openOn(map);
        }

        function getHydrologyOpacityValue() {
            var opacityEl = document.getElementById('hydrologyOpacity');
            return opacityEl ? parseFloat(opacityEl.value) : 0.55;
        }

        function ensureHydrologyLayer(layerId) {
            var meta = hydrologyLayerMeta[layerId];
            if (!meta) return null;

            if (!hydrologyLayers[layerId]) {
                hydrologyLayers[layerId] = createManagedGeoJsonLayer({
                    kind: 'hydrology',
                    label: meta.label,
                    path: meta.path,
                    pane: 'hydrologyPane',
                    opacity: getHydrologyOpacityValue(),
                    meta: meta
                });
            }

            return hydrologyLayers[layerId];
        }

        function toggleHydrologyPanel(checked) {
            var panel = document.getElementById('hydrologyControlPanel');
            if (panel) panel.style.display = checked ? 'block' : 'none';

            if (!checked) {
                clearAllHydrologyLayers();
            } else {
                syncHydrologyStatus();
            }
        }

        function toggleHydrologyLayer(layerId, checked) {
            var layer = ensureHydrologyLayer(layerId);
            if (!layer) return;

            if (checked) {
                layer.setOpacity(getHydrologyOpacityValue());

                if (!map.hasLayer(layer)) {
                    map.addLayer(layer);
                }

                layer.loadData();
            } else {
                if (map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            }

            syncHydrologyStatus();
        }

        function updateHydrologyOpacity(val) {
            var valueText = document.getElementById('hydrologyOpacityValue');
            if (valueText) {
                valueText.innerText = Math.round(parseFloat(val) * 100) + '%';
            }

            Object.keys(hydrologyLayers).forEach(function(layerId) {
                if (hydrologyLayers[layerId] && hydrologyLayers[layerId].setOpacity) {
                    hydrologyLayers[layerId].setOpacity(parseFloat(val));
                }
            });
        }

        function syncHydrologyStatus() {
            var activeCount = 0;

            Object.keys(hydrologyLayerMeta).forEach(function(layerId) {
                var checkbox = document.getElementById('hydro_' + layerId);
                var layer = hydrologyLayers[layerId];
                var active = checkbox && checkbox.checked && layer && map.hasLayer(layer);
                if (active) activeCount++;
            });

            var statusText = document.getElementById('hydrologyStatusText');
            if (statusText) {
                statusText.innerText = activeCount + ' 層';
            }

            var masterToggle = document.getElementById('hydrologyMasterToggle');
            if (masterToggle) {
                masterToggle.checked = activeCount > 0 || (
                    document.getElementById('hydrologyControlPanel') &&
                    document.getElementById('hydrologyControlPanel').style.display === 'block'
                );
            }
        }

        function clearAllHydrologyLayers() {
            Object.keys(hydrologyLayerMeta).forEach(function(layerId) {
                var checkbox = document.getElementById('hydro_' + layerId);
                if (checkbox) checkbox.checked = false;

                if (hydrologyLayers[layerId] && map.hasLayer(hydrologyLayers[layerId])) {
                    map.removeLayer(hydrologyLayers[layerId]);
                }
            });

            syncHydrologyStatus();
        }

        function setHydrologyRecommended(checked) {
            var masterToggle = document.getElementById('hydrologyMasterToggle');
            var panel = document.getElementById('hydrologyControlPanel');

            if (masterToggle) masterToggle.checked = true;
            if (panel) panel.style.display = 'block';

            recommendedHydrologyIds.forEach(function(layerId) {
                var checkbox = document.getElementById('hydro_' + layerId);
                if (checkbox) {
                    checkbox.checked = checked;
                    toggleHydrologyLayer(layerId, checked);
                }
            });
        }
// 🌟 官方災害圖資 - 科普白話文小辭典
        const hazardExplanations = {
            'landslide_sensitive': { title: '山崩與地滑地質敏感區', desc: '就像是地球的「舊傷疤」。這裡過去曾經發生過山崩，或者地質比較脆弱，未來如果遇到大雨或地震，容易再次發生土石崩落。我們可以用它來避開危險的蓋房子地點！' },
            'dislope': { title: '順向坡', desc: '想像一個溜滑梯！當地底下的岩層傾斜方向，跟山坡表面的傾斜方向「一模一樣」時，這就叫順向坡。如果溜滑梯的最底下（坡腳）被挖掉，上面的土石就很容易整塊滑下來喔。' },
            'lidar': { title: '光達 (LiDAR) 判釋地形', desc: '這是一種超酷的「透視眼」技術！利用飛機在天上打雷射光，可以穿透茂密的樹林，看到底下最真實的地表起伏。科學家用它來尋找隱藏在森林裡的斷層或是古老的山崩痕跡。' },
            'gm50000': { title: '五萬分之一地質圖', desc: '這是地質學家的「尋寶圖」。圖上不同的顏色，代表我們腳底下踩的是不同年代、不同種類的岩石（例如砂岩、頁岩），上面也會畫出地底下的斷層在哪裡。' },
            'slp20': { title: '全島數值地形坡度圖', desc: '這張圖用顏色告訴我們「哪裡很陡、哪裡很平」。顏色越深的地方代表越陡峭，通常也是比較危險、不適合開發的地方。' },
            'shadw20': { title: '多向陰影圖', desc: '這就像是幫台灣的地形「打上聚光燈」！透過模擬太陽光從不同角度照射，讓山脈跟山谷看起來產生 3D 立體的感覺，非常適合用來觀察地形特徵。' },
            'soil_liquefaction': { title: '土壤液化潛勢圖', desc: '當強烈地震發生時，地底下的沙子和地下水會因為劇烈搖晃而混合，原本堅硬的泥土會瞬間變成像「泥漿」一樣軟爛，導致上面的房子下沉或傾斜。' }
        };

        function showHazardInfo(key, event) {
            if(event) { event.preventDefault(); event.stopPropagation(); }
            const info = hazardExplanations[key];
            if(!info) return;
            document.getElementById('hazardInfoTitle').innerText = info.title;
            document.getElementById('hazardInfoDesc').innerText = info.desc;
            // 這裡不再呼叫 closeAllDrawers()，讓選單保持開啟！
            document.getElementById('hazardInfoModal').classList.add('active');
        }
        // ==========================================
        // 🌟 官方災害圖資 (從官方 API 串接，修正 XYZ 對應)
        // ==========================================
        var officialHazardTileMeta = {
            landslide_sensitive: {
                label: '山崩與地滑地質敏感區',
                type: 'xyz',
                url: 'https://landslide.geologycloud.tw/jlwmts/jetlink/SensitiveArea/GoogleMapsCompatible/{z}/{x}/{y}.png',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            },
            dislope: {
                label: '順向坡目錄',
                type: 'xyz',
                url: 'https://landslide.geologycloud.tw/jlwmts/jetlink/Dislope/GoogleMapsCompatible/{z}/{x}/{y}.png',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            },
            lidar: {
                label: '光達判釋目錄',
                type: 'xyz',
                url: 'https://landslide.geologycloud.tw/jlwmts/jetlink/Lidar/GoogleMapsCompatible/{z}/{x}/{y}.png',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            },
            gm50000: {
                label: '五萬分之一地質圖',
                type: 'xyz',
                url: 'https://landslide.geologycloud.tw/jlwmts/jetlink/gm50000/GoogleMapsCompatible/{z}/{x}/{y}.png',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            },
            slp20: {
                label: '全島數值地形坡度圖',
                type: 'xyz',
                url: 'https://landslide.geologycloud.tw/jlwmts/jetlink/Slp20/GoogleMapsCompatible/{z}/{x}/{y}.png',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            },
            shadw20: {
                label: '全島數值地形多向陰影圖',
                type: 'xyz',
                url: 'https://landslide.geologycloud.tw/jlwmts/jetlink/Shadw20/GoogleMapsCompatible/{z}/{x}/{y}.png',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            },
            soil_liquefaction_1: {
                label: '土壤液化潛勢圖（初級）',
                type: 'xyz',
                url: 'https://wmts.nlsc.gov.tw/wmts/SoilLiquefaction/default/GoogleMapsCompatible/{z}/{y}/{x}',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            },
            soil_liquefaction_2: {
                label: '土壤液化潛勢圖（中級）',
                type: 'xyz',
                url: 'https://wmts.nlsc.gov.tw/wmts/SoilLiquefaction2/default/GoogleMapsCompatible/{z}/{y}/{x}',
                options: { tileSize: 256, opacity: 0.6, pane: 'officialHazardPane', maxZoom: 19 }
            }
        };

        var recommendedOfficialHazardIds = [
            'landslide_sensitive',
            'dislope',
            'soil_liquefaction_1',
            'soil_liquefaction_2'
        ];

        var officialHazardLayers = {};

        map.createPane('officialHazardPane');
        map.getPane('officialHazardPane').style.zIndex = 345;
        map.getPane('officialHazardPane').style.pointerEvents = 'none';

        function getOfficialHazardOpacityValue() {
            var opacityEl = document.getElementById('officialHazardOpacity');
            return opacityEl ? parseFloat(opacityEl.value) : 0.6;
        }

        function ensureOfficialHazardLayer(layerId) {
            if (!officialHazardLayers[layerId]) {
                var meta = officialHazardTileMeta[layerId];
                if (!meta) return null;

                officialHazardLayers[layerId] = L.tileLayer(meta.url, meta.options);
                officialHazardLayers[layerId].on('tileerror', function(err) {
                    console.warn('Official hazard tile error:', layerId, err);
                });
            }
            return officialHazardLayers[layerId];
        }

        function toggleOfficialHazardPanel(checked) {
            var panel = document.getElementById('officialHazardControlPanel');
            if (panel) panel.style.display = checked ? 'block' : 'none';

            if (!checked) {
                clearAllOfficialHazardLayers();
            } else {
                syncOfficialHazardStatus();
            }
        }

        function toggleOfficialHazardLayer(layerId, checked) {
            var layer = ensureOfficialHazardLayer(layerId);
            if (!layer) return;

            if (checked) {
                layer.setOpacity(getOfficialHazardOpacityValue());
                if (!map.hasLayer(layer)) map.addLayer(layer);
            } else {
                if (map.hasLayer(layer)) map.removeLayer(layer);
            }

            syncOfficialHazardStatus();
        }

        function updateOfficialHazardOpacity(val) {
            var valueText = document.getElementById('officialHazardOpacityValue');
            if (valueText) {
                valueText.innerText = Math.round(parseFloat(val) * 100) + '%';
            }

            Object.keys(officialHazardLayers).forEach(function(layerId) {
                officialHazardLayers[layerId].setOpacity(parseFloat(val));
            });
        }

        function syncOfficialHazardStatus() {
            var activeCount = 0;

            Object.keys(officialHazardTileMeta).forEach(function(layerId) {
                var checkbox = document.getElementById('officialHazard_' + layerId);
                var layer = officialHazardLayers[layerId];
                var active = checkbox && checkbox.checked && layer && map.hasLayer(layer);
                if (active) activeCount++;
            });

            var statusText = document.getElementById('officialHazardStatusText');
            if (statusText) {
                statusText.innerText = activeCount + ' 層';
            }

            var masterToggle = document.getElementById('officialHazardMasterToggle');
            if (masterToggle) {
                masterToggle.checked = activeCount > 0 || (
                    document.getElementById('officialHazardControlPanel') &&
                    document.getElementById('officialHazardControlPanel').style.display === 'block'
                );
            }
        }

        function clearAllOfficialHazardLayers() {
            Object.keys(officialHazardTileMeta).forEach(function(layerId) {
                var checkbox = document.getElementById('officialHazard_' + layerId);
                if (checkbox) checkbox.checked = false;

                if (officialHazardLayers[layerId] && map.hasLayer(officialHazardLayers[layerId])) {
                    map.removeLayer(officialHazardLayers[layerId]);
                }
            });

            syncOfficialHazardStatus();
        }

        function setOfficialHazardRecommended(checked) {
            var masterToggle = document.getElementById('officialHazardMasterToggle');
            var panel = document.getElementById('officialHazardControlPanel');

            if (masterToggle) masterToggle.checked = true;
            if (panel) panel.style.display = 'block';

            recommendedOfficialHazardIds.forEach(function(layerId) {
                var checkbox = document.getElementById('officialHazard_' + layerId);
                if (checkbox) {
                    checkbox.checked = checked;
                    toggleOfficialHazardLayer(layerId, checked);
                }
            });
        }

        // ==========================================
        // 🌟 南山公墓：圖資載入、墳墓卡片、分類選單
        // ==========================================
                var nanshanLayer = null;
        var nanshanGeoJsonData = null;
        var nanshanDidFitBounds = false;
        var nanshanCanvasRenderer = L.canvas({ padding: 0.5 });
        var nanshanSearchKeyword = '';
        var nanshanSearchTimer = null;

        // 🌟 南山公墓搜尋結果定位／高亮用
        var nanshanFeatureLayerMap = {};
        var nanshanHighlightLayer = null;
        var nanshanHighlightTimer = null;
        function normalizeNanshanSearchText(text) {
            return String(text || '')
                .toLowerCase()
                .replace(/\s+/g, '')
                .replace(/[，。、「」『』（）()【】\[\]：:；;,.!?！？\-—_/\\]/g, '');
        }

        function getNanshanSearchText(feature) {
            if (!feature) return '';

            if (feature.__nanshanSearchText) {
                return feature.__nanshanSearchText;
            }

            var props = feature.properties || {};
            var data = extractNanshanData(props);

            var rawValues = Object.keys(props).map(function(key) {
                var val = props[key];
                if (val && typeof val === 'object' && val.value) return val.value;
                if (typeof val === 'string' || typeof val === 'number') return val;
                return '';
            }).join(' ');

            feature.__nanshanSearchText = normalizeNanshanSearchText([
                data.name,
                data.layerName,
                data.bioContent,
                rawValues
            ].join(' '));

            return feature.__nanshanSearchText;
        }
                function getNanshanFeatureId(feature) {
            if (!feature) return '';

            if (!feature.__nanshanId) {
                var data = extractNanshanData(feature.properties || {});
                var coords = '';

                if (feature.geometry && feature.geometry.coordinates) {
                    coords = JSON.stringify(feature.geometry.coordinates);
                }

                feature.__nanshanId = normalizeNanshanSearchText(data.name + '_' + coords);
            }

            return feature.__nanshanId;
        }

        function clearNanshanHighlight() {
            if (nanshanHighlightTimer) {
                clearInterval(nanshanHighlightTimer);
                nanshanHighlightTimer = null;
            }

            if (nanshanHighlightLayer && map.hasLayer(nanshanHighlightLayer)) {
                map.removeLayer(nanshanHighlightLayer);
            }

            nanshanHighlightLayer = null;
        }

        function highlightNanshanGrave(latlng) {
            clearNanshanHighlight();

            var growing = true;
            var radius = 12;

            nanshanHighlightLayer = L.circleMarker(latlng, {
                radius: radius,
                color: '#f59e0b',
                weight: 4,
                opacity: 1,
                fillColor: '#fef08a',
                fillOpacity: 0.38,
                interactive: false
            }).addTo(map);

            nanshanHighlightTimer = setInterval(function() {
                if (!nanshanHighlightLayer || !map.hasLayer(nanshanHighlightLayer)) {
                    clearNanshanHighlight();
                    return;
                }

                radius = growing ? radius + 2 : radius - 2;

                if (radius >= 26) growing = false;
                if (radius <= 12) growing = true;

                nanshanHighlightLayer.setRadius(radius);
                nanshanHighlightLayer.setStyle({
                    opacity: growing ? 0.72 : 1,
                    fillOpacity: growing ? 0.2 : 0.48
                });
            }, 180);
        }

        window.focusNanshanGrave = function(fid) {
            var layer = nanshanFeatureLayerMap[fid];
            if (!layer) return;

            var latlng = null;

            if (layer.getLatLng) {
                latlng = layer.getLatLng();
            } else if (layer.getBounds) {
                latlng = layer.getBounds().getCenter();
            }

            if (!latlng) return;

            map.flyTo(latlng, 19, {
                animate: true,
                duration: 0.9
            });

            setTimeout(function() {
                if (layer.openPopup) layer.openPopup();
                highlightNanshanGrave(latlng);
            }, 650);
        };

        function renderNanshanSearchResults(resultCount, totalCount) {
            var searchStatus = document.getElementById('nanshanSearchStatus');
            var catList = document.getElementById('nanshanCategoryList');
            var note = document.querySelector('.nanshan-category-note');
            if (!searchStatus) return;

            var keywordRaw = nanshanSearchKeyword.trim();

            /* 🎯 兩全其美解法：搜尋時隱藏說明文字，並把分類選單「稍微壓縮」但保持可見與捲動 */
            if (note) {
                note.style.display = keywordRaw ? 'none' : 'block';
            }
            if (catList) {
                catList.style.display = 'flex'; // 永遠保持顯示
                catList.style.maxHeight = keywordRaw ? '110px' : '250px'; // 搜尋時壓縮高度 (約顯示3.5個選項，提示可滑動)
                catList.style.borderBottom = keywordRaw ? '1px dashed #ddd6fe' : 'none'; // 加上分隔線
                catList.style.paddingBottom = keywordRaw ? '6px' : '0';
                catList.style.marginBottom = keywordRaw ? '6px' : '0';
            }

            if (!nanshanLayer) {
                searchStatus.textContent = '';
                return;
            }

            if (!keywordRaw) {
                searchStatus.textContent = '目前顯示：' + resultCount + ' / ' + totalCount + ' 筆';
                return;
            }

            var layers = nanshanLayer.getLayers();

            var html =
                '<div>搜尋「' + escapeHTML(keywordRaw) + '」：' + resultCount + ' / ' + totalCount + ' 筆</div>';

            if (layers.length === 0) {
                html += '<div style="margin-top:6px; color:#ef4444; font-weight:800;">沒有找到符合的墓塚。</div>';
                searchStatus.innerHTML = html;
                return;
            }

            html += '<div style="margin-top:8px; display:flex; flex-direction:column; gap:5px;">';

            layers.slice(0, 20).forEach(function(layer) {
                var feature = layer.feature;
                var data = extractNanshanData(feature.properties || {});
                var fid = getNanshanFeatureId(feature);

                html +=
                    '<button type="button" onclick="focusNanshanGrave(\'' + fid + '\')" ' +
                    'style="width:100%; text-align:left; border:1px solid #ddd6fe; background:#fff; color:#4c1d95; border-radius:9px; padding:7px 9px; font-size:12px; font-weight:900; cursor:pointer; line-height:1.35;">' +
                        escapeHTML(data.name) +
                        '<span style="display:block; font-size:10.5px; color:#8b5cf6; margin-top:2px; font-weight:800;">' +
                            escapeHTML(data.layerName) +
                        '</span>' +
                    '</button>';
            });

            if (layers.length > 20) {
                html += '<div style="font-size:11px; color:#7c3aed; font-weight:800; margin-top:2px;">僅顯示前 20 筆，請輸入更精確關鍵字。</div>';
            }

            html += '</div>';

            searchStatus.innerHTML = html;
        }

        window.handleNanshanSearchInput = function(value) {
            nanshanSearchKeyword = value || '';

            var clearBtn = document.getElementById('nanshanSearchClearBtn');
            if (clearBtn) {
                clearBtn.style.display = nanshanSearchKeyword.trim() ? 'inline-flex' : 'none';
            }

            clearTimeout(nanshanSearchTimer);
            nanshanSearchTimer = setTimeout(function() {
                updateNanshanMap();
            }, 180);
        };

        window.clearNanshanSearch = function() {
            nanshanSearchKeyword = '';

            var input = document.getElementById('nanshanSearchInput');
            if (input) input.value = '';

            var clearBtn = document.getElementById('nanshanSearchClearBtn');
            if (clearBtn) clearBtn.style.display = 'none';

            updateNanshanMap();
        };

        function getNanshanProp(props, keys, fallback) {
            props = props || {};
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (props[key] !== undefined && props[key] !== null && String(props[key]).trim() !== '') {
                    return props[key];
                }
            }
            return fallback;
        }

        function stripNanshanHtmlToText(rawHtml) {
            if (!rawHtml) return '';
            var preHtml = String(rawHtml).replace(/<br\s*\/?\s*>/gi, '\n');
            var doc = new DOMParser().parseFromString(preHtml, 'text/html');
            doc.querySelectorAll('script, style, iframe, object, embed, img').forEach(function(el) { el.remove(); });

            var rows = Array.from(doc.querySelectorAll('tr'));
            if (rows.length > 0) {
                var collectedLines = [];
                rows.forEach(function(row) {
                    var cells = Array.from(row.querySelectorAll('td, th')).map(function(c) { return c.textContent.trim(); }).filter(Boolean);
                    if (cells.length >= 2) {
                        var label = cells[0];
                        var value = cells.slice(1).join(' ').trim();
                        if (!value) return;
                        if (label.indexOf('說明') > -1 || label.indexOf('簡介') > -1 || label === '') {
                            collectedLines.push(value);
                        } else if (label !== '名稱' && label.toLowerCase() !== 'name') {
                            collectedLines.push('【' + label + '】\n' + value);
                        }
                    } else if (cells.length === 1) {
                        collectedLines.push(cells[0]);
                    }
                });
                if (collectedLines.length > 0) return collectedLines.join('\n\n');
            }

            return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        }

                        var NANSHAN_ERA_ORDER = {
            '明鄭／明代': 1,
            '清朝／清領': 2,
            '日治時期': 3,
            '1945 之後／戰後': 4,
            '年代待考': 5,
            '其他／非墓塚或未判定': 6
        };

        function normalizeNanshanColor(rawColor) {
            return String(rawColor || '').trim().toLowerCase();
        }

        function getNanshanFeatureColor(props) {
            props = props || {};

            var color = normalizeNanshanColor(props['icon-color'] || props.iconColor || props.color);
            if (color) return color;

            var styleUrl = String(props.styleUrl || props.styleurl || '').toLowerCase();
            var match = styleUrl.match(/-([0-9a-f]{6})(?:-|$)/i);
            if (match && match[1]) return '#' + match[1].toLowerCase();

            return '';
        }

        function getNanshanEraLabel(props) {
            var color = getNanshanFeatureColor(props);

            switch (color) {
                case '#f57c00':
                    return '明鄭／明代';

                case '#01579b':
                    return '清朝／清領';

                case '#9c27b0':
                case '#673ab7':
                    return '日治時期';

                case '#7cb342':
                    return '1945 之後／戰後';

                case '#0288d1':
                case '#000000':
                    return '年代待考';

                default:
                    return '其他／非墓塚或未判定';
            }
        }

        function getNanshanEraColor(props) {
            var color = getNanshanFeatureColor(props);

            if (color === '#000000') return '#64748b';
            if (color) return color;

            return '#8b5cf6';
        }

        function getNanshanCategoryColor(categoryName) {
            switch (categoryName) {
                case '明鄭／明代':
                    return '#f57c00';
                case '清朝／清領':
                    return '#01579b';
                case '日治時期':
                    return '#9c27b0';
                case '1945 之後／戰後':
                    return '#7cb342';
                case '年代待考':
                    return '#0288d1';
                default:
                    return '#64748b';
            }
        }

        function compareNanshanEra(a, b) {
            var orderA = NANSHAN_ERA_ORDER[a] || 99;
            var orderB = NANSHAN_ERA_ORDER[b] || 99;

            if (orderA !== orderB) return orderA - orderB;

            return String(a).localeCompare(String(b), 'zh-Hant');
        }

        var NANSHAN_IMAGE_PROXY_BASE = 'https://nanshan-image-proxy.yhzkiki.workers.dev/?url=';
        var nanshanExifCache = {};

        function getNanshanProxyImageUrl(src) {
            if (!src) return '';
            return NANSHAN_IMAGE_PROXY_BASE + encodeURIComponent(src);
        }

        function getNanshanExifOrientation(buffer) {
            var view = new DataView(buffer);

            if (view.getUint16(0, false) !== 0xFFD8) return 1;

            var offset = 2;
            var length = view.byteLength;

            while (offset < length) {
                if (view.getUint8(offset) !== 0xFF) break;

                var marker = view.getUint8(offset + 1);
                var size = view.getUint16(offset + 2, false);

                if (marker === 0xE1) {
                    var app1Start = offset + 4;

                    function getString(start, len) {
                        var str = '';
                        for (var i = 0; i < len; i++) {
                            str += String.fromCharCode(view.getUint8(start + i));
                        }
                        return str;
                    }

                    if (getString(app1Start, 6) !== 'Exif\u0000\u0000') return 1;

                    var tiffStart = app1Start + 6;
                    var little = view.getUint16(tiffStart, false) === 0x4949;

                    if (view.getUint16(tiffStart + 2, little) !== 0x002A) return 1;

                    var firstIFDOffset = view.getUint32(tiffStart + 4, little);
                    var ifdStart = tiffStart + firstIFDOffset;
                    var entries = view.getUint16(ifdStart, little);

                    for (var j = 0; j < entries; j++) {
                        var entryOffset = ifdStart + 2 + j * 12;
                        var tag = view.getUint16(entryOffset, little);

                        if (tag === 0x0112) {
                            return view.getUint16(entryOffset + 8, little) || 1;
                        }
                    }
                }

                offset += 2 + size;
            }

            return 1;
        }

        function drawNanshanOrientedImage(buffer, orientation) {
            return new Promise(function(resolve, reject) {
                var blob = new Blob([buffer]);
                var objectUrl = URL.createObjectURL(blob);
                var img = new Image();

                img.onload = function() {
                    try {
                        var canvas = document.createElement('canvas');
                        var ctx = canvas.getContext('2d');
                        var width = img.naturalWidth;
                        var height = img.naturalHeight;
                        var swap = [5, 6, 7, 8].indexOf(orientation) > -1;

                        canvas.width = swap ? height : width;
                        canvas.height = swap ? width : height;

                        switch (orientation) {
                            case 2:
                                ctx.translate(canvas.width, 0);
                                ctx.scale(-1, 1);
                                break;
                            case 3:
                                ctx.translate(canvas.width, canvas.height);
                                ctx.rotate(Math.PI);
                                break;
                            case 4:
                                ctx.translate(0, canvas.height);
                                ctx.scale(1, -1);
                                break;
                            case 5:
                                ctx.rotate(0.5 * Math.PI);
                                ctx.scale(1, -1);
                                break;
                            case 6:
                                ctx.translate(canvas.width, 0);
                                ctx.rotate(0.5 * Math.PI);
                                break;
                            case 7:
                                ctx.translate(canvas.width, canvas.height);
                                ctx.rotate(0.5 * Math.PI);
                                ctx.scale(-1, 1);
                                break;
                            case 8:
                                ctx.translate(0, canvas.height);
                                ctx.rotate(-0.5 * Math.PI);
                                break;
                            default:
                                break;
                        }

                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(objectUrl);

                        resolve(canvas.toDataURL('image/jpeg', 0.9));
                    } catch (err) {
                        URL.revokeObjectURL(objectUrl);
                        reject(err);
                    }
                };

                img.onerror = function() {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('圖片解碼失敗'));
                };

                img.src = objectUrl;
            });
        }

        window.applyNanshanExifOrientation = function(imgEl) {
            if (!imgEl || imgEl.dataset.exifApplied === '1') return;

            var src = imgEl.dataset.exifSrc || imgEl.src;
            if (!src || src.indexOf('data:image/') === 0) return;

            imgEl.dataset.exifApplied = '1';

            if (!nanshanExifCache[src]) {
                nanshanExifCache[src] = fetch(src, { cache: 'force-cache' })
                    .then(function(res) {
                        if (!res.ok) throw new Error('圖片讀取失敗：' + res.status);
                        return res.arrayBuffer();
                    })
                    .then(function(buffer) {
                        var orientation = getNanshanExifOrientation(buffer);

                        if (!orientation || orientation === 1) {
                            return null;
                        }

                        return drawNanshanOrientedImage(buffer, orientation);
                    })
                    .catch(function(err) {
                        console.warn('EXIF 方向判讀失敗，維持原圖：', err);
                        return null;
                    });
            }

            nanshanExifCache[src].then(function(orientedDataUrl) {
                if (orientedDataUrl) {
                    imgEl.src = orientedDataUrl;
                }
            });
        };

        function collectNanshanImages(props, rawHtml) {
            var images = [];

            function cleanImageUrl(url) {
                if (!url) return '';
                url = String(url).trim();

                // 移除 HTML 屬性或標點殘留
                url = url.replace(/&amp;/g, '&');
                url = url.replace(/[)"'<>]+$/g, '');

                // 排除 My Maps 圖釘 icon
                if (url.indexOf('gstatic.com/mapspro') > -1) return '';

                // 🎯 核心修復：攔截 Google 的怪物級解析度 (如 s16383)
                // 強制將長邊縮小到 800px (s800)，防爆、省流量且載入極快！
                url = url.replace(/([?&]fife=s)\d+/i, '$1800');
                url = url.replace(/=s\d+$/i, '=s800');

                return url;
            }

            function pushUrl(url) {
                if (!url) return;

                var matches = String(url).match(/https?:\/\/[^\s"'<>]+/g);
                if (!matches) return;

                matches.forEach(function(src) {
                    src = cleanImageUrl(src);
                    if (src && images.indexOf(src) === -1) images.push(src);
                });
            }

            ['gx_media_links', 'image', 'Image', 'photo', 'Photo', '照片', '圖片'].forEach(function(key) {
                var val = props && props[key];
                if (val && typeof val === 'object' && val.value) val = val.value;
                pushUrl(val);
            });

            if (rawHtml) {
                var doc = new DOMParser().parseFromString(String(rawHtml), 'text/html');

                doc.querySelectorAll('img').forEach(function(img) {
                    pushUrl(img.getAttribute('src'));
                });

                pushUrl(rawHtml);
            }

            return images;
        }

        window.copyNanshanPhotoUrl = function(url) {
            if (!url) return;

            function fallbackCopy() {
                window.prompt('照片網址如下，請手動複製：', url);
            }

            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(url)
                    .then(function() {
                        alert('已複製照片網址。可貼到新分頁或另存備查。');
                    })
                    .catch(function() {
                        fallbackCopy();
                    });
            } else {
                fallbackCopy();
            }
        };

        function buildNanshanImageGallery(images, name) {
            if (!images || !images.length) return '';

            var visibleImages = images.slice(0, 8);
            var firstImage = visibleImages[0];
            var firstProxy = getNanshanProxyImageUrl(firstImage);

            var thumbsHtml = '';

            if (visibleImages.length > 1) {
                thumbsHtml = '<div class="nanshan-photo-strip">';

                visibleImages.forEach(function(src, index) {
                    var proxySrc = getNanshanProxyImageUrl(src);

                    thumbsHtml +=
                        '<a href="' + escapeHTML(proxySrc) + '" target="_blank" rel="noopener noreferrer" title="開啟第 ' + (index + 1) + ' 張照片">' +
                            '<img class="nanshan-photo-thumb" src="' + escapeHTML(proxySrc) + '" data-exif-src="' + escapeHTML(proxySrc) + '" alt="' + escapeHTML(name) + ' 照片 ' + (index + 1) + '" loading="lazy" onload="applyNanshanExifOrientation(this)" onerror="this.closest(\'a\').style.display=\'none\';">' +
                        '</a>';
                });

                thumbsHtml += '</div>';
            }

            return '' +
                '<div class="nanshan-photo-gallery">' +
                    '<a class="nanshan-main-photo-wrap" href="' + escapeHTML(firstProxy) + '" target="_blank" rel="noopener noreferrer" title="開啟照片">' +
                        '<img class="nanshan-main-photo" src="' + escapeHTML(firstProxy) + '" data-exif-src="' + escapeHTML(firstProxy) + '" alt="' + escapeHTML(name) + '" loading="lazy" onload="applyNanshanExifOrientation(this)" onerror="this.closest(\'.nanshan-photo-gallery\').style.display=\'none\';">' +
                        '<span class="nanshan-photo-count">' + images.length + ' 張</span>' +
                    '</a>' +
                    thumbsHtml +
                '</div>';
        }

        function extractNanshanData(props) {
            props = props || {};
            var name = getNanshanProp(props, ['Name', 'name', '名稱', 'title', 'Title'], '未命名墓塚');

            var rawHtml = '';
            if (typeof props.description === 'string') rawHtml = props.description;
            else if (props.description && props.description.value) rawHtml = props.description.value;
            else rawHtml = getNanshanProp(props, ['Description', '說明', '簡介', 'bio', 'Bio'], '');

            var layerName = getNanshanEraLabel(props);
            var images = collectNanshanImages(props, rawHtml);
            var bioContent = stripNanshanHtmlToText(rawHtml);

            if (!bioContent) {
                bioContent = getNanshanProp(props, ['說明', '簡介', 'bio', 'Bio', 'description'], '這筆圖資尚未提供完整說明。');
                if (bioContent && typeof bioContent === 'object' && bioContent.value) bioContent = bioContent.value;
                bioContent = stripNanshanHtmlToText(bioContent) || '這筆圖資尚未提供完整說明。';
            }

            return {
                name: String(name).trim(),
                layerName: String(layerName).trim(),
                images: images,
                bioContent: String(bioContent).trim()
            };
        }

        function formatNanshanBio(text) {
            var safe = escapeHTML(text || '這筆圖資尚未提供完整說明。');
            safe = safe.replace(/【([^】]+)】/g, '<strong>【$1】</strong>');
            return safe;
        }

        function buildNanshanPopup(feature) {
            var data = extractNanshanData(feature.properties || {});
            var galleryHtml = buildNanshanImageGallery(data.images, data.name);

            return '' +
                '<div class="nanshan-popup-content">' +
                    galleryHtml +
                    '<div class="nanshan-popup-body">' +
                        '<h3>' + escapeHTML(data.name) + '</h3>' +
                        '<div class="bio-text">' + formatNanshanBio(data.bioContent) + '</div>' +
                        '<div class="source-tag">年代分類｜' + escapeHTML(data.layerName) + '<br>資料來源：張鎧臣及蔡韋漢等，2020，南山公墓歷史名人墓塚地圖（0900更新）。</div>' +
                    '</div>' +
                '</div>';
        }

                        window.updateNanshanMap = function() {
            if (!nanshanGeoJsonData) return;

            clearNanshanHighlight();

            if (nanshanLayer) {
                map.removeLayer(nanshanLayer);
                nanshanLayer = null;
            }

            // 每次重建圖層時，重建搜尋結果對應表，避免指到舊 layer
            nanshanFeatureLayerMap = {};

            var checkboxes = document.querySelectorAll('.nanshan-cat-checkbox');
            var activeCats = Array.from(checkboxes)
                .filter(function(cb) { return cb.checked; })
                .map(function(cb) { return cb.value; });

            var keyword = normalizeNanshanSearchText(nanshanSearchKeyword);

            nanshanLayer = L.geoJSON(nanshanGeoJsonData, {
                filter: function(feature) {
                    var data = extractNanshanData(feature.properties || {});
                    var matchCategory = activeCats.indexOf(data.layerName) > -1;
                    var matchKeyword = !keyword || getNanshanSearchText(feature).indexOf(keyword) > -1;

                    return matchCategory && matchKeyword;
                },

                pointToLayer: function(feature, latlng) {
                    var eraColor = getNanshanEraColor((feature && feature.properties) || {});

                    var marker = L.circleMarker(latlng, {
                        renderer: nanshanCanvasRenderer,

                        // 原本 radius: 3 太難點；改成 8，點擊熱區會大很多
                        radius: 8,

                        color: eraColor,
                        weight: 2,
                        opacity: 0.85,
                        fillColor: eraColor,
                        fillOpacity: 0.28,

                        interactive: true,
                        bubblingMouseEvents: false
                    });

                    marker.on('mouseover', function() {
                        map.getContainer().style.cursor = 'pointer';
                        marker.setRadius(11);
                        marker.setStyle({
                            weight: 3,
                            fillOpacity: 0.55
                        });
                    });

                    marker.on('mouseout', function() {
                        map.getContainer().style.cursor = document.body.classList.contains('nanshan-mode') ? 'crosshair' : '';
                        marker.setRadius(8);
                        marker.setStyle({
                            weight: 2,
                            fillOpacity: 0.28
                        });
                    });

                    return marker;
                },

                style: function(feature) {
                    var eraColor = getNanshanEraColor((feature && feature.properties) || {});

                    return {
                        color: eraColor,
                        weight: 2,
                        opacity: 0.75,
                        fillColor: eraColor,
                        fillOpacity: 0.18
                    };
                },

                onEachFeature: function(feature, layer) {
                    var fid = getNanshanFeatureId(feature);
                    nanshanFeatureLayerMap[fid] = layer;

                    layer.bindPopup(function() {
                        return buildNanshanPopup(feature);
                    }, {
                        maxWidth: 320,
                        autoPan: true,
                        className: 'nanshan-custom-popup',
                        autoPanPaddingTopLeft: [15, 60]
                    });
                }
            });

            nanshanLayer.addTo(map);

            var status = document.getElementById('nanshanLayerStatus');
            if (status) status.textContent = activeCats.length + ' 類';

            var resultCount = nanshanLayer ? nanshanLayer.getLayers().length : 0;
            var totalCount = nanshanGeoJsonData && nanshanGeoJsonData.features ? nanshanGeoJsonData.features.length : 0;

            renderNanshanSearchResults(resultCount, totalCount);

            if (!nanshanDidFitBounds && nanshanLayer.getLayers().length > 0) {
                try {
                    map.fitBounds(nanshanLayer.getBounds(), {
                        padding: [28, 28],
                        maxZoom: 17
                    });
                    nanshanDidFitBounds = true;
                } catch (err) {}
            }
        };

                function buildNanshanCategoryMenu() {
            if (!nanshanGeoJsonData || !Array.isArray(nanshanGeoJsonData.features)) return;

            var categoryCounts = {};

            nanshanGeoJsonData.features.forEach(function(f) {
                var categoryName = extractNanshanData((f && f.properties) || {}).layerName;
                categoryCounts[categoryName] = (categoryCounts[categoryName] || 0) + 1;
            });

            var listContainer = document.getElementById('nanshanCategoryList');
            if (!listContainer) return;

            var html = '';
            Object.keys(categoryCounts).sort(compareNanshanEra).forEach(function(cat) {
                var color = getNanshanCategoryColor(cat);

                html += '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13.5px; color:#475569; font-weight:700; margin-bottom:4px; transition:0.2s;">' +
                    '<input type="checkbox" class="nanshan-cat-checkbox" value="' + escapeHTML(cat) + '" checked onchange="updateNanshanMap()" style="accent-color:#8b5cf6; width:16px; height:16px; cursor:pointer; flex-shrink:0;">' +
                    '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:' + color + '; box-shadow:0 0 0 2px rgba(255,255,255,0.9); flex-shrink:0;"></span>' +
                    '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">' + escapeHTML(cat) + '</span>' +
                    '<span style="font-size:11px; color:#94a3b8; font-family:Courier New, monospace;">' + categoryCounts[cat] + '</span>' +
                '</label>';
            });

            listContainer.innerHTML = html;
        }

        window.setAllNanshanCategories = function(checked) {
            document.querySelectorAll('.nanshan-cat-checkbox').forEach(function(cb) { cb.checked = checked; });
            updateNanshanMap();
        };

        window.toggleNanshanLayer = function(checked) {
            var leftMenu = document.getElementById('nanshanCategoryMenu');
            var toggle = document.getElementById('nanshanToggle');

                        if (!checked) {
                if (nanshanLayer) {
                    map.removeLayer(nanshanLayer);
                    nanshanLayer = null;
                }

                clearNanshanHighlight();
                nanshanFeatureLayerMap = {};

                document.body.classList.remove('nanshan-mode');
                if (leftMenu) leftMenu.style.display = 'none';
                if (toggle) toggle.checked = false;
                return;
            }

            document.body.classList.add('nanshan-mode');
            if (leftMenu) leftMenu.style.display = 'flex';

            if (!nanshanGeoJsonData) {
                if (toggle) toggle.disabled = true;
                fetch('./nanshan_cemetery.geojson')
                    .then(function(res) {
                        if (!res.ok) throw new Error('找不到圖資檔案');
                        return res.json();
                    })
                    .then(function(data) {
                        nanshanGeoJsonData = data;
                        buildNanshanCategoryMenu();
                        updateNanshanMap();
                        if (toggle) toggle.disabled = false;
                    })
                                         .catch(function(err) {
                        console.error('南山公墓圖層載入錯誤：', err);
                        alert('南山公墓圖層啟用失敗：\n\n' + err.message + '\n\n請打開 Console 看完整錯誤。');

                        if (toggle) {
                            toggle.checked = false;
                            toggle.disabled = false;
                        }

                        document.body.classList.remove('nanshan-mode');
                        if (leftMenu) leftMenu.style.display = 'none';
                    });
            } else {
                updateNanshanMap();
            }
        };

        // 初始化
        taiwanLayer.addTo(map);
        updateFloodLabels();
        updateFloodOpacity(getFloodOpacityValue());
        updateHydrologyOpacity(getHydrologyOpacityValue());
        syncHydrologyStatus();
        updateOfficialHazardOpacity(getOfficialHazardOpacityValue());
        syncOfficialHazardStatus();

// 臺灣精細圖僅在原本支援的區域使用；離開範圍時沿用 OSM 標準圖。
        function isInsideTaiwanBasemapCoverage(center) {
            return center.lat >= 20.0 && center.lat <= 26.5 && center.lng >= 118.0 && center.lng <= 122.5;
        }

        function showBasemapAutoFallbackNotice(visible) {
            var note = document.getElementById('basemapAutoFallbackNote');
            if (note) note.style.display = visible ? 'block' : 'none';
        }

        // 🚀 負責切換「現代圖資底圖」；舊 global 值一律安全轉到 OSM。
        function switchBasemap(val) {
            if (val !== 'taiwan' && val !== 'osm' && val !== 'esri_sat') val = 'osm';
            allModernLayers.forEach(function(l) { if (map.hasLayer(l)) map.removeLayer(l); });

            document.querySelectorAll('input[name="basemap"]').forEach(function(el) {
                el.checked = (el.value === val);
            });

            var taiwanFallback = val === 'taiwan' && !isInsideTaiwanBasemapCoverage(map.getCenter());
            var targetLayer = val === 'esri_sat' ? esriSatLayer : (val === 'osm' || taiwanFallback ? osmLayer : taiwanLayer);
            map.addLayer(targetLayer);
            showBasemapAutoFallbackNotice(taiwanFallback);

            // 🎯 套用目前拉桿設定的底圖透明度
            var slider = document.getElementById('basemapOpacity');
            if (slider && targetLayer.setOpacity) {
                targetLayer.setOpacity(parseFloat(slider.value));
            }
        }

        // 🎯 監聽底圖透明度拉桿的變動
        function updateBasemapOpacity(opacity) {
            allModernLayers.forEach(function(l) {
                if (map.hasLayer(l) && l.setOpacity) {
                    l.setOpacity(parseFloat(opacity));
                }
            });
        }

        // 🚀 負責切換「歷史套疊圖層」(支援多層獨立透明度)
        function switchHistoryMap(val, isChecked) {
            var layerMap = {
                'history_1875': history1875Layer,
                'history_tainan': historyTainanLayer,
                'history_1900': history1900Layer,
                'history_1904': history1904Layer,
                'history_1920': history1920Layer,
                'history_1921': history1921Layer,
                'history_1944': history1944Layer
            };

            var targetLayer = layerMap[val];
            if (!targetLayer) return;

            var ctrlDiv = document.getElementById('ctrl_' + val);

            if (isChecked) {
                if (!map.hasLayer(targetLayer)) map.addLayer(targetLayer);
                
                // 顯示專屬拉桿
                if (ctrlDiv) ctrlDiv.style.display = 'block';
                
                // 套用該拉桿目前的透明度設定
                var slider = ctrlDiv ? ctrlDiv.querySelector('input[type="range"]') : null;
                if (slider && targetLayer.setOpacity) {
                    targetLayer.setOpacity(parseFloat(slider.value));
                }
            } else {
                if (map.hasLayer(targetLayer)) map.removeLayer(targetLayer);
                if (ctrlDiv) ctrlDiv.style.display = 'none'; // 隱藏拉桿
            }
        }

        // 🎯 專門處理單一歷史圖層透明度的獨立函數
        function updateSingleHistoryOpacity(val, opacity) {
            var layerMap = {
                'history_1875': history1875Layer,
                'history_tainan': historyTainanLayer,
                'history_1900': history1900Layer,
                'history_1904': history1904Layer,
                'history_1920': history1920Layer,
                'history_1921': history1921Layer,
                'history_1944': history1944Layer
            };
            if (layerMap[val] && map.hasLayer(layerMap[val]) && layerMap[val].setOpacity) {
                layerMap[val].setOpacity(parseFloat(opacity));
            }
        }
        
        map.pm.setLang('zh-TW', {
            tooltips: { placeMarker: '點擊放置標記', firstVertex: '點擊地圖放置第一個起點', continueLine: '點擊繼續畫線', finishLine: '點擊最後一個節點完成路線', finishPoly: '點擊第一個起點完成多邊形', finishRect: '點擊並拖曳繪製矩形', edit: '拖曳節點以編輯形狀', cut: '剪下圖層', delete: '點擊你想刪除的圖層' },
            actions: { cancel: '取消', finish: '完成', removeLastVertex: '移除最後一點' },
            buttonTitles: { drawPolyButton: '畫多邊形範圍', drawLineButton: '畫折線路徑', drawRectButton: '畫矩形範圍', deleteButton: '單件刪除工具' }
        });

        var geomanControl = map.pm.addControls({ position: 'topright', drawMarker: false, drawCircleMarker: false, drawCircle: false, drawText: false, drawRectangle: true, editMode: false, dragMode: false, cutPolygon: false, rotateMode: false, removalMode: true });

        map.pm.Toolbar.createCustomControl({
            name: 'clearAllBtn', block: 'edit', title: '一鍵全部清除', className: 'custom-clear-icon', 
            onClick: () => {
                map.pm.getGeomanDrawLayers().forEach(l => map.removeLayer(l));
                var clearBtn = document.getElementById('clearRouteBtn');
                if(clearBtn) toggleRoute('clear', clearBtn);
            }, toggle: false
        });

        setTimeout(() => {
            var pmToolbars = document.querySelectorAll('.leaflet-pm-toolbar');
            var container = document.getElementById('geomanContainer');
            if (pmToolbars.length > 0 && container) { pmToolbars.forEach(tb => container.appendChild(tb)); }
        }, 100);

map.on('moveend', function() {
            var checkedBasemap = document.querySelector('input[name="basemap"]:checked');
            if (!checkedBasemap || checkedBasemap.value !== 'taiwan') return;

            // 僅臺灣精細底圖需要自動回退；手選 OSM / 衛星圖不受地圖移動影響。
            var useOsmFallback = !isInsideTaiwanBasemapCoverage(map.getCenter());
            var targetLayer = useOsmFallback ? osmLayer : taiwanLayer;
            var previousLayer = useOsmFallback ? taiwanLayer : osmLayer;
            if (!map.hasLayer(targetLayer)) map.addLayer(targetLayer);
            if (map.hasLayer(previousLayer)) map.removeLayer(previousLayer);
            showBasemapAutoFallbackNotice(useOsmFallback);

            // 自動切換時保留使用者設定的底圖透明度。
            var slider = document.getElementById('basemapOpacity');
            if (slider && targetLayer.setOpacity) targetLayer.setOpacity(parseFloat(slider.value));
        });
        
        function updateHeaderVisibility(hide) {
            if (window.innerWidth <= 600) {
                var header = document.querySelector('.glass-header');
                var pullTab = document.getElementById('headerPullTab');
                if (hide) {
                    header.classList.add('hidden-up');
                    if (pullTab) pullTab.classList.add('visible');
                } else {
                    header.classList.remove('hidden-up');
                    if (pullTab) pullTab.classList.remove('visible');
                }
            }
        }
        
        map.on('dragstart', () => updateHeaderVisibility(true)); 
        
        var markerCluster = L.markerClusterGroup({ 
            maxClusterRadius: 40, 
            spiderfyOnMaxZoom: false,         // 🌟 關閉蜘蛛網，改用底下的穩定偏移
            disableClusteringAtZoom: 18,      // 🌟 放大到極限時強制解散叢集
            removeOutsideVisibleBounds: false // 🛑 核心防護：禁止移動時拔除地標
        });

        // 🌟 穩定偏移函式 (Stable Jitter) - 讓重疊座標根據 UID 產生微小且固定的偏移
        function getStableJitter_(key) {
            var hash = 0;
            key = String(key || "");
            for (var i = 0; i < key.length; i++) {
                hash = ((hash << 5) - hash) + key.charCodeAt(i);
                hash |= 0;
            }
            var latOffset = ((hash % 21) - 10) * 0.000005; // 約偏移 0.5 公尺
            var lonOffset = (((hash >> 4) % 21) - 10) * 0.000005;
            return { lat: latOffset, lon: lonOffset };
        }
        var allMarkersData = [], globalAudio = new Audio(), currentAudioUid = null;
        var currentRouteType = null, currentRouteLine = null, isRoutePlaying = false;
        var routePointsData = [], routeMarkerObjects = [], currentRouteIndex = 0;
        var routeTimeout = null; 
        var currentGeoFenceBufferLayer = null; 
        var globalMarkerMap = {}; 

        
        setTimeout(() => {
            const uis = ['sidePanel', 'routePanel', 'rightToolsWrapper', 'drawModeHUD', 'globalPlayer'];
            uis.forEach(id => {
                let el = document.getElementById(id);
                // 防干擾：確保只有按鈕本身吃點擊
                if(el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); }
            });
            let header = document.querySelector('.glass-header');
            if(header) { L.DomEvent.disableClickPropagation(header); L.DomEvent.disableScrollPropagation(header); }
        }, 500);

        function closeAllDrawers() {
            var side = document.getElementById('sidePanel');
            var route = document.getElementById('routePanel');
            var tools = document.getElementById('rightToolsWrapper');
            var player = document.getElementById('globalPlayer');

            if (side) {
                side.classList.add('collapsed');
                side.setAttribute('aria-hidden', 'true');
                var sideToggle = side.querySelector('.toggle-btn');
                if (sideToggle) sideToggle.setAttribute('aria-expanded', 'false');
            }
            if (route) {
                route.classList.add('collapsed');
                route.setAttribute('aria-hidden', 'true');
                var routeToggle = route.querySelector('.toggle-btn');
                if (routeToggle) routeToggle.setAttribute('aria-expanded', 'false');
            }
            if (tools) {
                tools.classList.remove('open');
                tools.classList.remove('haidian-v4-data-open');
                tools.classList.add('haidian-v4-tools-user-hidden');
                tools.setAttribute('aria-hidden', 'true');
                var toolsToggle = tools.querySelector('.tools-toggle-btn');
                if (toolsToggle) toolsToggle.setAttribute('aria-expanded', 'false');
            }
            if (player) player.classList.remove('force-hide');
        }

        function togglePanel(id, event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            var target = document.getElementById(id);
            if (!target) return false;
            var isClosed = target.classList.contains('collapsed');

            // HAIDIAN V4：左側小耳朵要能跨模式叫出對應面板。
            // 例如右下在「聆聽」時點走讀小耳朵，直接切到走讀並展開 routePanel；
            // 右下在「圖資」時點聆聽/走讀小耳朵，也要先關閉圖資再打開對應面板。
            if (isClosed && document.body && document.body.classList.contains('haidian-v4') && typeof window.haidianSwitchMode === 'function') {
                if (id === 'sidePanel') return window.haidianSwitchMode('listen', false);
                if (id === 'routePanel') return window.haidianSwitchMode('walk', false);
            }

            closeAllDrawers();

            var targetToggle = target.querySelector('.toggle-btn');
            if (isClosed) {
                target.classList.remove('collapsed');
                target.setAttribute('aria-hidden', 'false');
                if (targetToggle) targetToggle.setAttribute('aria-expanded', 'true');
            } else {
                target.classList.add('collapsed');
                target.setAttribute('aria-hidden', 'true');
                if (targetToggle) targetToggle.setAttribute('aria-expanded', 'false');
            }
            return false;
        }

        function openCustomDrawHelp() {
            closeAllDrawers();
            closeGlobalPlayer(); 
            map.closePopup();    
            document.getElementById('drawModeHUD').classList.add('active');
            
            setTimeout(() => {
                alert('進入手繪模式！\n\n1. 請點選畫面左側的繪圖按鈕描繪範圍。\n2. 系統將自動為您導航該範圍的專屬路線！\n\n(完成後可點選紅色 X 退出模式)');
            }, 100);
        }

        function exitDrawMode() {
            document.getElementById('drawModeHUD').classList.remove('active');
        }

        function updateCardButtonUI() {
            document.querySelectorAll('.btn-play-main').forEach(btn => {
                if (btn.id && btn.id.startsWith('card-btn-')) {
                    btn.classList.remove('playing');
                    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> <span>播放聲音記錄</span>`;
                }
            });
            if (currentAudioUid && !globalAudio.paused) {
                var activeBtn = document.getElementById('card-btn-' + currentAudioUid);
                if (activeBtn) {
                    activeBtn.classList.add('playing');
                    activeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> <span>暫停播放</span>`;
                }
            }
        }

        function formatTime(seconds) {
            if (isNaN(seconds)) return "00:00";
            var m = Math.floor(seconds / 60);
            var s = Math.floor(seconds % 60);
            return (m < 10 ? '0'+m : m) + ':' + (s < 10 ? '0'+s : s);
        }

        globalAudio.addEventListener('play', updateCardButtonUI);
        globalAudio.addEventListener('pause', updateCardButtonUI);
        globalAudio.addEventListener('ended', () => {
    updateCardButtonUI();

    var player = getGlobalPlayerEl_();
    var toggleBtn = player ? player.querySelector('#playerToggleBtn') : null;
    var waveProgress = player ? player.querySelector('#waveProgress') : null;

    if (toggleBtn) {
        toggleBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    }

    if (waveProgress) {
        waveProgress.style.clipPath = `inset(0 100% 0 0)`;
    }

    if (isRoutePlaying) {
        currentRouteIndex++;
        routeTimeout = setTimeout(playNextRoutePoint, 1500);
    }
});

                window.toggleCardPlay = function(event, uid) {
    event.preventDefault();
    event.stopPropagation();

    if (currentAudioUid === uid) {
        var player = getGlobalPlayerEl_();
        mountGlobalPlayerIntoPopup_();

        if (player) {
            if (!player.classList.contains('suppress-floating')) {
    player.classList.add('active');
}
        }

        toggleGlobalAudio();
    } else {
        startGlobalPlayback(uid, { skipFocus: true });
    }
};

window.toggleGlobalAudio = function() {
    var player = getGlobalPlayerEl_();
    var toggleBtn = player ? player.querySelector('#playerToggleBtn') : null;

    if (globalAudio.paused) {
        globalAudio.play();

        if (toggleBtn) {
            toggleBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
        }
    } else {
        globalAudio.pause();

        if (toggleBtn) {
            toggleBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
        }
    }

    updateCardButtonUI();
};

        // 🌟 加上 ?t= 時間戳強制破除快取
        const API_URL = "https://haidian-soundscape-default-rtdb.asia-southeast1.firebasedatabase.app/soundscape_data.json?t=" + Date.now();
        
fetch(API_URL, { cache: "no-store" })
            .then(async (res) => {
                const json = await res.json();
                if (!res.ok) throw new Error(json?.error || `HTTP 狀態碼 ${res.status}`);
                if (!Array.isArray(json)) throw new Error("資料庫格式錯誤：不是陣列");
                return json;
            })
            .then((data) => {
                allMarkersData = data; 
                renderMarkers(data);
                renderLatestSubmissions(data);

                // 🌟 設定今日推薦聲景
                var box = document.getElementById('featuredSoundCard');
                var titleEl = document.getElementById('featuredSoundTitle');
                var finishedData = data.filter(item => !item.isProcessing && item.title && !isNaN(item.lat));
                if (finishedData.length > 0 && box && titleEl) {
                    var picked = finishedData[Math.floor(Math.random() * finishedData.length)];
                    titleEl.innerText = picked.title + " ｜ " + (picked.author || "特派員");
                    
                    // 🌟 確保這行有確實對應到 HTML
                    box.style.display = 'block';
                    box.onclick = function() {
                        enterMap();
                        setTimeout(() => focusMarkerOnMap(picked.uid), 700);
                    };
                }

                
                // 🚀 自動檢查網址是否帶有分享參數，有的話直接降落
                const params = new URLSearchParams(window.location.search);
                const workUid = params.get("work");
                if (workUid) {
                    setTimeout(() => { focusMarkerOnMap(workUid); }, 800);
                }
            })
            .catch((err) => {
                console.error("載入資料失敗：", err);
                alert("地圖資料載入失敗，請確認網路連線：" + err.message);
            });

        // 🛡️ 核心資安更新：XSS 防護過濾器 (將危險字元轉為純文字，防止惡意腳本攻擊)
        function escapeHTML(str) {
            if (!str) return "";
            return String(str).replace(/[&<>'"]/g, function(tag) {
                var charsToReplace = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#' + '39;' };
                return charsToReplace[tag] || tag;
            });
        }

        // ==========================================
        // 🚀 深層連結 (Deep Link) 與分享引擎
        // ==========================================
        function getWorkFromUid(uid) {
            return allMarkersData.find(item => String(item.uid) === String(uid));
        }

        window.shareWork = async function(event, uid) {
            event.preventDefault(); event.stopPropagation();
            const item = getWorkFromUid(uid);
            if (!item) return alert("找不到這件作品");

            const shareUrl = item.shortUrl || (window.location.origin + window.location.pathname + "?work=" + uid);
            const shareText = `我在【海佃 溪遊記】聽到這個聲音地景：「${item.title}」，一起打開耳朵來聽聽看！`;

            // 1. 嘗試優先使用手機原生分享面板
            if (navigator.share) {
                try {
                    await navigator.share({ title: item.title, text: shareText, url: shareUrl });
                    return; // 成功呼叫就結束
                } catch (err) { 
                    if (err.name === "AbortError") return; // 玩家按取消，什麼都不做
                }
            }

            // 2. 備用方案：桌機或不支援原生分享時，自動複製到剪貼簿！
            try {
                // 將文案與網址合併複製
                await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
                alert("作品與網址已自動複製到剪貼簿！\n您可以直接貼上至 LINE 或其他通訊軟體分享。");
            } catch (err) {
                prompt("您的瀏覽器阻擋自動複製，請手動複製以下連結：", shareUrl);
            }
        };

        // 🚀 開啟外部 Google Map 導航
        window.openGoogleMap = function(event, lat, lon) {
            event.preventDefault(); event.stopPropagation();
            const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
            window.open(url, "_blank", "noopener");
        };

        // 🚀 修復：地點搜尋結果 UI (移除 br、增加 X)
        function renderPlaceSearchResults(places, keyword) {
            var resultBox = getPlaceSearchResultsBox();
            resultBox.innerHTML = '';

            if (!places || places.length === 0) {
                resultBox.innerHTML = `
                    <div style="position: relative; padding:10px 32px 10px 12px; border-radius:8px; background:#fffbeb; color:#b45309; font-size:12px; font-weight:800; border:1px solid #fde68a; line-height:1.6;">
                        找不到名稱包含「${escapePlaceHtml(keyword)}」的地點。試試看其他關鍵字吧！
                        <div onclick="document.getElementById('placeSearchResults').innerHTML=''" style="position: absolute; top: 8px; right: 8px; cursor: pointer; background: rgba(180, 83, 9, 0.1); border-radius: 50%; width: 22px; height: 22px; display: flex; justify-content: center; align-items: center; transition: 0.2s;" onmouseover="this.style.background='rgba(180, 83, 9, 0.2)'" onmouseout="this.style.background='rgba(180, 83, 9, 0.1)'" title="清除提示">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </div>
                    </div>`;
                return;
            }

            var title = document.createElement('div');
            title.style.cssText = 'padding:6px 10px; border-radius:6px; background:#ecfdf5; color:#047857; font-size:11px; font-weight:900; border:1px solid #a7f3d0; display:flex; justify-content:space-between;';
            title.innerHTML = `<span>找到 ${places.length} 個結果</span> <span onclick="document.getElementById('placeSearchResults').innerHTML=''" style="cursor:pointer; color:#10b981;">清除</span>`;
            resultBox.appendChild(title);

            places.forEach(function(place, index) {
                var btn = document.createElement('button');
                btn.type = 'button';
                // ✨ 高顏值清單排版
                btn.style.cssText = 'width:100%; border:1px solid #e2e8f0; background:#f8fafc; border-radius:8px; padding:8px 10px; cursor:pointer; text-align:left; display:flex; flex-direction:column; gap:4px; transition:0.2s;';
                btn.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="font-size:13px; font-weight:800; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${index + 1}. ${escapePlaceHtml(place.name)}</span>
                        <span style="font-size:10px; font-weight:800; color:#e74c3c; background:#fff1f2; padding:2px 8px; border-radius:12px; border:1px solid #ffe4e6; flex-shrink:0;">前往</span>
                    </div>
                    <span style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:8px; border: 1px solid #e2e8f0; font-family:'Courier New', monospace;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg> 類型：${escapePlaceHtml(place.type)}
                    </span>
                `;
                btn.onmouseover = function() { btn.style.borderColor = '#e74c3c'; btn.style.backgroundColor = '#ffffff'; btn.style.boxShadow = '0 2px 8px rgba(231,76,60,0.1)'; };
                btn.onmouseout = function() { btn.style.borderColor = '#e2e8f0'; btn.style.backgroundColor = '#f8fafc'; btn.style.boxShadow = 'none'; };
                btn.onclick = function() { focusPlaceFromList(place.lat, place.lon, place.name, place.type); };
                resultBox.appendChild(btn);
            });
        }

        function updateCurrentWorkUrl(uid) {
            const url = new URL(window.location.href);
            url.searchParams.set("work", uid);
            history.replaceState(null, "", url.toString());
        }

        function createMarker(item) {
            // 🌟 新增防呆機制：如果欄位空缺自動補上預設值，防爆版
            item.category = item.category || "未分類";
            // 🛡️ 核心資安更新：使用 escapeHTML 清洗來自外部表單的文字
            item.title = escapeHTML(item.title || "無標題");
            item.author = escapeHTML(item.author || "海佃特派員");
            item.description = escapeHTML(item.description || "");
            item.date = item.date || "未知日期";
            
            var cleanCat = item.category.split(/[(（]/)[0].trim();
            var rawDate = item.date.replace(" 00:00:00", "");
            var displayDate = rawDate;
            if(rawDate.includes(":")) { var parts = rawDate.split(":"); displayDate = parts[0] + ":" + parts[1]; }
            displayDate = displayDate.replace(/-/g, "/");
            
            var catClass = "cat-default";
            if (cleanCat.includes("自然")) catClass = "cat-nature";
            else if (cleanCat.includes("常民")) catClass = "cat-culture";
            else if (cleanCat.includes("活動") || cleanCat.includes("產業")) catClass = "cat-industry";
            else if (cleanCat.includes("空間")) catClass = "cat-space";
            else if (cleanCat.includes("歲月")) catClass = "cat-history";

            var timeSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`; 
            
            var hasGps = !isNaN(item.lat) && !isNaN(item.lon) && (item.lat !== 0 || item.lon !== 0);
            var gpsHTML = hasGps ? `<span class="meta-gps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>${parseFloat(item.lat).toFixed(4)}, ${parseFloat(item.lon).toFixed(4)}</span>` : `<span class="meta-gps" style="color:#94a3b8; border-color:#e2e8f0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 軌跡定位中...</span>`;
            
            var audioHTML = "";
            if (item.isProcessing) {
                audioHTML = `<p style="background:#f8fafc; color:#94a3b8; padding:12px; border-radius:10px; border:1px dashed #cbd5e1; text-align:center; font-size:13px; font-weight:800; margin-top:10px; display:flex; justify-content:center; align-items:center; gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: badgeShine 2s linear infinite;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg> 聲音正在雲端沖洗中...稍後回來聽！</p>`;
            } else if (item.audioUrl) {
                audioHTML = `<button id="card-btn-${item.uid}" class="btn-play-main" onclick="toggleCardPlay(event, '${item.uid}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> <span>播放聲音記錄</span></button>`;
            } else {
                audioHTML = `<p style="background:#f1f5f9; color:#475569; padding:12px; border-radius:10px; border:1px solid #e2e8f0; text-align:center; font-size:13px; font-weight:800; margin-top:10px; display:flex; justify-content:center; align-items:center; gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> 純生態影像記錄</p>`;
            }
            var adminMenuHTML = `
    <details class="admin-menu card-admin-menu" onclick="event.stopPropagation()">
        <summary title="勘誤 / 下架">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        </summary>
        <div class="admin-dropdown">
            <a href="https://docs.google.com/forms/d/e/1FAIpQLSdORjyp5IXZ_h6L7AaeFxXxJVbDEI2oqjCidzRnAfkJFODM1Q/viewform?usp=pp_url&entry.977398317=提出勘誤&entry.111338985=${encodeURIComponent(item.title)}" target="_blank" class="action-link-faint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                勘誤
            </a>
            <span style="color:#e2e8f0">|</span>
            <a href="https://docs.google.com/forms/d/e/1FAIpQLSdORjyp5IXZ_h6L7AaeFxXxJVbDEI2oqjCidzRnAfkJFODM1Q/viewform?usp=pp_url&entry.977398317=原作者申請下架&entry.111338985=${encodeURIComponent(item.title)}" target="_blank" class="action-link-faint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                下架
            </a>
        </div>
    </details>
`;

            // 🌟 處理延伸閱讀邏輯 (強化防呆版)
            var extLinkHTML = "";
            if (item.extLink && item.extLink.trim() !== "") {
                var rawExt = item.extLink.trim();
                var linkTitle = "推薦閱讀文章";
                var linkUrl = "";

                if (rawExt.indexOf('|') > -1) {
                    // 有直線 |，完美格式 (標題 | 網址)
                    var parts = rawExt.split('|');
                    linkTitle = parts[0].trim() || linkTitle;
                    linkUrl = parts[1].trim();
                } else if (rawExt.toLowerCase().startsWith('http')) {
                    // 忘記打標題，只貼了網址
                    linkUrl = rawExt;
                } else {
                    // 忘記貼網址，只打了純文字 (標題) -> 轉換為 Google 搜尋連結，避免 404
                    linkTitle = rawExt;
                    linkUrl = "https://www.google.com/search?q=" + encodeURIComponent(rawExt);
                }

                if (linkUrl) {
                    extLinkHTML = `
                        <a href="${escapeHTML(linkUrl)}" target="_blank" class="ext-link-card" title="另開新分頁閱讀">
                            <div class="ext-link-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </div>
                            <div class="ext-link-text">
                                <span class="ext-link-label">延伸閱讀</span>
                                <span class="ext-link-title">${escapeHTML(linkTitle)}</span>
                            </div>
                        </a>
                    `;
                }
            }
            var cardHTML = `
                <div class="sound-card">
                    <img src="${item.coverUrl}" class="sound-cover" onerror="this.src='https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?q=80&w=600&auto=format&fit=crop'">
                    <div class="sound-info">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                            <h3 class="sound-title" style="margin: 0; padding-right: 10px; line-height: 1.4;">${item.title}</h3>
                            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-top: -2px;">
                                <button class="share-icon-btn" onclick="shareWork(event, '${item.uid}')" title="分享作品">
                                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                                </button>
                                <button class="nav-icon-btn" onclick="openGoogleMap(event, ${item.lat}, ${item.lon})" title="開啟 Google 地圖導航">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
                                </button>
                                <button id="card-fav-${item.uid}" class="fav-btn" onclick="toggleFavorite('${item.uid}')" title="加入收藏">
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                                </button>
                                ${adminMenuHTML}
                            </div>
                        </div>
                        
                        <div class="card-meta-box">
                            <div class="meta-row">
                                <span class="meta-item meta-author-name" title="${item.author}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                    ${item.author}
                                </span>
                                <span class="meta-item meta-date-text">${timeSvg} ${displayDate}</span>
                            </div>
                            <div class="card-tags-row">
                                <span class="meta-category ${catClass}">${cleanCat}</span>
                                ${gpsHTML}
                            </div>
                        </div>

                        <p class="sound-desc">${item.description}</p>
                        
                        ${extLinkHTML}
                        
                        <div class="reaction-section-title">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                            留下你的聽覺回音...
                        </div>
                        <div class="reaction-box" id="reaction-bar-${item.uid}">
                            <button class="reaction-btn" data-type="calm" onclick="toggleReaction('${item.uid}', 'calm')" title="聽完覺得很平靜">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path><line x1="16" y1="8" x2="2" y2="22"></line><line x1="17.5" y1="15" x2="9" y2="15"></line></svg>
                                <span>平靜</span>
                            </button>
                            <button class="reaction-btn" data-type="surprise" onclick="toggleReaction('${item.uid}', 'surprise')" title="這個聲音讓我好驚喜">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                <span>驚喜</span>
                            </button>
                            <button class="reaction-btn" data-type="curious" onclick="toggleReaction('${item.uid}', 'curious')" title="想一探究竟、引發好奇">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
                                <span>好奇</span>
                            </button>
                            <button class="reaction-btn" data-type="nostalgic" onclick="toggleReaction('${item.uid}', 'nostalgic')" title="有一種懷念、回味的感覺">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                <span>懷念</span>
                            </button>
                        </div>

                                                ${audioHTML}
                        <div id="embedded-player-slot-${item.uid}" class="embedded-player-slot"></div>
                                                
                    </div>
                </div>`;
            
            var marker = null;
            if (hasGps) {
                // 🌟 套用穩定偏移，徹底避開完全重疊的蜘蛛網 Bug
                var jitter = getStableJitter_(item.uid);
                var displayLat = parseFloat(item.lat) + jitter.lat;
                var displayLon = parseFloat(item.lon) + jitter.lon;

                // 🌟 產生專屬類別的聲音光點
                var customIcon = L.divIcon({
                    className: 'custom-sound-icon',
                    iconSize: [26, 26],
                    iconAnchor: [13, 13],
                    popupAnchor: [0, -12],
                    html: `<div class="sound-dot-marker ${catClass} pulse"></div>`
                });

                marker = L.marker([displayLat, displayLon], { icon: customIcon }).bindPopup(cardHTML, {
                    autoPan: true,
                    keepInView: false,
                    closeOnClick: false,      // ✅ 保留：防護 iOS 手指誤觸地圖背景導致卡片消失
                    autoClose: true,          // 🔧 修正這裡！改回 true，確保點擊新卡片時，舊卡片會自動收合
                    closeOnEscapeKey: false,
                    offset: [0, -28],
                    autoPanPaddingTopLeft: [15, 60],
                    autoPanPaddingBottomRight: [15, 80]
                });

                /* ===== [FIX START] 路線播放中 popup 被關閉時，不停止播放器也不破壞路線狀態 ===== */
                marker.on('popupclose', function() {
                    if (isRoutePlaying) {
                        // 🌟 核心修復 1：換卡片時，退回底部的播放器必須保持隱形 (true)！
                        restoreGlobalPlayerToBody_(true);
                        return;
                    }
                    closeGlobalPlayer();
                });
                /* ===== [FIX END] ===== */

                globalMarkerMap[item.uid] = marker;
                
                marker.on('click', (e) => { 
                    L.DomEvent.stopPropagation(e);
                    isRoutePlaying = false; 
                    clearTimeout(routeTimeout); 
                    var clearBtn = document.getElementById('clearRouteBtn');
                    if(clearBtn && clearBtn.style.display !== 'none') toggleRoute('clear', clearBtn);
                });
            }
            return marker;
        }

        function focusMarkerOnMap(uid) {
            updateCurrentWorkUrl(uid); // 🚀 點擊卡片時，默默把網址換成該作品的專屬網址

            isRoutePlaying = false; 
            clearTimeout(routeTimeout);
            
            var clearBtn = document.getElementById('clearRouteBtn');
            if(clearBtn && clearBtn.style.display !== 'none') toggleRoute('clear', clearBtn);
            
            closeAllDrawers();
            
            var targetMarker = globalMarkerMap[uid];
            if(targetMarker) {
                markerCluster.zoomToShowLayer(targetMarker, () => {
                    targetMarker.openPopup();
                });
            }
        }

function renderMarkers(data) { markerCluster.clearLayers(); globalMarkerMap = {}; data.forEach(item => { var m = createMarker(item); if (m) markerCluster.addLayer(m); }); map.addLayer(markerCluster); }        
        function renderLatestSubmissions(data) {
            var latestListDiv = document.getElementById('latestList'); 
            if (!latestListDiv) return;
            latestListDiv.innerHTML = "";

            // 🌟 核心過濾：只挑選「已經處理完成」的作品放入最新上架
            var finishedData = data.filter(item => !item.isProcessing);

            // 🌟 確保依照日期由新到舊排序
            var sortedData = finishedData.sort((a, b) => {
                var da = new Date(a.date || 0).getTime();
                var db = new Date(b.date || 0).getTime();
                return db - da; 
            });
            
            var top10 = sortedData.slice(0, 10);
            if(top10.length === 0) { latestListDiv.innerHTML = "<p style='font-size:12px; color:#94a3b8; text-align:center;'>目前尚無作品</p>"; return; }
            top10.forEach(item => {
                var rawDate = (item.date || "").replace(" 00:00:00", "").split(" ")[0].replace(/-/g, "/"); 
                // 🌟 明確清洗字串，不依賴 createMarker 的副作用
                var safeTitle = escapeHTML(item.title || "無標題");
                var safeAuthor = escapeHTML(item.author || "海佃特派員");

                latestListDiv.innerHTML += `
                    <div class="latest-item" onclick="closeModal('latestModal'); focusMarkerOnMap('${item.uid}')">
                        <img src="${item.coverUrl}" onerror="this.src='https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?q=80&w=100&auto=format&fit=crop'">
                        <div class="latest-item-info">
                            <div class="latest-item-title">${safeTitle}</div>
                            <div class="latest-item-meta">
                                <span style="display:flex; align-items:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> ${safeAuthor}</span>
                                <span style="font-family:'Courier New', monospace;">${rawDate}</span>
                            </div>
                        </div>
                    </div>`;
            });
        }
        
        function filterMarkers() {
            if (currentRouteType) return; 
            var s = document.getElementById('searchInput').value.toLowerCase();
            var cat = document.querySelector('input[name="catFilter"]:checked').value;
            var hLimit = parseInt(document.getElementById('timeSlider').value);
            var displayTime = hLimit === -1 ? "全部時段" : hLimit + ":00 - " + hLimit + ":59";
            document.getElementById('timeDisplay').innerText = displayTime;
            
            var favToggle = document.getElementById('favFilterToggle');
            var showOnlyFavs = favToggle ? favToggle.checked : false;
            
            if (showOnlyFavs && !currentUser) {
                alert("請先點擊右上角「登入探險」，才能啟用你的專屬尋寶圖喔！");
                favToggle.checked = false;
                showOnlyFavs = false;
            }

            renderMarkers(allMarkersData.filter(i => {
                var matchSearch = i.title.toLowerCase().includes(s) || i.author.toLowerCase().includes(s);
                var matchCat = (cat === 'all' || i.category.includes(cat));
                var matchTime = (hLimit === -1 || (i.date.match(/\s(\d{2}):/) && parseInt(i.date.match(/\s(\d{2}):/)[1]) === hLimit));
                var matchFav = showOnlyFavs ? userFavorites.has(i.uid) : true; 
                
                return matchSearch && matchCat && matchTime && matchFav;
            }));
        }

        function executeStandardRoute(type, actualPathCoords) {
            if (routePointsData.length < 2) { 
                if (type && type.startsWith('geofence')) {
                    alert('目前此範圍內的聲景作品不足 2 筆，無法啟動自動導航播放。但已為您標示出空間涵蓋範圍與路徑！快來投稿吧！');
                    markerCluster.clearLayers();
                    routeMarkerObjects = [];
                    routePointsData.forEach(item => { var m = createMarker(item); routeMarkerObjects.push(m); markerCluster.addLayer(m); });
                    map.addLayer(markerCluster); 
                    
                    if (currentRouteLine) { map.removeLayer(currentRouteLine); currentRouteLine = null; }
                    if (actualPathCoords) {
                        currentRouteLine = L.polyline(actualPathCoords, { color: '#e74c3c', weight: 4, opacity: 0.8, dashArray: '10, 15', className: 'route-path-animated' }).addTo(map);
                    }
                    map.fitBounds(currentGeoFenceBufferLayer.getBounds(), { padding: [50, 50] });
                    closeAllDrawers();
                    isRoutePlaying = false;
                    return; 
                } else {
                    alert('目前該主題的聲景資料不足以產生路線！'); 
                    toggleRoute('clear', document.getElementById('clearRouteBtn')); 
                    return; 
                }
            }

            markerCluster.clearLayers(); routeMarkerObjects = [];
            routePointsData.forEach(item => { var m = createMarker(item); routeMarkerObjects.push(m); markerCluster.addLayer(m); });
            map.addLayer(markerCluster);

            if (currentRouteLine) map.removeLayer(currentRouteLine);
            
            var coordsToDraw = actualPathCoords ? actualPathCoords : routePointsData.map(p => [p.lat, p.lon]);
            currentRouteLine = L.polyline(coordsToDraw, { color: '#e74c3c', weight: 4, opacity: 0.8, dashArray: '10, 15', className: 'route-path-animated' }).addTo(map);
            
            map.fitBounds(currentGeoFenceBufferLayer ? currentGeoFenceBufferLayer.getBounds() : currentRouteLine.getBounds(), { padding: [50, 50] });

            currentRouteIndex = 0;
            closeAllDrawers(); 
            routeTimeout = setTimeout(playNextRoutePoint, 1500); 
        }

        function executeCustomGeofence(bufferPolygon, actualPathCoords) {
            if (currentGeoFenceBufferLayer) { map.removeLayer(currentGeoFenceBufferLayer); currentGeoFenceBufferLayer = null; }
            if (currentRouteLine) { map.removeLayer(currentRouteLine); currentRouteLine = null; }
            document.querySelectorAll('.route-btn').forEach(btn => btn.classList.remove('active'));
            /* ===== [FIX-ROUTE-START START] ===== */
document.getElementById('clearRouteBtn').style.display = 'block';

var floatingClearBtn = document.getElementById('floatingClearRouteBtn');
if (floatingClearBtn) floatingClearBtn.style.display = 'flex';
/* ===== [FIX-ROUTE-START END] ===== */

            currentRouteType = 'custom';
            isRoutePlaying = true;

            currentGeoFenceBufferLayer = L.geoJSON(bufferPolygon, { style: { color: '#8e44ad', weight: 2, opacity: 0.8, fillColor: '#8e44ad', fillOpacity: 0.15 } }).addTo(map);
            routePointsData = allMarkersData.filter(i => turf.booleanPointInPolygon(turf.point([i.lon, i.lat]), bufferPolygon));

            executeStandardRoute('geofence_custom', actualPathCoords);
        }

        map.on('pm:create', function(e) {
            var layer = e.layer;
            var shape = e.shape; 
            var geojson = layer.toGeoJSON();
            var searchPolygon;
            var pathCoords = null;

            if (shape === 'Line' || shape === 'LineString') {
                searchPolygon = turf.buffer(geojson, 200, { units: 'meters' });
                pathCoords = geojson.geometry.coordinates.map(coord => [coord[1], coord[0]]);
            } else {
                searchPolygon = geojson;
            }

            map.removeLayer(layer);
            executeCustomGeofence(searchPolygon, pathCoords);
        });

        function toggleRoute(type, btnElement) {
            document.querySelectorAll('.route-btn').forEach(btn => btn.classList.remove('active'));
            if (currentGeoFenceBufferLayer) { map.removeLayer(currentGeoFenceBufferLayer); currentGeoFenceBufferLayer = null; }

            if (type === 'clear' || currentRouteType === type) {
                currentRouteType = null; isRoutePlaying = false; closeGlobalPlayer();
                document.getElementById('clearRouteBtn').style.display = 'none';
                var floatingClearBtn = document.getElementById('floatingClearRouteBtn');
if (floatingClearBtn) floatingClearBtn.style.display = 'none';
                if (currentRouteLine) { map.removeLayer(currentRouteLine); currentRouteLine = null; }
                map.pm.getGeomanDrawLayers().forEach(l => map.removeLayer(l));
                
                clearTimeout(routeTimeout); 
                
                filterMarkers(); return;
            }

            currentRouteType = type; isRoutePlaying = true;
            btnElement.classList.add('active');
            document.getElementById('clearRouteBtn').style.display = 'block';
            var floatingClearBtn = document.getElementById('floatingClearRouteBtn');
if (floatingClearBtn) floatingClearBtn.style.display = 'flex';

            if (type === 'nature') {
                routePointsData = allMarkersData.filter(i => i.category.includes('自然') || i.category.includes('空間')).slice(0, 5);
                executeStandardRoute(type, null);
            }
            else if (type === 'culture') {
                routePointsData = allMarkersData.filter(i => i.category.includes('常民') || i.category.includes('歲月') || i.category.includes('產業')).slice(0, 5);
                executeStandardRoute(type, null);
            }
            
            // ▼▼▼ 貼上這段新程式碼 ▼▼▼
            else if (type === 'geofence_shanhai' || type === 'geofence_taijiang') {
                // 1. 自動判斷要載入哪個檔案與使用哪個主題色
                var isShanhai = (type === 'geofence_shanhai');
                var fileName = isShanhai ? './shanhaizhun.geojson' : './taijiang_water_day.geojson';
                var themeColor = isShanhai ? '#e67e22' : '#27ae60';
                
                var tipMsg = isShanhai ? "準備載入山海圳綠道圖資..." : "準備載入台江水日路線圖資...";
                var loadingToast = L.popup({ closeButton: false, autoClose: false, closeOnClick: false, className: 'glass-popup' })
                                    .setLatLng(map.getCenter())
                                    .setContent(`<div style="padding:10px; font-weight:800; color:${themeColor}; text-align:center;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: badgeShine 2s linear infinite; vertical-align:middle; margin-right:5px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                        ${tipMsg}
                                    </div>`)
                                    .openOn(map);

                fetch(fileName)
                .then(res => {
                    if (!res.ok) throw new Error("找不到檔案 " + fileName);
                    return res.json();
                })
                .then(geojsonData => {
                    map.closePopup(loadingToast); 
                    
                    // === 🛡️ 終極防爆機制：不管檔案格式長怎樣，直接無腦萃取所有座標！ ===
                    var rawCoords = [];
                    try {
                        if (geojsonData.type) {
                            rawCoords = turf.coordAll(geojsonData); // Turf.js 原生大絕招
                        } else if (Array.isArray(geojsonData)) {
                            rawCoords = geojsonData.map(pt => Array.isArray(pt) ? pt : (pt.pt || [pt.lon, pt.lat])).filter(Boolean);
                        }
                    } catch (e) {
                        throw new Error("座標萃取失敗，檔案內容可能損毀！");
                    }

                    if (!rawCoords || rawCoords.length < 2) {
                        throw new Error("找不到足夠的座標點來畫路線！");
                    }

                    // === ✂️ 智慧剪線機制：切斷飛往玉山的「不合理直線」 ===
                    var shanhaiSegments = [];
                    var currentSeg = [];
                    
                    for(var j = 0; j < rawCoords.length; j++) {
                        var pt = rawCoords[j]; // [lon, lat]
                        if(currentSeg.length === 0) {
                            currentSeg.push(pt);
                        } else {
                            var prev = currentSeg[currentSeg.length - 1];
                            var dx = pt[0] - prev[0];
                            var dy = pt[1] - prev[1];
                            var distSq = dx*dx + dy*dy;
                            
                            // 如果距離大於閾值 (約 2公里)，視為斷點，直接剪斷！
                            if(distSq > 0.0004) {
                                shanhaiSegments.push(currentSeg);
                                currentSeg = [pt];
                            } else {
                                currentSeg.push(pt);
                            }
                        }
                    }
                    if(currentSeg.length > 0) shanhaiSegments.push(currentSeg);

                    // 把剪乾淨的線段包裝好，並濾掉孤兒點
                    shanhaiSegments = shanhaiSegments.filter(seg => seg.length > 1);
                    var riverLine = turf.multiLineString(shanhaiSegments);
                    
                    // 4. 使用 Turf.js 一秒算出 200m 緩衝區！
                    var optimizedLine = turf.simplify(riverLine, {tolerance: 0.0001, highQuality: true});
                    var buffer = turf.buffer(optimizedLine, 200, { units: 'meters' });

                    currentGeoFenceBufferLayer = L.geoJSON(buffer, { 
                        style: { color: themeColor, weight: 3, opacity: 0.8, fillColor: themeColor, fillOpacity: 0.15, dashArray: '5, 5' } 
                    }).addTo(map);

                    // 5. 篩選落入這個緩衝區的 Firebase 聲音地標
                    routePointsData = allMarkersData.filter(i => turf.booleanPointInPolygon(turf.point([i.lon, i.lat]), buffer));
                    
                    // 6. 萃取座標點來畫紅色的「導航虛線」
                    var leafletPath = shanhaiSegments.map(seg => seg.map(coord => [coord[1], coord[0]])); // Turf 轉 Leaflet
                    
                    executeStandardRoute(type, leafletPath);

                }).catch(err => {
                    map.closePopup(loadingToast);
                    alert("載入失敗！\n1. 請確認「" + fileName + "」是否存在。\n2. 錯誤細節：" + err.message);
                    toggleRoute('clear', document.getElementById('clearRouteBtn'));
                });
            }
// ▲▲▲ 貼上結束 ▲▲▲
// ▲▲▲ 貼上結束 ▲▲▲
            else if (type.startsWith('geofence')) {
                var p = { 
                    yanshui: [
                        [120.27808209977803, 23.055971160279995], [120.2774026433413, 23.057865704624007], [120.2766934436903, 23.058741894422184],
                        [120.27584039175895, 23.05921724368109], [120.2739422242592, 23.059387104064925], [120.27350655424726, 23.059518930599694],
                        [120.2712411395911, 23.060411543154373], [120.27018662376139, 23.06033385960511], [120.26886115815427, 23.059964335654627],
                        [120.26764857984784, 23.059643471306813], [120.26349983285843, 23.05930129515714], [120.26188599978201, 23.05817662130849],
                        [120.26104757571056, 23.058055584982483], [120.25950026652282, 23.058256333640728], [120.25817684700559, 23.05800217814506],
                        [120.25743206076987, 23.057663327674405], [120.2541884164761, 23.057239581979474], [120.25283848536998, 23.05755592133056],
                        [120.2500743878162, 23.058318600797904], [120.24814599555151, 23.05879847973216], [120.24677991369902, 23.05829409719483],
                        [120.24561564440518, 23.057913636093204], [120.24509624542281, 23.057611289377135], [120.24397231051154, 23.05635720183335],
                        [120.24351919458041, 23.056051400053036], [120.24187966600437, 23.054373504952522], [120.24086287141245, 23.052705654860617],
                        [120.23814053401446, 23.0506269168569], [120.23471109545989, 23.048841639655777], [120.22830788475119, 23.045147425533955],
                        [120.22627856940932, 23.042779030007566], [120.22198625837723, 23.03371889460604], [120.21998846571074, 23.02859525133836],
                        [120.2160653710788, 23.025032341399523], [120.21340421269593, 23.024235029547228], [120.20803944247677, 23.023504132770995],
                        [120.20155526350982, 23.022707627184147], [120.19482101993754, 23.02019305113072], [120.18921656345344, 23.017587051277644],
                        [120.18361849583766, 23.014040029201382], [120.18147834748504, 23.012433642878918], [120.18094854336033, 23.011767782344492],
                        [120.17576574284755, 23.00781362154153], [120.16696924468056, 23.005165980507726], [120.16333587252535, 23.00561969571237],
                        [120.15874176242727, 23.00626174830066], [120.15472979194732, 23.005319455699066], [120.14701687759828, 23.002277784871836],
                        [120.14296840066538, 23.001136328022], [120.1416405455451, 22.999745274471707], [120.13809958714228, 22.9937837390831]
                    ], 
                    jianan: [
                        [120.271733, 23.108189], [120.271038, 23.105101], [120.270575, 23.104705], [120.270641, 23.103944],
                        [120.270459, 23.102986], [120.270906, 23.102575], [120.270945, 23.101577], [120.270845, 23.101480],
                        [120.270995, 23.099969], [120.270967, 23.099612], [120.270792, 23.097123], [120.270542, 23.096418],
                        [120.266026, 23.095475], [120.265564, 23.094727], [120.265462, 23.094005], [120.265518, 23.091660],
                        [120.265629, 23.091261], [120.269064, 23.088363], [120.269416, 23.087848], [120.269379, 23.086982],
                        [120.269296, 23.086447], [120.269139, 23.086209], [120.265131, 23.084858], [120.263988, 23.084731],
                        [120.260765, 23.083720], [120.259342, 23.082692], [120.258908, 23.082548], [120.257116, 23.082650],
                        [120.256276, 23.082497], [120.253598, 23.080228], [120.253080, 23.079565], [120.252896, 23.077889],
                        [120.252535, 23.077404], [120.252101, 23.077175], [120.251853, 23.076717], [120.251955, 23.075459],
                        [120.251345, 23.074278], [120.251291, 23.074205], [120.248718, 23.071947], [120.245708, 23.066739],
                        [120.243336, 23.062568], [120.240793, 23.060216], [120.236847, 23.056810], [120.230292, 23.051061],
                        [120.226851, 23.045736], [120.220451, 23.036356], [120.216766, 23.030920], [120.212424, 23.028814],
                        [120.208260, 23.028657], [120.193166, 23.029837], [120.189832, 23.029168], [120.176875, 23.025377],
                        [120.173612, 23.023399], [120.171204, 23.021544], [120.166292, 23.016696], [120.159833, 23.016026],
                        [120.150635, 23.013497], [120.147697, 23.012859], [120.142696, 23.009468], [120.141528, 23.005439],
                        [120.140819, 22.999721], [120.139589, 22.996637], [120.136844, 22.994410]
                    ] 
                };
                
                var riverKey = type.split('_')[1];
                var riverLine = turf.lineString(p[riverKey]);
                var buffer = turf.buffer(riverLine, 200, { units: 'meters' });

                currentGeoFenceBufferLayer = L.geoJSON(buffer, { style: { color: '#3498db', weight: 2, opacity: 0.5, fillColor: '#3498db', fillOpacity: 0.15 } }).addTo(map);
                routePointsData = allMarkersData.filter(i => turf.booleanPointInPolygon(turf.point([i.lon, i.lat]), buffer));
                
                var leafletPath = p[riverKey].map(coord => [coord[1], coord[0]]);
                executeStandardRoute(type, leafletPath);
            }
        }

        function playNextRoutePoint() {
    if (!isRoutePlaying) return;

    if (currentRouteIndex >= routePointsData.length) {
        alert("路線探索完畢！");
        // 🌟 自動觸發結束路線，清理紅色路徑、重置叢集地標、隱藏結束按鈕
        toggleRoute('clear', document.getElementById('clearRouteBtn'));
        return;
    }

    var marker = routeMarkerObjects[currentRouteIndex];
    var point = routePointsData[currentRouteIndex];

    if (!marker || !point) {
        currentRouteIndex++;
        playNextRoutePoint();
        return;
    }

    markerCluster.zoomToShowLayer(marker, () => {
        if (!isRoutePlaying) return;

        // 🌟 退回 Body 之前，先套上隱形斗篷，避免在底部閃爍！
        var player = getGlobalPlayerEl_();
        if (player) player.style.opacity = '0';

        restoreGlobalPlayerToBody_(true);

        marker.once('popupopen', function() {
                    if (!isRoutePlaying) return;

                    // 🌟 核心修復 2：給 Leaflet 動畫 150ms 的喘息時間，並刪除重複的 mount 呼叫
                    setTimeout(function() {
                        if (point.audioUrl) {
                            startGlobalPlayback(point.uid, { skipFocus: true });
                        } else {
                            routeTimeout = setTimeout(() => {
                                if (isRoutePlaying) {
                                    currentRouteIndex++;
                                    playNextRoutePoint();
                                }
                            }, 4000);
                        }
                    }, 150);
                });

                marker.openPopup();
            });
        }

        function startGlobalPlayback(uid, options) {
    options = options || {};

    var item = allMarkersData.find(i => i.uid === uid);
    if (!item) return;

    var player = getGlobalPlayerEl_();
    if (!player) return;

    // 🌟 防止轉場時播放條在底部閃現：先披上隱形斗篷
    player.style.opacity = '0';

    if (currentAudioUid === uid) {
        player.classList.add('active');
        mountGlobalPlayerIntoPopup_();
        return;
    }

    currentAudioUid = uid;

    var header = document.querySelector('.glass-header');
    if (header) {
        header.classList.add('compact-mode');
    }

        player.classList.add('active');

    // ✅ 修正：第一次播放新作品時，立刻把播放器嵌入目前作品卡片
    // 否則 player 仍停在 body 且 opacity = 0，會造成「有聲音但沒有波形圖」
    mountGlobalPlayerIntoPopup_();

    var titleContainer = player.querySelector('#playerTitleContainer');
    var titleUI = player.querySelector('#playerTitleUI');
    var displayText = item.title + " (採集者: " + item.author + ")";

    if (titleUI) {
        titleUI.innerText = displayText;
        titleUI.classList.remove('marquee-text');
    }

    setTimeout(() => {
        if (titleUI && titleContainer && titleUI.scrollWidth > titleContainer.clientWidth) {
            var spacer = "          ";
            titleUI.innerHTML = `<span>${displayText}${spacer}</span><span>${displayText}${spacer}</span>`;
            titleUI.classList.add('marquee-text');
        }
    }, 100);

    var wBase = player.querySelector('#waveBase');
    var wProg = player.querySelector('#waveProgress');

    if (wBase) wBase.style.display = 'block';
    if (wProg) wProg.style.display = 'block';

    // 🌟 徹底解決破圖問題：URL 安全編碼 SVG
    var w = (u, c) => {
        if (u && u.includes('res.cloudinary.com')) {
            return u.replace('/upload/', `/upload/fl_waveform,co_rgb:${c},b_transparent,w_800,h_80/`).replace(/\.[^.]+$/, '.png');
        }
        const colorHex = c === "27ae60" ? "%2327ae60" : "%23bdc3c7";
        const svgStr = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 80' preserveAspectRatio='none'><path d='M0 40 L10 20 L20 60 L30 10 L40 70 L50 30 L60 50 L70 40 L80 15 L90 65 L100 35 L110 45 L120 25 L130 55 L140 40 L150 20 L160 60 L170 30 L180 50 L190 40 L200 10 L210 70 L220 30 L230 50 L240 40 L250 15 L260 65 L270 35 L280 45 L290 25 L300 55 L310 40 L320 20 L330 60 L340 30 L350 50 L360 40 L370 10 L380 70 L390 30 L400 50 L410 40 L420 15 L430 65 L440 35 L450 45 L460 25 L470 55 L480 40 L490 20 L500 60 L510 30 L520 50 L530 40 L540 10 L550 70 L560 30 L570 50 L580 40 L590 15 L600 65 L610 35 L620 45 L630 25 L640 55 L650 40 L660 20 L670 60 L680 30 L690 50 L700 40 L710 10 L720 70 L730 30 L740 50 L750 40 L760 15 L770 65 L780 35 L790 45 L800 25' fill='none' stroke='${colorHex}' stroke-width='2'/></svg>`;
        return `data:image/svg+xml,${encodeURIComponent(svgStr)}`;
    };

    if (wBase) wBase.src = w(item.audioUrl, "bdc3c7");

    if (wProg) {
        wProg.src = w(item.audioUrl, "27ae60");
        wProg.style.clipPath = 'inset(0 100% 0 0)';
    }

    var timeDisplay = player.querySelector('#playerTimeDisplay');
    if (timeDisplay) {
        timeDisplay.innerText = "00:00 / 00:00";
    }

    globalAudio.src = item.audioUrl;

    globalAudio.onerror = function() {
        console.warn("首選來源載入失敗，檢測是否需切換...");

        if (item.fallbackAudioUrl && globalAudio.src !== item.fallbackAudioUrl) {
            globalAudio.src = item.fallbackAudioUrl;
            globalAudio.load();
            globalAudio.play().catch(e => console.error("備援載入也失敗"));
        } else {
            console.error("所有音軌來源均失效");
        }
    };

    globalAudio.play().catch(e => console.warn("等待使用者手動觸發播放", e));

    var toggleBtn = player.querySelector('#playerToggleBtn');
    if (toggleBtn) {
        toggleBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    }
}
        
                var globalPlayerElCache = null;

function getGlobalPlayerEl_() {
    if (!globalPlayerElCache) {
        globalPlayerElCache = document.getElementById('globalPlayer');
    }
    return globalPlayerElCache;
}

function restoreGlobalPlayerToBody_(suppressFloating) {
    var player = getGlobalPlayerEl_();
    if (!player) return;

    if (suppressFloating) {
        player.classList.add('suppress-floating');
    } else {
        player.classList.remove('suppress-floating');
    }

    player.classList.remove('embedded-player');
    document.body.classList.remove('player-embedded');

    if (player.parentElement !== document.body) {
        document.body.appendChild(player);
    }
}

function mountGlobalPlayerIntoPopup_(retry) {
    retry = retry || 0;

    var player = getGlobalPlayerEl_();
    if (!player) return;

    var isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var isRealMobile = isSmallScreen && isTouchDevice;

    if (isRealMobile) {
        restoreGlobalPlayerToBody_();
        player.style.opacity = '1'; // 手機版維持可見
        return;
    }

    // 🌟 終極修復：不要依賴 ID，因為卡片切換時會有殘影。直接抓取「最後一個(最新)」開啟的 popup 插槽
    var popups = document.querySelectorAll('.leaflet-popup');
    var activePopup = popups.length > 0 ? popups[popups.length - 1] : null;
    var target = activePopup ? activePopup.querySelector('.embedded-player-slot') : null;

    if (!target) {
        if (retry < 15) { // 增加重試次數，等待卡片動畫完成
            setTimeout(function() {
                mountGlobalPlayerIntoPopup_(retry + 1);
            }, 100);
        } else {
            player.style.opacity = '1'; // 放棄搬移，至少脫下斗篷確保可見
        }
        return;
    }

    player.classList.remove('suppress-floating');
    player.classList.add('embedded-player');
    player.classList.add('active');
    document.body.classList.add('player-embedded');
    target.appendChild(player);

    // 🌟 成功塞進新卡片後，脫下隱形斗篷！
    setTimeout(() => { player.style.opacity = '1'; }, 50);
}
    
            function closeGlobalPlayer() { 
            globalAudio.pause(); 

            var player = getGlobalPlayerEl_();
            if (player) player.classList.remove('active');

            restoreGlobalPlayerToBody_();

            var header = document.querySelector('.glass-header');
            if (header) header.classList.remove('compact-mode'); 

            currentAudioUid = null; 
            isRoutePlaying = false; 
            clearTimeout(routeTimeout); 
        }
        
        function toggleMute() { 
            globalAudio.muted = !globalAudio.muted;
            var mb = document.getElementById('muteBtn'); 
            if(globalAudio.muted || globalAudio.volume == 0) {
                mb.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
            } else {
                mb.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
            }
        }
        function changeVolume() { 
            globalAudio.volume = document.getElementById('volumeSlider').value; 
            if(globalAudio.volume > 0 && globalAudio.muted) globalAudio.muted = false;
            var mb = document.getElementById('muteBtn'); 
            if(globalAudio.muted || globalAudio.volume == 0) mb.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
            else mb.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
        }
        
        let loggedAudioUids = new Set(); // 🌟 使用 Set 記住此次連線聽過的所有作品
        let hasLoggedPlay = false;       // 配合 UI 狀態使用

        globalAudio.addEventListener('play', () => {
            hasLoggedPlay = false; 
            if (currentAudioUid) logAction(currentAudioUid, 'play_start');
        });

        globalAudio.ontimeupdate = () => { 
    if (globalAudio.duration && currentAudioUid) {
        var player = getGlobalPlayerEl_();
        var waveProgress = player ? player.querySelector('#waveProgress') : null;
        var timeDisplay = player ? player.querySelector('#playerTimeDisplay') : null;

        if (waveProgress) {
            waveProgress.style.clipPath = `inset(0 ${100 - (globalAudio.currentTime / globalAudio.duration * 100)}% 0 0)`;
        }

        if (timeDisplay) {
            timeDisplay.innerText = formatTime(globalAudio.currentTime) + ' / ' + formatTime(globalAudio.duration);
        }
        
        let threshold = Math.min(10, globalAudio.duration * 0.3);
        
        // 🌟 只要這首歌被加入過 Set，就絕對不再發送 10s log
        if (globalAudio.currentTime > threshold && !loggedAudioUids.has(currentAudioUid)) {
            logAction(currentAudioUid, 'play_10s'); 
            loggedAudioUids.add(currentAudioUid);
            console.log(`有效聆聽：${currentAudioUid}`);
        }
    } 
};
        
        function seekGlobalAudio(e) { var rect = document.getElementById('waveformWrapper').getBoundingClientRect(); globalAudio.currentTime = ((e.clientX - rect.left) / rect.width) * globalAudio.duration; }
        
        // ==========================================
        // Phase 2: Firebase Auth & Firestore 邏輯
        // ==========================================
        const firebaseConfig = {
            apiKey: "AIzaSyBXGNMbKedaTF2XjePRpFhNIv3NwRrmo_U",
            authDomain: "haidian-soundscape.firebaseapp.com",
            projectId: "haidian-soundscape",
            storageBucket: "haidian-soundscape.firebasestorage.app",
            messagingSenderId: "116926349938",
            appId: "1:116926349938:web:5ace762dab874d323f78eb"
        };
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.firestore();

        let currentUser = null;

        function toggleLogin() {
            if (currentUser) {
                auth.signOut().then(() => alert("已登出"));
                return;
            }

            const provider = new firebase.auth.GoogleAuthProvider();
            // 🌟 判斷是否為行動裝置
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

            // 🌟 手機用跳轉登入 (Redirect)，桌機用彈出視窗 (Popup)
            const loginAction = isMobile
                ? auth.signInWithRedirect(provider)
                : auth.signInWithPopup(provider);

            loginAction.catch(error => {
                const silentLoginCancelCodes = new Set([
                    "auth/popup-closed-by-user",
                    "auth/cancelled-popup-request",
                    "auth/redirect-cancelled-by-user",
                    "auth/user-cancelled"
                ]);

                const errorCode = error && error.code ? error.code : "";
                const errorMessage = error && error.message ? error.message : "";

                // 使用者主動關閉 Google 登入視窗時，視為取消登入，不顯示錯誤彈窗。
                if (
                    silentLoginCancelCodes.has(errorCode) ||
                    errorMessage.includes("popup-closed-by-user") ||
                    errorMessage.includes("closed by the user")
                ) {
                    return;
                }

                console.error("登入失敗:", error);
                alert("登入失敗：" + (errorMessage || "請重試"));
            });
        }

        function updateAuthUI(user) {
            let navFavBtn = document.getElementById('navFavBtn');
            if (navFavBtn) navFavBtn.style.display = user ? 'flex' : 'none'; 
            let authBtn = document.getElementById('authBtn');
            
            if (!authBtn) {
                authBtn = document.createElement('button');
                authBtn.id = 'authBtn';
                authBtn.onclick = toggleLogin;
                authBtn.style.marginLeft = '10px';
                authBtn.className = 'btn-submit'; 
                authBtn.style.background = '#3498db'; 
                authBtn.style.boxShadow = '0 4px 12px rgba(52, 152, 219, 0.25)';
                document.querySelector('.nav-buttons').appendChild(authBtn);
            }

            if (user) {
                authBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span class="full-text">登出 (${user.displayName.split(' ')[0]})</span><span class="short-text">登出</span>
                `;
            } else {
                authBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
                    <span class="full-text">登入探險</span><span class="short-text">登入</span>
                `;
            }
        }

        function logAction(uid, eventType) {
            const userKey = currentUser ? currentUser.uid : 'guest_' + Math.random().toString(36).substr(2, 9);
            db.collection("traffic_log").add({
                uid: uid,
                eventType: eventType,
                userKey: userKey,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(error => {
                console.error("寫入 Log 失敗:", error);
            });
        }
        function openModal(id) { closeAllDrawers(); document.getElementById(id).classList.add('active'); }
        function closeModal(id) { document.getElementById(id).classList.remove('active'); }
        function closeModalOnBgClick(e, id) { if (e.target.id === id) closeModal(id); }
        
        // ==========================================
        // Phase 2.5: Firebase 專屬收藏庫 (Favorites)
        // ==========================================
        let userFavorites = new Set();

        auth.onAuthStateChanged(user => {
            currentUser = user;
            updateAuthUI(user);
            
            if (user) {
                db.collection("user_favorites").where("userId", "==", user.uid).get()
                .then(snapshot => {
                    userFavorites.clear();
                    snapshot.forEach(doc => userFavorites.add(doc.data().soundUid));
                    updateFavoriteUI(); 
                });
            } else {
                userFavorites.clear();
                updateFavoriteUI();
            }
        });

        function toggleFavorite(targetUid) {
            if (!currentUser) {
                alert("請先點擊右上角「登入探險」，登入後即可將這首聲音加入專屬收藏庫！");
                return;
            }
            
            let uid = targetUid || currentAudioUid;
            if (!uid) return;

            let isFav = userFavorites.has(uid);
            let docId = currentUser.uid + "_" + uid; 
            let favRef = db.collection("user_favorites").doc(docId);

            if (isFav) {
                favRef.delete().then(() => {
                    userFavorites.delete(uid);
                    updateFavoriteUI();
                    let favToggle = document.getElementById('favFilterToggle');
                    if (favToggle && favToggle.checked) filterMarkers();
                });
            } else {
                let globalBtn = document.getElementById('favBtn');
                let cardBtn = document.getElementById('card-fav-' + uid);
                if (globalBtn && uid === currentAudioUid) globalBtn.classList.add('active');
                if (cardBtn) cardBtn.classList.add('active');
                
                favRef.set({
                    userId: currentUser.uid,
                    soundUid: uid,
                    addedAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(() => {
                    userFavorites.add(uid);
                    updateFavoriteUI();
                    logAction(uid, 'favorite');
                });
            }
        }

        function updateFavoriteUI() {
            let favBtn = document.getElementById('favBtn');
            if (favBtn) {
                if (currentAudioUid && userFavorites.has(currentAudioUid)) favBtn.classList.add('active');
                else favBtn.classList.remove('active');
            }
            
            document.querySelectorAll('.sound-card .fav-btn').forEach(btn => {
                let uid = btn.id.replace('card-fav-', '');
                if (userFavorites.has(uid)) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            renderFavoritesList();
        }

        function renderFavoritesList() {
            let listDiv = document.getElementById('favoritesList');
            if (!listDiv) return;
            
            if (userFavorites.size === 0) {
                listDiv.innerHTML = '<div style="text-align:center; color:#94a3b8; font-size:13px; line-height:1.6; display:flex; flex-direction:column; align-items:center; gap:6px;"><span>目前空空如也！</span><span style="display:flex; align-items:center; gap:4px;">趕快去地圖上點擊 <svg width="14" height="14" viewBox="0 0 24 24" fill="#f43f5e" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> 收藏聲音吧！</span></div>';
                return;
            }
            
            let html = '';
            userFavorites.forEach(uid => {
                let item = allMarkersData.find(i => i.uid === uid);
                if (item) {
                    let rawDate = (item.date || "").split(" ")[0].replace(/-/g, "/"); 
                    html += `
                        <div class="latest-item" onclick="closeModal('favoritesModal'); focusMarkerOnMap('${item.uid}')">
                            <img src="${item.coverUrl}" onerror="this.src='https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?q=80&w=100&auto=format&fit=crop'">
                            <div class="latest-item-info">
                                <div class="latest-item-title">${item.title}</div>
                                <div class="latest-item-meta">
                                    <span style="display:flex; align-items:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> ${item.author}</span>
                                    <span style="font-family:'Courier New', monospace;">${rawDate}</span>
                                </div>
                            </div>
                        </div>`;
                }
            });
            listDiv.innerHTML = html;
        }

        const originalStartGlobalPlayback = startGlobalPlayback;
        startGlobalPlayback = function(uid) {
            originalStartGlobalPlayback(uid);
            setTimeout(updateFavoriteUI, 100); 
            setTimeout(() => updateReactionUI(uid), 100); // 🌟 連動更新徽章
        };

        // ==========================================
        // Phase 2.6: SEL 情緒回音板 (Reactions)
        // ==========================================
        let userReactions = {}; 

        auth.onAuthStateChanged(user => {
            if (user) {
                db.collection("user_reactions").where("userId", "==", user.uid).get()
                .then(snapshot => {
                    userReactions = {};
                    snapshot.forEach(doc => { userReactions[doc.data().soundUid] = doc.data().reactionType; });
                    updateAllReactionsUI();
                });
            } else {
                userReactions = {};
                updateAllReactionsUI();
            }
        });

        window.toggleReaction = function(uid, type) {
            if (!currentUser) {
                alert("請先點擊右上角「登入探險」，才能留下你的聽覺感受喔！");
                return;
            }

            let docId = currentUser.uid + "_" + uid; 
            let reactionRef = db.collection("user_reactions").doc(docId);
            
            let oldType = userReactions[uid];
            
            if (oldType === type) {
                delete userReactions[uid];
                updateReactionUI(uid);
                reactionRef.delete();
            } else {
                userReactions[uid] = type;
                updateReactionUI(uid);
                reactionRef.set({
                    userId: currentUser.uid,
                    soundUid: uid,
                    reactionType: type,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                logAction(uid, 'reaction_' + type);
            }
        };

        window.updateReactionUI = function(uid) {
            let bar = document.getElementById('reaction-bar-' + uid);
            if (!bar) return;
            
            let selectedType = userReactions[uid];
            bar.querySelectorAll('.reaction-btn').forEach(btn => {
                if (btn.dataset.type === selectedType) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        };

        function updateAllReactionsUI() {
            Object.keys(userReactions).forEach(uid => updateReactionUI(uid));
        }

        // 🌟 覆寫卡片開啟事件，確保 SEL 徽章狀態正確載入
        const originalPopupOpen = map._events.popupopen ? map._events.popupopen[0].fn : null;
        map.off('popupopen'); 
        
        map.on('popupopen', function(e) {
            updateHeaderVisibility(true);
            setTimeout(updateCardButtonUI, 50);
            setTimeout(updateFavoriteUI, 50);
            
            let popupContent = e.popup.getContent();

            // 南山公墓 popup 使用 function 動態產生內容；聲景作品 popup 才是字串。
            // 避免南山卡片觸發聲景卡片的收藏／情緒 UI 判斷時爆掉。
            if (typeof popupContent !== 'string') {
                const popupEl = e.popup.getElement();
                popupContent = popupEl ? popupEl.innerHTML : '';
            }

            let uidMatch = popupContent.match(/card-fav-([a-zA-Z0-9_-]+)/);
            if (uidMatch && uidMatch[1]) {
                setTimeout(() => updateReactionUI(uidMatch[1]), 50);
            }
        });

        // ==========================================
        // Phase 2.7: 聲音獵人 遊戲化成就系統
        // ==========================================
        let unlockedBadges = new Set();
        
        // 定義三個階段的徽章資料
        const BADGE_DATA = {
            'eco_listener': {
                id: 'eco_listener', name: '生態傾聽者', desc: '成功收集 3 個「自然絮語」或「空間聲」類別的聲音。',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c4-4 8-10 8-14a8 8 0 1 0-16 0c0 4 4 10 8 14z"></path></svg>'
            },
            'village_tracker': {
                id: 'village_tracker', name: '聚落尋跡人', desc: '成功收集 5 個「常民聲」或「活動與產業」類別的聲音。',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
            },
            'time_voyager': {
                id: 'time_voyager', name: '台江時空旅人', desc: '收集超過 10 個聲音，且包含至少 1 個「歲月回音」。',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
            }
        };

        // 登入時載入已解鎖成就
        auth.onAuthStateChanged(user => {
            if (user) {
                db.collection("user_achievements").doc(user.uid).get().then(doc => {
                    if (doc.exists && doc.data().badges) {
                        unlockedBadges = new Set(doc.data().badges);
                    } else { unlockedBadges.clear(); }
                    renderAchievementWall();
                });
            }
        });

        // 核心邏輯：每次動作或打開成就牆時，檢查是否滿足條件
        window.checkAchievements = function() {
            if (!currentUser) return;
            
            // 將「愛心收藏」和「SEL情緒」的作品 UID 合併，去重複計算
            let interactedUids = new Set([...userFavorites, ...Object.keys(userReactions)]);
            let counts = { nature: 0, culture: 0, history: 0, total: interactedUids.size };
            
            interactedUids.forEach(uid => {
                let item = allMarkersData.find(i => i.uid === uid);
                if (item) {
                    if (item.category.includes('自然') || item.category.includes('空間')) counts.nature++;
                    if (item.category.includes('常民') || item.category.includes('活動') || item.category.includes('產業')) counts.culture++;
                    if (item.category.includes('歲月')) counts.history++;
                }
            });

            let newBadges = [];
            if (counts.nature >= 3 && !unlockedBadges.has('eco_listener')) newBadges.push('eco_listener');
            if (counts.culture >= 5 && !unlockedBadges.has('village_tracker')) newBadges.push('village_tracker');
            if (counts.total >= 10 && counts.history >= 1 && !unlockedBadges.has('time_voyager')) newBadges.push('time_voyager');

            if (newBadges.length > 0) {
                newBadges.forEach(bId => unlockedBadges.add(bId));
                
                db.collection("user_achievements").doc(currentUser.uid).set({
                    badges: Array.from(unlockedBadges),
                    lastUnlockedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                showUnlockAnimation(BADGE_DATA[newBadges[newBadges.length - 1]]);
                // 🌟 註解掉此行，避免成就與渲染引發無限迴圈
                // renderAchievementWall(); 
            }
        };

        function showUnlockAnimation(badgeData) {
            document.getElementById('unlockedBadgeIcon').innerHTML = badgeData.svg;
            document.getElementById('unlockedBadgeName').innerText = badgeData.name;
            document.getElementById('unlockedBadgeDesc').innerText = badgeData.desc;
            
            // 關閉其他可能開啟的 Modal
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
            closeAllDrawers();
            
            // 延遲一下再跳出，讓使用者先看完點擊愛心的回饋
            setTimeout(() => {
                document.getElementById('badgeUnlockModal').classList.add('active');
            }, 800);
        }

        // 🌟 新增：專門負責打開成就牆的統籌函式
        function openAchievementWall() {
            checkAchievements();       // 1. 先結算最新成績
            renderAchievementWall();   // 2. 根據成績畫出徽章
            openModal('achievementWallModal'); // 3. 打開彈出視窗
        }

        function renderAchievementWall() {
            let grid = document.getElementById('achievementWallGrid');
            if(!grid) return;
            grid.innerHTML = '';
            
            Object.values(BADGE_DATA).forEach(badge => {
                let isUnlocked = unlockedBadges.has(badge.id);
                grid.innerHTML += `
                    <div class="wall-badge ${isUnlocked ? 'unlocked' : ''}" title="解鎖條件：${badge.desc}">
                        <div class="mini-icon">${badge.svg}</div>
                        <div class="wall-badge-name">${badge.name}</div>
                        <div style="font-size:10px; color:#94a3b8; font-weight: 800; display:flex; align-items:center; justify-content:center; gap:3px;">
                            ${isUnlocked ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg> 已解鎖' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> 未解鎖'}
                        </div>
                        <div class="wall-badge-desc">${badge.desc}</div>
                    </div>
                `;
            });
        }

        // 🌟 攔截之前的 toggleFavorite 與 toggleReaction，在最後加上檢查成就的呼叫
        const originalToggleFavorite = toggleFavorite;
        toggleFavorite = function(targetUid) {
            originalToggleFavorite(targetUid);
            setTimeout(checkAchievements, 500); // 延遲檢查，等待資料庫更新
        };

        const originalToggleReaction = window.toggleReaction;
        window.toggleReaction = function(uid, type) {
            originalToggleReaction(uid, type);
            setTimeout(checkAchievements, 500); 
        };

        // ==========================================
        // 🚀 新投稿系統：預填表單、長按選點、GPS定位
        // ==========================================
        const FORM_BASE_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdEq8I8O6zWZ95RO0Jf-YCKAuwUedMHsnThrU71FcTJQbuGGg/viewform";
        const GPS_ENTRY_ID = "entry.255203319"; // 🌟 已經完美替換為您的真實代碼！

        function showSubmitPopup(latlng) {
            var lat = latlng.lat.toFixed(6);
            var lon = latlng.lng.toFixed(6);
            var gpsString = lat + ", " + lon;
            var prefillUrl = FORM_BASE_URL + "?usp=pp_url&" + GPS_ENTRY_ID + "=" + encodeURIComponent(gpsString);

            var popupContent = `
                <div style="text-align:center; padding:5px; min-width: 150px;">
                    <div style="font-weight:900; font-size:15px; color:#27ae60; margin-bottom:8px; display:flex; justify-content:center; align-items:center; gap:6px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 
                        標記這個位置？
                    </div>
                    <div style="font-size:11px; color:#7f8c8d; margin-bottom:12px; font-family:'Courier New', monospace;">${gpsString}</div>
                    <button onclick="window.open('${prefillUrl}', '_blank')" style="background:#27ae60; color:#fff; border:none; padding:8px 15px; border-radius:8px; font-weight:800; cursor:pointer; width:100%; box-shadow:0 4px 10px rgba(39,174,96,0.3);">
                        用此座標前往投稿
                    </button>
                </div>
            `;
            L.popup({ closeButton: true, autoClose: true, className: 'map-click-popup' })
             .setLatLng(latlng).setContent(popupContent).openOn(map);
        }

        // 電腦版支援右鍵
        map.on('contextmenu', function(e) { showSubmitPopup(e.latlng); });

        // 手機版長按偵測 (0.7秒)
        var longPressTimer;
        map.on('mousedown touchstart', function(e) {
            if (e.originalEvent && e.originalEvent.target.closest('.leaflet-control, .glass-header, .drawer-panel, .global-player, .locate-me-wrapper')) return;
            longPressTimer = setTimeout(function() { showSubmitPopup(e.latlng); }, 700); 
        });
        map.on('mouseup mousemove touchend touchmove dragstart', function(e) { clearTimeout(longPressTimer); });

        // 一鍵抓取手機 GPS 
        window.locateAndSubmit = function() {
            if (!navigator.geolocation) {
                alert("您的裝置不支援自動定位，請使用「地圖長按選點」功能。"); return;
            }
            var btn = document.querySelector('#submitChoiceModal .btn-submit');
            var originalText = btn.innerHTML;
            btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: badgeShine 2s linear infinite;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 定位中...請稍候`;

            navigator.geolocation.getCurrentPosition(
                function(position) {
                    var gpsString = position.coords.latitude.toFixed(6) + ", " + position.coords.longitude.toFixed(6);
                    var prefillUrl = FORM_BASE_URL + "?usp=pp_url&" + GPS_ENTRY_ID + "=" + encodeURIComponent(gpsString);
                    btn.innerHTML = originalText;
                    closeModal('submitChoiceModal');
                    window.open(prefillUrl, '_blank');
                },
                function(error) {
                    btn.innerHTML = originalText;
                    alert("無法獲取您的位置！可能是 GPS 未開啟，請改用「返回地圖長按選點」。");
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        };

        // 地圖上的「定位我」按鈕
        var userLocationMarker = null, userLocationCircle = null;
        window.flyToMyLocation = function() {
            var btn = document.getElementById('locateMeBtn');
            if(btn) btn.classList.add('locating');
            map.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true });
        };

        map.on('locationfound', function(e) {
            var btn = document.getElementById('locateMeBtn');
            if(btn) btn.classList.remove('locating');
            if (userLocationMarker) map.removeLayer(userLocationMarker);
            if (userLocationCircle) map.removeLayer(userLocationCircle);

            userLocationCircle = L.circle(e.latlng, { radius: e.accuracy / 2, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 1, interactive: false }).addTo(map);
            userLocationMarker = L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2.5, fillColor: '#3b82f6', fillOpacity: 1, zIndexOffset: 4000 }).addTo(map);
            
            // 🌟 注入高顏值 HTML 結構與專屬 Class
            var hintContent = `
                <div class="hint-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
                    目前粗略位置
                </div>
                <div class="hint-body">
                    請直接 <strong>長按地圖</strong> 精準標記你想投稿的點！
                </div>
            `;
            userLocationMarker.bindPopup(hintContent, { 
                className: 'custom-hint-popup', 
                offset: [0, -5],
                autoClose: true
            }).openPopup();
        });

        map.on('locationerror', function(e) {
            var btn = document.getElementById('locateMeBtn');
            if(btn) btn.classList.remove('locating');
            alert("無法獲取您的位置！\n請確認您已允許瀏覽器存取「定位服務」。");
        });

        if (window.innerWidth <= 600) { ['sidePanel', 'routePanel'].forEach(id => document.getElementById(id).classList.add('collapsed')); }

        // 🌟 迎賓帷幕邏輯 (乾淨標準版)
        document.addEventListener("DOMContentLoaded", function() {
            var splash = document.getElementById("splashScreen");
            if (!splash) return;

            if (localStorage.getItem("haidian_visited") === "true") {
                splash.style.display = "none";
            }
        });

        function enterMap() {
            var splash = document.getElementById("splashScreen");
            if (!splash) return;

            splash.classList.add("is-hidden");
            localStorage.setItem("haidian_visited", "true");

            setTimeout(function() {
                splash.style.display = "none";
            }, 600);
        }

 // 🌟 專注模式：只保留作品、作品 Popup、播放器與退出按鈕。
window.toggleListeningMode = function() {
    var enteringFocusMode = !document.body.classList.contains('listening-mode');

    document.body.classList.toggle('listening-mode', enteringFocusMode);

    if (!enteringFocusMode) {
        return false;
    }

    // 先同步關閉 V4 的聆聽／走讀／圖資狀態，避免退出專注模式後殘留半開面板。
    if (typeof window.haidianV4CloseAll === "function") {
        window.haidianV4CloseAll(true);
    } else if (typeof closeAllDrawers === "function") {
        closeAllDrawers();
    }

    // 手繪與路線介面不屬於作品本身，進入專注模式時一併收起。
    var drawModeHud = document.getElementById('drawModeHUD');
    if (drawModeHud) {
        drawModeHud.classList.remove('active');
    }

    return false;
};

       // ==========================================
        // 🌊 新增模組：即時淹水感測器戰情室 (通用設計形狀分級與直覺篩選)
        // ==========================================
        // ==========================================
// 🌊 即時淹水感測器：不漏站版
// ==========================================
let realtimeFloodLayer = null;
let realtimeFloodInterval = null;
window.currentFloodData = {};
window.showOnlyFlooded = false;

const FLOOD_DISPLAY_THRESHOLD_CM = 1;
const FLOOD_STALE_AFTER_HOURS = 24;

// API 有些同站資料流會包含 Raw Data；這筆永康站已確認需 ×10 才是實際 61 cm。
const FLOOD_STATION_SCALE_OVERRIDES = {
  "永康區-永明街與中山南路4巷165弄路口": 10
};

window.toggleShowOnlyFlooded = function(checked) {
  window.showOnlyFlooded = checked;
  renderRealtimeFloodMap();
};

async function toggleRealtimeFlood(checked) {
  const panel = document.getElementById("realtimeFloodControlPanel");
  const statusEl = document.getElementById("realtimeFloodStatus");

  if (panel) panel.style.display = checked ? "block" : "none";

  clearInterval(realtimeFloodInterval);
  realtimeFloodInterval = null;

  if (!checked) {
    if (realtimeFloodLayer && map.hasLayer(realtimeFloodLayer)) {
      map.removeLayer(realtimeFloodLayer);
    }
    return;
  }

  if (statusEl) {
    statusEl.innerHTML =
      '<span style="color:#b91c1c;">📡 連線物聯網大數據中心...</span>';
  }

  if (!realtimeFloodLayer) {
  realtimeFloodLayer =
    typeof L.markerClusterGroup === "function"
      ? L.markerClusterGroup({
          chunkedLoading: true,
          chunkInterval: 80,
          chunkDelay: 16,
          maxClusterRadius: 52,
          disableClusteringAtZoom: 15,
          spiderfyOnMaxZoom: false,
          showCoverageOnHover: false,
          removeOutsideVisibleBounds: true,

          iconCreateFunction(cluster) {
            const count = cluster.getChildCount();

            return L.divIcon({
              className: "flood-cluster-icon",
              iconSize: [42, 42],
              iconAnchor: [21, 21],
              html: `
                <div style="
                  width:42px;
                  height:42px;
                  border-radius:50%;
                  display:flex;
                  align-items:center;
                  justify-content:center;
                  background:#0f766e;
                  color:#fff;
                  border:3px solid rgba(255,255,255,.95);
                  box-shadow:0 4px 14px rgba(15,118,110,.35);
                  font:800 12px/1 system-ui,sans-serif;
                ">
                  ${count > 999 ? "999+" : count}
                </div>
              `
            });
          }
        })
      : L.layerGroup();
}

if (!map.hasLayer(realtimeFloodLayer)) {
  map.addLayer(realtimeFloodLayer);
}

  await updateRealtimeFlood();
  realtimeFloodInterval = setInterval(updateRealtimeFlood, 5 * 60 * 1000);
}

function getFloodDepthCm(ds, stationName) {
  const rawResult = ds?.Observations?.[0]?.result;

  // 沒有即時值不等於 0 cm。
  if (
    rawResult === null ||
    rawResult === undefined ||
    String(rawResult).trim() === ""
  ) {
    return null;
  }

  const rawValue = Number(rawResult);
  if (!Number.isFinite(rawValue)) return null;

  const unit = String(
    ds?.unitOfMeasurement?.symbol ||
    ds?.unitOfMeasurement?.name ||
    "cm"
  ).trim().toLowerCase();

  let depthCm = rawValue;

  if (
    unit === "m" ||
    unit === "meter" ||
    unit === "metre" ||
    unit === "公尺"
  ) {
    depthCm = rawValue * 100;
  } else if (unit === "mm" || unit === "毫米") {
    depthCm = rawValue / 10;
  }

  const scale = FLOOD_STATION_SCALE_OVERRIDES[stationName];
  if (scale) depthCm *= scale;

  return Math.max(0, Math.round(depthCm * 10) / 10);
}

function floodRecordState(ds, depthCm, observedAtMs) {
  const declaredStatus = String(
    ds?.Thing?.properties?.realtimeStatus || ""
  ).trim().toLowerCase();

  const hasObservation =
    depthCm !== null &&
    declaredStatus !== "metadata_only";

  const hasValidTimestamp = Number.isFinite(observedAtMs);

  const hoursAgo = hasValidTimestamp
    ? (Date.now() - observedAtMs) / 3600000
    : Number.POSITIVE_INFINITY;

  return {
    hasObservation,
    hasValidTimestamp,
    hoursAgo,
    isStale:
      hasObservation &&
      (
        !hasValidTimestamp ||
        hoursAgo > FLOOD_STALE_AFTER_HOURS ||
        hoursAgo < -1
      )
  };
}

const TAINAN_SFPN_REALTIME_URL =
    "https://sfpn.tainan.gov.tw/TainanFloodSmartWeb/FloodWater/Services/FloodWaterService.asmx/GetAllRealtimeInfosJson";

const TNWRB_STATION_PATTERN = /^TNWRB\d{4,8}$/i;

function isExplicitlyDisabledFloodStation(value) {
    if (value === false || value === 0) return true;

    const text = String(value ?? "")
        .trim()
        .toLowerCase();

    return ["0", "false", "n", "no", "disabled"].includes(text);
}

function normaliseFloodStationId(value) {
    const raw = String(value ?? "").trim();

    if (!raw) return "";

    const matched = raw.match(/\bTNWRB\s*[-_ ]?\s*(\d{1,8})\b/i);

    if (matched) {
        return `TNWRB${matched[1].padStart(4, "0")}`;
    }

    return raw.replace(/[\s_-]+/g, "").toUpperCase();
}

function parseFloodObservationTime(value) {
    const raw = String(value ?? "").trim();

    if (!raw) {
        return {
            observedAt: "",
            observedAtMs: 0,
            isValid: false
        };
    }

    const isoLike = raw.replace(/\//g, "-").replace(" ", "T");

    const hasTimezone =
        /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoLike);

    const date = new Date(
        hasTimezone
            ? isoLike
            : `${isoLike}+08:00`
    );

    if (!Number.isFinite(date.getTime())) {
        return {
            observedAt: raw,
            observedAtMs: 0,
            isValid: false
        };
    }

    return {
        observedAt: date.toISOString(),
        observedAtMs: date.getTime(),
        isValid: true
    };
}

function getFloodRecordKey(record) {
    // SFPN 的 TNWRB 站號是權威唯一鍵。
    if (TNWRB_STATION_PATTERN.test(record.stationId)) {
        return record.stationId;
    }

    // 其他來源避免不同地點剛好共用 stationId 時互相覆蓋。
    return [
        record.stationId,
        record.stationName,
        record.lon.toFixed(5),
        record.lat.toFixed(5)
    ].join("|");
}

function isFloodRecordBetter(candidate, current) {
    if (!current) return true;

    // SFPN / WMap 是臺南 TNWRB 的權威來源。
    if (candidate.sourcePriority !== current.sourcePriority) {
        return candidate.sourcePriority > current.sourcePriority;
    }

    // 有讀值優先於沒有讀值。
    if (candidate.hasObservation !== current.hasObservation) {
        return candidate.hasObservation;
    }

    // 即時資料優先於逾期資料。
    if (candidate.isStale !== current.isStale) {
        return !candidate.isStale;
    }

    // 同來源時，避免 Raw Data 蓋掉正式資料流。
    const candidateIsRaw = /raw data/i.test(candidate.description || "");
    const currentIsRaw = /raw data/i.test(current.description || "");

    if (candidateIsRaw !== currentIsRaw) {
        return !candidateIsRaw;
    }

    // 不再讓舊的積水值蓋掉較新的 0 cm。
    return candidate.observedAtMs >= current.observedAtMs;
}

async function fetchSfpnRealtimeRows() {
    const response = await fetch(TAINAN_SFPN_REALTIME_URL, {
        cache: "no-store",
        credentials: "omit",
        headers: {
            Accept: "application/json, text/plain, */*"
        }
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(
            `SFPN HTTP ${response.status}; ` +
            text.replace(/\s+/g, " ").slice(0, 200)
        );
    }

    let payload = JSON.parse(
        text.replace(/^\uFEFF/, "").trim()
    );

    // 支援 ASP.NET 常見的 { d: [...] } 或 { d: "[...]" } 格式。
    if (payload?.d !== undefined) {
        payload =
            typeof payload.d === "string"
                ? JSON.parse(payload.d)
                : payload.d;
    }

    const rows =
        Array.isArray(payload)
            ? payload
            : payload?.data ??
              payload?.Data ??
              payload?.value ??
              payload?.Value ??
              [];

    if (!Array.isArray(rows)) {
        throw new Error("SFPN returned no station array");
    }

    return rows
        .filter(row => {
            const stationId = normaliseFloodStationId(row?.StationID);

            return (
                TNWRB_STATION_PATTERN.test(stationId) &&
                !isExplicitlyDisabledFloodStation(row?.IsEnabled)
            );
        })
        .map(row => ({
            ...row,
            StationID: normaliseFloodStationId(row.StationID)
        }));
}

// ===== START: SFPN 單站近 24 小時水深趨勢 =====
const TAINAN_SFPN_HISTORY_BASE_URL =
    "https://wrbweb2.tainan.gov.tw/TainanApi/FloodWater/Infos/Last24Hours/";

const COLIFE_WATER_RESOURCE_BASE_URL =
    "https://sta.colife.org.tw/STA_WaterResource_v2/v1.0/";

const FLOOD_HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const FLOOD_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const COLIFE_HISTORY_MAX_PAGES = 16;

const floodHistoryCache = new Map();

function isSfpnHistoryStation(record) {
    return (
        record?.source === "sfpn" &&
        TNWRB_STATION_PATTERN.test(
            String(record?.stationId ?? "")
        )
    );
}

function isColifeHistoryStation(record) {
    const datastreamId = Number(record?.datastreamId);

    return (
        record?.source === "worker" &&
        Number.isInteger(datastreamId) &&
        datastreamId > 0
    );
}

function canLoadFloodHistory(record) {
    return (
        isSfpnHistoryStation(record) ||
        isColifeHistoryStation(record)
    );
}

function getFloodHistoryContainerId(record) {
    const isSfpn = isSfpnHistoryStation(record);

    const sourceKey = isSfpn
        ? "sfpn"
        : "colife";

    const idKey = isSfpn
        ? record?.stationId
        : record?.datastreamId;

    return `flood-history-${sourceKey}-${String(idKey ?? "unknown")
        .replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function formatFloodHistoryTime(value, withDate = false) {
    const timeInfo = parseFloodObservationTime(value);

    if (!timeInfo.isValid) return "—";

    return new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        month: withDate ? "2-digit" : undefined,
        day: withDate ? "2-digit" : undefined,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).format(new Date(timeInfo.observedAtMs));
}

async function fetchSfpnFloodHistory(stationId) {
    const normalizedStationId =
        normaliseFloodStationId(stationId);

    if (!TNWRB_STATION_PATTERN.test(normalizedStationId)) {
        throw new Error("不是可查詢歷史資料的 TNWRB 測站");
    }

    const cached =
        floodHistoryCache.get(normalizedStationId);

    if (
        cached?.rows &&
        cached.expiresAt > Date.now()
    ) {
        return cached.rows;
    }

    if (cached?.promise) {
        return cached.promise;
    }

    const promise = (async () => {
        const response = await fetch(
            TAINAN_SFPN_HISTORY_BASE_URL +
            encodeURIComponent(normalizedStationId),
            {
                cache: "no-store",
                credentials: "omit",
                headers: {
                    Accept: "application/json, text/plain, */*"
                }
            }
        );

        const text = await response.text();

        if (!response.ok) {
            throw new Error(
                `SFPN 歷史資料 HTTP ${response.status}`
            );
        }

        let payload = JSON.parse(
            text.replace(/^\uFEFF/, "").trim()
        );

        if (payload?.d !== undefined) {
            payload =
                typeof payload.d === "string"
                    ? JSON.parse(payload.d)
                    : payload.d;
        }

        const sourceRows =
            Array.isArray(payload)
                ? payload
                : payload?.data ??
                  payload?.Data ??
                  payload?.value ??
                  payload?.Value ??
                  [];

        if (!Array.isArray(sourceRows)) {
            throw new Error("SFPN 歷史資料沒有陣列格式");
        }

        const rowsByTime = new Map();

        sourceRows.forEach(row => {
            const timeInfo = parseFloodObservationTime(
                row?.InfoTime
            );

            const rawDepth = Number(
                row?.WaterDepth ??
                row?.waterDepth ??
                row?.WaterInner ??
                row?.waterInner
            );

            if (
                !timeInfo.isValid ||
                !Number.isFinite(rawDepth)
            ) {
                return;
            }

            rowsByTime.set(timeInfo.observedAtMs, {
                stationId: normaliseFloodStationId(
                    row?.StationID || normalizedStationId
                ),

                observedAt: timeInfo.observedAt,
                observedAtMs: timeInfo.observedAtMs,

                depthCm: Math.max(
                    0,
                    Math.round(rawDepth * 10) / 10
                ),

                batteryVoltage: Number(row?.BatteryVoltage),
                rssi: Number(row?.RSSI),
                snr: Number(row?.SNR),
                change: Number(row?.Change)
            });
        });

        const rows = [...rowsByTime.values()]
            .sort((a, b) =>
                a.observedAtMs - b.observedAtMs
            );

        if (!rows.length) {
            throw new Error("SFPN 歷史資料沒有有效水深紀錄");
        }

        return rows;
    })();

    floodHistoryCache.set(normalizedStationId, {
        promise
    });

    try {
        const rows = await promise;

        floodHistoryCache.set(normalizedStationId, {
            rows,
            expiresAt:
                Date.now() + FLOOD_HISTORY_CACHE_TTL_MS
        });

        return rows;
    } catch (error) {
        floodHistoryCache.delete(normalizedStationId);
        throw error;
    }
}

function normaliseColifeHistoryDepthCm(rawValue, record) {
    const value = Number(rawValue);

    if (!Number.isFinite(value)) return null;

    const unit = String(record?.unitSymbol || "cm")
        .trim()
        .toLowerCase();

    let depthCm = value;

    if (
        unit === "m" ||
        unit === "meter" ||
        unit === "metre" ||
        unit === "公尺"
    ) {
        depthCm = value * 100;
    } else if (unit === "mm" || unit === "毫米") {
        depthCm = value / 10;
    }

    const scale =
        FLOOD_STATION_SCALE_OVERRIDES[
            record?.stationName
        ];

    if (scale) depthCm *= scale;

    return Math.max(
        0,
        Math.round(depthCm * 10) / 10
    );
}

async function fetchColifeFloodHistory(record) {
    const rawDatastreamId = Number(record?.datastreamId);

    if (
        !Number.isInteger(rawDatastreamId) ||
        rawDatastreamId <= 0
    ) {
        throw new Error("缺少 Colife Datastream ID");
    }

    const cacheKey = `colife:${rawDatastreamId}`;

    const cached =
        floodHistoryCache.get(cacheKey);

    if (
        cached?.rows &&
        cached.expiresAt > Date.now()
    ) {
        return cached.rows;
    }

    if (cached?.promise) {
        return cached.promise;
    }

    const promise = (async () => {
        const firstUrl = new URL(
            `Datastreams(${rawDatastreamId})/Observations`,
            COLIFE_WATER_RESOURCE_BASE_URL
        );

        firstUrl.searchParams.set(
            "$select",
            "result,phenomenonTime"
        );

        firstUrl.searchParams.set(
            "$orderby",
            "phenomenonTime desc"
        );

        firstUrl.searchParams.set("$top", "100");

        let nextUrl = firstUrl.toString();

        const cutoffMs =
            Date.now() - FLOOD_HISTORY_WINDOW_MS;

        const rowsByTime = new Map();
        const requestedUrls = new Set();

        for (
            let page = 0;
            nextUrl && page < COLIFE_HISTORY_MAX_PAGES;
            page++
        ) {
            if (requestedUrls.has(nextUrl)) break;

            requestedUrls.add(nextUrl);

            const response = await fetch(nextUrl, {
                cache: "no-store",
                credentials: "omit",
                headers: {
                    Accept: "application/json, text/plain, */*"
                }
            });

            const text = await response.text();

            if (!response.ok) {
                throw new Error(
                    `Colife 歷史資料 HTTP ${response.status}`
                );
            }

            const payload = JSON.parse(
                text.replace(/^\uFEFF/, "").trim()
            );

            const sourceRows = Array.isArray(payload?.value)
                ? payload.value
                : [];

            let oldestPageTimeMs =
                Number.POSITIVE_INFINITY;

            sourceRows.forEach(row => {
                const timeInfo =
                    parseFloodObservationTime(
                        row?.phenomenonTime
                    );

                const depthCm =
                    normaliseColifeHistoryDepthCm(
                        row?.result,
                        record
                    );

                if (
                    !timeInfo.isValid ||
                    depthCm === null
                ) {
                    return;
                }

                oldestPageTimeMs = Math.min(
                    oldestPageTimeMs,
                    timeInfo.observedAtMs
                );

                if (
                    timeInfo.observedAtMs <
                    cutoffMs
                ) {
                    return;
                }

                rowsByTime.set(
                    timeInfo.observedAtMs,
                    {
                        stationId: record.stationId,
                        datastreamId: rawDatastreamId,

                        observedAt:
                            timeInfo.observedAt,

                        observedAtMs:
                            timeInfo.observedAtMs,

                        depthCm,
                        batteryVoltage: null,
                        rssi: null,
                        snr: null,
                        change: null
                    }
                );
            });

            if (
                Number.isFinite(oldestPageTimeMs) &&
                oldestPageTimeMs <= cutoffMs
            ) {
                break;
            }

            nextUrl = String(
                payload?.["@iot.nextLink"] || ""
            ).trim();
        }

        const rows = [...rowsByTime.values()]
            .sort((a, b) =>
                a.observedAtMs - b.observedAtMs
            );

        rows.forEach((row, index) => {
            if (index === 0) return;

            row.change = Math.round(
                (
                    row.depthCm -
                    rows[index - 1].depthCm
                ) * 10
            ) / 10;
        });

        if (!rows.length) {
            throw new Error(
                "Colife 近 24 小時沒有有效水深紀錄"
            );
        }

        return rows;
    })();

    floodHistoryCache.set(cacheKey, {
        promise
    });

    try {
        const rows = await promise;

        floodHistoryCache.set(cacheKey, {
            rows,
            expiresAt:
                Date.now() +
                FLOOD_HISTORY_CACHE_TTL_MS
        });

        return rows;

    } catch (error) {
        floodHistoryCache.delete(cacheKey);
        throw error;
    }
}

async function fetchFloodHistory(record) {
    if (isSfpnHistoryStation(record)) {
        return fetchSfpnFloodHistory(record.stationId);
    }

    if (isColifeHistoryStation(record)) {
        return fetchColifeFloodHistory(record);
    }

    throw new Error("此測站尚未提供歷史資料");
}

function buildFloodHistoryChartHtml(rows) {
    const chartRows = rows.length > 300
        ? rows.filter((_, index) =>
            index % Math.ceil(rows.length / 300) === 0
        )
        : rows;

    const values = chartRows.map(row => row.depthCm);

    const latest =
        chartRows[chartRows.length - 1];

    const peak = chartRows.reduce(
        (best, row) =>
            row.depthCm > best.depthCm ? row : best,
        chartRows[0]
    );

    const width = 292;
    const height = 132;

    const padLeft = 32;
    const padRight = 8;
    const padTop = 10;
    const padBottom = 24;

    const chartWidth =
        width - padLeft - padRight;

    const chartHeight =
        height - padTop - padBottom;

    const maxDepth = Math.max(...values, 0);

    const yMax = Math.max(
        10,
        Math.ceil((maxDepth + 5) / 10) * 10
    );

    const toX = index =>
        padLeft +
        (
            chartRows.length <= 1
                ? chartWidth / 2
                : (index / (chartRows.length - 1)) *
                  chartWidth
        );

    const toY = depth =>
        padTop +
        (
            1 - depth / yMax
        ) * chartHeight;

    const points = chartRows.map((row, index) => ({
        x: toX(index),
        y: toY(row.depthCm)
    }));

    const linePath = points
        .map((point, index) =>
            `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
        )
        .join(" ");

    const areaPath = `
        M ${points[0].x.toFixed(2)} ${(padTop + chartHeight).toFixed(2)}
        L ${points
            .map(point =>
                `${point.x.toFixed(2)} ${point.y.toFixed(2)}`
            )
            .join(" L ")}
        L ${points[points.length - 1].x.toFixed(2)} ${(padTop + chartHeight).toFixed(2)}
        Z
    `;

    const midDepth =
        Math.round((yMax / 2) * 10) / 10;

    const latestPoint =
        points[points.length - 1];

    const firstTime =
        formatFloodHistoryTime(
            chartRows[0].observedAt,
            true
        );

    const lastTime =
        formatFloodHistoryTime(
            latest.observedAt,
            true
        );

    const latestChangeText =
        Number.isFinite(latest.change)
            ? `${latest.change > 0 ? "+" : ""}${latest.change.toFixed(1)} cm`
            : "—";

    return `
        <section style="
            margin-top:14px;
            padding-top:13px;
            border-top:1px dashed #cbd5e1;
        ">
            <div style="
                display:flex;
                justify-content:space-between;
                align-items:flex-start;
                gap:10px;
                margin-bottom:8px;
            ">
                <div>
                    <div style="
                        font-size:11px;
                        font-weight:900;
                        color:#0f766e;
                        letter-spacing:.04em;
                    ">
                        近 24 小時水深趨勢
                    </div>

                    <div style="
                        margin-top:3px;
                        font-size:10px;
                        color:#64748b;
                    ">
                        ${chartRows.length} 筆紀錄・約每 5 分鐘更新
                    </div>
                </div>

                <div style="
                    text-align:right;
                    white-space:nowrap;
                ">
                    <div style="
                        font-size:16px;
                        font-weight:950;
                        color:#0f172a;
                        font-family:ui-monospace,monospace;
                    ">
                        ${latest.depthCm.toFixed(1)} cm
                    </div>

                    <div style="
                        margin-top:2px;
                        font-size:10px;
                        color:${latest.change > 0 ? "#b45309" : latest.change < 0 ? "#0369a1" : "#64748b"};
                        font-weight:800;
                    ">
                        最新變化 ${latestChangeText}
                    </div>
                </div>
            </div>

            <svg
                viewBox="0 0 ${width} ${height}"
                width="100%"
                height="${height}"
                role="img"
                aria-label="近 24 小時水深趨勢圖"
                style="
                    display:block;
                    overflow:visible;
                    border-radius:10px;
                    background:#f8fafc;
                    border:1px solid #e2e8f0;
                "
            >
                <line
                    x1="${padLeft}"
                    x2="${width - padRight}"
                    y1="${padTop}"
                    y2="${padTop}"
                    stroke="#e2e8f0"
                    stroke-width="1"
                />

                <line
                    x1="${padLeft}"
                    x2="${width - padRight}"
                    y1="${toY(midDepth)}"
                    y2="${toY(midDepth)}"
                    stroke="#e2e8f0"
                    stroke-width="1"
                    stroke-dasharray="3 3"
                />

                <line
                    x1="${padLeft}"
                    x2="${width - padRight}"
                    y1="${padTop + chartHeight}"
                    y2="${padTop + chartHeight}"
                    stroke="#cbd5e1"
                    stroke-width="1"
                />

                <text
                    x="${padLeft - 5}"
                    y="${padTop + 4}"
                    text-anchor="end"
                    font-size="9"
                    font-weight="800"
                    fill="#64748b"
                >${yMax}</text>

                <text
                    x="${padLeft - 5}"
                    y="${toY(midDepth) + 4}"
                    text-anchor="end"
                    font-size="9"
                    font-weight="800"
                    fill="#94a3b8"
                >${midDepth}</text>

                <text
                    x="${padLeft - 5}"
                    y="${padTop + chartHeight + 4}"
                    text-anchor="end"
                    font-size="9"
                    font-weight="800"
                    fill="#94a3b8"
                >0</text>

                <path
                    d="${areaPath}"
                    fill="rgba(14, 116, 144, 0.14)"
                />

                <path
                    d="${linePath}"
                    fill="none"
                    stroke="#0f766e"
                    stroke-width="2.25"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />

                <circle
                    cx="${latestPoint.x}"
                    cy="${latestPoint.y}"
                    r="3.8"
                    fill="#0f766e"
                    stroke="#ffffff"
                    stroke-width="2"
                />

                <text
                    x="${padLeft}"
                    y="${height - 6}"
                    text-anchor="start"
                    font-size="9"
                    font-weight="800"
                    fill="#64748b"
                >${firstTime}</text>

                <text
                    x="${width - padRight}"
                    y="${height - 6}"
                    text-anchor="end"
                    font-size="9"
                    font-weight="800"
                    fill="#64748b"
                >${lastTime}</text>
            </svg>

            <div style="
                display:flex;
                justify-content:space-between;
                gap:8px;
                margin-top:8px;
                font-size:10px;
                color:#64748b;
            ">
                <span>
                    最高：
                    <b style="color:#7c2d12;">
                        ${peak.depthCm.toFixed(1)} cm
                    </b>
                </span>

                <span>
                    峰值時間：
                    <b style="color:#475569;">
                        ${formatFloodHistoryTime(
                            peak.observedAt,
                            true
                        )}
                    </b>
                </span>
            </div>
        </section>
    `;
}

async function loadFloodHistoryIntoPopup(record) {
    if (!canLoadFloodHistory(record)) return;

    const containerId =
        getFloodHistoryContainerId(record);

    const container =
        document.getElementById(containerId);

    if (
        !container ||
        container.dataset.loading === "true" ||
        container.dataset.loaded === "true"
    ) {
        return;
    }

    container.dataset.loading = "true";

    try {
        const rows =
            await fetchFloodHistory(record);

        if (!container.isConnected) return;

        container.dataset.loading = "false";
        container.dataset.loaded = "true";
        container.innerHTML =
            buildFloodHistoryChartHtml(rows);

    } catch (error) {
        const sourceName =
            isSfpnHistoryStation(record)
                ? "SFPN"
                : "Colife";

        console.warn(
            `${sourceName} 單站歷史資料讀取失敗`,
            record.stationId,
            error
        );

        if (!container.isConnected) return;

        container.dataset.loading = "false";
        container.innerHTML = `
            <div style="
                margin-top:14px;
                padding:11px 12px;
                border-top:1px dashed #cbd5e1;
                color:#64748b;
                font-size:11px;
                font-weight:800;
                line-height:1.5;
            ">
                近 24 小時趨勢暫時無法取得。
            </div>
        `;
    }
}
// ===== END: SFPN 單站近 24 小時水深趨勢 =====
        
function makeWorkerFloodCandidate(ds) {
    const thing = ds?.Thing;
    const coords =
        thing?.Locations?.[0]?.location?.coordinates;

    if (!thing || !Array.isArray(coords) || coords.length < 2) {
        return null;
    }

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
    }

    if (
        Math.abs(lon - 120) < 0.000001 &&
        Math.abs(lat - 23) < 0.000001
    ) {
        return null;
    }

    if (lon < 118 || lon > 123 || lat < 21 || lat > 26.5) {
        return null;
    }

    const stationName =
        thing?.properties?.stationName ||
        thing?.name ||
        "未命名測站";

    const stationId = normaliseFloodStationId(
        thing?.properties?.stationID ||
        thing?.properties?.stationCode ||
        thing?.name ||
        stationName
    );

        const observation = ds?.Observations?.[0] || null;
    const rawResult = observation?.result;

    const rawDatastreamId = Number(ds?.["@iot.id"]);

    const datastreamId =
        Number.isInteger(rawDatastreamId) &&
        rawDatastreamId > 0
            ? rawDatastreamId
            : null;

    const unitSymbol = String(
        ds?.unitOfMeasurement?.symbol ||
        ds?.unitOfMeasurement?.name ||
        "cm"
    ).trim();

    const hasObservation =
        rawResult !== null &&
        rawResult !== undefined &&
        String(rawResult).trim() !== "";

    const timeInfo = parseFloodObservationTime(
        observation?.phenomenonTime ||
        ds?.phenomenonTime ||
        ""
    );

    const hoursAgo = timeInfo.isValid
        ? (Date.now() - timeInfo.observedAtMs) / 3600000
        : Number.POSITIVE_INFINITY;

    return {
        stationId,
        stationName,
        lon,
        lat,

        depthCm: hasObservation
            ? getFloodDepthCm(ds, stationName)
            : null,

                observedAt: timeInfo.observedAt,
        observedAtMs: timeInfo.observedAtMs,

        // Colife 歷史查詢所需資訊
        datastreamId,
        unitSymbol,

        hasObservation,
        isStale:
            hasObservation &&
            (
                !timeInfo.isValid ||
                hoursAgo > FLOOD_STALE_AFTER_HOURS ||
                hoursAgo < -1
            ),

        description: ds?.description || "",
        source: "worker",
        sourcePriority: 10
    };
}

function makeSfpnFloodCandidate(row) {
    const stationId = normaliseFloodStationId(row?.StationID);

    const lon = Number(row?.Longitude);
    const lat = Number(row?.Latitude);

    if (
        !TNWRB_STATION_PATTERN.test(stationId) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat)
    ) {
        return null;
    }

    if (lon < 118 || lon > 123 || lat < 21 || lat > 26.5) {
        return null;
    }

    const rawDepth = Number(row?.WaterInner);
    const hasObservation = Number.isFinite(rawDepth);

    const timeInfo = parseFloodObservationTime(row?.InfoTime);

    const hoursAgo = timeInfo.isValid
        ? (Date.now() - timeInfo.observedAtMs) / 3600000
        : Number.POSITIVE_INFINITY;

    return {
        stationId,
        stationName: String(
            row?.StationName || stationId
        ).trim(),

        lon,
        lat,

        depthCm: hasObservation
            ? Math.max(0, Math.round(rawDepth * 10) / 10)
            : null,

        observedAt: timeInfo.observedAt,
        observedAtMs: timeInfo.observedAtMs,

        hasObservation,
        isStale:
            hasObservation &&
            (
                !timeInfo.isValid ||
                hoursAgo > FLOOD_STALE_AFTER_HOURS ||
                hoursAgo < -1
            ),

        connectionStatus: row?.ConnectionStatus || "",
        description: "臺南市 SFPN / WMap 即時淹水資料",
        source: "sfpn",
        sourcePriority: 100
    };
}

async function updateRealtimeFlood() {
    if (!realtimeFloodLayer) return;

    const statusEl = document.getElementById(
        "realtimeFloodStatus"
    );

    try {
        const workerPromise = fetch(
            "https://haidian-gis-cache.yhzkiki.workers.dev/api/realtime-flood",
            { cache: "no-store" }
        ).then(async response => {
            if (!response.ok) {
                throw new Error(`Worker API HTTP ${response.status}`);
            }

            return response.json();
        });

        const sfpnPromise = fetchSfpnRealtimeRows();

        const [workerResult, sfpnResult] =
            await Promise.allSettled([
                workerPromise,
                sfpnPromise
            ]);

        const workerData =
            workerResult.status === "fulfilled"
                ? workerResult.value
                : null;

        const sfpnRows =
            sfpnResult.status === "fulfilled"
                ? sfpnResult.value
                : [];

        if (!workerData && !sfpnRows.length) {
            throw new Error(
                "Worker 與 SFPN 都無法取得資料；" +
                `Worker=${workerResult.reason}; ` +
                `SFPN=${sfpnResult.reason}`
            );
        }

        const stationRecords = {};
        const hasSfpnTainan = sfpnRows.length > 0;

        // 先放 Worker 的全台資料。
        (workerData?.value || []).forEach(ds => {
            const candidate = makeWorkerFloodCandidate(ds);

            if (!candidate) return;

            // SFPN 成功時，完全排除 Worker / Colife 的 TNWRB。
            // 這可避免 Colife 站號錯配或同站重複。
            if (
                hasSfpnTainan &&
                TNWRB_STATION_PATTERN.test(candidate.stationId)
            ) {
                return;
            }

            const key = getFloodRecordKey(candidate);

            if (
                isFloodRecordBetter(
                    candidate,
                    stationRecords[key]
                )
            ) {
                stationRecords[key] = candidate;
            }
        });

        // 再放 SFPN 臺南完整測站，權威優先。
        sfpnRows.forEach(row => {
            const candidate = makeSfpnFloodCandidate(row);

            if (!candidate) return;

            const key = getFloodRecordKey(candidate);

            if (
                isFloodRecordBetter(
                    candidate,
                    stationRecords[key]
                )
            ) {
                stationRecords[key] = candidate;
            }
        });

        window.currentFloodData = stationRecords;

        window.realtimeFloodSourceMeta = {
            workerOk: workerResult.status === "fulfilled",
            sfpnOk: sfpnResult.status === "fulfilled",
            sfpnRows: sfpnRows.length,
            workerError:
                workerResult.status === "rejected"
                    ? String(workerResult.reason)
                    : null,
            sfpnError:
                sfpnResult.status === "rejected"
                    ? String(sfpnResult.reason)
                    : null
        };

        renderRealtimeFloodMap();

    } catch (err) {
        console.error("淹水感測器抓取失敗", err);

        if (statusEl) {
            statusEl.innerHTML =
                '<span style="color:#ef4444;font-weight:800;">⚠️ 讀取失敗，請稍後再試。</span>';
        }
    }
}


const FLOOD_RENDER_ICON_CACHE = new Map();

function getFloodMarkerVisual(record, isFlooded) {
    if (!record.hasObservation) {
        return {
            key: "no-observation",
            color: "#64748b",
            statusText: "尚無即時讀值",
            svgIcon: `
                <svg width="28" height="28" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" fill="#64748b" stroke="#fff" stroke-width="2.5"/>
                    <path d="M12 7v5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
                    <circle cx="12" cy="16.5" r="1.1" fill="#fff"/>
                </svg>
            `
        };
    }

    if (record.isStale) {
        return {
            key: "stale",
            color: "#94a3b8",
            statusText: "資料逾 24 小時",
            svgIcon: `
                <svg width="28" height="28" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" fill="#94a3b8" stroke="#fff" stroke-width="2.5"/>
                    <path d="M12 7v5l3 2" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `
        };
    }

    if (record.depthCm >= 30) {
        return {
            key: "high",
            color: "#CC79A7",
            statusText: "高度警戒",
            svgIcon: `
                <svg width="28" height="28" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="4" fill="#CC79A7" stroke="#fff" stroke-width="2.5"/>
                    <path d="M12 7v6" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>
                    <circle cx="12" cy="16.5" r="1.2" fill="#fff"/>
                </svg>
            `
        };
    }

    if (record.depthCm >= 10) {
        return {
            key: "warning",
            color: "#E69F00",
            statusText: "注意積淹",
            svgIcon: `
                <svg width="30" height="30" viewBox="0 0 24 24">
                    <polygon points="12 2 22 20 2 20" fill="#E69F00" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
                    <path d="M12 8v5" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>
                    <circle cx="12" cy="16.5" r="1.2" fill="#fff"/>
                </svg>
            `
        };
    }

    if (isFlooded) {
        return {
            key: "low-flood",
            color: "#0072B2",
            statusText: "輕微積水",
            svgIcon: `
                <svg width="28" height="28" viewBox="0 0 24 24">
                    <polygon points="12 2 22 12 12 22 2 12" fill="#0072B2" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
                    <path d="M7 13c1.5-1.3 3-1.3 4.5 0 1.5 1.3 3 1.3 4.5 0" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>
                </svg>
            `
        };
    }

    return {
        key: "normal",
        color: "#475569",
        statusText: "無積水",
        svgIcon: `
            <svg width="24" height="24" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" fill="#475569" stroke="#fff" stroke-width="2.5"/>
                <path d="M8 12.2l2.5 2.5 5-5.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `
    };
}

function getFloodMarkerIcon(visual) {
    if (!FLOOD_RENDER_ICON_CACHE.has(visual.key)) {
        FLOOD_RENDER_ICON_CACHE.set(
            visual.key,
            L.divIcon({
                className: "flood-marker-icon",
                html: visual.svgIcon,
                iconSize: [30, 30],
                iconAnchor: [15, 15],
                popupAnchor: [0, -12]
            })
        );
    }

    return FLOOD_RENDER_ICON_CACHE.get(visual.key);
}

function makeFloodPopupHtml(record, visual, historyContainerId = "") {
    const time = new Date(record.observedAt);

    const timeDisplay = Number.isFinite(time.getTime())
        ? `${String(time.getMonth() + 1).padStart(2, "0")}/${String(time.getDate()).padStart(2, "0")} ${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`
        : "無有效觀測時間";

    const depthDisplay = record.hasObservation
        ? record.depthCm
        : "—";

        const sourceDisplay =
        record.source === "sfpn"
            ? "臺南 SFPN / WMap"
            : isColifeHistoryStation(record)
                ? "全台 Colife 水資源感測資料"
                : "全台物聯網資料";

    const historyHtml = historyContainerId
        ? `
            <div
                id="${historyContainerId}"
                style="
                    margin-top:14px;
                    padding:11px 12px;
                    border-top:1px dashed #cbd5e1;
                    color:#64748b;
                    font-size:11px;
                    font-weight:800;
                "
            >
                正在載入近 24 小時水深趨勢…
            </div>
        `
        : "";

    return `
        <div style="padding:16px;font-family:system-ui,-apple-system,sans-serif;">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:13px;">
                ${visual.svgIcon}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:10px;font-weight:900;color:#64748b;letter-spacing:.08em;">即時淹水感測站</div>
                    <div style="font-size:15px;font-weight:900;color:#0f172a;line-height:1.4;">
                        ${escapeGISHtml(record.stationName)}
                    </div>
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:end;background:#f8fafc;border-radius:12px;padding:12px 13px;">
                <span style="font-size:12px;font-weight:800;color:#475569;">目前淹水深度</span>
                <span style="font-size:29px;font-weight:900;line-height:1;color:${visual.color};font-family:ui-monospace,monospace;">
                    ${depthDisplay}<small style="font-size:12px;">${record.hasObservation ? " cm" : ""}</small>
                </span>
            </div>

            <div style="margin-top:11px;padding-top:10px;border-top:1px dashed #cbd5e1;display:flex;justify-content:space-between;gap:10px;font-size:11px;">
                <span style="color:#64748b;font-weight:800;">${visual.statusText}</span>
                <span style="color:#475569;text-align:right;">${timeDisplay}</span>
            </div>

            <div style="margin-top:7px;font-size:10px;color:#94a3b8;">
                資料來源：${sourceDisplay}
            </div>

            ${historyHtml}
        </div>
    `;
}

function renderRealtimeFloodMap() {
    if (!realtimeFloodLayer) return;

    realtimeFloodLayer.clearLayers();

    let floodedCount = 0;
    let normalCount = 0;
    let staleCount = 0;
    let noObservationCount = 0;

    const markers = [];

    Object.values(window.currentFloodData || {}).forEach(record => {
        const isCurrent =
            record.hasObservation &&
            !record.isStale;

        const isFlooded =
            isCurrent &&
            record.depthCm >= FLOOD_DISPLAY_THRESHOLD_CM;

        if (!record.hasObservation) {
            noObservationCount++;
        } else if (record.isStale) {
            staleCount++;
        } else if (isFlooded) {
            floodedCount++;
        } else {
            normalCount++;
        }

        if (window.showOnlyFlooded && !isFlooded) {
            return;
        }

                const visual = getFloodMarkerVisual(record, isFlooded);

        const showFloodHistory =
            canLoadFloodHistory(record);

        const historyContainerId =
            showFloodHistory
                ? getFloodHistoryContainerId(record)
                : "";

        const marker = L.marker(
            [record.lat, record.lon],
            {
                icon: getFloodMarkerIcon(visual),
                title:
                    `${record.stationName}：` +
                    `${record.hasObservation ? record.depthCm : "—"} cm`
            }
        );

                marker.bindPopup(
            () => makeFloodPopupHtml(
                record,
                visual,
                historyContainerId
            ),
            {
                className: "flood-popup",
                closeButton: true,
                autoPan: false
            }
        );

                        /*
         * Popup 開啟後，將地圖中心放在測站北側。
         * 這會讓測站與 Popup 整體往下移，避開上方 Banner。
         */
        marker.on("popupopen", function () {
            var stationLatLng = marker.getLatLng();
            var targetZoom = Math.max(map.getZoom(), 16);

            /*
             * 桌機卡片較高，預留較多 Banner 安全距離；
             * 手機保留較多下方畫面，避免卡片過低。
             */
            var popupClearance =
                window.matchMedia("(max-width: 600px)").matches
                    ? 96
                    : 140;

            /*
             * 將地圖中心移到測站北側：
             * 測站會在畫面中央偏下，
             * 往上展開的 Popup 就不會被 Banner 遮住。
             */
            var projectedStation = map.project(
                stationLatLng,
                targetZoom
            );

            var targetCenter = map.unproject(
                L.point(
                    projectedStation.x,
                    projectedStation.y - popupClearance
                ),
                targetZoom
            );

            var shouldMove =
                map.getZoom() !== targetZoom ||
                map.getCenter().distanceTo(targetCenter) > 10;

            var loadPopupData = function () {
                if (
                    typeof marker.isPopupOpen === "function" &&
                    !marker.isPopupOpen()
                ) {
                    return;
                }

                var popup = marker.getPopup();

                if (popup && typeof popup.update === "function") {
                    popup.update();
                }

                if (!showFloodHistory) {
                    return;
                }

                var startLoad = function () {
                    loadFloodHistoryIntoPopup(record);
                };

                if (typeof window.requestAnimationFrame === "function") {
                    window.requestAnimationFrame(startLoad);
                } else {
                    window.setTimeout(startLoad, 0);
                }
            };

            if (shouldMove) {
                map.stop();
                map.once("moveend", loadPopupData);

                map.flyTo(
                    targetCenter,
                    targetZoom,
                    {
                        animate: true,
                        duration: 0.45
                    }
                );
            } else {
                loadPopupData();
            }
        });

        markers.push(marker);
    });

    // markerClusterGroup 會分段加入，避免一次卡住主執行緒。
    if (typeof realtimeFloodLayer.addLayers === "function") {
        realtimeFloodLayer.addLayers(markers);
    } else {
        markers.forEach(marker => realtimeFloodLayer.addLayer(marker));
    }

    const statusEl = document.getElementById(
        "realtimeFloodStatus"
    );

    if (statusEl) {
        const sourceMeta =
            window.realtimeFloodSourceMeta || {};

        const sourceText = sourceMeta.sfpnOk
            ? `臺南 SFPN：${sourceMeta.sfpnRows} 站`
            : "臺南 SFPN 暫時不可用";

        statusEl.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;font-weight:900;">
                <span style="color:#475569;">無積水：${normalCount}</span>
                <span style="color:#b45309;">有積水：${floodedCount}</span>
                <span style="color:#64748b;">過期資料：${staleCount}</span>
                <span style="color:#64748b;">無讀值：${noObservationCount}</span>
            </div>

            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px;padding:9px 10px;background:#fff7ed;border:1px solid #fdba74;border-radius:9px;">
                <input
                    type="checkbox"
                    onchange="toggleShowOnlyFlooded(this.checked)"
                    ${window.showOnlyFlooded ? "checked" : ""}
                    style="width:16px;height:16px;margin:0;accent-color:#E69F00;"
                >
                <span style="font-size:12px;font-weight:900;color:#9a3412;">只顯示有積淹水的測站</span>
            </label>

            <div style="margin-top:8px;color:#64748b;font-size:10px;line-height:1.5;">
                ${sourceText}<br>
                每 5 分鐘更新；逾 ${FLOOD_STALE_AFTER_HOURS} 小時資料以灰色顯示，且不納入即時統計。
            </div>
        `;
    }
}
    
