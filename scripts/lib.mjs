// 共通ユーティリティ: データファイルの読み書き・分類ルール・重複判定
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOPS_PATH = path.join(ROOT, 'data', 'shops.json');

export async function loadShops() {
  try {
    return JSON.parse(await readFile(SHOPS_PATH, 'utf8'));
  } catch {
    return { updatedAt: null, shops: [] };
  }
}

// 手動で削除した店舗（重複・閉店）。自動更新で再追加しないために参照する
export async function loadRemoved() {
  try {
    const { removed } = JSON.parse(await readFile(path.join(ROOT, 'data', 'removed.json'), 'utf8'));
    return {
      osmIds: new Set(removed.map((r) => r.osmId).filter(Boolean)),
      placeIds: new Set(removed.map((r) => r.placeId).filter(Boolean)),
    };
  } catch {
    return { osmIds: new Set(), placeIds: new Set() };
  }
}

export async function saveShops(db) {
  db.updatedAt = new Date().toISOString();
  db.shops.sort((a, b) => a.city.localeCompare(b.city, 'ja') || a.name.localeCompare(b.name, 'ja'));
  await writeFile(SHOPS_PATH, JSON.stringify(db, null, 2) + '\n');
}

// ラーメンを出す店かどうかの判定ルール。
// ramen: "specialty" = ラーメン専門店 / "menu" = メニューにラーメンがある（チェーンで確認済み）/ "likely" = 中華・食堂など提供の可能性が高い
const RAMEN_NAME = /ラーメン|らーめん|拉麺|拉麵|中華そば|中華ソバ|支那そば|つけ麺|担々麺|坦々麺|まぜそば|油そば|ramen|豚骨|とんこつ|醤油|味噌|塩そば|麺屋|麺や|麺処|麺家|らぁ麺|ら〜めん|らー麺|ラー麺/i;
const CHINESE_NAME = /中華|中国料理|餃子|チャイナ|飯店|菜館|酒家|楼|台湾/;
const SHOKUDO_NAME = /食堂|大衆|ドライブイン|めし処|ごはん処/;

// ラーメン専門チェーン
const RAMEN_CHAINS = /来来亭|幸楽苑|丸源|山岡家|一風堂|一蘭|天下一品|豚太郎|味仙|ばり嗎|まこと屋|魁力屋|一刻魁堂|どうとんぼり神座|神座|横綱|らあめん花月|花月嵐|ずんどう屋|町田商店|壱角家|すき家ラーメン|金の豚|ラーメン魁力屋|丸醤屋|だるまや|元気いちばん|く～た|くーた|りょう花|一興|骨太/;
// ラーメン専門店ではないが、メニューにラーメンがあるチェーン
const MENU_CHAINS = /スシロー|くら寿司|はま寿司|かっぱ寿司|大阪王将|餃子の王将|王将|バーミヤン|日高屋|リンガーハット|8番らーめん|フジグラン.*フードコート|スガキヤ|ちゃんぽん亭|ラー麺ずんどう屋/;
// ラーメンを出さない（または例外的な）チェーン・業態は除外
const EXCLUDE = /CoCo壱番屋|ココイチ|すき家|松屋|吉野家|なか卯|はなまる|丸亀製麺|ガスト|ココス|マクドナルド|モスバーガー|ケンタッキー|ミスタードーナツ|スターバックス|コメダ|サイゼリヤ|びっくりドンキー|ほっともっと|ほっかほっか|オリジン|ロッテリア|ドトール|タリーズ|サブウェイ|焼肉|寿司(?!.*ラーメン)|鮨|お好み焼|カレー|ピザ|パスタ|ステーキ|うなぎ|とんかつ|天ぷら|カフェ|珈琲|喫茶|ゆで太郎|製麺所|うどん|饂飩|クレープ|お好|鉄板|バイキング|酒処|居酒屋|ベーカリー|ケーキ|スイーツ|ジェラート|アイス|たこ焼|ハンバーガー|バーガー|焼鳥|焼き鳥|海鮮|魚|そば処|蕎麦|ナマステ|インド|ネパール|イタリア|欧風|タイ料理|ベトナム/;

export const isExcluded = (name) => EXCLUDE.test(name);

export function classify(name, cuisine = '') {
  const c = cuisine.toLowerCase();
  if (RAMEN_CHAINS.test(name) || RAMEN_NAME.test(name) || /ramen/.test(c)) {
    return { category: 'ramen', ramen: 'specialty' };
  }
  if (MENU_CHAINS.test(name)) {
    const category = /寿司|スシロー|くら|はま|かっぱ/.test(name) ? 'chain-sushi' : /王将|バーミヤン|日高屋/.test(name) ? 'chinese' : 'chain';
    return { category, ramen: 'menu' };
  }
  if (EXCLUDE.test(name)) return null;
  if (/chinese|taiwanese/.test(c) || CHINESE_NAME.test(name)) return { category: 'chinese', ramen: 'likely' };
  // OSM では cuisine=noodle がラーメン店に付くことが多い（うどん・そば専門は除外）
  if (/noodle/.test(c) && !/udon|soba/.test(c) && !/うどん|そば|蕎麦/.test(name)) return { category: 'ramen', ramen: 'specialty' };
  if (SHOKUDO_NAME.test(name)) return { category: 'shokudo', ramen: 'likely' };
  return null;
}

export function emptyRatings() {
  return {
    google: null,    // { score, count, url }
    tabelog: null,   // 食べログ
    rdb: null,       // ラーメンデータベース
    retty: null,
    hotpepper: null,
  };
}

// 2点間の距離(m)
export function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const norm = (s) => s.normalize('NFKC').replace(/[\s・\-ー〜~()（）店]/g, '').toLowerCase();

// 同じ店かどうか（近距離かつ名前の一部が一致）
export function isSameShop(a, b) {
  const d = distance(a, b);
  if (d > 150) return false;
  const na = norm(a.name), nb = norm(b.name);
  if (na.includes(nb.slice(0, 4)) || nb.includes(na.slice(0, 4))) return true;
  return d < 25;
}

// Instagram URL / ハンドルを正規化してハンドル名だけ返す
export function instagramHandle(value) {
  if (!value) return null;
  const m = String(value).match(/(?:instagram\.com\/)?@?([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/);
  if (!m || ['p', 'v', 'tv', 'reel', 'reels', 'stories', 'explore', 'accounts', 'share', 'sharer'].includes(m[1])) return null;
  return m[1];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
