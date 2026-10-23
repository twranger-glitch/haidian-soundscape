/**
 * 海佃溪遊記：站內投稿的後端接口＋省力管理工具
 * 放法：在現有的 Apps Script 專案（有 exportDataToFirebase 的那個）裡的「站內投稿.gs」，整個換成這份、存檔。
 *       這個檔案只新增 doPost 和 site 開頭的函式，不會蓋掉你原本的任何函式。
 *
 * 一、程式碼.gs 要改的兩個地方
 *   1. 封面（之前已經改好）：var siteCover = siteCoverFromRow_(data[i]); 以及 (siteCover || driveCover || …)
 *   2. 下架與待審不上地圖：在 exportDataToFirebase 裡找到
 *        if (status !== "" && status.indexOf("失敗") === -1 && status.indexOf("無 GPS") === -1) {
 *      換成
 *        if (status !== "" && status.indexOf("失敗") === -1 && status.indexOf("無 GPS") === -1 && !siteHidden_(status)) {
 *
 * 二、appsscript.json 的 oauthScopes 加三行（寄摘要信、建立排程、試算表選單）
 *        "https://www.googleapis.com/auth/script.send_mail",
 *        "https://www.googleapis.com/auth/script.scriptapp",
 *        "https://www.googleapis.com/auth/script.container.ui"
 *
 * 三、在編輯器上方選 siteSetup →「執行」一次，照提示授權。它會：
 *   - 建立「站內投稿設定」分頁（擋字、封鎖帳號，直接在試算表裡改，不用重新部署）
 *   - 每天早上 8 點寄投稿摘要信給你（沒有新投稿就不寄）
 *   - 試算表多一個「📮 站內投稿」選單：下架／重新上架選取的列、立刻寄摘要
 *   - 你手動把「處理狀態」改成「下架」時，地圖會自動更新
 *
 * 四、Google 登入（選用）：GOOGLE_CLIENT_ID 填了之後，站內投稿一定要先用 Google 登入；留空就維持匿名。
 *     前端 soundscape-submit.js 的 CONFIG.googleClientId 要填同一個。
 *
 * 五、「部署」→「管理部署作業」→ 鉛筆 → 版本選「新版本」→ 部署（網址不變）。
 */
var SITE_SUBMIT = {
  CLOUD_NAME: 'dcccnd4gk',   // 站內上傳用的 Cloudinary 帳號，要和前端 CONFIG.cloudName 一樣
  FOLDER: 'haidian-site',    // 和 upload preset 的資料夾一樣
  GOOGLE_CLIENT_ID: '',      // Google 登入用的用戶端 ID（xxxx.apps.googleusercontent.com）；留空＝匿名投稿
  MAX_PER_10_MIN: 30,        // 全站每 10 分鐘最多收幾件，擋惡意灌資料
  MAX_PER_PERSON_6H: 10,     // 登入後，同一個帳號 6 小時內最多幾件
  MAX_AUDIO_SEC: 660,        // 聲音最長幾秒（前端限制 10 分鐘，這裡多留一點）
  DIGEST_TO: '',             // 摘要信寄給誰；留空＝寄給這個 Apps Script 的擁有者
  DIGEST_HOUR: 8,            // 每天幾點寄摘要信
  SETTINGS_SHEET: '站內投稿設定',
  STATUS_HIDDEN: '下架',
  STATUS_REVIEW: '待審'
};

// 預設擋字：碰到的投稿不會被拒絕，而是先標「待審」不上地圖，摘要信會提醒你看
var SITE_DEFAULT_WORDS = ['娛樂城', '博弈', '百家樂', '代儲', '貸款', '色情', '約砲', '約炮', '援交', '加賴', '加line', '幹你', '操你', '靠北', '白癡', '智障', 'http', 'www.'];

