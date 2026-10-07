// MY RAMEN 38 — 「行った」の記録のまとめ・バッジ・シェアカード・書き出し／読み込み
// app.js から RamenMy.init(ctx) で初期化する。記録はこの端末のブラウザ（localStorage）にだけ保存される。
(function () {
  'use strict';
  const BADGES = [
    { id: 'rookie', name: 'ROOKIE', label: '10杯', need: (s) => s.ate >= 10, left: (s) => 10 - s.ate },
    { id: 'r38', name: 'RAMEN 38', label: '38杯', need: (s) => s.ate >= 38, left: (s) => 38 - s.ate },
    { id: 'hunter', name: 'EHIME HUNTER', label: '100杯', need: (s) => s.ate >= 100, left: (s) => 100 - s.ate },
    { id: 'all', name: 'ALL EHIME', label: '全市町', need: (s) => s.cities >= s.citiesTotal && s.citiesTotal > 0, left: (s) => s.citiesTotal - s.cities, unit: '市町' },
  ];
  const $ = (sel) => document.querySelector(sel);
  const pad3 = (n) => String(n).padStart(3, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  let ctx, base, baseCities, geo;

  // ---------- 集計 ----------
  function stats() {
    const byId = ctx.byId;
    const ids = [...ctx.mylist.visited].filter((id) => byId.has(id)); // 閉じた・削除した店は数えない
    const ate = ids.filter((id) => byId.get(id).category === 'ramen' && byId.get(id).closed !== true);
    const cityOf = (id) => byId.get(id).city;
    const done = new Set(ate.map(cityOf));
    const year = String(new Date().getFullYear());
    const thisYear = ids.filter((id) => (ctx.mylist.visitedAt[id] || year).startsWith(year)).length;
    const perCity = baseCities.map(([city, total]) => [city, total, ate.filter((id) => cityOf(id) === city).length]);
    return { ids, ate: ate.length, ateIds: new Set(ate), total: base.length, cities: done.size, citiesTotal: baseCities.length, thisYear, perCity,
      pct: base.length ? (ate.length / base.length) * 100 : 0 };
  }
  const earned = (s) => BADGES.filter((b) => b.need(s)).map((b) => b.id);

  // ---------- 愛媛の形（専門店の位置を点で描く） ----------
  function geoSetup() {
    const lats = base.map((s) => s.lat), lngs = base.map((s) => s.lng);
    geo = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs), kx: 0.83 }; // 経度は cos(33.8°) で補正
  }
  function project(s, w, h) {
    const k = Math.min(w / ((geo.maxLng - geo.minLng) * geo.kx), h / (geo.maxLat - geo.minLat));
    const ox = (w - (geo.maxLng - geo.minLng) * geo.kx * k) / 2, oy = (h - (geo.maxLat - geo.minLat) * k) / 2;
    return [ox + (s.lng - geo.minLng) * geo.kx * k, oy + (geo.maxLat - s.lat) * k];
  }
  function mapSvg(w, h, ateIds) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="食べた店の分布">${base.map((s) => {
      const [x, y] = project(s, w, h), v = ateIds.has(s.id);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${v ? 6 : 2.8}" fill="${v ? '#111' : '#c2c2bd'}"/>`;
    }).join('')}</svg>`;
  }

  // ---------- 画面 ----------
  function render() {
    if (!$('#my')) return;
    const s = stats();
    $('#my-ate').innerHTML = `${s.ate}<small>/ ${s.total}</small>`;
    $('#my-cities').innerHTML = `${s.cities}<small>/ ${s.citiesTotal}</small>`;
    $('#my-year').innerHTML = `${s.thisYear}<small>杯</small>`;
    $('#my-pct-bar').style.width = `${Math.max(s.pct, s.ate ? 1.2 : 0)}%`;
    $('#my-pct-label').textContent = `愛媛ラーメン制覇率 ${s.pct.toFixed(1)}%`;
    $('#my-map').innerHTML = mapSvg(300, 236, s.ateIds);
    $('#my-cityrows').innerHTML = s.perCity.map(([c, t, v]) =>
      `<div class="my-crow"><span>${ctx.esc(c)}</span><span class="bar"><i style="width:${(v / t) * 100}%"></i></span><span class="cv"><b>${v}</b> / ${t}</span></div>`).join('');
    const got = new Set(earned(s));
    $('#my-badges').innerHTML = BADGES.map((b) => `<div class="my-badge${got.has(b.id) ? ' on' : ''}"><b>${b.name}</b><small>${b.label}</small><em>${got.has(b.id) ? 'GET' : `あと ${Math.max(b.left(s), 0)}${b.unit || ''}`}</em></div>`).join('');
    $('#my-empty').hidden = s.ids.length > 0;
    $('#my-note-extra').textContent = s.ids.length - s.ate > 0 ? `専門店以外（食堂・中華など）の ${s.ids.length - s.ate} 店も「行った」に記録されています（制覇率には含めません）。` : '';
    $('#my-card').disabled = !s.ids.length;
    $('#my-show-list').disabled = !s.ids.length;
    renderList();
  }

  function renderList() {
    const box = $('#my-list');
    if (box.hidden) return;
    const order = [...ctx.mylist.visited].filter((id) => ctx.byId.has(id));
    box.innerHTML = order.map((id, i) => ({ id, no: i + 1 })).reverse().map(({ id, no }) => {
      const sh = ctx.byId.get(id);
      return `<li data-id="${ctx.esc(id)}"><span class="no">${pad3(no)}</span><a href="#shop=${encodeURIComponent(id)}" class="nm">${ctx.esc(sh.name)}</a><span class="ct">${ctx.esc(sh.city)}</span><span class="dt">${(ctx.mylist.visitedAt[id] || '').replace(/-/g, '.')}</span><button type="button" data-card="${ctx.esc(id)}">カード</button></li>`;
    }).join('');
  }

  // ---------- シェアカード（画像） ----------
  const W = 1080, H = 1920, INK = '#111', MUTE = '#8a8a86';
  let logoImg = null;
  const loadLogo = () => logoImg ? Promise.resolve(logoImg) : new Promise((res) => { const i = new Image(); i.onload = () => res((logoImg = i)); i.onerror = () => res(null); i.src = 'assets/logo-horizontal.png'; });

  async function fonts(text) {
    try {
      await Promise.all([
        document.fonts.load('300 200px "Barlow Condensed"', '0123456789#'),
        document.fonts.load('400 40px "Barlow Condensed"', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./ '),
        document.fonts.load('500 80px "Noto Sans JP"', text),
        document.fonts.load('400 40px "Noto Sans JP"', text),
      ]);
    } catch { /* フォントが読めなくても、代わりの書体で描く */ }
  }
  const FONT_EN = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const FONT_JA = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';

  function wrapLines(c, text, maxW, maxLines) {
    const lines = []; let cur = '';
    for (const ch of text) {
      if (c.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…'); }
    return lines;
  }
  const spaced = (c, px) => { if ('letterSpacing' in c) c.letterSpacing = `${px}px`; };

  async function drawCard(kind, shopId) {
    const s = stats();
    const sh = shopId ? ctx.byId.get(shopId) : null;
    const dark = kind === 'summary';
    const year = new Date().getFullYear();
    const text = `${sh?.name || ''}${sh?.city || ''}杯愛媛のラーメンを食べた数一杯から、愛媛を知る。ラーメン専門店中華料理食堂・定食チェーンその他の飲食店${(sh ? TAG_TEXT(sh) : '')}`;
    await fonts(text);
    const logo = await loadLogo();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const bg = dark ? INK : '#fff', fg = dark ? '#fff' : INK, mute = dark ? '#9a9a96' : MUTE, line = dark ? '#3a3a38' : '#e6e6e3';
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const M = 96;
    // ヘッダー
    if (logo) {
      const lh = 56, lw = lh * (logo.width / logo.height);
      if (dark) { c.save(); c.filter = 'invert(1)'; c.drawImage(logo, M, 120, lw, lh); c.restore(); } else c.drawImage(logo, M, 120, lw, lh);
    } else { c.fillStyle = fg; c.font = `500 52px ${FONT_EN}`; c.fillText('RAMEN 38', M, 170); }
    c.fillStyle = mute; c.font = `400 40px ${FONT_EN}`; spaced(c, 8); c.textAlign = 'right';
    c.fillText(dark ? `MY ${year}` : String(year), W - M, 170); c.textAlign = 'left'; spaced(c, 0);
    c.fillStyle = fg; c.fillRect(M, 270, W - M * 2, 3);

    let y;
    if (kind === 'shop') {
      const no = [...ctx.mylist.visited].filter((id) => ctx.byId.has(id)).indexOf(shopId) + 1;
      c.fillStyle = mute; c.font = `300 110px ${FONT_EN}`; c.fillText('#', M, 470);
      c.fillStyle = fg; c.font = `300 440px ${FONT_EN}`; c.fillText(pad3(no), M + 90, 690);
      y = 810;
      c.font = `500 84px ${FONT_JA}`; c.fillStyle = fg;
      for (const ln of wrapLines(c, sh.name, W - M * 2, 2)) { c.fillText(ln, M, y); y += 112; }
      c.fillStyle = mute; c.font = `400 38px ${FONT_JA}`; spaced(c, 4);
      c.fillText(`${sh.city}　—　${ctx.CATEGORIES[sh.category]?.label || ''}`, M, y - 22); spaced(c, 0);
      y += 78;
      // タグ
      c.font = `400 34px ${FONT_JA}`; let x = M;
      const tags = ctx.TAG_GROUPS.flatMap((g) => sh.tags?.[g.key] || []).slice(0, 8);
      c.lineWidth = 2; c.strokeStyle = dark ? '#666' : '#bbb';
      for (const t of tags) {
        const tw = c.measureText(t).width + 36;
        if (x + tw > W - M) { x = M; y += 68; }
        c.strokeRect(x, y - 40, tw, 54); c.fillStyle = dark ? '#ddd' : '#555'; c.fillText(t, x + 18, y); x += tw + 14;
      }
      y += 70;
    } else {
      c.fillStyle = fg; c.font = `300 460px ${FONT_EN}`; c.fillText(String(s.ids.length), M, 700);
      const nw = c.measureText(String(s.ids.length)).width;
      c.fillStyle = mute; c.font = `400 90px ${FONT_JA}`; c.fillText('杯', M + nw + 20, 700);
      c.font = `400 40px ${FONT_JA}`; spaced(c, 4); c.fillText('愛媛のラーメンを食べた数', M, 770); spaced(c, 0);
      const col = (label, val, unit, x0) => {
        c.fillStyle = mute; c.font = `400 34px ${FONT_EN}`; spaced(c, 9); c.fillText(label, x0, 880); spaced(c, 0);
        c.fillStyle = fg; c.font = `300 150px ${FONT_EN}`; c.fillText(val, x0, 1020);
        const w = c.measureText(val).width; c.fillStyle = mute; c.font = `400 50px ${FONT_EN}`; c.fillText(unit, x0 + w + 14, 1020);
      };
      col('CITIES', String(s.cities), `/ ${s.citiesTotal}`, M);
      col('COMPLETE', s.pct.toFixed(1), '%', W / 2 + 20);
      y = 1060;
    }
    // 地図
    const mapTop = Math.max(y, 1080), mapH = 1700 - mapTop - 20, mapW = kind === 'shop' ? 560 : W - M * 2;
    c.save(); c.translate(kind === 'shop' ? M : M, mapTop);
    const hi = shopId ? ctx.byId.get(shopId) : null;
    for (const b of base) {
      const [px, py] = project(b, mapW, mapH), v = s.ateIds.has(b.id);
      c.beginPath(); c.arc(px, py, v ? 11 : 5.5, 0, Math.PI * 2);
      c.fillStyle = v ? (dark ? '#fff' : INK) : (dark ? '#555' : '#c8c8c3'); c.fill();
    }
    if (kind === 'shop' && hi && hi.category === 'ramen') {
      const [px, py] = project(hi, mapW, mapH);
      c.beginPath(); c.arc(px, py, 24, 0, Math.PI * 2); c.lineWidth = 4; c.strokeStyle = fg; c.stroke();
    }
    c.restore();
    if (kind === 'shop') {
      c.textAlign = 'right'; c.fillStyle = mute; c.font = `400 44px ${FONT_EN}`; spaced(c, 6);
      c.fillText(`${s.cities} / ${s.citiesTotal} CITIES`, W - M, 1560); c.fillText(`${s.ate} / ${s.total} SHOPS`, W - M, 1624); c.textAlign = 'left'; spaced(c, 0);
    }
    // フッター
    c.fillStyle = line; c.fillRect(M, 1760, W - M * 2, 2);
    c.fillStyle = mute; c.font = `400 36px ${FONT_EN}`; spaced(c, 7);
    if (kind === 'shop') {
      const d = (ctx.mylist.visitedAt[shopId] || today()).replace(/-/g, '.');
      const no = [...ctx.mylist.visited].filter((id) => ctx.byId.has(id)).indexOf(shopId) + 1;
      c.fillText(d, M, 1830); c.textAlign = 'right'; c.fillText(`EHIME RAMEN #${pad3(no)}`, W - M, 1830);
    } else {
      c.fillText('RAMEN 38', M, 1830); c.textAlign = 'right'; c.font = `400 36px ${FONT_JA}`; spaced(c, 4); c.fillText('一杯から、愛媛を知る。', W - M, 1830);
    }
    c.textAlign = 'left'; spaced(c, 0);
    return cv;
  }
  const TAG_TEXT = (sh) => ctx.TAG_GROUPS.flatMap((g) => sh.tags?.[g.key] || []).join('');

  let modal = null;
  async function openCard(kind, shopId) {
    closeCard();
    modal = document.createElement('div'); modal.id = 'card-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-label', 'シェアカード');
    modal.innerHTML = '<div class="cm-box"><p class="cm-load">つくっています…</p></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeCard(); });
    const cv = await drawCard(kind, shopId);
    if (!modal) return;
    const name = kind === 'shop' ? `ramen38-${pad3([...ctx.mylist.visited].filter((id) => ctx.byId.has(id)).indexOf(shopId) + 1)}.png` : `ramen38-my-${new Date().getFullYear()}.png`;
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    const sh = shopId && ctx.byId.get(shopId);
    modal.innerHTML = `<div class="cm-box">
      <img src="${url}" alt="シェアカードの画像" class="cm-img">
      <div class="cm-tabs"><button type="button" data-kind="shop"${kind === 'shop' ? ' aria-pressed="true"' : ''}${shopId ? '' : ' hidden'}>この1杯</button><button type="button" data-kind="summary"${kind === 'summary' ? ' aria-pressed="true"' : ''}>まとめ</button></div>
      <div class="cm-acts"><button type="button" class="pri" data-share>共有・保存</button><button type="button" data-dl>画像を保存</button><button type="button" data-close>閉じる</button></div>
      <p class="cm-note">画像はこの端末の中だけで作られ、送信されません。</p></div>`;
    const file = new File([blob], name, { type: 'image/png' });
    const download = () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
    modal.querySelector('[data-dl]').addEventListener('click', download);
    modal.querySelector('[data-share]').addEventListener('click', async () => {
      const data = { files: [file], text: sh && kind === 'shop' ? `${sh.name}（${sh.city}）｜RAMEN 38` : 'MY RAMEN 38', url: `${location.origin}${location.pathname}` };
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
      download();
    });
    modal.querySelectorAll('.cm-tabs button').forEach((b) => b.addEventListener('click', () => { URL.revokeObjectURL(url); openCard(b.dataset.kind, shopId); }));
  }
  function closeCard() { if (modal) { modal.remove(); modal = null; } }

  // ---------- 書き出し・読み込み ----------
  function exportData() {
    const m = ctx.mylist;
    const data = { app: 'ramen38', version: 1, exportedAt: new Date().toISOString(), fav: [...m.fav], visited: [...m.visited], visitedAt: m.visitedAt };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `ramen38-my-${today()}.json`; document.body.appendChild(a); a.click(); a.remove();
  }
  async function importData(file) {
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== 'ramen38' || !Array.isArray(d.visited)) throw new Error('形式が違います');
      const m = ctx.mylist; let added = 0;
      for (const id of d.fav || []) m.fav.add(id);
      for (const id of d.visited) if (!m.visited.has(id)) { m.visited.add(id); added++; }
      for (const [id, dt] of Object.entries(d.visitedAt || {})) if (!m.visitedAt[id]) m.visitedAt[id] = dt;
      ctx.save(); ctx.refreshMarks(); render();
      ctx.toast(`読み込みました（新しく ${added} 店）`);
    } catch (e) { ctx.toast('読み込めませんでした。書き出したファイルを選んでください'); }
  }

  // ---------- 外から呼ぶ ----------
  // 「行った」を押した直後：何杯目か・節目のバッジを返す
  function afterVisit(id) {
    const s = stats();
    const n = [...ctx.mylist.visited].filter((x) => ctx.byId.has(x)).length;
    const sh = ctx.byId.get(id);
    const city = s.perCity.find(([c]) => c === sh?.city);
    return { n, sub: city ? `${city[0]} ${city[2]} / ${city[1]}` : '', badges: BADGES.filter((b) => b.need(s)), prev: prevEarned };
  }
  let prevEarned = [];
  function snapshot() { prevEarned = earned(stats()); }

  function init(c) {
    ctx = c;
    base = ctx.shops.filter((s) => s.category === 'ramen' && s.closed !== true);
    const cnt = {}; base.forEach((s) => { cnt[s.city] = (cnt[s.city] || 0) + 1; });
    baseCities = Object.entries(cnt).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
    geoSetup();
    snapshot();
    if (!$('#my')) return;
    $('#my-card').addEventListener('click', () => {
      const last = [...ctx.mylist.visited].filter((id) => ctx.byId.has(id)).pop();
      openCard('summary', last);
    });
    $('#my-show-list').addEventListener('click', (e) => {
      const box = $('#my-list'); box.hidden = !box.hidden;
      e.currentTarget.setAttribute('aria-expanded', !box.hidden); renderList();
    });
    $('#my-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-card]'); if (b) openCard('shop', b.dataset.card);
    });
    $('#my-export').addEventListener('click', exportData);
    $('#my-import').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
    render();
  }
  window.RamenMy = { init, render, openCard, afterVisit, snapshot };
})();
