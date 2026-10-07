// 店ごとのページの「お気に入り」「行った」。保存先は地図のページと同じ（この端末のブラウザ）
(function () {
  'use strict';
  const KEY = 'ramen38:mylist:v1';
  const box = document.querySelector('.shop-cta');
  if (!box) return;
  const id = box.dataset.id;
  let data = { fav: [], visited: [], visitedAt: {} };
  try { data = Object.assign(data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* 保存できない環境でも表示は動く */ }
  const has = (k) => data[k].includes(id);
  const show = () => box.querySelectorAll('.act').forEach((b) => b.setAttribute('aria-pressed', has(b.dataset.act)));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 保存できない環境 */ } };
  let timer;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<span class="tmsg">${msg}</span>`; el.classList.remove('has-action'); el.classList.add('show');
    clearTimeout(timer); timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.act'); if (!b) return;
    const k = b.dataset.act;
    if (has(k)) {
      data[k] = data[k].filter((x) => x !== id);
      if (k === 'visited') delete data.visitedAt[id];
    } else {
      data[k].push(id);
      if (k === 'visited') { const d = new Date(); data.visitedAt[id] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
      toast(k === 'fav' ? 'お気に入りに追加しました' : `${data.visited.length}杯目を記録しました（MY RAMEN 38 で確認できます）`);
    }
    save(); show();
  });
  show();
})();
