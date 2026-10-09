// 修正した全店舗 CSV（export-shops.mjs の出力と同じ形）を shops.json に反映する。
//   node scripts/import-shops.mjs [--dry-run] [--base 元のCSV] [--report 出力先] file.csv ...
// ルール
//   ・空欄のセルは「変更なし」、"-" は「その値を削除」
//   ・--base を付けると、元のCSVから変わったセルだけを反映する（古いCSVで上書きしない）
//   ・文字コードは UTF-8 / Shift_JIS（Excel の CSV）を自動判別。Shift_JIS で表せない文字が「?」になっていたら、そのセルは無視して警告
//   ・営業時間は統一表記に整える（scripts/hours.mjs）。出典URL・確認日・確認状況は data/hours-sources.csv に保存
//   ・id が空で店名がある行は「新規店舗」（緯度・経度が空なら住所から国土地理院APIで取得）
//   ・「状態」に 閉業 / ラーメンなし / 出前のみ / 重複 / 削除 と書く、または「ラーメン」を 無し にすると、その店を削除して data/removed.json に記録
//   ・タグは「｜」「/」「、」区切り。サイトに無いタグは取り込まずに警告
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadShops, saveShops, instagramHandle } from './lib.mjs';
import { computeRanking } from './compute-ranking.mjs';
import { TAGS } from './import-tags.mjs';
import { normalizeHours } from './hours.mjs';
import { CATEGORY_LABEL, RAMEN_LABEL, TAG_KEYS, TAG_HEADERS, TAG_ALIAS, HOURS_SOURCE_COLUMNS, parseCsv, csvEscape } from './shops-csv.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const dry = flag('--dry-run');
const baseFile = opt('--base');
const reportFile = opt('--report');
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--base' && args[i - 1] !== '--report');
if (!files.length) {
  console.log('使い方: node scripts/import-shops.mjs [--dry-run] [--base 元のCSV] [--report 出力先] file.csv ...');
  process.exit(1);
}

async function readCsv(file) {
  const buf = await readFile(file);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { text = new TextDecoder('shift_jis').decode(buf); console.log(`（${path.basename(file)} は Shift_JIS として読み込みました）`); }
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  return { col, rows };
}

const CAT_BY_LABEL = Object.fromEntries(Object.entries(CATEGORY_LABEL).map(([k, v]) => [v, k]));
const RAMEN_BY_LABEL = { ...Object.fromEntries(Object.entries(RAMEN_LABEL).map(([k, v]) => [v, k])), 未確認: 'likely' };
const REMOVE_REASON = { 閉業: '閉業', ラーメンなし: 'ラーメンなし', 無し: 'ラーメンなし', なし: 'ラーメンなし', 出前のみ: '出前のみ', 重複: '重複', 削除: '削除依頼' };
const NO_RAMEN = new Set(['無し', 'なし']);
const DEL = '-';

const db = await loadShops();
const removedPath = path.join(ROOT, 'data', 'removed.json');
const removedDb = JSON.parse(await readFile(removedPath, 'utf8').catch(() => '{"removed":[]}'));
const byId = new Map(db.shops.map((s) => [s.id, s]));

// 営業時間の出典・確認状況（公開しない）
const srcPath = path.join(ROOT, 'data', 'hours-sources.csv');
const hoursSrc = new Map();
try {
  const { col, rows } = await readCsv(srcPath);
  for (const r of rows) hoursSrc.set(r[col.id], { name: r[col['店名']] ?? '', url: r[col['出典URL']] ?? '', date: r[col['確認日']] ?? '', status: r[col['確認状況']] ?? '' });
} catch { /* まだ無い */ }

// タグ調査のメモ（備考）。公開しない（data/tag-notes.csv）
const notesPath = path.join(ROOT, 'data', 'tag-notes.csv');
const tagNotes = new Map();
try {
  const { col, rows } = await readCsv(notesPath);
  for (const r of rows) tagNotes.set(r[col.id], r[col['備考']] ?? '');
} catch { /* まだ無い */ }

// base（元のCSV）
const base = new Map();
if (baseFile) {
  const { col, rows } = await readCsv(baseFile);
  for (const r of rows) base.set(r[col.id], Object.fromEntries(Object.entries(col).map(([h, i]) => [h, (r[i] ?? '').trim()])));
}

const num = (v) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const log = { changed: 0, added: 0, removed: 0, warn: 0 };
const report = [];
const warn = (m) => { log.warn++; console.warn(`⚠ ${m}`); report.push(`⚠ ${m}`); };
const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
// Shift_JIS で表せない文字が「?」(や ASCII 近似) になったセルかどうか
function looksCorrupted(cell, cur) {
  if (!cur) return false;
  if (cell.includes('?')) {
    const rx = new RegExp('^' + [...cell].map((c) => (c === '?' ? '.{1,2}' : c.replace(/[.*+^${}()|[\]\\]/g, '\\$&'))).join('') + '$');
    if (rx.test(cur)) return true;
    return 'maybe';
  }
  return fold(cell) === fold(cur) && cell !== cur && /[^\x00-\x7f]/.test(cur) && !/[^\x00-\x7f]/.test(cell);
}

