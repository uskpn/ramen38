// 全店舗の CSV 入出力で共通に使う定義（列の並び・ジャンル名・区分名）
export const CATEGORY_LABEL = {
  ramen: 'ラーメン専門店',
  chinese: '中華料理',
  shokudo: '食堂・定食',
  chain: 'チェーン',
  restaurant: 'その他の飲食店',
  other: '未確認',
};
export const RAMEN_LABEL = { specialty: '専門', menu: 'あり', likely: '不明' };
export const TAG_KEYS = ['style', 'soup', 'noodle', 'character'];
export const TAG_HEADERS = { style: 'Style', soup: 'Soup', noodle: 'Noodle', character: 'Character' };

export const COLUMNS = [
  'id', '店名', 'ジャンル', 'ラーメン', '市区町村', '住所', '営業時間', '電話', 'Instagram',
  '食べログ点数', '食べログ件数', '食べログURL', 'RDB点数', 'RDB件数', 'RDBURL',
  ...TAG_KEYS.map((k) => TAG_HEADERS[k]),
  '状態', '備考', '緯度', '経度',
];

export const csvEscape = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}
