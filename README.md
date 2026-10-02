# RAMEN 38 — Explore Ehime Ramen

一杯から、愛媛を知る。

愛媛県内で **ラーメンが食べられるお店** を地図で探せる静的サイトです。
ラーメン専門店だけでなく、中華料理店・食堂・回転寿司などラーメンを出しているお店もまとめて掲載します。

- 地図（クラスタ表示）＋リスト、市町・種類・Instagram有無での絞り込み
- **評価くらべ表**：Google / 食べログ / ラーメンデータベース / Retty / ホットペッパー の評価を横並びで比較
  - 評価が未登録のサイトは、その店の検索ページへワンクリックで飛べます
- Instagram を運用している店舗はアカウントへのリンクを表示

ビルド不要の HTML/CSS/JS だけで動くので、GitHub Pages・Netlify・Vercel などにフォルダごと置けば公開できます。

## ローカルで見る

```bash
cd ehime-ramen-map
npm run serve        # http://localhost:8080
```
（`index.html` をダブルクリックで開くと `data/shops.json` を読めないので、簡易サーバー経由で開いてください）

## 公開（GitHub Pages）

`.github/workflows/ramen38-pages.yml` により、`main` ブランチの `ehime-ramen-map/` が更新されると自動で GitHub Pages に公開されます。
公開されるのは `index.html` / `css` / `js` / `assets` / `data/shops.json` のみです（スクリプトや作業用CSVは含めません）。

初回のみ、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にしてください。
公開URL: https://uskpn.github.io/autopost-/

## データ

`data/shops.json` が唯一のデータです。1 店舗の形式:

```jsonc
{
  "id": "osm-n123",               // 一意なID
  "name": "〇〇ラーメン",
  "category": "ramen",            // ramen / chinese / shokudo / chain-sushi / chain / restaurant / other
  "ramen": "specialty",           // specialty=専門店, menu=メニューにあり(確認済み), likely=ありそう(未確認)
  "lat": 33.84, "lng": 132.77, "city": "松山市",
  "address": "...", "hours": "...", "phone": "...", "website": "...",
  "instagram": "shop_account",    // Instagram ハンドル（@なし）
  "ratings": {
    "google":    { "score": 4.1, "count": 523, "url": "https://maps.google.com/?cid=..." },
    "tabelog":   { "score": 3.52, "count": 120, "url": "https://tabelog.com/ehime/..." },
    "rdb":       null,            // ラーメンデータベース（100点満点）
    "retty":     null,
    "hotpepper": null
  },
  "closed": true,                 // 閉店（true）/ 休業中（"temporary"）
  "locked": ["name"]              // 自動更新で上書きしたくない項目
}
```

### 更新手順

| やること | コマンド | 備考 |
|---|---|---|
| OpenStreetMap から店舗を取り込む | `npm run fetch:osm` | キー不要。手入力した評価・Instagram は保持されます |
| Google の評価を付与＋店舗を追加発見 | `GOOGLE_MAPS_API_KEY=xxx npm run fetch:google` | Places API (New) のキーが必要。市町×「ラーメン」「中華そば」等で検索し、OSM に無い店も追加します |
| 公式サイトから Instagram を自動検出 | `npm run find:instagram` | |
| 食べログ等の評価・Instagram を手入力 | `npm run ratings:template` → `data/ratings.csv` を Excel 等で編集 → `npm run ratings:import` | 空欄は変更なし、`-` で削除 |

食べログ・ラーメンデータベース・Retty・ホットペッパーは公開 API が無く、スクレイピングは各サイトの利用規約で禁止されているため、
評価は CSV での手入力（各サイトを見て転記）にしています。

### 「ラーメンが食べられるか」の判定

`scripts/lib.mjs` の `classify()` で店名・料理ジャンルから自動判定しています。

- **ラーメン専門店**: 店名に「ラーメン」「中華そば」「麺屋」など、または既知のラーメンチェーン
- **メニューにあり**: スシロー・くら寿司・はま寿司・王将などラーメンを出しているチェーン
- **ありそう（未確認）**: 中華料理店・食堂。地図上では小さめのマーカーで表示
- **その他の飲食店**: ラーメン店以外で、メニューにラーメンがあると確認できた店（`npm run menu:import -- 確認済み.csv`）
- **その他（未確認）**: Google で「ラーメン」等を検索して出てきたが、店名から判断できない店。初期表示ではオフ

削除したお店（重複・閉店）は `data/removed.json` に記録され、`fetch:osm` / `fetch:google` で再追加されません。

誤判定やメニューを確認できたお店は `shops.json` の `category` / `ramen` を直接直し、`locked` に項目名を入れておくと自動更新で戻りません。
ラーメンを出さないお店は削除し、`EXCLUDE` に店名パターンを追加してください。

## クレジット

- 店舗データ: © OpenStreetMap contributors（ODbL）/ Google Places
- 地図: 国土地理院 地理院タイル
- 地図ライブラリ: Leaflet, Leaflet.markercluster
