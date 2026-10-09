// タグ（STYLE / SOUP / NOODLE / CHARACTER）の下書き出力と取り込み。
//   node scripts/import-tags.mjs --template [out.csv]   ラーメン専門店の一覧に、店名からの推測タグを入れた CSV を作る
//   node scripts/import-tags.mjs file.csv ...           CSV を取り込む（タグは「/」区切り。空欄の段は既存の値を変えない）
// タグの種類は js/app.js の TAG_GROUPS と同じ。許可されていないタグは取り込まずに警告する。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadShops, saveShops } from './lib.mjs';
import { isRankTarget } from './compute-ranking.mjs';

export const TAGS = {
  style: ['ラーメン', '中華そば', '家系', '二郎系', 'つけ麺', 'まぜそば', '油そば', '汁なし', '担々麺', 'ちゃんぽん', '辛麺', '冷やし', '創作系'],
  soup: ['醤油', '塩', '味噌', '豚骨', '牛', '鶏', '鶏白湯', '魚介', '煮干し', '節', '鯛・鮮魚', '貝', '海老・蟹', '野菜', '胡麻', 'カレー', '柑橘'],
  noodle: ['細麺', '中細麺', '中太麺', '太麺', '縮れ麺', 'ストレート麺', '平打ち麺', '自家製麺'],
  character: ['あっさり', 'こってり', '濃厚', '清湯', '白湯', 'セメント系', '泡系', '背脂', '辛い', '痺れ', 'にんにく'],
};
const KEYS = Object.keys(TAGS);

// 店名から分かる範囲だけの推測。確実なものだけを入れる（メニューまでは分からない）
const RULES = [
  [/家系/, { style: ['家系'], soup: ['豚骨', '醤油'] }],
  [/二郎|マシマシ/, { style: ['二郎系'] }],
  [/つけ麺|つけめん|つけ蕎麦/, { style: ['つけ麺'] }],
  [/まぜそば/, { style: ['まぜそば'] }],
  [/油そば|油組/, { style: ['油そば'] }],
  [/担々麺|タンタン麺|担担麺/, { style: ['担々麺'] }],
  [/ちゃんぽん/, { style: ['ちゃんぽん'] }],
  [/辛麺/, { style: ['辛麺'], character: ['辛い'] }],
  [/中華そば/, { style: ['中華そば'] }],
  [/豚骨|とんこつ|長浜|久留米|博多|豚太郎/, { soup: ['豚骨'] }],
  [/味噌/, { soup: ['味噌'] }],
  [/塩ラーメン|塩らーめん|塩そば/, { soup: ['塩'] }],
  [/醤油|しょうゆ/, { soup: ['醤油'] }],
  [/鯛/, { soup: ['鯛・鮮魚'] }],
  [/鮮魚/, { soup: ['鯛・鮮魚'] }],
  [/煮干/, { soup: ['煮干し'] }],
  [/鰹/, { soup: ['節'] }],
  [/しじみ/, { soup: ['貝'] }],
  [/カレー/, { soup: ['カレー'] }],
  [/天下一品/, { soup: ['鶏'], character: ['濃厚', 'こってり'] }],
];

function guess(shop) {
  const out = Object.fromEntries(KEYS.map((k) => [k, new Set()]));
  for (const [re, tags] of RULES) {
    if (!re.test(shop.name)) continue;
    for (const [k, vs] of Object.entries(tags)) vs.forEach((v) => out[k].add(v));
  }
  return out;
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function parseCsv(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
const args = isMain ? process.argv.slice(2) : [];
const db = isMain ? await loadShops() : null;

if (!isMain) {
  // 他のスクリプトから TAGS だけを import した場合は何もしない
} else if (args[0] === '--template') {
  const out = args[1] || 'data/tags.csv';
  const lines = [['id', 'name', 'city', ...KEYS].join(',')];
  for (const s of db.shops.filter(isRankTarget).sort((a, b) => a.city.localeCompare(b.city, 'ja') || a.name.localeCompare(b.name, 'ja'))) {
    const g = guess(s);
    const cur = (k) => (s.tags?.[k] ? s.tags[k] : [...g[k]]).join('/');
    lines.push([s.id, s.name, s.city, ...KEYS.map(cur)].map(q).join(','));
  }
  await writeFile(out, '﻿' + lines.join('\n') + '\n');
  console.log(`${lines.length - 1} 店分を ${out} に出力しました（選択肢: ${KEYS.map((k) => `${k}=${TAGS[k].join('/')}`).join(' ・ ')}）`);
} else if (args.length) {
  const byId = new Map(db.shops.map((s) => [s.id, s]));
  let updated = 0;
  for (const file of args) {
    const [head, ...rows] = parseCsv((await readFile(file, 'utf8')).replace(/^﻿/, ''));
    const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
    for (const r of rows) {
      const shop = byId.get(r[col.id]?.trim());
      if (!shop) { console.warn(`id が見つかりません: ${r[col.id]}`); continue; }
      for (const k of KEYS) {
        const raw = (r[col[k]] ?? '').trim();
        if (!raw) continue;
        const vals = [...new Set(raw.split(/[\/／、,]/).map((x) => x.trim()).filter(Boolean))];
        const bad = vals.filter((v) => !TAGS[k].includes(v));
        if (bad.length) console.warn(`${shop.name} の ${k} に未定義のタグ: ${bad.join(', ')}`);
        shop.tags = { ...(shop.tags || {}), [k]: vals.filter((v) => TAGS[k].includes(v)) };
      }
      updated++;
    }
  }
  await saveShops(db);
  console.log(`${updated} 行を反映しました`);
} else {
  console.log('使い方: --template [out.csv] / file.csv ...');
}
