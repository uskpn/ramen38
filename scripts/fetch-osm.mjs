// OpenStreetMap (Overpass API) から愛媛県内の飲食店を取得し、ラーメンを出す店を data/shops.json に反映する。
// 既存データの手入力項目（評価・Instagram など）は保持される。
//   node scripts/fetch-osm.mjs
import { loadShops, loadRemoved, saveShops, classify, emptyRatings, isSameShop, instagramHandle } from './lib.mjs';

const ENDPOINTS = [
  process.env.OVERPASS_URL,
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
].filter(Boolean);

async function overpass(query) {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'ehime-ramen-map/1.0' }, body: new URLSearchParams({ data: query }) });
      if (res.ok) return await res.json();
      console.warn(`${url}: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`${url}: ${e.message}`);
    }
  }
  throw new Error('Overpass API に接続できませんでした');
}

const AREA = 'area["name"="愛媛県"]["admin_level"="4"]->.a;';

// 偶奇判定による点の多角形内判定（リング組み立て不要: 全メンバーの線分に対して交差数を数える）
function inBoundary(pt, rel) {
  let inside = false;
  for (const m of rel.members) {
    if (m.type !== 'way' || !m.geometry) continue;
    const g = m.geometry;
    for (let i = 0; i < g.length - 1; i++) {
      const a = g[i], b = g[i + 1];
      if ((a.lat > pt.lat) !== (b.lat > pt.lat) &&
          pt.lng < ((b.lon - a.lon) * (pt.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
  }
  return inside;
}

function address(t) {
  if (t['addr:full']) return t['addr:full'];
  return [t['addr:province'], t['addr:city'], t['addr:quarter'], t['addr:neighbourhood'], t['addr:block_number'] || t['addr:street'], t['addr:housenumber']]
    .filter(Boolean).join('');
}

const main = async () => {
  console.log('市町境界を取得中…');
  const muni = (await overpass(`[out:json][timeout:180];${AREA}rel(area.a)["boundary"="administrative"]["admin_level"="7"];out geom;`)).elements;
  console.log(`  ${muni.length} 市町`);

  console.log('飲食店を取得中…');
  const places = (await overpass(`[out:json][timeout:180];${AREA}nwr(area.a)["amenity"~"^(restaurant|fast_food|food_court)$"]["name"];out center tags;`)).elements;
  console.log(`  ${places.length} 件`);

  const db = await loadShops();
  const removed = await loadRemoved();
  let added = 0, updated = 0;

  for (const el of places) {
    const t = el.tags;
    const cls = classify(t.name, t.cuisine);
    if (!cls) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const osmId = `${el.type}/${el.id}`;
    if (removed.osmIds.has(osmId)) continue;
    const city = muni.find((r) => inBoundary({ lat, lng }, r))?.tags.name || t['addr:city'] || '不明';

    const fresh = {
      name: t.name,
      category: cls.category,
      ramen: cls.ramen,
      lat, lng, city,
      address: address(t) || null,
      hours: t.opening_hours || null,
      phone: t.phone || t['contact:phone'] || null,
      website: t.website || t['contact:website'] || null,
      osmId,
    };
    const ig = instagramHandle(t['contact:instagram'] || t.instagram);

    const existing = db.shops.find((s) => s.osmId === osmId) || db.shops.find((s) => !s.osmId && isSameShop(s, fresh));
    if (existing) {
      // 手入力された値は上書きしない（null の項目だけ埋める）
      for (const [k, v] of Object.entries(fresh)) {
        if (existing.locked?.includes(k)) continue;
        if (k === 'osmId' || existing[k] == null) existing[k] = v;
      }
      if (ig && !existing.instagram) existing.instagram = ig;
      if (!existing.sources.includes('osm')) existing.sources.push('osm');
      updated++;
    } else {
      db.shops.push({
        id: `osm-${el.type[0]}${el.id}`,
        ...fresh,
        instagram: ig,
        ratings: emptyRatings(),
        sources: ['osm'],
      });
      added++;
    }
  }

  await saveShops(db);
  console.log(`完了: 追加 ${added} 件 / 更新 ${updated} 件 / 合計 ${db.shops.length} 件`);
};

main().catch((e) => { console.error(e); process.exit(1); });
