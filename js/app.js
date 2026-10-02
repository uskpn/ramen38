(() => {
  'use strict';

  const CATEGORIES = {
    ramen: { label: 'ラーメン専門店' },
    chinese: { label: '中華料理' },
    shokudo: { label: '食堂・定食' },
    'chain-sushi': { label: '回転寿司' },
    chain: { label: 'チェーン' },
    restaurant: { label: 'その他の飲食店' },
    other: { label: '未確認', off: true },
  };
  const RAMEN_LABEL = {
    specialty: '',
    menu: 'ラーメンあり',
    likely: 'ラーメンあり?',
  };
  // 評価を並べるサイト。url が無い店舗は各サイトの検索ページへリンクする
  const SITES = [
    { key: 'google', label: 'Google', max: 5,
      search: (s) => s.placeId
        ? `https://www.google.com/maps/search/?api=1&query=${enc(s.name)}&query_place_id=${s.placeId}`
        : `https://www.google.com/maps/search/?api=1&query=${enc(`${s.name} ${s.city}`)}` },
    { key: 'tabelog', label: 'Tabelog', max: 5,
      search: (s) => `https://tabelog.com/ehime/rstLst/?vs=1&sk=${enc(s.name)}` },
    { key: 'rdb', label: 'Ramen DB', max: 100,
      search: (s) => siteSearch('ramendb.supleks.jp', s) },
    { key: 'retty', label: 'Retty', max: 5,
      search: (s) => siteSearch('retty.me', s) },
    { key: 'hotpepper', label: 'Hot Pepper', max: 5,
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
    limit: 60,
    activeId: null,
  };
  const markers = new Map();
  let activeMarker = null;

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
  fetch('https://tiles.openfreemap.org/styles/positron')
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
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 30 : n < 50 ? 38 : 46;
      return L.divIcon({ className: '', html: `<div class="cluster" style="width:${size}px;height:${size}px">${n}</div>`, iconSize: [size, size] });
    },
  });
  map.addLayer(cluster);

  function icon(shop, active = false) {
    return L.divIcon({
      className: '',
      html: `<div class="dot ${shop.ramen === 'likely' ? 'maybe' : ''} ${active ? 'active' : ''}"></div>`,
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
    return html;
  }

  const fmt = (site, v) => v.toFixed(site.max === 100 ? 1 : site.key === 'google' ? 1 : 2);

  function ratingCell(shop, site) {
    const r = shop.ratings?.[site.key];
    const href = esc(r?.url || site.search(shop));
    if (r?.score != null) {
      const count = r.count ? `<small>${r.count.toLocaleString()} reviews</small>` : '<small>&nbsp;</small>';
      return `<a class="rating" href="${href}" target="_blank" rel="noopener"><span class="site">${site.label}</span><b>${fmt(site, r.score)}</b>${count}</a>`;
    }
    return `<a class="rating none" href="${href}" target="_blank" rel="noopener" title="${site.label}${r?.url ? 'のページを開く' : 'で探す'}">
      <span class="site">${site.label}</span><b>—</b><small>${r?.url ? 'page' : 'search'}</small></a>`;
  }

  function instagramLink(shop) {
    if (!shop.instagram) return '';
    return `<a class="ig" href="https://www.instagram.com/${esc(shop.instagram)}/" target="_blank" rel="noopener">@${esc(shop.instagram)}</a>`;
  }

  // 「月曜日: 11時00分～15時00分」→「月 11:00–15:00」
  const compactHours = (h) => h.replace(/曜日:\s*/, ' ').replace(/(\d+)時(\d+)分/g, (_, a, b) => `${a}:${b}`).replace(/～/g, '–');

  function popupHtml(shop) {
    const rows = [
      ['住所', shop.address],
      ['営業時間', shop.hoursText ? shop.hoursText.map((h) => esc(compactHours(h))).join('<br>') : esc(shop.hours)],
      ['電話', shop.phone && `<a href="tel:${esc(shop.phone)}">${esc(shop.phone)}</a>`],
      ['Web', shop.website && `<a href="${esc(shop.website)}" target="_blank" rel="noopener">公式サイト</a>`],
      ['Instagram', shop.instagram && `<a href="https://www.instagram.com/${esc(shop.instagram)}/" target="_blank" rel="noopener">@${esc(shop.instagram)}</a>`],
    ].filter(([, v]) => v);
    const label = { 住所: 'Address', 営業時間: 'Hours', 電話: 'Tel', Web: 'Web', Instagram: 'Instagram' };
    return `<div class="popup">
      <p class="shop-meta">${meta(shop)}</p>
      <p class="shop-name">${esc(shop.name)}</p>
      <dl>${rows.map(([k, v]) => `<dt>${label[k]}</dt><dd>${k === '住所' ? esc(v) : v}</dd>`).join('')}</dl>
      <div class="ratings">${SITES.map((s) => ratingCell(shop, s)).join('')}</div>
      <p class="popup-links">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lng}" target="_blank" rel="noopener">経路</a>
        ${shop.instagram ? '' : `<a href="https://www.google.com/search?q=${enc(`site:instagram.com ${shop.name} ${shop.city}`)}" target="_blank" rel="noopener">Instagramを探す</a>`}
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
    $('#count').innerHTML = `<b>${list.length}</b> / ${state.shops.length} shops`;
    const no = (i) => String(i + 1).padStart(3, '0');

    cluster.clearLayers();
    cluster.addLayers(list.map((s) => markers.get(s.id)));

    $('#list').innerHTML = list.slice(0, state.limit).map((s, i) => `
      <li data-id="${esc(s.id)}" class="${s.id === state.activeId ? 'active' : ''}">
        <span class="shop-no">${no(i)}</span>
        <p class="shop-name">${esc(s.name)}</p>
        <p class="shop-meta">${meta(s)}</p>
        <div class="ratings">${SITES.map((site) => ratingCell(s, site)).join('')}</div>
        ${instagramLink(s)}
      </li>`).join('') + (list.length > state.limit ? `<li class="more"><button type="button" id="more">More — ${list.length - state.limit}</button></li>` : '')
      || '<li class="empty">条件に合うお店がありません</li>';

    if (state.view !== 'table') return;
    $('#table-body').innerHTML = list.map((s, i) => `
      <tr>
        <td class="no">${no(i)}</td>
        <td class="name-cell" data-id="${esc(s.id)}">${esc(s.name)}</td>
        <td>${esc(s.city)}</td>
        <td class="type">${meta(s, false)}</td>
        ${SITES.map((site) => {
          const r = s.ratings?.[site.key];
          const href = esc(r?.url || site.search(s));
          return r?.score != null
            ? `<td class="num"><a href="${href}" target="_blank" rel="noopener"><span class="score">${fmt(site, r.score)}</span>${r.count ? `<small>${r.count.toLocaleString()}</small>` : ''}</a></td>`
            : `<td class="num"><a class="link" href="${href}" target="_blank" rel="noopener">${r?.url ? 'Page' : 'Search'}</a></td>`;
        }).join('')}
        <td class="ig-cell">${instagramLink(s) || '<span class="dash">—</span>'}</td>
      </tr>`).join('');
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
    document.getElementById('view-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
    map.setView([shop.lat, shop.lng], Math.max(map.getZoom(), 16));
    m.openPopup();
    document.querySelectorAll('#list li').forEach((li) => li.classList.toggle('active', li.dataset.id === id));
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
      m.shop = s;
      m.bindPopup(() => popupHtml(s), { maxWidth: 360, minWidth: 250 });
      markers.set(s.id, m);
    }

    const cities = [...new Set(state.shops.map((s) => s.city))].sort((a, b) => a.localeCompare(b, 'ja'));
    $('#city').insertAdjacentHTML('beforeend', cities.map((c) => {
      const n = state.shops.filter((s) => s.city === c).length;
      return `<option value="${esc(c)}">${esc(c)} (${n})</option>`;
    }).join(''));
    $('#categories').innerHTML = Object.entries(CATEGORIES).map(([k, v]) =>
      `<button type="button" class="toggle" data-cat="${k}" aria-pressed="${!v.off}">${v.label}</button>`).join('');
    if (db.updatedAt) $('#updated').textContent = new Date(db.updatedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

    // ヒーローの数字（閉店を除く）
    const open = state.shops.filter((s) => s.closed !== true);
    const stat = {
      shops: open.length,
      cities: new Set(open.map((s) => s.city)).size,
      rated: open.filter(hasRating).length,
      instagram: open.filter((s) => s.instagram).length,
    };
    for (const [k, v] of Object.entries(stat)) document.querySelector(`[data-stat="${k}"]`).textContent = v.toLocaleString();

    bind();
    render();
    fitToList();
  }

  // 大きなサイト名が見えている間はヘッダーのロゴを隠す
  const wordmark = document.querySelector('.hero-wordmark');
  if (wordmark && 'IntersectionObserver' in window) {
    const header = document.querySelector('.site-header');
    header.classList.add('at-top');
    new IntersectionObserver(([e]) => header.classList.toggle('at-top', e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' }).observe(wordmark);
  }

  init().catch((e) => {
    console.error(e);
    $('#list').innerHTML = '<li>データの読み込みに失敗しました。ローカルで開く場合は簡易サーバー経由で開いてください（README参照）。</li>';
  });
})();
