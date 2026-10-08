(() => {
  'use strict';

  const CATEGORIES = {
    ramen: { label: 'ラーメン専門店' },
    chinese: { label: '中華料理' },
    shokudo: { label: '食堂・定食' },
    chain: { label: 'チェーン' },
    restaurant: { label: 'その他の飲食店' },
    other: { label: '未確認', off: true },
  };
  const RAMEN_LABEL = {
    specialty: '',
    menu: 'ラーメンあり',
    likely: 'ラーメンあり?',
  };
  // タグ（店ごとに無制限で付ける）。shop.tags = { style: [], soup: [], noodle: [], character: [] }
  const TAG_GROUPS = [
    { key: 'style', label: 'Style', tags: ['ラーメン', '中華そば', '家系', '二郎系', 'つけ麺', 'まぜそば', '油そば', '担々麺', 'ちゃんぽん', '辛麺', '冷やし', '創作系'] },
    { key: 'soup', label: 'Soup', tags: ['醤油', '塩', '味噌', '豚骨', '鶏', '鶏白湯', '魚介', '煮干し', '節', '鯛・鮮魚', '貝', '海老・蟹', '野菜', '胡麻', 'カレー', '柑橘'] },
    { key: 'noodle', label: 'Noodle', tags: ['細麺', '中太麺', '太麺', '自家製麺'] },
    { key: 'character', label: 'Character', tags: ['あっさり', 'こってり', '濃厚', '清湯', '白湯', 'セメント系', '泡系', '背脂', '辛い', '痺れ', 'にんにく'] },
  ];
  const tagsOf = (shop, key) => shop.tags?.[key] || [];

  // 評価を並べるサイト。url が無い店舗は各サイトの検索ページへリンクする
  const SITES = [
    { key: 'google', label: 'Google', max: 5, linkOnly: true, // 点数は規約上保存・掲載せず、Google マップへ案内する
      search: (s) => s.placeId
        ? `https://www.google.com/maps/search/?api=1&query=${enc(s.name)}&query_place_id=${s.placeId}`
        : `https://www.google.com/maps/search/?api=1&query=${enc(`${s.name} ${s.city}`)}` },
    { key: 'tabelog', label: 'Tabelog', max: 5,
      search: (s) => `https://tabelog.com/ehime/rstLst/?vs=1&sk=${enc(s.name)}` },
    { key: 'rdb', label: 'Ramen DB', max: 100,
      search: (s) => siteSearch('ramendb.supleks.jp', s) },
  ];

  // 店ごとのページ（shop/）では ../ になる。サイトの根元からの相対パス
  const ROOT = document.documentElement.dataset.root || '';
  // shop/ のページは「一覧（Index）だけ」。地図は使わず、店名は店ごとのページへのリンクにする
  const INDEX_ONLY = document.documentElement.dataset.mode === 'index';
  const enc = encodeURIComponent;
  const siteSearch = (domain, s) => `https://www.google.com/search?q=${enc(`site:${domain} ${s.name} ${s.city}`)}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);

  const state = {
    shops: [],
    q: '', city: '', sort: 'rank',
    cats: new Set(Object.keys(CATEGORIES).filter((k) => !CATEGORIES[k].off)),
    igOnly: false, ratedOnly: false, hideClosed: true,
    openNow: false, near: false, mine: '', // near: 現在地から近い順に並べる // mine: '' | fav | visited | todo
    loc: null, // 現在地 { lat, lng }
    tags: Object.fromEntries(TAG_GROUPS.map((g) => [g.key, new Set()])), // 同じ段の中は OR、段どうしは AND
    view: 'map',
    limit: 60,
    activeId: null,
  };
  const markers = new Map();
  let activeMarker = null;

  // ---------- お気に入り・行った（この端末のブラウザに保存） ----------
  const STORE_KEY = 'ramen38:mylist:v1';
  const mylist = { fav: new Set(), visited: new Set(), visitedAt: {} }; // visitedAt: { 店ID: 'YYYY-MM-DD' }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    for (const k of ['fav', 'visited']) (saved[k] || []).forEach((id) => mylist[k].add(id));
    mylist.visitedAt = saved.visitedAt || {};
  } catch { /* 保存できない環境でもそのまま使える */ }
  const saveMylist = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ fav: [...mylist.fav], visited: [...mylist.visited], visitedAt: mylist.visitedAt })); } catch { /* 保存できない環境 */ }
  };

  // ---------- 営業中の判定・現在地からの距離 ----------
  let now = new Date(); // 描画のたびに更新する
  const openStatus = (shop) => (shop.closed ? null : window.RamenHours?.status(shop.hours, now));
  const distanceKm = (shop) => {
    if (!state.loc) return null;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(shop.lat - state.loc.lat), dLng = rad(shop.lng - state.loc.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(state.loc.lat)) * Math.cos(rad(shop.lat)) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  };
  const distText = (km) => (km < 1 ? `${Math.round(km * 10) * 100}m`.replace(/^0m$/, '100m') : `${km.toFixed(km < 10 ? 1 : 0)}km`);

  // ---------- 地図 ----------
  const map = L.map('map', { zoomControl: true, scrollWheelZoom: false, minZoom: 5, maxZoom: 18 }).setView([33.65, 132.8], 9);
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
  // 地図：OpenFreeMap（鍵不要・無料）の淡色スタイル。地名は日本語だけにする。
  // 読み込めないときは国土地理院の淡色地図に切り替える。
  const gsiTiles = () => L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
  });
  if (!INDEX_ONLY) fetch('https://tiles.openfreemap.org/styles/positron')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((style) => {
      for (const layer of style.layers) {
        const tf = layer.layout?.['text-field'];
        if (tf && !JSON.stringify(tf).includes('"ref"')) layer.layout['text-field'] = ['coalesce', ['get', 'name:ja'], ['get', 'name:nonlatin'], ['get', 'name']];
      }
      L.maplibreGL({
        style,
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
    })
    .catch(() => gsiTiles().addTo(map));
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    disableClusteringAtZoom: 16,
    // 吹き出しを開いて地図が動いたとき、画面の外に出たピンを取り除かない（取り除くと吹き出しが閉じてしまう）
    removeOutsideVisibleBounds: false,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 30 : n < 50 ? 38 : 46;
      return L.divIcon({ className: '', html: `<div class="cluster" style="width:${size}px;height:${size}px">${n}</div>`, iconSize: [size, size] });
    },
  });
  map.addLayer(cluster);
  // 選んだ直後の2.5秒以内に、再描画（画面サイズの変化など）で吹き出しが閉じたら開き直す。地図を触ったら止める
  map.getContainer().addEventListener('pointerdown', () => { reopen = null; }, true);
  map.on('popupclose', () => {
    if (!reopen || Date.now() > reopen.until || reopen.tries >= 1) return; // 開き直しは1回だけ（繰り返して地図が揺れるのを防ぐ）
    reopen.tries++;
    const m = markers.get(reopen.id);
    setTimeout(() => {
      if (reopen && Date.now() <= reopen.until && !m.isPopupOpen()) cluster.zoomToShowLayer(m, () => m.openPopup());
    }, 60);
  });

  function icon(shop, active = false) {
    return L.divIcon({
      className: '',
      html: `<div class="dot ${shop.ramen === 'likely' ? 'maybe' : ''} ${active ? 'active' : ''} ${mylist.visited.has(shop.id) ? 'visited' : ''} ${mylist.fav.has(shop.id) ? 'fav' : ''}"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -8],
    });
  }

  // ---------- 表示部品 ----------
  // 「松山市 — ラーメン専門店 · ラーメンあり?」のような1行の説明
  function meta(shop, withCity = true) {
    const parts = [];
    if (withCity) parts.push(esc(shop.city));
    parts.push(esc(CATEGORIES[shop.category]?.label || shop.category));
    let html = parts.join('<span class="sep">—</span>');
    if (RAMEN_LABEL[shop.ramen]) {
      const cls = shop.ramen === 'likely' ? 'tag-maybe' : '';
      const title = shop.ramen === 'likely' ? ' title="メニュー未確認"' : '';
      html += `<span class="sep">·</span><span class="${cls}"${title}>${esc(RAMEN_LABEL[shop.ramen])}</span>`;
    }
    if (shop.closed) html += `<span class="sep">·</span><span class="tag-closed">${shop.closed === 'temporary' ? '休業中' : '閉店'}</span>`;
    if (withCity) {
      const st = openStatus(shop);
      if (st) html += `<span class="sep">·</span>${st.open ? `<span class="open-now" title="日本時間の現在時刻で判定">営業中 〜${st.until}</span>` : '<span class="open-off">営業時間外</span>'}`;
      const km = distanceKm(shop);
      if (km != null) html += `<span class="sep">·</span><span class="dist">${distText(km)}</span>`;
    }
    return html;
  }

  const fmt = (site, v) => v.toFixed(site.max === 100 ? 1 : site.key === 'google' ? 1 : 2);

  function ratingCell(shop, site) {
    const r = shop.ratings?.[site.key];
    const href = esc(r?.url || site.search(shop));
    if (site.linkOnly) {
      return `<a class="rating none" href="${href}" target="_blank" rel="noopener" title="Google マップで評価を見る">
      <span class="site">${site.label}</span><b>Maps</b><small>open</small></a>`;
    }
    if (r?.score != null) {
      const count = r.count ? `<small>${r.count.toLocaleString()} reviews</small>` : '<small>&nbsp;</small>';
      return `<a class="rating" href="${href}" target="_blank" rel="noopener"><span class="site">${site.label}</span><b>${fmt(site, r.score)}</b>${count}</a>`;
    }
    return `<a class="rating none" href="${href}" target="_blank" rel="noopener" title="${site.label}${r?.url ? 'のページを開く' : 'で探す'}">
      <span class="site">${site.label}</span><b>—</b><small>${r?.url ? 'page' : 'search'}</small></a>`;
  }

  const marks = (shop) => `<span class="marks" data-marks="${esc(shop.id)}">${mylist.fav.has(shop.id) ? '<i class="mk-fav" title="お気に入り">★</i>' : ''}${mylist.visited.has(shop.id) ? '<i class="mk-visited" title="行った">✓</i>' : ''}</span>`;

  const tagsHtml = (shop) => {
    const all = TAG_GROUPS.flatMap((g) => tagsOf(shop, g.key));
    return all.length ? `<p class="tags">${all.map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : '';
  };

  // 一覧（地図の横のリスト・Index の表）のホームページ / Instagram / X のアイコン。未登録は薄く表示
  function socialIcons(shop) {
    const ic = (key, label, href) => href
      ? `<a class="ic" href="${href}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ICONS[key]}</a>`
      : `<span class="ic off" title="${label}（未登録）" aria-label="${label}（未登録）">${ICONS[key]}</span>`;
    return `<span class="social">${ic('hp', 'ホームページ', shop.website && esc(shop.website))}${shop.instagram
      ? ic('ig', 'Instagram', `https://www.instagram.com/${esc(shop.instagram)}/`)
      : ic('ig', 'Instagramを探す', `https://www.google.com/search?q=${enc(`site:instagram.com ${shop.name} ${shop.city}`)}`).replace('class="ic"', 'class="ic search"')}${ic('x', 'X', shop.x && `https://x.com/${esc(shop.x)}`)}</span>`;
  }

  function instagramLink(shop) {
    if (!shop.instagram) return '';
    return `<a class="ig" href="https://www.instagram.com/${esc(shop.instagram)}/" target="_blank" rel="noopener">@${esc(shop.instagram)}</a>`;
  }

  // 総合ランキング（ラーメン専門店のみ・200位まで）。順位は scripts/compute-ranking.mjs が算出
  const rankBadge = (shop) => shop.rank
    ? `<span class="rank${shop.rank <= 3 ? ' rank-top' : ''}" title="総合スコア ${shop.score}"><small>RANK</small>${shop.rank}</span>`
    : '';

  // 営業時間は「 / 」区切りで1行ずつ表示する（表記は scripts/hours.mjs で統一）
  const hoursHtml = (h) => h && h.split(' / ').map(esc).join('<br>');

  // 吹き出しのアイコン（HP / Instagram / X / 経路）
  const ICONS = {
    hp: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
    ig: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" class="dot"/></svg>',
    x: '<svg viewBox="0 0 24 24" class="fill"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    route: '<svg viewBox="0 0 24 24"><path d="M3 11l19-9-9 19-2-8z"/></svg>',
  };
  function iconLinks(shop) {
    const ic = (key, label, href) => href
      ? `<a class="ic" href="${href}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ICONS[key]}</a>`
      : `<span class="ic off" title="${label}（未登録）" aria-label="${label}（未登録）">${ICONS[key]}</span>`;
    return `<div class="popup-icons">
      ${ic('hp', 'ホームページ', shop.website && esc(shop.website))}
      ${shop.instagram
        ? ic('ig', 'Instagram', `https://www.instagram.com/${esc(shop.instagram)}/`)
        : ic('ig', 'Instagramを探す', `https://www.google.com/search?q=${enc(`site:instagram.com ${shop.name} ${shop.city}`)}`).replace('class="ic"', 'class="ic search"')}
      ${ic('x', 'X', shop.x && `https://x.com/${esc(shop.x)}`)}
      ${ic('route', '経路', `https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lng}`)}
    </div>`;
  }

  const ICONS2 = {
    fav: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    visited: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v8h14v-8"/></svg>',
  };
  const actionsHtml = (shop) => `<div class="popup-actions" data-id="${esc(shop.id)}">
      <button type="button" class="act" data-act="fav" aria-pressed="${mylist.fav.has(shop.id)}">${ICONS2.fav}<span>お気に入り</span></button>
      <button type="button" class="act" data-act="visited" aria-pressed="${mylist.visited.has(shop.id)}">${ICONS2.visited}<span>行った</span></button>
      <button type="button" class="act" data-act="share">${ICONS2.share}<span>共有</span></button>
    </div>
    <p class="popup-more"><a href="${ROOT}shop/${esc(shop.id)}.html">このお店のページ →</a></p>`;

  function popupHtml(shop) {
    const rows = [
      ['住所', shop.address],
      ['営業時間', hoursHtml(shop.hours)],
      ['電話', shop.phone && `<a href="tel:${esc(shop.phone)}">${esc(shop.phone)}</a>`],
    ].filter(([, v]) => v);
    const label = { 住所: 'Address', 営業時間: 'Hours', 電話: 'Tel' };
    return `<div class="popup">
      <p class="shop-meta">${meta(shop)}</p>
      <p class="shop-name">${rankBadge(shop)}${esc(shop.name)}</p>
      ${tagsHtml(shop)}
      <dl>${rows.map(([k, v]) => `<dt>${label[k]}</dt><dd>${k === '住所' ? esc(v) : v}</dd>`).join('')}</dl>
      ${iconLinks(shop)}
      ${actionsHtml(shop)}
      <div class="ratings">${SITES.map((s) => ratingCell(shop, s)).join('')}</div>
    </div>`;
  }

  // ---------- 絞り込み・並び替え ----------
  // 口コミが少ない店が上位に来ないよう、件数が少ないほど平均的な値に寄せて並べる（ベイズ平均）
  const PRIOR = { tabelog: 3.1, rdb: 75 };
  const score = (shop, key) => {
    const r = shop.ratings?.[key];
    if (r?.score == null) return -1;
    if (!r.count) return r.score;
    const m = 20;
    return (r.score * r.count + PRIOR[key] * m) / (r.count + m);
  };
  const totalCount = (shop) => SITES.filter((s) => !s.linkOnly).reduce((n, s) => n + (shop.ratings?.[s.key]?.count || 0), 0);
  const hasRating = (shop) => SITES.some((s) => !s.linkOnly && shop.ratings?.[s.key]?.score != null);

  function filtered() {
    const q = state.q.trim().normalize('NFKC').toLowerCase();
    const list = state.shops.filter((s) =>
      state.cats.has(s.category) &&
      (!state.city || s.city === state.city) &&
      (!state.igOnly || s.instagram) &&
      (!state.ratedOnly || hasRating(s)) &&
      (!state.hideClosed || s.closed !== true) &&
      (!state.openNow || openStatus(s)?.open) &&
      (!state.mine || (state.mine === 'todo' ? !mylist.visited.has(s.id) : mylist[state.mine].has(s.id))) &&
      TAG_GROUPS.every((g) => !state.tags[g.key].size || tagsOf(s, g.key).some((x) => state.tags[g.key].has(x))) &&
      (!q || `${s.name} ${s.address || ''} ${s.city}`.normalize('NFKC').toLowerCase().includes(q)));
    const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
    const nearFirst = (a, b) => (distanceKm(a) ?? 1e9) - (distanceKm(b) ?? 1e9) || byName(a, b);
    const sorters = {
      rank: (a, b) => (a.rank || 9999) - (b.rank || 9999) || a.city.localeCompare(b.city, 'ja') || byName(a, b),
      name: (a, b) => a.city.localeCompare(b.city, 'ja') || byName(a, b),
      count: (a, b) => totalCount(b) - totalCount(a) || byName(a, b),
    };
    if (state.near && state.loc) return list.sort(nearFirst); // 「現在地から近い」を入れている間は、並び替えより優先
    return list.sort(sorters[state.sort] || ((a, b) => score(b, state.sort) - score(a, state.sort) || byName(a, b)));
  }

  // ---------- 描画 ----------
  function render() {
    now = new Date();
    const list = filtered();
    $('#count').innerHTML = `<b>${list.length}</b> / ${state.shops.length} shops`;

    if (!INDEX_ONLY) cluster.clearLayers();
    if (!INDEX_ONLY) cluster.addLayers(list.map((s) => markers.get(s.id)));

    if (!INDEX_ONLY) $('#list').innerHTML = list.slice(0, state.limit).map((s, i) => `
      <li data-id="${esc(s.id)}" class="${s.id === state.activeId ? 'active' : ''}">
        <p class="shop-name">${rankBadge(s)}${esc(s.name)}${marks(s)}</p>
        <p class="shop-meta">${meta(s)}</p>
        ${tagsHtml(s)}
        <div class="ratings">${SITES.map((site) => ratingCell(s, site)).join('')}</div>
        ${socialIcons(s)}
      </li>`).join('') + (list.length > state.limit ? `<li class="more"><button type="button" id="more">More — ${list.length - state.limit}</button></li>` : '')
      || '<li class="empty">条件に合うお店がありません</li>';

    if (state.view !== 'table') return;
    $('#table-body').innerHTML = list.map((s, i) => `
      <tr>
        <td class="no">${s.rank || '—'}</td>
        <td class="name-cell" data-id="${esc(s.id)}">${INDEX_ONLY ? `<a href="${esc(s.id)}.html">${esc(s.name)}</a>` : esc(s.name)}</td>
        <td>${esc(s.city)}</td>
        <td class="type">${meta(s, false)}${INDEX_ONLY ? indexExtra(s) : ''}</td>
        ${SITES.map((site) => {
          const r = s.ratings?.[site.key];
          const href = esc(r?.url || site.search(s));
          return r?.score != null
            ? `<td class="num"><a href="${href}" target="_blank" rel="noopener"><span class="score">${fmt(site, r.score)}</span>${r.count ? `<small>${r.count.toLocaleString()}</small>` : ''}</a></td>`
            : `<td class="num"><a class="link" href="${href}" target="_blank" rel="noopener">${r?.url ? 'Page' : 'Search'}</a></td>`;
        }).join('')}
        <td class="ig-cell">${socialIcons(s)}</td>
      </tr>`).join('');
  }

  // 一覧の「種類」欄に、営業中の表示と現在地からの距離を足す（shop/ のページだけ）
  function indexExtra(shop) {
    let html = '';
    const st = openStatus(shop);
    if (st) html += `<span class="sep">·</span>${st.open ? `<span class="open-now">営業中 〜${st.until}</span>` : '<span class="open-off">営業時間外</span>'}`;
    const km = distanceKm(shop);
    if (km != null) html += `<span class="sep">·</span><span class="dist">${distText(km)}</span>`;
    return html;
  }

  function focusShop(id) {
    const shop = state.shops.find((s) => s.id === id);
    if (!shop) return;
    state.activeId = id;
    if (state.view !== 'map') setView('map');
    const m = markers.get(id);
    if (activeMarker && activeMarker !== m) activeMarker.setIcon(icon(activeMarker.shop));
    m.setIcon(icon(shop, true));
    activeMarker = m;
    document.querySelectorAll('#list li').forEach((li) => li.classList.toggle('active', li.dataset.id === id));
    // 地図までスクロールし終えてから、地図を動かして吹き出しを開く
    // （スクロール中に開くと、スマホのアドレスバーの伸び縮みによる再描画で吹き出しが消えてしまうため）
    const token = (focusToken = {});
    document.getElementById('view-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
    waitForScrollEnd().then(() => {
      if (token !== focusToken) return; // 別のお店が選ばれた
      map.invalidateSize({ animate: false });
      map.setView([shop.lat, shop.lng], Math.max(map.getZoom(), 16), { animate: false });
      reopen = { id, until: Date.now() + 2500, tries: 0 };
      cluster.zoomToShowLayer(m, () => m.openPopup());
    });
  }

  // 吹き出しの本文の最大の高さ = 地図の高さ − (上下の余白 + 吹き出しの矢印 + ピン + 画面端の余白)
  function popupMaxHeight() {
    const margins = window.innerWidth <= 720 ? 48 : 56;
    return Math.max(160, Math.min(640, map.getSize().y - margins - 20 - 34 - 24));
  }

  let focusToken = null;
  let reopen = null; // 選択直後に吹き出しが勝手に閉じたとき、開き直す対象
  // 画面のスクロールが止まるまで待つ（動いていなければすぐ戻る。最長1.2秒）
  function waitForScrollEnd(max = 1200) {
    return new Promise((resolve) => {
      let last = window.scrollY, still = 0;
      const t0 = performance.now();
      const tick = () => {
        still = window.scrollY === last ? still + 1 : 0;
        last = window.scrollY;
        if (still >= 8 || performance.now() - t0 > max) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------- 共有・お気に入り・現在地 ----------
  let toastTimer = null;
  // opts: { sub: 2行目, action: ボタンの文字, onAction: 押したときの処理, ms: 表示する長さ }
  function toast(msg, opts = {}) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<span class="tmsg">${esc(msg)}${opts.sub ? `<small>${esc(opts.sub)}</small>` : ''}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ''}`;
    el.classList.toggle('has-action', !!opts.action);
    if (opts.action) el.querySelector('button').onclick = () => { el.classList.remove('show'); opts.onAction?.(); };
    el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), opts.ms || (opts.action ? 6000 : 2200));
  }
  // 保存データを入れ替えたあと（読み込みなど）に、ピン・一覧・件数を作り直す
  function refreshMarks() {
    markers.forEach((m) => m.setIcon(icon(m.shop, m.shop.id === state.activeId)));
    updateMineCounts(); render();
  }
  const shareUrl = (id) => `${location.origin}${location.pathname}#shop=${enc(id)}`;
  async function shareShop(shop) {
    const url = shareUrl(shop.id);
    if (navigator.share) {
      try { await navigator.share({ title: `${shop.name} | RAMEN 38`, text: `${shop.name}（${shop.city}）`, url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); }
    catch { window.prompt('このリンクをコピーしてください', url); }
  }
  function updateMineCounts() {
    const sel = $('#mine'); if (!sel) return;
    sel.options[1].textContent = `お気に入り (${mylist.fav.size})`;
    sel.options[2].textContent = `行った (${mylist.visited.size})`;
    sel.options[3].textContent = `まだ行ってない (${state.shops.filter((s) => !mylist.visited.has(s.id)).length})`;
  }
  // ボタンを押したときは、吹き出しが閉じないよう地図は再描画せず、その場で見た目だけ更新する
  function toggleMark(id, key) {
    const shop = state.shops.find((s) => s.id === id); if (!shop) return;
    const set = mylist[key];
    if (set.has(id)) { set.delete(id); if (key === 'visited') delete mylist.visitedAt[id]; }
    else { set.add(id); if (key === 'visited') { const d = new Date(); mylist.visitedAt[id] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } }
    saveMylist(); updateMineCounts();
    const m = markers.get(id); m.setIcon(icon(shop, id === state.activeId));
    const li = document.querySelector(`#list [data-marks="${CSS.escape(id)}"]`);
    if (li) li.outerHTML = marks(shop);
    return set.has(id);
  }
  function onAction(e) {
    const btn = e.target.closest('.act'); if (!btn) return;
    const id = btn.parentElement.dataset.id;
    const shop = state.shops.find((s) => s.id === id);
    if (btn.dataset.act === 'share') return shareShop(shop);
    const on = toggleMark(id, btn.dataset.act);
    btn.setAttribute('aria-pressed', on);
    if (btn.dataset.act === 'visited') {
      const r = window.RamenMy;
      const info = on ? r.afterVisit(id) : null;
      if (on) {
        const got = info.badges.filter((b) => !info.prev.includes(b.id)).map((b) => b.name);
        toast(`${info.n}杯目を記録しました`, { sub: got.length ? `バッジ獲得：${got.join('・')}` : info.sub, action: 'カードをつくる', onAction: () => r.openCard('shop', id) });
      }
      r.snapshot(); r.render();
    } else if (on) toast('お気に入りに追加しました');
  }

  let userMarker = null;
  function locate() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { toast('この端末では現在地を使えません'); return resolve(false); }
      toast('現在地を取得しています…');
      navigator.geolocation.getCurrentPosition((pos) => {
        state.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (userMarker) userMarker.setLatLng([state.loc.lat, state.loc.lng]);
        else userMarker = L.circleMarker([state.loc.lat, state.loc.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(map);
        resolve(true);
      }, () => { toast('現在地を取得できませんでした（位置情報の許可をご確認ください）'); resolve(false); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
  }
  // 「現在地から近い」：位置情報を取って、近い順に並べる。取れなかったらチェックを戻す
  async function toggleNear(box) {
    if (!box.checked) { state.near = false; state.limit = 60; return render(); }
    if (!state.loc && !(await locate())) { box.checked = false; state.near = false; return render(); }
    state.near = true; state.limit = 60; render();
    if (!INDEX_ONLY) {
      const near = filtered().slice(0, 5).map((s) => [s.lat, s.lng]);
      map.fitBounds([[state.loc.lat, state.loc.lng], ...near], { padding: [40, 40], maxZoom: 15 });
      $('#list').scrollTop = 0;
    }
  }

  // 共有リンク（#shop=店ID）で開いたとき、その店を表示する。絞り込みで隠れている店は条件を緩めて表示する
  function openFromHash() {
    if (INDEX_ONLY) return;
    const m = location.hash.match(/^#shop=(.+)$/); if (!m) return;
    const id = decodeURIComponent(m[1]);
    const shop = state.shops.find((s) => s.id === id); if (!shop) return;
    if (!state.cats.has(shop.category)) {
      state.cats.add(shop.category);
      document.querySelector(`.toggle[data-cat="${shop.category}"]`)?.setAttribute('aria-pressed', true);
    }
    if (shop.closed === true && state.hideClosed) { state.hideClosed = false; $('#hideClosed').checked = false; }
    if (!filtered().includes(shop)) {
      Object.assign(state, { q: '', city: '', igOnly: false, ratedOnly: false, openNow: false, mine: '' });
      $('#q').value = ''; $('#city').value = ''; $('#igOnly').checked = $('#ratedOnly').checked = $('#openNow').checked = false; $('#mine').value = '';
      for (const set of Object.values(state.tags)) set.clear();
      document.querySelectorAll('.tagchip').forEach((b) => b.setAttribute('aria-pressed', false));
    }
    render();
    focusShop(id);
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view-switch button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === view));
    $('#view-map').hidden = view !== 'map';
    $('#view-table').hidden = view !== 'table';
    if (view === 'map') map.invalidateSize();
    else render();
  }

  // ---------- イベント ----------
  function bind() {
    const reset = () => { state.limit = 60; render(); };
    $('#q').addEventListener('input', (e) => { state.q = e.target.value; reset(); });
    $('#city').addEventListener('change', (e) => { state.city = e.target.value; reset(); fitToList(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; reset(); });
    $('#nearMe').addEventListener('change', (e) => toggleNear(e.target));
    $('#openNow').addEventListener('change', (e) => { state.openNow = e.target.checked; reset(); });
    $('#mine').addEventListener('change', (e) => { state.mine = e.target.value; reset(); fitToList(); });
    document.addEventListener('click', onAction);
    window.addEventListener('hashchange', openFromHash);
    // 吹き出しを開いている店の共有リンクをアドレスバーに出す（閉じたら元に戻す）
    map.on('popupopen', (e) => { const sh = e.popup._source?.shop; if (sh) history.replaceState(null, '', `#shop=${enc(sh.id)}`); });
    map.on('popupclose', () => { if (location.hash.startsWith('#shop=') && !(reopen && Date.now() <= reopen.until && reopen.tries < 1)) history.replaceState(null, '', '#explore'); });
    $('#igOnly').addEventListener('change', (e) => { state.igOnly = e.target.checked; reset(); });
    $('#ratedOnly').addEventListener('change', (e) => { state.ratedOnly = e.target.checked; reset(); });
    $('#hideClosed').addEventListener('change', (e) => { state.hideClosed = e.target.checked; reset(); });
    $('#categories').addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle');
      if (!btn) return;
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on);
      state.cats[on ? 'add' : 'delete'](btn.dataset.cat);
      reset();
    });
    $('#tag-filters').addEventListener('click', (e) => {
      const btn = e.target.closest('.tagchip');
      if (!btn) return;
      const set = state.tags[btn.dataset.group];
      const on = !set.has(btn.dataset.tag);
      set[on ? 'add' : 'delete'](btn.dataset.tag);
      btn.setAttribute('aria-pressed', on);
      reset();
    });
    document.querySelectorAll('.view-switch button, .site-nav a[data-view]').forEach((b) =>
      b.addEventListener('click', () => setView(b.dataset.view)));
    $('#list').addEventListener('click', (e) => {
      if (e.target.closest('#more')) { state.limit += 60; render(); return; }
      if (e.target.closest('a')) return;
      const li = e.target.closest('li[data-id]');
      if (li) focusShop(li.dataset.id);
    });
    $('#table-body').addEventListener('click', (e) => {
      const td = e.target.closest('.name-cell');
      if (td && !INDEX_ONLY) focusShop(td.dataset.id);
    });
  }

  // 一覧（Index）の見出し行を、下にスクロールしても画面の上（ヘッダーの下）に固定する。
  // 表は横にスクロールできる箱に入っていて、そのままだと position: sticky が効かないので、見出しの複製を画面に固定して表示する
  function stickyHead() {
    const wrap = $('#view-table'), table = wrap.querySelector('table'), thead = table.tHead;
    const box = document.createElement('div');
    box.className = 'sticky-head'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('div'); box.appendChild(inner);
    document.body.appendChild(box);
    let sig = '';
    const sync = () => {
      if (wrap.hidden) { box.hidden = true; return; }
      const hh = document.querySelector('.site-header')?.offsetHeight || 64;
      const head = thead.getBoundingClientRect(), tb = table.getBoundingClientRect();
      const show = head.top < hh && tb.bottom > hh + head.height;
      box.hidden = !show;
      if (!show) return;
      const ths = [...thead.rows[0].cells];
      const next = `${table.offsetWidth}|${ths.map((th) => th.offsetWidth).join(',')}`;
      if (next !== sig) { // 列の幅が変わったときだけ作り直す
        sig = next;
        const t = document.createElement('table');
        t.className = 'index-table';
        t.style.width = `${table.offsetWidth}px`;
        const clone = thead.cloneNode(true);
        [...clone.rows[0].cells].forEach((c, i) => { c.style.width = `${ths[i].offsetWidth}px`; c.style.minWidth = c.style.width; });
        t.appendChild(clone);
        inner.replaceChildren(t);
      }
      const wr = wrap.getBoundingClientRect();
      box.style.top = `${hh}px`; box.style.left = `${wr.left}px`; box.style.width = `${wr.width}px`;
      inner.style.paddingLeft = getComputedStyle(wrap).paddingLeft;
      inner.style.transform = `translateX(${-wrap.scrollLeft}px)`;
    };
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    wrap.addEventListener('scroll', sync, { passive: true });
    new MutationObserver(sync).observe($('#table-body'), { childList: true });
    sync();
  }

  function fitToList() {
    if (INDEX_ONLY) return;
    const pts = filtered().map((s) => [s.lat, s.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  }

  // ---------- 初期化 ----------
  async function init() {
    const res = await fetch(`${ROOT}data/shops.json`, { cache: 'no-cache' });
    const db = await res.json();
    state.shops = db.shops;

    for (const s of state.shops) {
      const m = L.marker([s.lat, s.lng], { icon: icon(s), title: s.name });
      m.shop = s;
      // 吹き出しは地図の高さに収まる大きさにする（収まらない分は吹き出しの中でスクロール）
      m.bindPopup(() => { m.getPopup().options.maxHeight = popupMaxHeight(); return popupHtml(s); }, { maxWidth: 360, minWidth: 250 });
      markers.set(s.id, m);
    }

    const cities = [...new Set(state.shops.map((s) => s.city))].sort((a, b) => a.localeCompare(b, 'ja'));
    $('#city').insertAdjacentHTML('beforeend', cities.map((c) => {
      const n = state.shops.filter((s) => s.city === c).length;
      return `<option value="${esc(c)}">${esc(c)} (${n})</option>`;
    }).join(''));
    $('#categories').innerHTML = Object.entries(CATEGORIES).map(([k, v]) =>
      `<button type="button" class="toggle" data-cat="${k}" aria-pressed="${!v.off}">${v.label}</button>`).join('');
    // タグの絞り込み（実際に付いているタグだけ表示。1つも付いていなければ欄ごと隠す）
    const used = (g) => g.tags.filter((x) => state.shops.some((s) => tagsOf(s, g.key).includes(x)));
    const rows = TAG_GROUPS.map((g) => [g, used(g)]).filter(([, tags]) => tags.length);
    $('#tag-filters').hidden = !rows.length;
    $('#tag-filters').innerHTML = rows.map(([g, tags]) => `
      <div class="tag-row"><span class="field-label">${g.label}</span><div class="tag-chips">${tags.map((x) =>
        `<button type="button" class="tagchip" data-group="${g.key}" data-tag="${esc(x)}" aria-pressed="false">${esc(x)}</button>`).join('')}</div></div>`).join('');
    if (db.updatedAt && $('#updated')) $('#updated').textContent = new Date(db.updatedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

    // ヒーローの数字（閉店を除く）
    const open = state.shops.filter((s) => s.closed !== true);
    const stat = {
      shops: open.length,
      cities: new Set(open.map((s) => s.city)).size,
      rated: open.filter(hasRating).length,
      instagram: open.filter((s) => s.instagram).length,
    };
    for (const [k, v] of Object.entries(stat)) { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v.toLocaleString(); } // ヒーローが無いページ（shop/）では何もしない

    updateMineCounts();
    window.RamenMy?.init({ shops: state.shops, byId: new Map(state.shops.map((x) => [x.id, x])), mylist, save: saveMylist, esc, CATEGORIES, TAG_GROUPS, toast, refreshMarks });
    bind();
    stickyHead();
    if (INDEX_ONLY) setView('table');
    render();
    fitToList();
    openFromHash();
  }

  init().catch((e) => {
    console.error(e);
    $('#list').innerHTML = '<li>データの読み込みに失敗しました。ローカルで開く場合は簡易サーバー経由で開いてください（README参照）。</li>';
  });
})();
