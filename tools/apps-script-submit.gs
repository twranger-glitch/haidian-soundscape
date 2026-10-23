/**
 * 海佃溪遊記：站內投稿的後端接口（貼進現有的 Apps Script 專案即可）
 *
 * 部署步驟：
 *  1. 把這整個檔案貼到現有專案（和 exportDataToFirebase 同一個專案）裡，存檔。
 *  2. 「部署」→「新增部署作業」→ 類型選「網頁應用程式」：
 *     執行身分「我」、存取權「任何人」→ 部署 → 複製「網頁應用程式網址」。
 *  3. 把網址填進前端 src/soundscape-submit.js 的 CONFIG.endpoint。
 *  4. （封面）在 exportDataToFirebase 裡，找到這一行：
 *        var finalCoverUrl = isProcessing ? "…" : (driveCover || "…");
 *     改成：
 *        var siteCover = normalize_(data[i][CONFIG.COLUMN.COVER_URL - 1]);
 *        var finalCoverUrl = isProcessing ? "…" : (siteCover || driveCover || "…");
 *     這樣站內上傳的照片才會當封面。
 *
 * 前端送來的 JSON 欄位：title, author, description, category, date("YYYY-MM-DD HH:MM:SS"),
 * lat, lon, place, email, uid, audioMp3, audio{url, publicId, resourceType, cloudName}, cover{url, publicId}
 */
function doPost(e) {
  var out = { ok: false };
  try {
    var p = JSON.parse(e.postData.contents || '{}');
    if (!p.title || !p.audio || !p.audio.publicId || !isFinite(p.lat) || !isFinite(p.lon)) throw new Error('缺少標題、聲音或座標');
    if (String(p.title).length > 60 || String(p.description || '').length > 600) throw new Error('文字太長');

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var uid;
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var s = ss.getSheetByName(CONFIG.MAIN_SHEET_NAME) || ss.getSheets()[0];
      var width = Math.max(s.getLastColumn(), CONFIG.COLUMN.EXT_LINK);
      var row = [];
      for (var i = 0; i < width; i++) row.push('');
      uid = p.uid && /^[0-9a-f-]{36}$/i.test(p.uid) ? p.uid : Utilities.getUuid();
      var when = p.date ? new Date(String(p.date).replace(' ', 'T')) : new Date();
      if (isNaN(when.getTime())) when = new Date();

      row[0] = new Date();                               // A 時間戳
      row[1] = String(p.title).trim();                   // B 標題
      row[2] = String(p.author || '海佃特派員').trim();    // C 採集者
      row[3] = String(p.description || '').trim();       // D 說明
      row[CONFIG.COLUMN.DATE - 1] = when;                // E 採集時間
      row[5] = String(p.category || '').trim();          // F 類別
      row[CONFIG.COLUMN.MANUAL_LOC - 1] = (p.place ? String(p.place) + '｜' : '') + (p.posSource === 'gps' ? '站內：裝置定位' : p.posSource === 'photo' ? '站內：照片座標' : '站內：地圖釘選');
      row[CONFIG.COLUMN.EMAIL - 1] = String(p.email || '').trim();
      row[CONFIG.COLUMN.GPS - 1] = (+p.lat).toFixed(6) + ', ' + (+p.lon).toFixed(6);
      row[CONFIG.COLUMN.COVER_URL - 1] = p.cover && p.cover.url ? String(p.cover.url) : '';
      row[CONFIG.COLUMN.AUDIO_URL - 1] = String(p.audioMp3 || p.audio.url);
      row[CONFIG.COLUMN.STATUS - 1] = CONFIG.STATUS.DONE;
      row[CONFIG.COLUMN.UID - 1] = uid;
      row[CONFIG.COLUMN.CLOUDINARY_PUBLIC_ID - 1] = String(p.audio.publicId);
      row[CONFIG.COLUMN.CLOUDINARY_RESOURCE_TYPE - 1] = String(p.audio.resourceType || 'video');
      row[CONFIG.COLUMN.CLOUDINARY_ACCOUNT - 1] = String(p.audio.cloudName || '');
      s.appendRow(row);
    } finally {
      lock.releaseLock();
    }
    try { exportDataToFirebase(); } catch (err) { Logger.log('站內投稿：推播失敗（排程會補）' + err); }
    out = { ok: true, uid: uid };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'haidian-submit' })).setMimeType(ContentService.MimeType.JSON);
}
