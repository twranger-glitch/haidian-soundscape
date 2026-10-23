#!/usr/bin/env node
/*
 * 測試站（Vercel）的建置步驟。
 * 正式站由 GitHub Actions 把 ShadeMap 金鑰填進 config.shademap.template.js；
 * 這裡做一樣的事：有 SHADEMAP_API_KEY 環境變數就產出 config.shademap.js，
 * 沒有就保留 repo 裡那份「自有引擎、不需金鑰」的設定。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const key = (process.env.SHADEMAP_API_KEY || '').trim();
const templatePath = path.join(root, 'config.shademap.template.js');
const outPath = path.join(root, 'config.shademap.js');

if (!key) {
  console.log('[vercel-build] 沒有 SHADEMAP_API_KEY，沿用 repo 內的 config.shademap.js（自有引擎）。');
  process.exit(0);
}

const placeholder = '__SHADEMAP_API_KEY_JSON__';
const template = fs.readFileSync(templatePath, 'utf8');
if (!template.includes(placeholder)) {
  console.error('[vercel-build] 樣板裡找不到 ' + placeholder);
  process.exit(1);
}
const rendered = template.replace(placeholder, JSON.stringify(key));
fs.writeFileSync(outPath, rendered);
new Function(rendered.replace(/^window\./m, 'var window={};window.')); // 語法檢查
console.log('[vercel-build] 已產出 config.shademap.js（含 ShadeMap 金鑰）。');
