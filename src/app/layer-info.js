/*
 * 圖資說明：每個圖層旁的「i」按鈕。
 * 點了就用既有的 hazardInfoModal 顯示這張圖資是什麼、拿來看什麼、為什麼重要。
 */
(function () {
  'use strict';

  var SINICA = '來源：中央研究院「臺灣百年歷史地圖」。';

  var INFO = {
    history_1875: {
      title: '1874 府城街道圖',
      desc: '清同治年間牡丹社事件之後、沈葆楨來臺整頓防務時留下的府城地圖，畫出城牆、城門、街巷、廟宇與衙署的位置。\n拿來看：清末府城的街廓骨架。對照今天的中西區，會發現許多巷弄仍沿著當年的走向。\n' + SINICA
    },
    history_tainan: {
      title: '1895 臺南府迅速測圖',
      desc: '日軍領臺之初為了行軍與布防，用最快速度實測的地圖，是臺南第一批有實測基礎的地圖。\n拿來看：河道、魚塭、竹圍聚落的實際位置與距離。和 1874 年圖並排，就能看出清領末到日治初的變化。\n' + SINICA
    },
    history_1900: {
      title: '1900 臺南府城內外略圖',
      desc: '日治初期的府城內外概略圖。城牆還在，城外是田園、墓地與溪流，德慶溪、福安坑溪的走向清楚可見。\n拿來看：府城的舊水路，以及城牆拆除之前城內與城外的邊界。\n' + SINICA
    },
    history_1904: {
      title: '1904 臺灣堡圖',
      desc: '臨時臺灣土地調查局測繪的兩萬分之一地形圖，是臺灣第一套涵蓋全島、有統一比例尺的精確地圖，許多土地研究都以它為基準。\n拿來看：一百二十年前的地名、聚落、水田、魚塭與河道；海佃一帶的溪流與海岸線當時在哪裡。\n' + SINICA
    },
    history_1920: {
      title: '1920 臺南市區改正圖',
      desc: '「市區改正」就是日治時期的都市計畫。這張圖畫出拆掉城牆之後的圓環、放射狀道路與新街廓。\n拿來看：今天臺南市中心的道路格局從哪裡來，哪些街道是這時候規劃出來的。\n' + SINICA
    },
    history_1921: {
      title: '1921 臺灣堡圖',
      desc: '堡圖在大正年間修測的版本。比 1904 年多了鐵路、糖鐵、新開道路與水利設施。\n拿來看：和 1904 年圖切換對照，看二十年間的開發、河道改道與聚落擴張。\n' + SINICA
    },
    history_1944: {
      title: '1944 美軍航照圖',
      desc: '二戰末期美軍拍攝的航空照片拼接而成，是戰前地景最後的真實影像，不是手繪地圖。\n拿來看：戰前的魚塭、鹽田、聚落、機場與軍事設施；再對照今天，就能看到戰後的填海造地與都市擴張。\n' + SINICA
    },
    nanshan: {
      title: '南山公墓歷史名人墓塚',
      desc: '南山公墓是全臺最古老、規模最大的公墓之一，從明鄭時期一路葬到現在。這一層標出歷史名人的墓塚位置，以顏色區分年代，也可以輸入姓名或關鍵字搜尋。\n拿來看：把人物史放回地景上，理解府城南郊的文化地景與保存議題。\n來源：張鎧臣、蔡韋漢等，2020，南山公墓歷史名人墓塚地圖。'
    },
    hydro_tainan_water_texture: {
      title: '府城歷史水系紋理',
      desc: '依古地圖與地形重繪的府城舊溪流與水道，例如德慶溪、福安坑溪、竹溪。這些水路今天大多加蓋成暗渠，或變成馬路。\n拿來看：為什麼有些街道是彎的、為什麼某些低窪處下大雨就積水，往往答案就在消失的河道上。'
    },
    hydro_SEAWALLZONE: {
      title: '海堤區域',
      desc: '海堤是人工築起來擋海浪與暴潮的堤防，這一層畫出海堤的範圍。\n拿來看：哪一段海岸靠人工防護、堤後是不是低地。颱風或大潮時，這裡就是第一道防線。\n來源：政府開放圖資。'
    },
    hydro_CoastalBufferZone: {
      title: '海岸緩衝區',
      desc: '依《海岸管理法》劃設，從海岸線往陸地算一段距離的緩衝帶，開發行為受到限制。\n拿來看：海岸管理的邊界在哪裡，哪些地方要留給海岸自然變動。\n來源：政府開放圖資。'
    },
    hydro_CoastalProtectionZone: {
      title: '海岸保護區',
      desc: '《海岸管理法》劃設的保護區，涵蓋濕地、沙洲、潟湖、防風林等重要自然資源。\n拿來看：臺南海岸線上（像七股、四草一帶）哪些區域是受保護的生態核心。\n來源：政府開放圖資。'
    },
    hydro_REGDAREA: {
      title: '區域排水治理區',
      desc: '水利單位公告的區域排水治理計畫範圍，標示哪些排水系統正在整治或納入管理。\n拿來看：把它和淹水潛勢、歷史淹水災情疊在一起，就能看出治水工程落在哪裡、哪裡還沒補上。\n來源：政府開放圖資。'
    },
    hydro_reservoir: {
      title: '水庫範圍',
      desc: '水庫的蓄水範圍。\n拿來看：我們的用水從哪裡來，水庫上游的集水區又和哪些保護區重疊。\n來源：政府開放圖資。'
    },
    hydro_TWQPROT: {
      title: '水質水量保護區',
      desc: '依《自來水法》劃設，為了保護飲用水源而限制污染行為與開發的範圍。\n拿來看：水源地在哪裡，以及為什麼上游地區的開發管制特別嚴格。\n來源：政府開放圖資。'
    },
    hydro_Salinizationzone: {
      title: '地下水鹽化區',
      desc: '沿海地區長期超抽地下水之後，海水從地底入侵，使地下水變鹹的範圍。\n拿來看：鹽化、地層下陷、養殖抽水與海岸低地淹水，其實是同一個問題的不同面向。\n來源：政府開放圖資。'
    },
    hydro_LASUBSTA: {
      title: '地層下陷監測站',
      desc: '長期記錄地面高程變化的監測站點，用來追蹤地層下陷的速度與範圍。\n拿來看：對照鹽化區與海岸線，了解沿海地區為什麼越來越低、越來越容易淹水。\n來源：政府開放圖資。'
    },
    nimby: {
      title: '周邊鄰避設施',
      desc: '用內政部國土測繪中心的開放 API（COM_012），查詢地圖中心一定半徑內的鄰避設施，例如焚化爐、掩埋場、變電所、殯葬設施等。\n拿來看：生活圈周邊有哪些大家不太想要、卻又不能沒有的設施，它們離住家、學校、溪流多遠。\n提醒：這只是 API 回傳的設施清單，不代表風險等級、違規紀錄或法定管制範圍。'
    }
  };

  function show(key) {
    var info = INFO[key];
    var modal = document.getElementById('hazardInfoModal');
    if (!info || !modal) return;
    var title = document.getElementById('hazardInfoTitle');
    var desc = document.getElementById('hazardInfoDesc');
    if (title) title.textContent = info.title;
    if (desc) {
      desc.textContent = '';
      info.desc.split('\n').forEach(function (line, i) {
        if (i) desc.appendChild(document.createElement('br'));
        desc.appendChild(document.createTextNode(line));
      });
    }
    modal.classList.add('active');
  }

  window.showLayerInfo = show;

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.ss-info[data-info]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    show(btn.getAttribute('data-info'));
  }, true);
})();
