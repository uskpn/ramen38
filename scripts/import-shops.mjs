// 修正した全店舗 CSV（export-shops.mjs の出力と同じ形）を shops.json に反映する。
//   node scripts/import-shops.mjs [--dry-run] file.csv ...
// ルール
//   ・空欄のセルは「変更なし」、"-" は「その値を削除」
//   ・id が空で店名がある行は「新規店舗」（緯度・経度が空なら住所から国土地理院APIで取得）
//   ・「状態」に 閉業 / ラーメンなし / 出前のみ / 重複 / 削除 のどれかを書くと、その店を削除して data/removed.json に記録
//   ・タグは「｜」「/」「、」区切り。サイトに無いタグは取り込まずに警告
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadShops, saveShops, instagramHandle } from './lib.mjs';
import { computeRanking } from './compute-ranking.mjs';
import { TAGS } from './import-tags.mjs';
import { CATEGORY_LABEL, RAMEN_LABEL, TAG_KEYS, TAG_HEADERS, parseCsv } from './shops-csv.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.log('使い方: node scripts/import-shops.mjs [--dry-run] file.csv ...');
  process.exit(1);
}

const CAT_BY_LABEL = Object.fromEntries(Object.entries(CATEGORY_LABEL).map(([k, v]) => [v, k]));
const RAMEN_BY_LABEL = { ...Object.fromEntries(Object.entries(RAMEN_LABEL).map(([k, v]) => [v, k])), 未確認: 'likely', '': undefined };
const REMOVE_REASON = { 閉業: '閉業', ラーメンなし: 'ラーメンなし', 無し: 'ラーメンなし', なし: 'ラーメンなし', 出前のみ: '出前のみ', 重複: '重複', 削除: '削除依頼' };
const DEL = '-';

const db = await loadShops();
const removedPath = path.join(ROOT, 'data', 'removed.json');
const removedDb = JSON.parse(await readFile(removedPath, 'utf8').catch(() => '{"removed":[]}'));
const byId = new Map(db.shops.map((s) => [s.id, s]));

const num = (v) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : undefined);
const log = { changed: 0, added: 0, removed: 0, warn: 0 };
const warn = (m) => { log.warn++; console.warn(`⚠ ${m}`); };

