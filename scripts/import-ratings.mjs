// 食べログ・ラーメンデータベースなど API の無いサイトの評価や Instagram を CSV から一括登録する。
//   node scripts/import-ratings.mjs --template   … data/ratings.csv に全店舗の入力用テンプレートを書き出す（既存値入り）
//   node scripts/import-ratings.mjs [ファイル...]  … CSV（省略時は data/ratings.csv）の内容を shops.json に反映する
// 空欄のセルは「変更なし」、"-" は「値を削除」として扱う。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadShops, saveShops, instagramHandle } from './lib.mjs';

const CSV_PATH = path.join(ROOT, 'data', 'ratings.csv');
const SITES = ['tabelog', 'rdb', 'retty', 'hotpepper'];
const COLUMNS = ['id', 'name', 'city', 'instagram', ...SITES.flatMap((s) => [`${s}_score`, `${s}_count`, `${s}_url`])];

const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

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

if (process.argv.includes('--template')) {
  const lines = [COLUMNS.join(',')];
  for (const s of db.shops) {
    lines.push([s.id, s.name, s.city, s.instagram,
      ...SITES.flatMap((site) => [s.ratings[site]?.score, s.ratings[site]?.count, s.ratings[site]?.url])].map(esc).join(','));
  }
  // Excel で文字化けしないよう BOM を付ける
  await writeFile(CSV_PATH, '﻿' + lines.join('\n') + '\n');
  console.log(`${CSV_PATH} に ${db.shops.length} 件のテンプレートを書き出しました`);
} else {
  // 引数で CSV を複数指定できる（省略時は data/ratings.csv）
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let updated = 0;
  for (const file of files.length ? files : [CSV_PATH]) {
    const [header, ...rows] = parseCsv((await readFile(file, 'utf8')).replace(/^﻿/, ''));
    for (const r of rows) {
      const rec = Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()]));
      const shop = db.shops.find((s) => s.id === rec.id);
      if (!shop) { console.warn(`不明な id: ${rec.id}`); continue; }
      if (rec.instagram === '-') shop.instagram = null;
      else if (rec.instagram) shop.instagram = instagramHandle(rec.instagram);
      for (const site of SITES) {
        const score = rec[`${site}_score`], count = rec[`${site}_count`], url = rec[`${site}_url`];
        if (score === '-') { shop.ratings[site] = null; continue; }
        if (!score && !url) continue;
        const cur = shop.ratings[site] || {};
        shop.ratings[site] = {
          score: score ? Number(score) : cur.score ?? null,
          count: count ? Number(count) : cur.count ?? null,
          url: url || cur.url || null,
        };
      }
      updated++;
    }
  }
  await saveShops(db);
  console.log(`${updated} 行を反映しました`);
}
