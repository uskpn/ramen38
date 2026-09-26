// Google Places API (New) で
//   1) 既存の店舗に Google の評価・口コミ数・マップURL・営業時間を付与
//   2) 市町ごとに「ラーメン」「中華そば」などで検索し、OSM に載っていない店舗を追加
// を行う。API キーが必要（Places API (New) を有効化したもの）。
//   GOOGLE_MAPS_API_KEY=xxxx node scripts/enrich-google.mjs [--no-discover] [--no-match]
import { loadShops, saveShops, classify, isExcluded, emptyRatings, isSameShop, instagramHandle, sleep } from './lib.mjs';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) {
  console.error('環境変数 GOOGLE_MAPS_API_KEY を設定してください');
  process.exit(1);
}
const args = new Set(process.argv.slice(2));

const CITIES = ['松山市', '今治市', '宇和島市', '八幡浜市', '新居浜市', '西条市', '大洲市', '伊予市', '四国中央市', '西予市', '東温市',
  '上島町', '久万高原町', '松前町', '砥部町', '内子町', '伊方町', '松野町', '鬼北町', '愛南町'];
const KEYWORDS = ['ラーメン', '中華そば', 'つけ麺', '中華料理', '食堂 ラーメン', 'ちゃんぽん'];
const RAMEN_KEYWORDS = new Set(['ラーメン', '中華そば', 'つけ麺']);

const FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'googleMapsUri', 'websiteUri',
  'primaryType', 'types', 'businessStatus', 'nationalPhoneNumber', 'regularOpeningHours.weekdayDescriptions'];

async function textSearch(body) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': [...FIELDS.map((f) => `places.${f}`), 'nextPageToken'].join(','),
    },
    body: JSON.stringify({ languageCode: 'ja', regionCode: 'JP', ...body }),
  });
  if (!res.ok) throw new Error(`Places API: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

function applyGoogle(shop, p) {
  shop.placeId = p.id;
  shop.ratings.google = p.rating ? { score: p.rating, count: p.userRatingCount ?? 0, url: p.googleMapsUri } : { score: null, count: 0, url: p.googleMapsUri };
  if (p.businessStatus === 'CLOSED_PERMANENTLY') shop.closed = true;
  if (p.businessStatus === 'CLOSED_TEMPORARILY') shop.closed = 'temporary';
  if (!shop.address && p.formattedAddress) shop.address = p.formattedAddress.replace(/^日本、(〒\d{3}-\d{4} )?/, '');
  if (!shop.phone && p.nationalPhoneNumber) shop.phone = p.nationalPhoneNumber;
  if (p.regularOpeningHours?.weekdayDescriptions) shop.hoursText = p.regularOpeningHours.weekdayDescriptions;
  if (p.websiteUri) {
    const ig = /instagram\.com/.test(p.websiteUri) ? instagramHandle(p.websiteUri) : null;
    if (ig && !shop.instagram) shop.instagram = ig;
    else if (!ig && !shop.website) shop.website = p.websiteUri;
  }
  if (!shop.sources.includes('google')) shop.sources.push('google');
}

const db = await loadShops();

// 1) 既存店舗を Google の店舗情報と突き合わせる
if (!args.has('--no-match')) {
  const targets = db.shops.filter((s) => !s.placeId);
  console.log(`既存店舗の照合: ${targets.length} 件`);
  for (const [i, shop] of targets.entries()) {
    try {
      const { places = [] } = await textSearch({
        textQuery: shop.name,
        pageSize: 5,
        locationBias: { circle: { center: { latitude: shop.lat, longitude: shop.lng }, radius: 300 } },
      });
      const hit = places.find((p) => isSameShop(shop, { name: p.displayName.text, lat: p.location.latitude, lng: p.location.longitude }));
      if (hit) applyGoogle(shop, hit);
      process.stdout.write(`\r  ${i + 1}/${targets.length}`);
    } catch (e) {
      console.warn(`\n  ${shop.name}: ${e.message}`);
    }
    await sleep(100);
  }
  console.log();
}

// 2) 市町×キーワードで検索して新しい店舗を追加
if (!args.has('--no-discover')) {
  let added = 0;
  for (const city of CITIES) {
    for (const kw of KEYWORDS) {
      let pageToken;
      do {
        const { places = [], nextPageToken } = await textSearch({ textQuery: `${kw} 愛媛県${city}`, pageSize: 20, pageToken });
        for (const p of places) {
          if (!p.formattedAddress?.includes('愛媛県')) continue;
          const name = p.displayName.text;
          const existing = db.shops.find((s) => s.placeId === p.id) ||
            db.shops.find((s) => isSameShop(s, { name, lat: p.location.latitude, lng: p.location.longitude }));
          if (existing) {
            applyGoogle(existing, p);
            continue;
          }
          const types = p.types || [];
          let cls = classify(name, types.includes('ramen_restaurant') ? 'ramen' : types.includes('chinese_restaurant') ? 'chinese' : '');
          // 店名にラーメンと入っていない店も多いので、ラーメン系キーワードの検索結果は飲食店であれば採用する
          if (!cls && RAMEN_KEYWORDS.has(kw) && types.some((t) => /restaurant|meal_takeaway|food/.test(t)) && !isExcluded(name)) {
            cls = { category: 'ramen', ramen: 'likely' };
          }
          if (!cls) continue;
          const shop = {
            id: `g-${p.id}`,
            name, ...cls,
            lat: p.location.latitude, lng: p.location.longitude,
            city: CITIES.find((c) => p.formattedAddress.includes(c)) || city,
            address: null, hours: null, phone: null, website: null,
            instagram: null,
            ratings: emptyRatings(),
            sources: [],
          };
          applyGoogle(shop, p);
          db.shops.push(shop);
          added++;
        }
        pageToken = nextPageToken;
        await sleep(pageToken ? 2000 : 100);
      } while (pageToken);
    }
    console.log(`  ${city}: 累計追加 ${added} 件`);
  }
}

await saveShops(db);
console.log(`完了: 合計 ${db.shops.length} 件`);
