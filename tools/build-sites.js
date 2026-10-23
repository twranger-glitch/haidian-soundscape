#!/usr/bin/env node
/*
 * 由 src/site/app.template.html 產出兩個分站頁面：
 *   sound.html  聲音地景（左側聆聽／走讀，右側只有定位、底圖、歷史套疊）
 *   gis.html    探究地景：用圖資讀土地（右側全部圖資工具）
 * 用法：node tools/build-sites.js
 * 樣板語法：{{KEY}} 代換；<!--#if sound--> … <!--#endif--> 只留在該分站。
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(root, 'src/site/app.template.html'), 'utf8');

const SITES = {
  sound: {
    PAGE: 'sound.html',
    TITLE: '海佃溪遊記｜聲音地景',
    DESC: '海佃地下圖書室聲音地景計畫。這是一張用耳朵閱讀的地圖，邀您沿著水圳與聚落，一起把台江的聲音帶回來。',
    SUB: '聲音地景'
  },
  gis: {
    PAGE: 'gis.html',
    TITLE: '海佃溪遊記｜探究地景：用圖資讀土地',
    DESC: '把底圖、歷史地圖、淹水潛勢、水文與災害圖資疊在同一張地圖上，用圖資讀台江的土地。',
    SUB: '探究地景'
  }
};

function render(site) {
  const vars = Object.assign({ SITE: site }, SITES[site]);
  let html = tpl.replace(/<!--#if (\w+)-->\n?([\s\S]*?)<!--#endif-->\n?/g, (m, who, body) => (who === site ? body : ''));
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error('樣板缺少變數 ' + k);
    return vars[k];
  });
  return html;
}

for (const site of Object.keys(SITES)) {
  const out = path.join(root, SITES[site].PAGE);
  fs.writeFileSync(out, render(site));
  console.log('寫出', SITES[site].PAGE, fs.statSync(out).size, 'bytes');
}