async function geocode(address) {
  const q = address.replace(/^〒\S+\s*/, '').replace(/\s.*$/, '');
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`);
  const j = await res.json();
  const c = j?.[0]?.geometry?.coordinates;
  return c ? { lng: c[0], lat: c[1] } : null;
}

// セルの値を shop に反映する。戻り値: 変更があったか
function applyRow(shop, get) {
  let changed = false;
  const set = (obj, key, val) => { if (JSON.stringify(obj[key]) !== JSON.stringify(val)) { obj[key] = val; changed = true; } };
  const text = (h, key, tf = (x) => x) => {
    const v = get(h); if (v === '') return;
    set(shop, key, v === DEL ? null : tf(v));
  };
  text('店名', 'name'); text('市区町村', 'city'); text('住所', 'address'); text('営業時間', 'hours'); text('電話', 'phone');
  text('Instagram', 'instagram', (v) => instagramHandle(v) || v);
  const cat = get('ジャンル');
  if (cat) { const k = CAT_BY_LABEL[cat] || (CATEGORY_LABEL[cat] ? cat : null); k ? set(shop, 'category', k) : warn(`${shop.name}: ジャンル「${cat}」は未定義`); }
  const rm = get('ラーメン');
  if (rm) { const k = RAMEN_BY_LABEL[rm] || (RAMEN_LABEL[rm] ? rm : null); k ? set(shop, 'ramen', k) : warn(`${shop.name}: ラーメン「${rm}」は 専門/あり/不明 のどれかで`); }
  shop.ratings ??= {};
  for (const [site, p] of [['tabelog', '食べログ'], ['rdb', 'RDB']]) {
    const sc = get(`${p}点数`), ct = get(`${p}件数`), url = get(`${p}URL`);
    if (!sc && !ct && !url) continue;
    if ([sc, ct, url].every((v) => v === DEL)) { if (shop.ratings[site]) { shop.ratings[site] = null; changed = true; } continue; }
    const cur = { score: null, count: null, url: null, ...(shop.ratings[site] || {}) };
    if (sc) cur.score = sc === DEL ? null : num(sc) ?? cur.score;
    if (ct) cur.count = ct === DEL ? null : num(ct) ?? cur.count;
    if (url) cur.url = url === DEL ? null : url;
    set(shop.ratings, site, cur);
  }
  for (const k of TAG_KEYS) {
    const raw = get(TAG_HEADERS[k]); if (!raw) continue;
    const vals = raw === DEL ? [] : [...new Set(raw.split(/[｜|\/／、,;；]/).map((x) => x.trim()).filter(Boolean))];
    const bad = vals.filter((v) => !TAGS[k].includes(v));
    if (bad.length) warn(`${shop.name} の ${TAG_HEADERS[k]} に未定義のタグ: ${bad.join('、')}`);
    shop.tags ??= {};
    set(shop.tags, k, vals.filter((v) => TAGS[k].includes(v)));
  }
  const lat = num(get('緯度')), lng = num(get('経度'));
  if (lat != null) set(shop, 'lat', lat);
  if (lng != null) set(shop, 'lng', lng);
  return changed;
}

for (const file of files) {
  const [head, ...rows] = parseCsv((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  if (col['id'] == null) { warn(`${file}: id 列がありません`); continue; }
  for (const r of rows) {
    const get = (h) => (col[h] == null ? '' : (r[col[h]] ?? '').trim());
    const id = get('id');
    const status = get('状態');
    if (!id) {
      if (!get('店名')) continue;
      const address = get('住所');
      let { lat, lng } = { lat: num(get('緯度')), lng: num(get('経度')) };
      if ((lat == null || lng == null) && address) {
        const g = await geocode(address).catch(() => null);
        if (g) ({ lat, lng } = g);
      }
      if (lat == null || lng == null) { warn(`新規「${get('店名')}」: 位置を取得できないため追加しませんでした（住所か緯度・経度を入れてください）`); continue; }
      const category = CAT_BY_LABEL[get('ジャンル')] || 'ramen';
      const shop = {
        id: `manual-${Date.now().toString(36)}${log.added}`, name: get('店名'), category,
        ramen: RAMEN_BY_LABEL[get('ラーメン')] || (category === 'ramen' ? 'specialty' : 'likely'),
        lat, lng, city: get('市区町村') || '', address, hours: null, phone: null, website: null, instagram: null,
        ratings: { tabelog: null, rdb: null }, closed: null, sources: ['manual'],
      };
      applyRow(shop, get);
      shop.lat = lat; shop.lng = lng;
      db.shops.push(shop); byId.set(shop.id, shop); log.added++;
      console.log(`＋ 追加: ${shop.name}`);
      continue;
    }
    const shop = byId.get(id);
    if (!shop) { warn(`id が見つかりません: ${id}（${get('店名')}）`); continue; }
    if (status) {
      const reason = REMOVE_REASON[status];
      if (!reason) { warn(`${shop.name}: 状態「${status}」は 閉業/ラーメンなし/出前のみ/重複/削除 のどれかで`); continue; }
      db.shops.splice(db.shops.indexOf(shop), 1); byId.delete(id);
      removedDb.removed.push({ id: shop.id, name: shop.name, city: shop.city ?? null, placeId: shop.placeId ?? null, osmId: shop.osmId ?? null, reason });
      log.removed++;
      console.log(`－ 削除: ${shop.name}（${reason}）`);
      continue;
    }
    if (applyRow(shop, get)) { log.changed++; console.log(`✎ 更新: ${shop.name}`); }
  }
}

if (dry) {
  console.log(`\n[dry-run] 更新 ${log.changed} / 追加 ${log.added} / 削除 ${log.removed} / 警告 ${log.warn}（ファイルは書き換えていません）`);
} else {
  computeRanking(db.shops);
  await saveShops(db);
  await writeFile(removedPath, JSON.stringify(removedDb, null, 2) + '\n');
  spawnSync('node', ['scripts/import-tags.mjs', '--template'], { cwd: ROOT, stdio: 'ignore' }); // data/tags.csv を最新に
  console.log(`\n更新 ${log.changed} / 追加 ${log.added} / 削除 ${log.removed} / 警告 ${log.warn}`);
}
