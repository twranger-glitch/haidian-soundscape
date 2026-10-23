/**
 * 海佃溪遊記：站內投稿的後端接口
 * 放法：在現有的 Apps Script 專案（有 exportDataToFirebase 的那個）新增一個檔案，例如「站內投稿.gs」，
 *       整個貼上、存檔。這個檔案只新增 doPost 和 site 開頭的小函式，不會蓋掉你原本的任何函式。
 *
 * 一、封面（必改一行）
 *   在 exportDataToFirebase 裡找到：
 *     var finalCoverUrl = isProcessing ? "https://images.unsplash.com/photo-1618044733300-…" : (driveCover || "https://images.unsplash.com/photo-1518173946687-…");
 *   在它「上面」加一行：
 *     var siteCover = siteCoverFromRow_(data[i]);
 *   再把那一行的 (driveCover || 改成 (siteCover || driveCover ||
 *   只有站內投稿（封面是 res.cloudinary.com 的網址）會用到，表單投稿的 Drive 封面完全不受影響。
 *
 * 二、部署
 *   「部署」→「管理部署作業」：
 *     已經有網頁應用程式 → 按鉛筆 → 版本選「新版本」→ 部署（網址不變）。
 *     還沒有 → 「新增部署作業」→ 網頁應用程式，執行身分「我」、存取權「任何人」→ 部署。
 *   複製結尾是 /exec 的網址。
 *
 * 三、Cloudinary
 *   在 SITE_SUBMIT.CLOUD_NAME 這個帳號建立 unsigned upload preset（資料夾 haidian-site）。
 *   這個帳號也要在指令碼屬性 CLOUDINARY_CLOUD_NAME 的清單裡，刪除列時才會連動刪掉雲端音檔。
 *
 * 前端送來的 JSON：title, author, description, category, date("YYYY-MM-DD HH:MM:SS"),
 * lat, lon, place, posSource, email, uid, audioMp3, audio{url, publicId, resourceType, cloudName}, cover{url, publicId}
 */
var SITE_SUBMIT = {
  CLOUD_NAME: 'dcccnd4gk',   // 站內上傳用的 Cloudinary 帳號，要和前端 CONFIG.cloudName 一樣
  FOLDER: 'haidian-site',    // 和 upload preset 的資料夾一樣
  MAX_PER_10_MIN: 30         // 全站每 10 分鐘最多收幾件，擋惡意灌資料
};

function doPost(e) {
  var out = { ok: false };
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    siteValidate_(p);
    siteThrottle_();

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var uid;
    try {
      var s = getMainSheet_();
      var width = Math.max(s.getLastColumn(), CONFIG.COLUMN.EXT_LINK);
      var row = [];
      for (var i = 0; i < width; i++) row.push('');
      uid = p.uid && /^[0-9a-f-]{36}$/i.test(p.uid) ? String(p.uid) : Utilities.getUuid();
      var when = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(p.date || '')) ? String(p.date) : Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
      var src = p.posSource === 'gps' ? '站內：裝置定位' : p.posSource === 'photo' ? '站內：照片座標' : p.posSource === 'video' ? '站內：影片座標' : '站內：地圖釘選';

      row[0] = new Date();                                             // A 時間戳
      row[1] = siteText_(p.title, 60);                                 // B 標題
      row[2] = siteText_(p.author, 40) || '海佃特派員';                  // C 採集者
      row[3] = siteText_(p.description, 600);                          // D 說明
      row[CONFIG.COLUMN.DATE - 1] = when;                              // E 採集時間（下面再設成文字格式）
      row[5] = siteText_(p.category, 20);                              // F 類別
      row[CONFIG.COLUMN.MANUAL_LOC - 1] = (p.place ? siteText_(p.place, 80) + '｜' : '') + src;
      row[CONFIG.COLUMN.EMAIL - 1] = siteText_(p.email, 120);
      row[CONFIG.COLUMN.GPS - 1] = (+p.lat).toFixed(6) + ', ' + (+p.lon).toFixed(6);
      row[CONFIG.COLUMN.COVER_URL - 1] = p.cover && p.cover.url ? String(p.cover.url) : '';
      row[CONFIG.COLUMN.AUDIO_URL - 1] = String(p.audioMp3 || p.audio.url);
      row[CONFIG.COLUMN.STATUS - 1] = CONFIG.STATUS.DONE;
      row[CONFIG.COLUMN.UID - 1] = uid;
      row[CONFIG.COLUMN.CLOUDINARY_PUBLIC_ID - 1] = String(p.audio.publicId);
      row[CONFIG.COLUMN.CLOUDINARY_RESOURCE_TYPE - 1] = 'video';
      row[CONFIG.COLUMN.CLOUDINARY_ACCOUNT - 1] = SITE_SUBMIT.CLOUD_NAME;
      s.appendRow(row);
      s.getRange(s.getLastRow(), CONFIG.COLUMN.DATE).setNumberFormat('@').setValue(when);

      // 登記到 _asset_registry：之後在試算表刪掉這一列，雲端音檔會跟著刪
      try {
        upsertRegistryRow_({ uid: uid, driveVideoId: '', driveCoverId: '', driveAudioId: '', cloudinaryPublicId: String(p.audio.publicId), cloudinaryResourceType: 'video' });
      } catch (regErr) { Logger.log('站內投稿：登記失敗（不影響上架）' + regErr); }
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

// exportDataToFirebase 用：只認站內上傳的 Cloudinary 封面，表單列的 Drive 網址一律略過
function siteCoverFromRow_(rowValues) {
  var v = normalize_(rowValues[CONFIG.COLUMN.COVER_URL - 1]);
  return v.indexOf('https://res.cloudinary.com/' + SITE_SUBMIT.CLOUD_NAME + '/image/upload/') === 0 ? v : '';
}

function siteValidate_(p) {
  if (!p || !p.title || !p.audio || !p.audio.publicId) throw new Error('缺少標題或聲音');
  var lat = +p.lat, lon = +p.lon;
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) throw new Error('座標不正確');
  if (String(p.title).length > 60 || String(p.description || '').length > 600) throw new Error('文字太長');
  var base = 'https://res.cloudinary.com/' + SITE_SUBMIT.CLOUD_NAME + '/';
  var folder = SITE_SUBMIT.FOLDER + '/';
  if (String(p.audio.publicId).indexOf(folder) !== 0) throw new Error('聲音來源不正確');
  if (String(p.audioMp3 || p.audio.url).indexOf(base + 'video/upload/') !== 0) throw new Error('聲音來源不正確');
  if (p.cover && p.cover.url && String(p.cover.url).indexOf(base + 'image/upload/') !== 0) throw new Error('封面來源不正確');
}

function siteThrottle_() {
  var cache = CacheService.getScriptCache();
  var key = 'site_submit_' + Math.floor(Date.now() / 600000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 900);
  if (n > SITE_SUBMIT.MAX_PER_10_MIN) throw new Error('現在投稿的人太多，請過幾分鐘再送');
}

function siteText_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