async function geocode(address) {
  const q = address.replace(/^〒\S+\s*/, '').replace(/\s.*$/, '');
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`);
  const j = await res.json();
  const c = j?.[0]?.geometry?.coordinates;
  return c ? { lng: c[0], lat: c[1] } : null;
}

const GUARD = { 店名: 'name', 住所: 'address', 市区町村: 'city', Instagram: 'instagram' };

// セルの値を shop に反映する。戻り値: 変更した項目の配列
function applyRow(shop, get) {
  const changed = [];
  const set = (obj, key, val, label) => { if (JSON.stringify(obj[key] ?? null) !== JSON.stringify(val ?? null)) { obj[key] = val; changed.push(label); } };
  const text = (h, key, tf = (x) => x) => { const v = get(h); if (v === '') return; set(shop, key, v === DEL ? null : tf(v), h); };
  text('店名', 'name'); text('市区町村', 'city'); text('住所', 'address'); text('電話', 'phone');
  text('ホームページURL', 'website');
  text('Instagram', 'instagram', (v) => instagramHandle(v) || v);
  text('X', 'x', (v) => v.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, ''));
  const hv = get('営業時間');
  if (hv !== '') set(shop, 'hours', hv === DEL ? null : normalizeHours(hv).text, '営業時間');
  const cat = get('ジャンル');
  if (cat) { const k = CAT_BY_LABEL[cat] || (CATEGORY_LABEL[cat] ? cat : null); k ? set(shop, 'category', k, 'ジャンル') : warn(`${shop.name}: ジャンル「${cat}」は未定義（${Object.values(CATEGORY_LABEL).join('/')}）`); }
  const rm = get('ラーメン');
  if (rm) { const k = RAMEN_BY_LABEL[rm] || (RAMEN_LABEL[rm] ? rm : null); k ? set(shop, 'ramen', k, 'ラーメン') : warn(`${shop.name}: ラーメン「${rm}」は 専門/あり/不明/無し のどれかで`); }
  shop.ratings ??= {};
  for (const [site, p] of [['tabelog', '食べログ'], ['rdb', 'RDB']]) {
    const sc = get(`${p}点数`), ct = get(`${p}件数`), url = get(`${p}URL`);
    if (!sc && !ct && !url) continue;
    if ([sc, ct, url].every((v) => v === DEL)) { if (shop.ratings[site]) { shop.ratings[site] = null; changed.push(`${p}`); } continue; }
    const cur = { score: null, count: null, url: null, ...(shop.ratings[site] || {}) };
    if (sc) cur.score = sc === DEL ? null : num(sc) ?? cur.score;
    if (ct) cur.count = ct === DEL ? null : num(ct) ?? cur.count;
    if (url) cur.url = url === DEL ? null : url;
    set(shop.ratings, site, cur, p);
  }
  for (const k of TAG_KEYS) {
    const raw = get(TAG_HEADERS[k]); if (!raw) continue;
    const vals = [];
    for (const v0 of raw === DEL ? [] : raw.split(/[｜|\/／、,;；]/).map((x) => x.trim()).filter(Boolean)) {
      for (const v of [].concat(TAG_ALIAS[v0] ?? v0)) {
        if (!TAGS[k].includes(v)) { warn(`${shop.name} の ${TAG_HEADERS[k]} に未定義のタグ: ${v}`); continue; }
        if (!vals.includes(v)) vals.push(v);
      }
    }
    shop.tags ??= {};
    set(shop.tags, k, vals, TAG_HEADERS[k]);
  }
  const lat = num(get('緯度')), lng = num(get('経度'));
  if (lat != null && Math.abs(lat - shop.lat) > 1e-5) set(shop, 'lat', lat, '緯度');
  if (lng != null && Math.abs(lng - shop.lng) > 1e-5) set(shop, 'lng', lng, '経度');
  return changed;
}

for (const file of files) {
  const { col, rows } = await readCsv(file);
  if (col['id'] == null) { warn(`${file}: id 列がありません`); continue; }
  for (const r of rows) {
    const id = (r[col['id']] ?? '').trim();
    const raw = (h) => (col[h] == null ? '' : (r[col[h]] ?? '').trim());
    const baseRow = id ? base.get(id) : null;
    const shop = id ? byId.get(id) : null;
    // 変わったセルだけを返す（空欄・元のCSVと同じ・文字化けは「変更なし」）
    const get = (h) => {
      const v = raw(h);
      if (v === '') return '';
      if (baseRow && v === (baseRow[h] ?? '')) return '';
      if (shop && GUARD[h] && v !== DEL) {
        const c = looksCorrupted(v, shop[GUARD[h]]);
        if (c === true) return '';
        if (c === 'maybe') { warn(`${shop.name}: ${h}「${v}」は文字化け（?）の可能性があるため無視しました`); return ''; }
        if (c) return '';
      }
      return v;
    };
    const status = get('状態') || raw('状態');
    if (!id) {
      if (!raw('店名')) continue;
      const address = raw('住所');
      let { lat, lng } = { lat: num(raw('緯度')), lng: num(raw('経度')) };
      if ((lat == null || lng == null) && address) {
        const g = await geocode(address).catch(() => null);
        if (g) ({ lat, lng } = g);
      }
      if (lat == null || lng == null) { warn(`新規「${raw('店名')}」: 位置を取得できないため追加しませんでした（住所か緯度・経度を入れてください）`); continue; }
      const category = CAT_BY_LABEL[raw('ジャンル')] || 'ramen';
      const s = {
        id: `manual-${Date.now().toString(36)}${log.added}`, name: raw('店名'), category,
        ramen: RAMEN_BY_LABEL[raw('ラーメン')] || (category === 'ramen' ? 'specialty' : 'likely'),
        lat, lng, city: raw('市区町村') || '', address, hours: null, phone: null, website: null, instagram: null,
        ratings: { tabelog: null, rdb: null }, closed: null, sources: ['manual'],
      };
      applyRow(s, raw);
      s.lat = lat; s.lng = lng;
      db.shops.push(s); byId.set(s.id, s); log.added++;
      console.log(`＋ 追加: ${s.name}`); report.push(`＋ 追加: ${s.name}`);
      continue;
    }
    if (!shop) { warn(`id が見つかりません: ${id}（${raw('店名')}）`); continue; }
    const ramenCell = get('ラーメン');
    const reason = status ? REMOVE_REASON[status] : NO_RAMEN.has(ramenCell) ? 'ラーメンなし' : null;
    if (status && !reason) { warn(`${shop.name}: 状態「${status}」は 閉業/ラーメンなし/出前のみ/重複/削除 のどれかで`); continue; }
    if (reason) {
      db.shops.splice(db.shops.indexOf(shop), 1); byId.delete(id); hoursSrc.delete(id); tagNotes.delete(id);
      removedDb.removed.push({ id: shop.id, name: shop.name, city: shop.city ?? null, placeId: shop.placeId ?? null, osmId: shop.osmId ?? null, reason });
      log.removed++;
      console.log(`－ 削除: ${shop.name}（${reason}）`); report.push(`－ 削除: ${shop.name}（${reason}）`);
      continue;
    }
    const changed = applyRow(shop, get);
    const noteCell = get('備考'); // 空欄・変更なしは何もしない。「-」で消す
    if (noteCell) { if (noteCell === DEL) tagNotes.delete(id); else tagNotes.set(id, noteCell); }
    // 営業時間の出典・確認状況
    const s0 = hoursSrc.get(id) ?? { name: '', url: '', date: '', status: '' };
    const s1 = { name: shop.name, url: get('営業時間出典URL') || s0.url, date: get('営業時間確認日') || s0.date, status: get('営業時間確認状況') || s0.status };
    if (s1.url || s1.date || s1.status) hoursSrc.set(id, s1);
    if (changed.length) { log.changed++; console.log(`✎ 更新: ${shop.name}（${changed.join('、')}）`); report.push(`✎ 更新: ${shop.name}（${changed.join('、')}）`); }
  }
}

if (reportFile) await writeFile(reportFile, report.join('\n') + '\n');
if (dry) {
  console.log(`\n[dry-run] 更新 ${log.changed} / 追加 ${log.added} / 削除 ${log.removed} / 警告 ${log.warn}（ファイルは書き換えていません）`);
} else {
  computeRanking(db.shops);
  await saveShops(db);
  await writeFile(removedPath, JSON.stringify(removedDb, null, 2) + '\n');
  const lines = [['id', '店名', '出典URL', '確認日', '確認状況'].join(',')];
  for (const [id, v] of [...hoursSrc.entries()].filter(([id]) => byId.has(id)).sort((a, b) => a[0].localeCompare(b[0]))) lines.push([id, byId.get(id).name, v.url, v.date, v.status].map(csvEscape).join(','));
  await writeFile(srcPath, '﻿' + lines.join('\r\n') + '\r\n');
  const nl = [['id', '店名', '備考'].join(',')];
  for (const [id, v] of [...tagNotes.entries()].filter(([id, v]) => byId.has(id) && v).sort((a, b) => a[0].localeCompare(b[0]))) nl.push([id, byId.get(id).name, v].map(csvEscape).join(','));
  await writeFile(notesPath, '﻿' + nl.join('\r\n') + '\r\n');
  spawnSync('node', ['scripts/import-tags.mjs', '--template'], { cwd: ROOT, stdio: 'ignore' }); // data/tags.csv を最新に
  console.log(`\n更新 ${log.changed} / 追加 ${log.added} / 削除 ${log.removed} / 警告 ${log.warn}`);
}
