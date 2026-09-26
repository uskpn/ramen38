// 各店舗の公式サイトを読み込み、Instagram へのリンクがあればハンドル名を登録する。
//   node scripts/find-instagram.mjs
import { loadShops, saveShops, instagramHandle, sleep } from './lib.mjs';

const db = await loadShops();
const targets = db.shops.filter((s) => s.website && !s.instagram);
console.log(`公式サイトを確認: ${targets.length} 件`);
let found = 0;
for (const shop of targets) {
  try {
    const res = await fetch(shop.website, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 ehime-ramen-map' } });
    const html = await res.text();
    const handles = [...html.matchAll(/instagram\.com\/([A-Za-z0-9._]{1,30})/g)]
      .map((m) => instagramHandle(m[1]))
      .filter(Boolean);
    if (handles.length) {
      shop.instagram = handles[0];
      found++;
      console.log(`  ${shop.name}: @${shop.instagram}`);
    }
  } catch (e) {
    console.warn(`  ${shop.name}: ${e.message}`);
  }
  await sleep(300);
}
await saveShops(db);
console.log(`完了: ${found} 件の Instagram を登録`);
