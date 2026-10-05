// 営業時間の表記を統一する。
//   例) 「火・水・木・金・土・日 / 11:30～14:00 / 18:00～20:00 / 月 / 定休日」
//     → 「火〜日 11:30〜14:00、18:00〜20:00 / 定休：月」
// 統一ルール
//   ・時間は「11:00〜14:00」（半角数字・〜）。複数の時間帯は「、」でつなぐ
//   ・曜日は「月〜金」「土・日・祝」。7日とも同じなら「毎日」
//   ・定休日は「定休：水」。ラストオーダー(L.O.)は省く
//   ・区切りは「 / 」。補足は短く（「不定休」「売切次第終了」など）
const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
const ORDER = [...DAYS, '祝', '祝前日'];
const OSM_DAY = { Mo: '月', Tu: '火', We: '水', Th: '木', Fr: '金', Sa: '土', Su: '日', PH: '祝' };
const T = '\\d{1,2}:\\d{2}';
const RANGE = new RegExp(`${T}\\s*〜(?:\\s*翌?${T})?`, 'g');
const RANGE_ONE = new RegExp(`^(${T})\\s*〜\\s*(${T})$`);

function pad(t) { return t.replace(/^(\d):/, '$1:'); }

function compressDays(set) {
  const list = ORDER.filter((d) => set.has(d));
  if (DAYS.every((d) => set.has(d))) return '毎日';
  const out = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    while (j + 1 < list.length && ORDER.indexOf(list[j + 1]) === ORDER.indexOf(list[j]) + 1 && !['祝', '祝前日'].includes(list[j + 1])) j++;
    if (j - i >= 2) out.push(`${list[i]}〜${list[j]}`);
    else for (let k = i; k <= j; k++) out.push(list[k]);
    i = j + 1;
  }
  return out.join('・');
}

function parseDays(tok) {
  // 「月・火・水」「月〜金」「土・日・祝日」「平日」「毎日」 → Set / 解釈できなければ null
  let t = tok.replace(/曜日?/g, '').replace(/祝前日/g, '前').replace(/祝後日/g, '').replace(/祝日/g, '祝').replace(/\s/g, '').replace(/・・+/g, '・').replace(/・$/, '');
  if (t === '毎日' || t === '全日') return new Set(DAYS);
  if (t === '平日') return new Set(['月', '火', '水', '木', '金']);
  if (!t || /[^月火水木金土日祝前・,、〜]/.test(t)) return null;
  const set = new Set();
  for (const part of t.split(/[・,、]/)) {
    if (!part) continue;
    const m = part.match(/^([月火水木金土日])〜([月火水木金土日])$/);
    if (m) {
      let a = DAYS.indexOf(m[1]), b = DAYS.indexOf(m[2]);
      if (a < 0 || b < 0) return null;
      for (let k = a; ; k = (k + 1) % 7) { set.add(DAYS[k]); if (k === b) break; }
    } else if (part === '前') set.add('祝前日');
    else if (/^[月火水木金土日祝]$/.test(part)) set.add(part);
    else if (/^[月火水木金土日祝]+$/.test(part)) for (const c of part) set.add(c);
    else return null;
  }
  return set.size ? set : null;
}

