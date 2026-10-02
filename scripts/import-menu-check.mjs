// 「ラーメンがメニューにあるか」を確認した CSV（ramen_on_menu 列: yes / no / unknown）を反映する。
//   node scripts/import-menu-check.mjs ファイル...
//   yes     … ラーメンあり（確認済み）にする。「その他（未確認）」の店は「その他の飲食店（ラーメンあり）」に移す
//   no      … 削除し、data/removed.json に記録する（自動更新で再追加されない）
//   unknown … 変更しない
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadShops, saveShops } from './lib.mjs';

const REMOVED_PATH = path.join(ROOT, 'data', 'removed.json');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

const db = await loadShops();
let removedList = [];
try { removedList = JSON.parse(await readFile(REMOVED_PATH, 'utf8')).removed; } catch {}

const counts = { yes: 0, no: 0, unknown: 0 };
const drop = new Set();
for (const file of process.argv.slice(2)) {
  const [header, ...rows] = parseCsv((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  const col = (name) => header.findIndex((h) => h.trim() === name);
  const iId = col('id'), iRamen = col('ramen_on_menu');
  for (const r of rows) {
    const shop = db.shops.find((s) => s.id === r[iId]);
    const v = (r[iRamen] || '').trim().toLowerCase();
    if (!shop) { console.warn(`不明な id: ${r[iId]}`); continue; }
    if (v === 'yes') {
      if (shop.category === 'other') shop.category = 'restaurant';
      if (shop.ramen !== 'specialty') shop.ramen = 'menu';
      counts.yes++;
    } else if (v === 'no') {
      drop.add(shop.id);
      removedList.push({ id: shop.id, name: shop.name, city: shop.city, osmId: shop.osmId || null, placeId: shop.placeId || null, reason: 'メニューにラーメンがない' });
      counts.no++;
    } else counts.unknown++;
  }
}
db.shops = db.shops.filter((s) => !drop.has(s.id));
await saveShops(db);
await writeFile(REMOVED_PATH, JSON.stringify({ removed: removedList }, null, 2) + '\n');
console.log(`ラーメンあり ${counts.yes} 件 / 削除 ${counts.no} 件 / 変更なし ${counts.unknown} 件（合計 ${db.shops.length} 件）`);
