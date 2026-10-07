// 店ごとの静的ページ（shop/<id>.html）と全店舗一覧（shop/index.html）、sitemap.xml を作る。
// 検索エンジンが一店ずつ見つけられるようにするためのもので、公開時（GitHub Actions）に実行する。
//   node scripts/build-pages.mjs <出力先(_site)> [バージョン]
// 出力先には index.html / css / js / assets がすでにコピーされている前提。
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadShops } from './lib.mjs';

const OUT = process.argv[2];
const VER = process.argv[3] || 'dev';
if (!OUT) { console.log('使い方: node scripts/build-pages.mjs <出力先> [バージョン]'); process.exit(1); }

const SITE = 'https://uskpn.github.io/ramen38/';
const CATEGORY = { ramen: 'ラーメン専門店', chinese: '中華料理', shokudo: '食堂・定食', chain: 'チェーン', restaurant: 'その他の飲食店', other: '未確認' };
const RAMEN_LABEL = { specialty: '', menu: 'ラーメンあり', likely: 'ラーメンあり?' };
const TAG_KEYS = ['style', 'soup', 'noodle', 'character'];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const tagsOf = (s) => TAG_KEYS.flatMap((k) => s.tags?.[k] || []);

const { shops: all, updatedAt } = await loadShops();
const shops = all.filter((s) => s.closed == null || s.closed === false); // 閉店・休業中のお店は作らない
for (const s of shops) if (!/^[\w-]+$/.test(s.id)) throw new Error(`ID にファイル名として使えない文字があります: ${s.id}`);
const lastmod = (updatedAt || new Date().toISOString()).slice(0, 10);

// ---------- 部品 ----------
const ICONS = {
  hp: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" class="dot"/></svg>',
  x: '<svg viewBox="0 0 24 24" class="fill"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  route: '<svg viewBox="0 0 24 24"><path d="M3 11l19-9-9 19-2-8z"/></svg>',
};
const icon = (key, label, href) => href
  ? `<a class="ic" href="${esc(href)}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ICONS[key]}</a>`
  : `<span class="ic off" title="${label}（未登録）" aria-label="${label}（未登録）">${ICONS[key]}</span>`;

const ratingCell = (s, site) => {
  const r = s.ratings?.[site];
  if (site === 'google') {
    const href = s.placeId ? `https://www.google.com/maps/search/?api=1&query=${enc(s.name)}&query_place_id=${s.placeId}` : `https://www.google.com/maps/search/?api=1&query=${enc(`${s.name} ${s.city}`)}`;
    return `<a class="rating none" href="${esc(href)}" target="_blank" rel="noopener"><span class="site">Google</span><b>Maps</b><small>open</small></a>`;
  }
  const label = site === 'tabelog' ? 'Tabelog' : 'Ramen DB';
  const search = site === 'tabelog' ? `https://tabelog.com/ehime/rstLst/?vs=1&sk=${enc(s.name)}` : `https://www.google.com/search?q=${enc(`site:ramendb.supleks.jp ${s.name} ${s.city}`)}`;
  const href = esc(r?.url || search);
  if (r?.score != null) {
    const v = site === 'rdb' ? r.score.toFixed(1) : r.score.toFixed(2);
    return `<a class="rating" href="${href}" target="_blank" rel="noopener"><span class="site">${label}</span><b>${v}</b><small>${r.count ? `${r.count.toLocaleString('en-US')} reviews` : '&nbsp;'}</small></a>`;
  }
  return `<a class="rating none" href="${href}" target="_blank" rel="noopener"><span class="site">${label}</span><b>—</b><small>${r?.url ? 'page' : 'search'}</small></a>`;
};

