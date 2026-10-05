// 全店舗の最新情報を CSV に書き出す（Excel で開いて確認・修正するための一覧）。
//   node scripts/export-shops.mjs [出力先]   … 省略時は exports/shops-all.csv
// 修正したCSVは scripts/import-shops.mjs で shops.json に反映できる。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadShops } from './lib.mjs';
import { COLUMNS, CATEGORY_LABEL, RAMEN_LABEL, TAG_KEYS, csvEscape, parseCsv } from './shops-csv.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, 'exports', 'shops-all.csv'));
const db = await loadShops();
// 営業時間の出典・確認状況（data/hours-sources.csv）
const src = new Map();
try {
  const [, ...rows] = parseCsv((await readFile(path.join(ROOT, 'data', 'hours-sources.csv'), 'utf8')).replace(/^\uFEFF/, ''));
  for (const r of rows) src.set(r[0], r);
} catch { /* まだ無い */ }
const ORDER = Object.keys(CATEGORY_LABEL);

const shops = [...db.shops].sort((a, b) =>
  ORDER.indexOf(a.category) - ORDER.indexOf(b.category) ||
  (a.city || '').localeCompare(b.city || '', 'ja') || a.name.localeCompare(b.name, 'ja'));

const lines = [COLUMNS.join(',')];
for (const s of shops) {
  const tb = s.ratings?.tabelog, rd = s.ratings?.rdb;
  const row = [
    s.id, s.name, CATEGORY_LABEL[s.category] ?? s.category, RAMEN_LABEL[s.ramen] ?? s.ramen ?? '', s.city, s.address,
    s.hours, s.phone, s.website, s.instagram, s.x,
    tb?.score, tb?.count, tb?.url, rd?.score, rd?.count, rd?.url,
    ...TAG_KEYS.map((k) => (s.tags?.[k] || []).join('｜')),
    '', '', s.lat, s.lng,
    src.get(s.id)?.[2], src.get(s.id)?.[3], src.get(s.id)?.[4],
  ];
  lines.push(row.map(csvEscape).join(','));
}
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, '﻿' + lines.join('\r\n') + '\r\n');
console.log(`${shops.length} 店を ${path.relative(ROOT, out)} に出力しました`);
