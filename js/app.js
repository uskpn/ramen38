(() => {
  'use strict';

  const CATEGORIES = {
    ramen: { label: 'ラーメン専門店', color: '#d9480f' },
    chinese: { label: '中華料理', color: '#c92a2a' },
    shokudo: { label: '食堂・定食', color: '#2b8a3e' },
    'chain-sushi': { label: '回転寿司', color: '#6741d9' },
    chain: { label: 'その他チェーン', color: '#1971c2' },
    restaurant: { label: 'その他の飲食店', color: '#0c8599' },
    other: { label: 'その他（未確認）', color: '#868e96', off: true },
  };
  const RAMEN_LABEL = {
    specialty: 'ラーメン専門',
    menu: 'メニューにラーメンあり',
    likely: 'ラーメンあり?（未確認）',
  };
  // 評価を並べるサイト。url が無い店舗は各サイトの検索ページへリンクする
  const SITES = [
    { key: 'google', label: 'Google', color: '#1a73e8', max: 5,
      search: (s) => s.placeId
        ? `https://www.google.com/maps/search/?api=1&query=${enc(s.name)}&query_place_id=${s.placeId}`
        : `https://www.google.com/maps/search/?api=1&query=${enc(`${s.name} ${s.city}`)}` },
    { key: 'tabelog', label: '食べログ', color: '#f08c00', max: 5,
      search: (s) => `https://tabelog.com/ehime/rstLst/?vs=1&sk=${enc(s.name)}` },
    { key: 'rdb', label: 'ラーメンDB', color: '#e03131', max: 100,
      search: (s) => siteSearch('ramendb.supleks.jp', s) },
    { key: 'retty', label: 'Retty', color: '#f76707', max: 5,
      search: (s) => siteSearch('retty.me', s) },
    { key: 'hotpepper', label: 'ホットペッパー', color: '#c2255c', max: 5,
      search: (s) => siteSearch('hotpepper.jp', s) },
  ];

  const enc = encodeURIComponent;
  const siteSearch = (domain, s) => `https://www.google.com/search?q=${enc(`site:${domain} ${s.name} ${s.city}`)}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);

  const state = {
    shops: [],
    q: '', city: '', sort: 'name',
    cats: new Set(Object.keys(CATEGORIES).filter((k) => !CATEGORIES[k].off)),
    igOnly: false, ratedOnly: false, hideClosed: true,
    view: 'map',
    activeId: null,
  };
  const markers = new Map();

  // ---------- 地図 ----------
  const map = L.map('map', { zoomControl: true }).setView([33.65, 132.8], 9);
  // 地理院タイル（淡色地図）
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
  }).addTo(map);
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    disableClusteringAtZoom: 16,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 32 : n < 50 ? 40 : 48;
      return L.divIcon({ className: '', html: `<div class="cluster" style="width:${size}px;height:${size}px">${n}</div>`, iconSize: [size, size] });
    },
  });
  map.addLayer(cluster);

  function icon(shop) {
    const c = CATEGORIES[shop.category]?.color || '#888';
    return L.divIcon({
      className: '',
      html: `<div class="marker-dot ${shop.ramen === 'likely' ? 'maybe' : ''}" style="--c:${c}"></div>`,
      iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10],
    });
  }

  // ---------- 表示部品 ----------
  function badges(shop) {
    const cat = CATEGORIES[shop.category];
    let html = `<span class="badge" style="--c:${cat?.color}">${esc(cat?.label || shop.category)}</span>`;
    if (shop.ramen !== 'specialty') html += `<span class="badge maybe">${esc(RAMEN_LABEL[shop.ramen])}</span>`;
    if (shop.closed) html += `<span class="badge closed">${shop.closed === 'temporary' ? '休業中' : '閉店'}</span>`;
    return html;
  }

  function ratingChip(shop, site) {
    const r = shop.ratings?.[site.key];
    if (r?.score != null) {
      const count = r.count ? `<small>(${r.count.toLocaleString()})</small>` : '';
      return `<a class="rating" style="--c:${site.color}" href="${esc(r.url || site.search(shop))}" target="_blank" rel="noopener">
        <span class="site">${site.label}</span><b>${r.score.toFixed(site.max === 100 ? 1 : 2)}</b>${count}</a>`;
    }
    return `<a class="rating none" href="${esc(r?.url || site.search(shop))}" target="_blank" rel="noopener" title="${site.label}で探す">
      <span class="site">${site.label}</span><small>${r?.url ? '評価なし' : '検索 ↗'}</small></a>`;
  }

  function instagramLink(shop) {
    if (shop.instagram) {
      return `<a class="ig-link" href="https://www.instagram.com/${esc(shop.instagram)}/" target="_blank" rel="noopener">📷 @${esc(shop.instagram)}</a>`;
    }
    return '';
  }

  function popupHtml(shop) {
    const rows = [
      ['住所', shop.address],
      ['営業時間', shop.hoursText ? shop.hoursText.map(esc).join('<br>') : esc(shop.hours)],
      ['電話', shop.phone && `<a href="tel:${esc(shop.phone)}">${esc(shop.phone)}</a>`],
      ['Web', shop.website && `<a href="${esc(shop.website)}" target="_blank" rel="noopener">公式サイト</a>`],
      ['Instagram', instagramLink(shop)],
    ].filter(([, v]) => v);
    return `<div class="popup">
      <h3>${esc(shop.name)}</h3>
      <div>${badges(shop)}</div>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === '住所' ? esc(v) : v}</dd>`).join('')}</dl>
      <div class="rating-grid">${SITES.map((s) => ratingChip(shop, s)).join('')}</div>
      <p style="margin:8px 0 0;font-size:.75rem">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lng}" target="_blank" rel="noopener">経路を調べる</a>
        ${shop.instagram ? '' : ` ・ <a href="https://www.google.com/search?q=${enc(`site:instagram.com ${shop.name} ${shop.city}`)}" target="_blank" rel="noopener">Instagramを探す</a>`}
      </p>
    </div>`;
  }

  // ---------- 絞り込み・並び替え ----------
  // 口コミが少ない店が上位に来ないよう、件数が少ないほど平均的な値に寄せて並べる（ベイズ平均）
  const PRIOR = { google: 3.6, tabelog: 3.1, rdb: 75, retty: 3.5, hotpepper: 3.5 };
  const score = (shop, key) => {
    const r = shop.ratings?.[key];
    if (r?.score == null) return -1;
    if (!r.count) return r.score;
    const m = 20;
    return (r.score * r.count + PRIOR[key] * m) / (r.count + m);
  };
  const totalCount = (shop) => SITES.reduce((n, s) => n + (shop.ratings?.[s.key]?.count || 0), 0);
  const hasRating = (shop) => SITES.some((s) => shop.ratings?.[s.key]?.score != null);

  function filtered() {
    const q = state.q.trim().normalize('NFKC').toLowerCase();
    const list = state.shops.filter((s) =>
      state.cats.has(s.category) &&
      (!state.city || s.city === state.city) &&
      (!state.igOnly || s.instagram) &&
      (!state.ratedOnly || hasRating(s)) &&
      (!state.hideClosed || s.closed !== true) &&
      (!q || `${s.name} ${s.address || ''} ${s.city}`.normalize('NFKC').toLowerCase().includes(q)));
    const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
    const sorters = {
      name: (a, b) => a.city.localeCompare(b.city, 'ja') || byName(a, b),
      count: (a, b) => totalCount(b) - totalCount(a) || byName(a, b),
    };
    return list.sort(sorters[state.sort] || ((a, b) => score(b, state.sort) - score(a, state.sort) || byName(a, b)));
  }

  // ---------- 描画 ----------
  function render() {
    const list = filtered();
    $('#count').textContent = `${list.length} / ${state.shops.length} 件`;

    cluster.clearLayers();
    cluster.addLayers(list.map((s) => markers.get(s.id)));

    $('#list').innerHTML = list.map((s) => `
      <li data-id="${esc(s.id)}" class="${s.id === state.activeId ? 'active' : ''}">
        <p class="shop-name">${esc(s.name)}</p>
        <p class="shop-meta">${badges(s)} ${esc(s.city)} ${instagramLink(s)}</p>
        <div class="ratings">${SITES.map((site) => ratingChip(s, site)).join('')}</div>
      </li>`).join('') || '<li>条件に合うお店がありません</li>';

    $('#table-body').innerHTML = list.map((s) => `
      <tr>
        <td class="name-cell" data-id="${esc(s.id)}">${esc(s.name)}</td>
        <td>${esc(s.city)}</td>
        <td>${badges(s)}</td>
        ${SITES.map((site) => {
          const r = s.ratings?.[site.key];
          const href = esc(r?.url || site.search(s));
          return r?.score != null
            ? `<td class="num" style="--c:${site.color}"><a href="${href}" target="_blank" rel="noopener"><span class="score">${r.score.toFixed(site.max === 100 ? 1 : 2)}</span>${r.count ? `<small>${r.count.toLocaleString()}件</small>` : ''}</a></td>`
            : `<td class="num"><a class="search" href="${href}" target="_blank" rel="noopener">${r?.url ? 'ページ↗' : '検索↗'}</a></td>`;
        }).join('')}
        <td>${instagramLink(s) || '<span style="color:var(--muted)">—</span>'}</td>
      </tr>`).join('');
  }

  function focusShop(id) {
    const shop = state.shops.find((s) => s.id === id);
    if (!shop) return;
    state.activeId = id;
    if (state.view !== 'map') setView('map');
    const m = markers.get(id);
    map.setView([shop.lat, shop.lng], Math.max(map.getZoom(), 16));
    m.openPopup();
    document.querySelectorAll('#list li').forEach((li) => li.classList.toggle('active', li.dataset.id === id));
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === view));
    $('#view-map').hidden = view !== 'map';
    $('#view-table').hidden = view !== 'table';
    if (view === 'map') map.invalidateSize();
  }

  // ---------- イベント ----------
  function bind() {
    $('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
    $('#city').addEventListener('change', (e) => { state.city = e.target.value; render(); fitToList(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
    $('#igOnly').addEventListener('change', (e) => { state.igOnly = e.target.checked; render(); });
    $('#ratedOnly').addEventListener('change', (e) => { state.ratedOnly = e.target.checked; render(); });
    $('#hideClosed').addEventListener('change', (e) => { state.hideClosed = e.target.checked; render(); });
    $('#categories').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on);
      state.cats[on ? 'add' : 'delete'](btn.dataset.cat);
      render();
    });
    document.querySelectorAll('.view-tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#list').addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const li = e.target.closest('li[data-id]');
      if (li) focusShop(li.dataset.id);
    });
    $('#table-body').addEventListener('click', (e) => {
      const td = e.target.closest('.name-cell');
      if (td) focusShop(td.dataset.id);
    });
  }

  function fitToList() {
    const pts = filtered().map((s) => [s.lat, s.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  }

  // ---------- 初期化 ----------
  async function init() {
    const res = await fetch('data/shops.json', { cache: 'no-cache' });
    const db = await res.json();
    state.shops = db.shops;

    for (const s of state.shops) {
      const m = L.marker([s.lat, s.lng], { icon: icon(s), title: s.name });
      m.bindPopup(() => popupHtml(s), { maxWidth: 340, minWidth: 280 });
      markers.set(s.id, m);
    }

    const cities = [...new Set(state.shops.map((s) => s.city))].sort((a, b) => a.localeCompare(b, 'ja'));
    $('#city').insertAdjacentHTML('beforeend', cities.map((c) => {
      const n = state.shops.filter((s) => s.city === c).length;
      return `<option value="${esc(c)}">${esc(c)} (${n})</option>`;
    }).join(''));
    $('#categories').innerHTML = Object.entries(CATEGORIES).map(([k, v]) =>
      `<button type="button" class="chip" data-cat="${k}" aria-pressed="${!v.off}" style="--c:${v.color}"><span class="dot"></span>${v.label}</button>`).join('');
    if (db.updatedAt) $('#updated').textContent = `データ更新日: ${new Date(db.updatedAt).toLocaleDateString('ja-JP')}`;

    bind();
    render();
    fitToList();
  }

  init().catch((e) => {
    console.error(e);
    $('#list').innerHTML = '<li>データの読み込みに失敗しました。ローカルで開く場合は簡易サーバー経由で開いてください（README参照）。</li>';
  });
})();