function cleanNote(n) {
  return n
    .replace(/(?:スープ|麺|材料|食材|ネタ)?(?:が)?(?:なくなり|無くなり|売り切れ|売切れ|売り切れ|売切)次第\s*(?:終了|閉店)?/g, '売切次第終了')
    .replace(/[(（][^)）]*[)）]/g, (m) => (/要確認/.test(m) ? '' : m))
    .replace(/[■□●◆※]\s*/g, '')
    .replace(/\(?[^()]*要確認[^()]*\)?/g, '')
    .replace(/(?<!不)定休日?\s*[:：]?\s*/g, '定休：')
    .replace(/第\s*([1-5１-５一二三四五])\s*[・･、]\s*第?\s*([1-5１-５一二三四五])\s*([月火水木金土日])曜日?/g, (_, a, b, d) => `第${nm(a)}・${nm(b)}${d}`)
    .replace(/第\s*([1-5１-５一二三四五])\s*([月火水木金土日])曜日?/g, (_, a, d) => `第${nm(a)}${d}`)
    .replace(/([月火水木金土日])曜日?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function nm(c) { return '１２３４５'.includes(c) ? '１２３４５'.indexOf(c) + 1 : '一二三四五'.includes(c) ? '一二三四五'.indexOf(c) + 1 : c; }

// 「09:00〜01:00」→「9:00〜翌1:00」「18:00〜00:00」→「18:00〜24:00」
function formatTimes(text) {
  return text.replace(/(\d{1,2}):(\d{2})〜(\d{1,2}):(\d{2})/g, (_, h1, m1, h2, m2) => {
    const a = +h1 * 60 + +m1;
    let b = +h2 * 60 + +m2;
    let end;
    if (b === 0) end = `24:${m2}`;
    else if (b <= a && +h2 < 12) end = `翌${+h2}:${m2}`;
    else end = `${+h2}:${m2}`;
    return `${+h1}:${m1}〜${end}`;
  }).replace(/(\d{1,2}):(\d{2})〜(?!\d|翌)/g, (_, h, m) => `${+h}:${m}〜`);
}

// すでに統一表記になっている文字列かどうか（再取り込みで崩れないように、そのまま通す）
export function looksNormalized(s) {
  const bad = /[～~?？\n■※０-９]|L\.?O|定休日|ラストオーダー|\d{1,2}:\d{2}\s*[-–]\s*\d|(?:^|\D)0\d:\d{2}/i;
  return s.includes('〜') && !bad.test(s);
}

export function normalizeHours(raw) {
  if (raw == null) return { text: null, unparsed: false };
  const orig = String(raw).trim();
  if (looksNormalized(orig)) return { text: orig, unparsed: false };
  let s = orig.normalize('NFKC').replace(/\u3000/g, ' ').trim();
  if (!s || /^要確認/.test(s)) return { text: null, unparsed: false };

  // OSM 形式（例: "Su-Fr 07:00-17:00", "Mo-Sa 11:00-14:00,17:00-22:00"）
  const osm = s.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su|PH))*)\s+(.+)$/);
  if (osm && /\d:\d/.test(osm[2])) {
    const dayPart = osm[1].split(',').map((x) => x.trim());
    const set = new Set();
    for (const p of dayPart) {
      const r = p.split('-').map((x) => x.trim());
      if (r.length === 2 && OSM_DAY[r[0]] && OSM_DAY[r[1]]) {
        const a = DAYS.indexOf(OSM_DAY[r[0]]), b = DAYS.indexOf(OSM_DAY[r[1]]);
        for (let k = a; ; k = (k + 1) % 7) { set.add(DAYS[k]); if (k === b) break; }
      } else if (OSM_DAY[r[0]]) set.add(OSM_DAY[r[0]]);
    }
    const times = osm[2].split(/[,、;]\s*/).map((x) => x.replace(/\s/g, '').replace(/[-–]/, '〜'));
    const closed = new Set(DAYS.filter((d) => !set.has(d) && d !== '祝'));
    const allBut = DAYS.every((d) => set.has(d) || closed.has(d));
    const parts = [allBut ? times.join('、') : `${compressDays(set)} ${times.join('、')}`];
    if (closed.size) parts.push(`定休：${compressDays(closed)}`);
    return { text: formatTimes(parts.join(' / ')), unparsed: false };
  }

  // 時間の区切り記号を揃える（〜 ～ ~ - – − ? など）
  s = s
    .replace(/(\d{1,2}:\d{2})\s*[~〜～\-–—−?？ー－]+\s*(\d{1,2}:\d{2})/g, '$1〜$2')
    .replace(/(\d{1,2}:\d{2})\s*[~〜～\-–—−?？]+\s*(?=\D|$)/g, '$1〜')
    .replace(/\s*[(（]?\s*L\.?\s*O\.?\s*(?:料理|ドリンク|フード|飲物|食事)?\s*\d{1,2}:\d{2}\s*[)）]?/gi, '')
    .replace(/\s*[(（]?ラストオーダー\s*(?:料理|ドリンク)?\s*\d{1,2}:\d{2}\s*[)）]?/g, '')
    .replace(/\s*\/\s*ラストオーダー\s*\/\s*\d{1,2}:\d{2}/g, '')
    .replace(/\s*\/\s*[■□●◆]?\s*(?:営業時間|定休日)\s*(?=\/|$)/g, (m) => (/定休日/.test(m) ? ' / 定休日' : ''))
    .replace(/^[■□]?\s*営業時間\s*\/\s*/, '');

  // 区切りで分割（/ ； ; 、で時間が続く場合は同じ要素にする）
  const toks = s.split(/\s*[\/；;]\s*/).map((x) => x.trim()).filter(Boolean);

  const groups = []; // {days:Set|null, times:[]}
  const closed = new Set();
  const notes = [];
  const closedNotes = [];
  let cur = null;
  let unparsed = false;
  let pendingDays = null;

  const commit = () => { if (cur && cur.times.length) groups.push(cur); cur = null; };

  for (let tok of toks) {
    // 時間帯だけの要素（「11:00〜14:00」「11:00〜14:00、17:00〜22:00」「11:00〜14:00 17:00〜22:00」）
    const ranges = tok.match(RANGE);
    const stripped = ranges ? tok.replace(RANGE, '').replace(/[、,\s・]/g, '') : tok;
    if (ranges && stripped === '') {
      if (!cur) cur = { days: pendingDays, times: [] };
      cur.times.push(...ranges.map((r) => r.replace(/\s/g, '')));
      continue;
    }
    // 曜日だけの要素
    const d = parseDays(tok);
    if (d && !/^定休/.test(tok)) {
      if (cur && cur.times.length) { commit(); }
      pendingDays = d; cur = { days: d, times: [] };
      continue;
    }
    // 「定休日」だけ → 直前の曜日を定休日にする
    if (/^[■□]?\s*定休日?$/.test(tok)) {
      if (pendingDays && !(cur && cur.times.length)) { pendingDays.forEach((x) => closed.add(x)); cur = null; pendingDays = null; }
      else if (pendingDays && cur && cur.times.length) { unparsed = true; }
      continue;
    }
    // 「定休日：日曜」などの定休日情報
    const cm = tok.match(/^[■□]?\s*定休日?\s*[:：]?\s*(.+)$/);
    if (cm) {
      const dd = parseDays(cm[1]);
      if (dd) dd.forEach((x) => closed.add(x));
      else { const cn = cleanNote(cm[1]).replace(/[(（].*$/, '').trim(); if (/^(年中)?無休$|^(なし|無し)$/.test(cn)) notes.push('無休'); else if (cn) closedNotes.push(cn); }
      continue;
    }
    // 「T～T；日・祝休」のような「〇休」
    const kyu = tok.match(/^([月火水木金土日祝・]+)休$/);
    if (kyu) { parseDays(kyu[1])?.forEach((x) => closed.add(x)); continue; }
    // 時間 + 補足（例: 「10:00〜スープがなくなり次第終了」「11:00〜14:00 売り切れ次第終了」）
    if (ranges) {
      if (!cur) cur = { days: pendingDays, times: [] };
      cur.times.push(...ranges.map((r) => r.replace(/\s/g, '')));
      const rest = cleanNote(tok.replace(RANGE, ''));
      if (rest) notes.push(rest);
      continue;
    }
    const n = cleanNote(tok);
    if (n) { notes.push(n); if (!/^(定休|不定休|無休|※|臨時|売|スープ|ラスト|予約)/.test(n)) unparsed = true; }
  }
  commit();

  // 同じ時間の曜日グループをまとめる
  const merged = [];
  for (const g of groups) {
    const key = g.times.join('、');
    const m = merged.find((x) => x.key === key && (x.days && g.days));
    if (m) g.days.forEach((x) => m.days.add(x)); else merged.push({ key, days: g.days ? new Set(g.days) : null, times: g.times });
  }

  // 開いている曜日が「定休日以外すべて」で時間も1種類なら、曜日は省く
  const parts = merged.map((g) => {
    const allBut = g.days && DAYS.every((d) => g.days.has(d) || closed.has(d));
    const times = g.times.join('、');
    return g.days && !(allBut && merged.length === 1) ? `${compressDays(g.days)} ${times}` : times;
  });
  const closedAll = [];
  if (closed.size) closedAll.push(compressDays(closed));
  for (const cn of closedNotes) {
    const dd = parseDays(cn);
    if (dd) dd.forEach((x) => { if (!closed.has(x)) closedAll[0] = undefined; });
    if (!(dd && [...dd].every((x) => closed.has(x))) && !closedAll.includes(cn)) closedAll.push(cn);
  }
  for (let i = closedAll.length - 1; i >= 0; i--) if (closedAll[i] === undefined) closedAll.splice(i, 1);
  if (closedAll.length) parts.push(`定休：${closedAll.join('、')}`);
  for (const n0 of notes) { const n = n0.replace(/[。.]+$/, '').trim(); if (n && !/^[、,・\s]+$/.test(n) && !parts.includes(n)) parts.push(n); }
  const text = formatTimes(parts.join(' / '));
  return { text: text || null, unparsed: unparsed || !text };
}