const hoursHtml = (h) => h.split(' / ').map(esc).join('<br>');
const tagChips = (s) => { const t = tagsOf(s); return t.length ? `<p class="tags">${t.map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : ''; };
const metaLine = (s) => [esc(s.city), esc(CATEGORY[s.category] || s.category)].join('<span class="sep">—</span>') + (RAMEN_LABEL[s.ramen] ? `<span class="sep">·</span>${esc(RAMEN_LABEL[s.ramen])}` : '');

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500&family=Noto+Sans+JP:wght@300;400;500&display=swap">';
function layout({ title, description, canonical, body, jsonld, ogType = 'website', app = null, current = '' }) {
  return `<!doctype html>
<html lang="ja"${app ? ' data-root="../"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#ffffff">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="../assets/favicon.png">
<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
${FONTS}
${app ? app.styles : ''}
<link rel="stylesheet" href="../css/style.css?v=${VER}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="subpage">
<header class="site-header">
  <a class="brand" href="../" aria-label="RAMEN 38 トップへ"><img src="../assets/logo-horizontal.png" alt="RAMEN 38" width="817" height="137"></a>
  <nav class="site-nav" aria-label="メインメニュー">
    <a href="../">Top</a><a href="./"${current === 'shops' ? ' aria-current="page"' : ''}>Shops</a><a href="../#explore">Explore</a><a href="../#my">My<span class="nav-long"> Ramen 38</span></a><a href="../#about">About</a>
  </nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <img src="../assets/mark.png" alt="" class="footer-mark" width="848" height="822">
  <p class="footer-brand">RAMEN 38 <span>Explore Ehime Ramen</span></p>
  <p class="footer-credit"><a href="../">地図で探す</a> · <a href="./">全店舗一覧</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, Google</p>
</footer>
${app ? app.scripts : ''}
</body>
</html>
`;
}

// ---------- 近い店（タグの重なりで選ぶ） ----------
const tagSets = new Map(shops.map((s) => [s.id, new Set(tagsOf(s))]));
function similar(s) {
  const a = tagSets.get(s.id);
  if (a.size < 2) return [];
  return shops
    .filter((o) => o.id !== s.id && (s.category !== 'ramen' || o.category === 'ramen'))
    .map((o) => {
      const b = tagSets.get(o.id);
      const shared = [...a].filter((t) => b.has(t));
      return { o, shared, sim: shared.length / new Set([...a, ...b]).size };
    })
    .filter((x) => x.shared.length >= 2)
    .sort((x, y) => y.sim - x.sim || (x.o.rank || 9999) - (y.o.rank || 9999) || (x.o.city === s.city ? -1 : 1) - (y.o.city === s.city ? -1 : 1) || x.o.name.localeCompare(y.o.name, 'ja'))
    .slice(0, 3);
}

// ---------- 店ごとのページ ----------
function shopPage(s) {
  const url = `${SITE}shop/${s.id}.html`;
  const tags = tagsOf(s);
  const rows = [['Address', s.address], ['Hours', s.hours && hoursHtml(s.hours)], ['Tel', s.phone && `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>`]].filter(([, v]) => v);
  const sim = similar(s);
  const description = `${s.name}（愛媛県${s.city}）の${CATEGORY[s.category] === 'ラーメン専門店' ? 'ラーメン店' : CATEGORY[s.category]}。${tags.length ? `${tags.slice(0, 6).join('・')}。` : ''}住所・営業時間・電話、食べログ／ラーメンデータベースの評価、Instagram、地図をまとめています。`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: s.name, url,
    servesCuisine: 'ラーメン',
    address: { '@type': 'PostalAddress', addressCountry: 'JP', addressRegion: '愛媛県', addressLocality: s.city, streetAddress: (s.address || '').replace(/^〒[\d-]+\s*/, '').replace(/^愛媛県/, '') },
    geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lng },
    ...(s.phone ? { telephone: s.phone } : {}),
    sameAs: [s.website, s.instagram && `https://www.instagram.com/${s.instagram}/`, s.x && `https://x.com/${s.x}`, s.ratings?.tabelog?.url].filter(Boolean),
  };
  const body = `<article class="shop-page">
  <p class="crumb"><a href="../">RAMEN 38</a><span>›</span><a href="./">Shops</a></p>
  <p class="shop-meta">${metaLine(s)}</p>
  <h1 class="shop-title">${s.rank ? `<span class="rank${s.rank <= 3 ? ' rank-top' : ''}" title="総合スコア ${s.score}"><small>RANK</small>${s.rank}</span>` : ''}${esc(s.name)}</h1>
  ${tagChips(s)}
  <div class="popup">
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Address' ? esc(v) : v}</dd>`).join('')}</dl>
    <div class="popup-icons">
      ${icon('hp', 'ホームページ', s.website)}
      ${icon('ig', 'Instagram', s.instagram && `https://www.instagram.com/${s.instagram}/`)}
      ${icon('x', 'X', s.x && `https://x.com/${s.x}`)}
      ${icon('route', '経路', `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`)}
    </div>
    <div class="ratings">${['google', 'tabelog', 'rdb'].map((k) => ratingCell(s, k)).join('')}</div>
  </div>
  <p class="shop-cta"><a class="btn-primary" href="../#shop=${enc(s.id)}">地図で見る・「行った」を記録する</a></p>
  ${sim.length ? `<section class="similar"><h2 class="lab">この店が好きなら</h2><ul>${sim.map(({ o, shared }) => `<li><a href="${o.id}.html"><span class="nm">${esc(o.name)}</span><span class="mt">${esc(o.city)} — ${esc(CATEGORY[o.category])}</span><span class="sh">共通：${shared.slice(0, 4).map(esc).join('・')}</span></a></li>`).join('')}</ul></section>` : ''}
  <p class="page-note">掲載情報は変わることがあります。お出かけ前に、各店・各サイトで最新の情報をご確認ください。（データ更新：${lastmod.replace(/-/g, '.')}）</p>