function doPost(e) {
  var out = { ok: false };
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    siteValidate_(p);
    var who = siteCheckLogin_(p);
    var settings = siteSettings_();
    if (who.email && settings.banned[who.email.toLowerCase()]) throw new Error('這個帳號暫時不能投稿，有疑問請來信');
    siteThrottle_(who.email);
    var hit = siteFlagWord_([p.title, p.author, p.description, p.place].join(' '), settings.words);

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
      row[CONFIG.COLUMN.EMAIL - 1] = who.email || siteText_(p.email, 120);
      row[CONFIG.COLUMN.GPS - 1] = (+p.lat).toFixed(6) + ', ' + (+p.lon).toFixed(6);
      row[CONFIG.COLUMN.COVER_URL - 1] = p.cover && p.cover.url ? String(p.cover.url) : '';
      row[CONFIG.COLUMN.AUDIO_URL - 1] = String(p.audioMp3 || p.audio.url);
      row[CONFIG.COLUMN.STATUS - 1] = hit ? SITE_SUBMIT.STATUS_REVIEW + '（' + hit + '）' : CONFIG.STATUS.DONE;
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
    if (!hit) {
      try { exportDataToFirebase(); } catch (err) { Logger.log('站內投稿：推播失敗（排程會補）' + err); }
    }
    out = { ok: true, uid: uid, review: !!hit };
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

// exportDataToFirebase 用：下架、待審的列不上地圖
function siteHidden_(status) {
  status = String(status || '');
  return status.indexOf(SITE_SUBMIT.STATUS_HIDDEN) > -1 || status.indexOf(SITE_SUBMIT.STATUS_REVIEW) > -1;
}

function siteValidate_(p) {
  if (!p || !p.title || !p.audio || !p.audio.publicId) throw new Error('缺少標題或聲音');
  var lat = +p.lat, lon = +p.lon;
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) throw new Error('座標不正確');
  if (String(p.title).length > 60 || String(p.description || '').length > 600) throw new Error('文字太長');
  if (+p.audio.duration > SITE_SUBMIT.MAX_AUDIO_SEC) throw new Error('聲音太長了，請剪到 10 分鐘以內');
  var base = 'https://res.cloudinary.com/' + SITE_SUBMIT.CLOUD_NAME + '/';
  var folder = SITE_SUBMIT.FOLDER + '/';
  if (String(p.audio.publicId).indexOf(folder) !== 0) throw new Error('聲音來源不正確');
  if (String(p.audioMp3 || p.audio.url).indexOf(base + 'video/upload/') !== 0) throw new Error('聲音來源不正確');
  if (p.cover && p.cover.url && String(p.cover.url).indexOf(base + 'image/upload/') !== 0) throw new Error('封面來源不正確');
}

// Google 登入：向 Google 驗證前端送來的 ID token，確認是這個網站發的、信箱已驗證
function siteCheckLogin_(p) {
  if (!SITE_SUBMIT.GOOGLE_CLIENT_ID) return { email: '' };
  if (!p.idToken) throw new Error('請先用 Google 登入再送出');
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(p.idToken), { muteHttpExceptions: true });
  var info = r.getResponseCode() === 200 ? safeJsonParse_(r.getContentText()) : null;
  if (!info || info.aud !== SITE_SUBMIT.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(info.iss || '') || String(info.email_verified) !== 'true' || +info.exp * 1000 < Date.now()) {
    throw new Error('登入已過期，請重新登入再送出');
  }
  return { email: String(info.email).toLowerCase(), name: info.name || '' };
}

function siteThrottle_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'site_submit_' + Math.floor(Date.now() / 600000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 900);
  if (n > SITE_SUBMIT.MAX_PER_10_MIN) throw new Error('現在投稿的人太多，請過幾分鐘再送');
  if (email) {
    var pk = 'site_person_' + Utilities.base64EncodeWebSafe(email).slice(0, 200) + '_' + Math.floor(Date.now() / 21600000);
    var m = Number(cache.get(pk) || 0) + 1;
    cache.put(pk, String(m), 21600);
    if (m > SITE_SUBMIT.MAX_PER_PERSON_6H) throw new Error('你今天投好多了，休息一下，晚點再送');
  }
}

function siteFlagWord_(text, words) {
  var t = String(text || '').toLowerCase();
  for (var i = 0; i < words.length; i++) if (words[i] && t.indexOf(words[i]) > -1) return words[i];
  return '';
}

// 「站內投稿設定」分頁：A 欄擋字、B 欄封鎖帳號，第一列是標題
function siteSettings_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SITE_SUBMIT.SETTINGS_SHEET);
  var out = { words: SITE_DEFAULT_WORDS.slice(), banned: {} };
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  out.words = [];
  v.forEach(function (r) {
    var w = normalize_(r[0]).toLowerCase(), b = normalize_(r[1]).toLowerCase();
    if (w) out.words.push(w);
    if (b) out.banned[b] = true;
  });
  return out;
}

function siteText_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

