// 統一表記の営業時間（scripts/hours.mjs 参照）から「いま営業中か」を判定する。
//   status(hours, date) → { open: true, until: '20:00' } | { open: false } | null（判定できない）
// 祝日・不定休・第○曜日などは判定しない（その場合は通常の曜日で判定する）。
(function (root) {
  'use strict';
  const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
  const TIME = /(\d{1,2}):(\d{2})\s*〜\s*(翌)?\s*(\d{1,2}):(\d{2})/g;

  // 「月〜金」「土・日・祝」→ 曜日の Set（解釈できなければ null）
  function parseDays(tok) {
    const t = tok.replace(/曜日?/g, '').replace(/祝日/g, '祝').replace(/[\s　]/g, '');
    if (t === '毎日') return new Set(DAYS);
    if (t === '平日') return new Set(DAYS.slice(0, 5));
    if (!t || /[^月火水木金土日祝・,、〜~]/.test(t)) return null;
    const set = new Set();
    for (const part of t.split(/[・,、]/)) {
      if (!part) continue;
      const m = part.match(/^([月火水木金土日])[〜~]([月火水木金土日])$/);
      if (m) {
        for (let k = DAYS.indexOf(m[1]); ; k = (k + 1) % 7) { set.add(DAYS[k]); if (DAYS[k] === m[2]) break; }
      } else if (/^[月火水木金土日祝]$/.test(part)) set.add(part);
      else return null;
    }
    return set;
  }

  // 日本時間の「曜日（0=月）」と「0時からの分」
  function jst(date) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).reduce((o, x) => (o[x.type] = x.value, o), {});
    return { dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), min: +p.hour * 60 + +p.minute };
  }
  const hhmm = (m) => `${Math.floor((m % 1440) / 60)}:${String(m % 60).padStart(2, '0')}`;

  const cache = new Map();
  function parse(hours) {
    if (cache.has(hours)) return cache.get(hours);
    const plain = [];          // 曜日の指定がない時間帯
    const byDay = DAYS.map(() => null); // 曜日ごとの時間帯（指定があるもの）
    const closed = new Set();
    for (const seg0 of hours.split(' / ')) {
      const seg = seg0.trim();
      const cm = seg.match(/^定休[：:]\s*(.*)$/);
      if (cm) {
        for (const tok of cm[1].split(/[、,]/)) { const d = parseDays(tok.trim()); if (d) d.forEach((x) => closed.add(x)); }
        continue;
      }
      const first = seg.search(/\d{1,2}:\d{2}/);
      if (first < 0) continue;
      const prefix = seg.slice(0, first).replace(/^時間は?/, '').trim();
      const ranges = [];
      for (const m of seg.slice(first).replace(/[（(][^）)]*[）)]/g, '').matchAll(TIME)) {
        const s = +m[1] * 60 + +m[2];
        let e = +m[4] * 60 + +m[5];
        if (s === e) { ranges.push([0, 1440]); continue; } // 24時間
        if (m[3] || e < s) e += 1440; // 翌日にまたがる
        ranges.push([s, e]);
      }
      if (!ranges.length) continue;
      const days = prefix ? parseDays(prefix) : null;
      if (prefix && !days) continue; // 解釈できない見出しは使わない
      if (!days) plain.push(...ranges);
      else DAYS.forEach((d, i) => { if (days.has(d)) (byDay[i] ||= []).push(...ranges); });
    }
    const out = { plain, byDay, closed };
    cache.set(hours, out);
    return out;
  }

  function status(hours, date = new Date()) {
    if (!hours) return null;
    const h = parse(hours);
    const rangesOf = (i) => byDayOrPlain(h, i);
    if (!h.plain.length && h.byDay.every((x) => !x)) return null;
    const { dow, min } = jst(date);
    const yest = (dow + 6) % 7;
    // 前日から続く深夜営業
    if (!h.closed.has(DAYS[yest])) {
      for (const [s, e] of rangesOf(yest)) if (e > 1440 && min < e - 1440) return { open: true, until: hhmm(e) };
    }
    if (!h.closed.has(DAYS[dow])) {
      for (const [s, e] of rangesOf(dow)) if (min >= s && min < e) return { open: true, until: hhmm(e) };
    }
    return { open: false };
  }
  function byDayOrPlain(h, i) { return h.byDay[i] || h.plain; }

  root.RamenHours = { status, _parse: parse };
  if (typeof module !== 'undefined') module.exports = root.RamenHours;
})(typeof window !== 'undefined' ? window : globalThis);