</article>`;
  return layout({ title: `${s.name}（${s.city}）｜RAMEN 38`, description, canonical: url, body, jsonld });
}

// ---------- 全店舗一覧（トップページの EXPLORE と同じ画面） ----------
async function indexPage() {
  const root = await readFile(path.join(OUT, 'index.html'), 'utf8');
  let explore = (root.match(/<section class="explore"[\s\S]*?<\/section>/) || [])[0];
  if (!explore) throw new Error('index.html から EXPLORE のセクションを取り出せませんでした');
  // 見出しを「EHIME RAMEN 645」にする（番号の「01」は付けない）
  explore = explore
    .replace(/<p class="section-no">[^<]*<\/p>\s*/, '')
    .replace(/<h2 id="explore-title">[\s\S]*?<\/h2>/, `<h2 id="explore-title"><span class="en">Ehime Ramen ${shops.length}</span></h2>`);
  const styles = (root.match(/<link rel="stylesheet" href="https:\/\/cdn[^>]*>/g) || []).join('\n');
  const scripts = (root.match(/<script src="[^"]*"><\/script>/g) || []).map((t) => t.replace('src="js/', 'src="../js/')).join('\n');
  // 検索エンジン向けに、JavaScript なしでも全店舗へのリンクが辿れるようにしておく
  const byCity = new Map();
  for (const s of shops) (byCity.get(s.city) || byCity.set(s.city, []).get(s.city)).push(s);
  const catRank = { ramen: 0, chinese: 1, shokudo: 2, restaurant: 3, chain: 4, other: 5 };
  const list = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'))
    .map(([c, l]) => `<h2>${esc(c)}（${l.length}店）</h2><ul>${l.sort((a, b) => catRank[a.category] - catRank[b.category] || (a.rank || 9999) - (b.rank || 9999) || a.name.localeCompare(b.name, 'ja')).map((s) => `<li><a href="${s.id}.html">${esc(s.name)}</a>（${esc(CATEGORY[s.category])}）</li>`).join('')}</ul>`).join('');
  const body = `<h1 class="sr-only">愛媛県のラーメン店 ${shops.length}店の一覧</h1>
${explore}
<noscript><div class="shop-index"><p class="page-note">JavaScript を有効にすると地図と絞り込みが使えます。全店舗の一覧です。</p>${list}</div></noscript>`;
  return layout({ title: `愛媛県のラーメン店 全${shops.length}店｜RAMEN 38`, description: `愛媛県20市町のラーメン店${shops.length}店を、地図・一覧・絞り込み（市町・タグ・営業中・現在地に近い順）で探せます。ラーメン専門店から中華料理・食堂まで。`, canonical: `${SITE}shop/`, body, app: { styles, scripts }, current: 'shops' });
}

// ---------- 書き出し ----------
const dir = path.join(OUT, 'shop');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'index.html'), await indexPage());
for (const s of shops) await writeFile(path.join(dir, `${s.id}.html`), shopPage(s));
const urls = [SITE, `${SITE}shop/`, ...shops.map((s) => `${SITE}shop/${s.id}.html`)];
await writeFile(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`);
console.log(`店ごとのページ ${shops.length} 件、一覧、sitemap.xml（${urls.length} URL）を ${OUT} に作りました`);