// ------------------------------------------------------------ 一次性設定
function siteSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SITE_SUBMIT.SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SITE_SUBMIT.SETTINGS_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['擋字（含這些字的投稿先標「待審」，不上地圖）', '封鎖帳號（填 email，這個帳號不能再投稿）', '說明']]).setFontWeight('bold');
    sh.getRange(2, 1, SITE_DEFAULT_WORDS.length, 1).setValues(SITE_DEFAULT_WORDS.map(function (w) { return [w]; }));
    sh.getRange(2, 3, 4, 1).setValues([['一格一個字詞，英文不分大小寫。'], ['改完不用重新部署，下一件投稿就生效。'], ['待審的投稿：看過沒問題，把「處理狀態」改成「已完成」就會上地圖。'], ['要下架：選那一列，用上方選單「📮 站內投稿 → 下架選取的列」。']]);
    sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 300); sh.setColumnWidth(3, 420);
    sh.setFrozenRows(1);
  }
  var want = { siteDailyDigest: 1, siteOnEdit: 1, siteOnOpen: 1 };
  ScriptApp.getProjectTriggers().forEach(function (t) { if (want[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('siteDailyDigest').timeBased().everyDays(1).atHour(SITE_SUBMIT.DIGEST_HOUR).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('siteOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('siteOnOpen').forSpreadsheet(ss).onOpen().create();
  Logger.log('完成：設定分頁、每天 ' + SITE_SUBMIT.DIGEST_HOUR + ' 點摘要信、下架自動更新地圖、站內投稿選單。');
}

function siteOnOpen() {
  SpreadsheetApp.getUi().createMenu('📮 站內投稿')
    .addItem('🙈 下架選取的列（不刪檔，可以再上架）', 'siteTakeDown')
    .addItem('👀 重新上架選取的列', 'siteRestore')
    .addSeparator()
    .addItem('✉️ 立刻寄一份投稿摘要給我', 'siteDigestNow')
    .addToUi();
}

function siteTakeDown() { siteSetStatusOfSelection_(SITE_SUBMIT.STATUS_HIDDEN); }
function siteRestore() { siteSetStatusOfSelection_(CONFIG.STATUS.DONE); }

function siteSetStatusOfSelection_(status) {
  var s = getMainSheet_();
  var ui = SpreadsheetApp.getUi();
  var range = SpreadsheetApp.getActiveRange();
  if (!range || range.getSheet().getName() !== s.getName() || range.getRow() < 2) { ui.alert('請先在「' + s.getName() + '」點選要處理的那一列（可以一次選好幾列）'); return; }
  var titles = [];
  for (var r = range.getRow(); r <= range.getLastRow(); r++) {
    s.getRange(r, CONFIG.COLUMN.STATUS).setValue(status);
    titles.push('「' + s.getRange(r, 2).getDisplayValue() + '」');
  }
  try { exportDataToFirebase(); } catch (e) { ui.alert('狀態改好了，但地圖更新失敗：' + e + '\n排程會再補。'); return; }
  ui.alert((status === CONFIG.STATUS.DONE ? '已重新上架：' : '已下架：') + titles.join('、') + '\n地圖已經更新。');
}

// 手動把「處理狀態」改成下架或已完成時，馬上更新地圖
function siteOnEdit(e) {
  try {
    if (!e || !e.range) return;
    var s = e.range.getSheet();
    if (s.getName() !== CONFIG.MAIN_SHEET_NAME || e.range.getColumn() > CONFIG.COLUMN.STATUS || e.range.getLastColumn() < CONFIG.COLUMN.STATUS) return;
    var v = String(e.value || '');
    if (v.indexOf(SITE_SUBMIT.STATUS_HIDDEN) > -1 || v === CONFIG.STATUS.DONE || e.range.getNumRows() > 1) exportDataToFirebase();
  } catch (err) { Logger.log('siteOnEdit：' + err); }
}

// ------------------------------------------------------------ 每日摘要
function siteDailyDigest() { siteSendDigest_(false); }
function siteDigestNow() {
  var n = siteSendDigest_(true);
  SpreadsheetApp.getUi().alert(n ? '寄出了，過去 24 小時有 ' + n + ' 件投稿。' : '過去 24 小時沒有新投稿，還是寄了一封空的給你確認收得到。');
}

function siteSendDigest_(force) {
  var s = getMainSheet_();
  var data = s.getDataRange().getValues();
  var since = Date.now() - 86400000;
  var url = SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + s.getSheetId() + '&range=A';
  var items = [];
  for (var i = 1; i < data.length; i++) {
    var ts = data[i][0];
    if (!(ts instanceof Date) || ts.getTime() < since) continue;
    var status = normalize_(data[i][CONFIG.COLUMN.STATUS - 1]);
    var gps = normalize_(data[i][CONFIG.COLUMN.GPS - 1]).split(',');
    var lat = parseFloat(gps[0]), lon = parseFloat(gps[1]);
    var flags = [];
    if (status.indexOf(SITE_SUBMIT.STATUS_REVIEW) > -1) flags.push('待審：' + status);
    if (status.indexOf('失敗') > -1) flags.push('處理失敗');
    if (isFinite(lat) && isFinite(lon) && !siteInTaiwan_(lat, lon)) flags.push('不在台灣（' + lat.toFixed(3) + ', ' + lon.toFixed(3) + '）');
    items.push({
      row: i + 1, title: normalize_(data[i][1]), author: normalize_(data[i][2]), desc: normalize_(data[i][3]),
      email: normalize_(data[i][CONFIG.COLUMN.EMAIL - 1]), site: normalize_(data[i][CONFIG.COLUMN.MANUAL_LOC - 1]).indexOf('站內') > -1,
      status: status, flags: flags, audio: normalize_(data[i][CONFIG.COLUMN.AUDIO_URL - 1])
    });
  }
  if (!items.length && !force) return 0;
  var flagged = items.filter(function (x) { return x.flags.length; });
  var h = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var card = function (x) {
    return '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin:0 0 10px;' + (x.flags.length ? 'background:#fff7ed;border-color:#fdba74;' : '') + '">' +
      '<div style="font-weight:700;font-size:15px">' + h(x.title || '（沒有標題）') + '</div>' +
      '<div style="color:#64748b;font-size:12px;margin:2px 0 6px">' + h(x.author) + (x.email ? '・' + h(x.email) : '') + '・' + (x.site ? '站內投稿' : '表單投稿') + '・' + h(x.status) + '</div>' +
      (x.flags.length ? '<div style="color:#c2410c;font-size:13px;font-weight:600;margin-bottom:6px">⚠️ ' + h(x.flags.join('；')) + '</div>' : '') +
      (x.desc ? '<div style="font-size:13px;color:#334155;margin-bottom:6px">' + h(x.desc.slice(0, 140)) + '</div>' : '') +
      '<a href="' + h(url + x.row) + '" style="font-size:13px">打開試算表第 ' + x.row + ' 列</a>' +
      (x.audio ? '　<a href="' + h(x.audio) + '" style="font-size:13px">聽聲音</a>' : '') +
      '</div>';
  };
  var body = '<div style="font-family:sans-serif;max-width:560px">' +
    '<p style="font-size:15px">過去 24 小時收到 <b>' + items.length + '</b> 件投稿' + (flagged.length ? '，其中 <b style="color:#c2410c">' + flagged.length + ' 件</b>建議看一下。' : '，都沒有異狀，不用處理。') + '</p>' +
    (flagged.length ? '<h3 style="font-size:14px;margin:18px 0 8px">要看一下的</h3>' + flagged.map(card).join('') : '') +
    (items.length > flagged.length ? '<h3 style="font-size:14px;margin:18px 0 8px">其他（已經上地圖）</h3>' + items.filter(function (x) { return !x.flags.length; }).map(card).join('') : '') +
    '<p style="font-size:12px;color:#64748b;margin-top:18px">要下架：在試算表選那一列，用選單「📮 站內投稿 → 下架選取的列」。<br>待審的沒問題：把「處理狀態」改成「已完成」就會上地圖。<br>不在台灣只是提醒，出國錄的也很好，不用處理。<br>擋字和封鎖帳號在「' + SITE_SUBMIT.SETTINGS_SHEET + '」分頁。</p></div>';
  MailApp.sendEmail({
    to: SITE_SUBMIT.DIGEST_TO || Session.getEffectiveUser().getEmail(),
    subject: '海佃溪遊記｜過去 24 小時 ' + items.length + ' 件投稿' + (flagged.length ? '（' + flagged.length + ' 件要看）' : ''),
    htmlBody: body
  });
  return items.length;
}

// 台灣本島、澎湖、金門、馬祖、蘭嶼綠島的大致範圍；只用來在摘要信裡提醒，不會擋
function siteInTaiwan_(lat, lon) {
  var boxes = [[21.7, 25.5, 119.2, 122.2], [24.3, 24.6, 118.1, 118.6], [25.9, 26.5, 119.8, 120.6]];
  for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3]) return true; }
  return false;
}
