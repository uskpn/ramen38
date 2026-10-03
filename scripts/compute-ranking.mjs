// RAMEN 38 総合ランキングを計算し、各店舗に score（偏差値）と rank（順位）を書き込む。
//   node scripts/compute-ranking.mjs
//
// 対象: ラーメン専門店（category=ramen かつ ramen=specialty）で、閉店しておらず、評価が1つ以上ある店。
// 計算:
//   1. サイトごとに、口コミが少ない店の評価を平均に寄せる（ベイズ平均）。
//        補正後 = (評価 × 件数 + 全体平均 × m) / (件数 + m)
//   2. 補正後の評価を、サイトごとに偏差値化する（尺度の違う Google/食べログ/ラーメンDB を同じ土俵にする）。
//   3. 評価のあるサイトの偏差値を重み付き平均する。サイトが少ない店は、平均に寄せる。
//   4. 偏差値（平均50・標準偏差10）にして、高い順に順位を付ける。順位は RANK_LIMIT 位まで。
import { fileURLToPath } from 'node:url';
import { loadShops, saveShops } from './lib.mjs';

export const RANK_LIMIT = 200;
// m = 何件ぶんの口コミを「平均の評価」として加えるか／weight = サイトの重み
const SITES = {
  tabelog: { m: 15, weight: 1 },
  rdb: { m: 5, weight: 1 },
};
const MISSING_PENALTY = 0.5; // サイトが少ない店を平均に寄せる強さ（大きいほど強く寄せる）

export const isRankTarget = (s) => s.category === 'ramen' && s.ramen === 'specialty' && s.closed !== true;

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a, m = mean(a)) => Math.sqrt(mean(a.map((v) => (v - m) ** 2)));

export function computeRanking(shops) {
  const targets = shops.filter(isRankTarget);

  // サイトごとの補正後評価と、その平均・標準偏差
  const stats = {};
  for (const [key, { m }] of Object.entries(SITES)) {
    const rated = targets.filter((s) => s.ratings?.[key]?.score != null);
    const prior = mean(rated.map((s) => s.ratings[key].score));
    const adj = (s) => {
      const { score, count } = s.ratings[key];
      const n = count || 1;
      return (score * n + prior * m) / (n + m);
    };
    const values = rated.map(adj);
    stats[key] = { adj, mean: mean(values), sd: sd(values) || 1 };
  }

  for (const s of shops) { delete s.score; delete s.rank; }

  const scored = [];
  for (const s of targets) {
    let sum = 0, weights = 0;
    for (const [key, { weight }] of Object.entries(SITES)) {
      if (s.ratings?.[key]?.score == null) continue;
      sum += weight * ((stats[key].adj(s) - stats[key].mean) / stats[key].sd);
      weights += weight;
    }
    if (!weights) continue;
    scored.push({ s, z: sum / (weights + MISSING_PENALTY) });
  }
  scored.sort((a, b) => b.z - a.z || a.s.name.localeCompare(b.s.name, 'ja'));

  // 偏差値（対象店全体で 平均50・標準偏差10 になるように）
  const zs = scored.map((x) => x.z);
  const zm = mean(zs), zsd = sd(zs, zm) || 1;
  scored.forEach(({ s, z }, i) => {
    s.score = Math.round((50 + (10 * (z - zm)) / zsd) * 10) / 10;
    if (i < RANK_LIMIT) s.rank = i + 1;
  });
  return { targets: targets.length, scored: scored.length, ranked: Math.min(scored.length, RANK_LIMIT) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await loadShops();
  const r = computeRanking(db.shops);
  await saveShops(db);
  console.log(`対象 ${r.targets} 店 / 評価あり ${r.scored} 店 / ランキング ${r.ranked} 位まで`);
}
