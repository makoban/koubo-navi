# 詳細バックフィル 引き継ぎ資料

**作成日**: 2026-02-27
**目的**: opportunities テーブルの全案件に対し、詳細ページから11項目を抽出してDBに保存する

---

## 1. 現状

| 項目 | 件数 |
|------|------|
| 全案件数（opportunities） | 43,626件 |
| バックフィル未完了（`detail_fetched_at=NULL`） | **43,219件** |
| バックフィル済み | 407件 |

### 前回の実行（2026-02-26 セッション#39）

- `backfill_details.py` を15ワーカーで実行（247件/分）
- 17,000件処理した時点で中断
- **成功率 約11%**（大半の古い案件ページが既に削除済み・404）
- 実際にDBに保存できたのは407件のみ

---

## 2. やること

**43,219件を全件フェッチし直す。** HTTPが成功した分（約11%≒4,754件）だけGemini APIで詳細抽出→DB保存。

### 抽出する11項目

```
published_date, deadline, bid_opening_date, contract_period,
briefing_date, budget, requirements, contact_info,
detailed_summary, difficulty, industry_category
```

---

## 3. 費用見積もり

### Gemini 2.0 Flash（現行モデル）

| 項目 | 数値 |
|------|------|
| HTTPフェッチ | 43,219件（費用なし） |
| Gemini API呼び出し | 約4,754件（成功分のみ） |
| 入力トークン | 約24.7Mトークン（1件あたり約5,200） |
| 出力トークン | 約2.4Mトークン（1件あたり約500） |
| **合計コスト** | **約$3.4 ≒ 500円** |
| 所要時間（15ワーカー） | 約3時間 |

### Gemini 2.5 Flash（次世代モデル）

| 項目 | 数値 |
|------|------|
| 合計コスト | **約$13.4 ≒ 2,000円** |

### 緊急: Gemini 2.0 Flash は 2026-03-03 に退役予定

2.0 Flashで走らせるなら **残り4日** しかない。
退役後は2.5 Flash（約4倍のコスト）に切り替える必要あり。

---

## 4. 実行手順

### 4-1. .env を作成

`公募ナビ/batch/.env`（または `公募ナビ/.env`）に以下を設定：

```env
GEMINI_API_KEY=（Google Cloud Consoleで取得）
SUPABASE_URL=https://ypyrjsdotkeyvzequdez.supabase.co
SUPABASE_SERVICE_KEY=（INFRASTRUCTURE.mdまたはWorker secretsで確認）
```

> SUPABASE_SERVICE_KEY は `docs/INFRASTRUCTURE.md` の Secret Key を使用

### 4-2. 実行コマンド

```bash
cd "C:\Users\banma\becreative Dropbox\番野誠\ビークリ社内用共有\サービス\公募ナビ\batch"
python backfill_details.py --limit 50000 --workers 15
```

### 4-3. オプション

| 引数 | デフォルト | 説明 |
|------|-----------|------|
| `--limit` | 50000 | 処理件数上限 |
| `--workers` | 15 | 並列ワーカー数 |
| `--batch` | 1000 | DB取得バッチサイズ |

---

## 5. 処理フロー

```
1. DB から detail_fetched_at=NULL の案件を batch件ずつ取得
2. 各案件の detail_url に HTTPフェッチ
   ├── 壊れたURL（p-portal等）→ スキップ
   ├── 404/タイムアウト → fail_fetch
   └── 成功 → テキスト抽出
3. Gemini 2.0 Flash で11項目をJSON抽出
   ├── 失敗 → fail_gemini
   └── 成功 → バリデーション
4. DB更新（update_opportunity_details）
5. 進捗ログ: 50件ごとに成功/失敗/スキップ数と処理速度を表示
```

---

## 6. 期待される結果

| 指標 | 予想値 |
|------|--------|
| 処理件数 | 43,219件 |
| 成功（DB保存） | 約4,700件（+既存407件 = 約5,100件） |
| フェッチ失敗（404等） | 約38,500件 |
| 所要時間 | 約3時間 |
| 費用 | 約500円（2.0 Flash） |

---

## 7. 完了後の確認

```sql
-- バックフィル済み件数
SELECT COUNT(*) FROM opportunities WHERE detail_fetched_at IS NOT NULL;
-- → 5,000件前後になるはず

-- 未処理件数（0に近いほど良い）
SELECT COUNT(*) FROM opportunities WHERE detail_fetched_at IS NULL;
```

Supabase REST APIで確認する場合：
```bash
curl -s "https://ypyrjsdotkeyvzequdez.supabase.co/rest/v1/opportunities?select=id&detail_fetched_at=not.is.null&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Prefer: count=exact" -I 2>&1 | grep Content-Range
```

---

## 8. 注意事項

- `backfill_details.py` は `detail_fetched_at=NULL` のレコードだけ処理するため、再実行しても重複処理にならない
- 前回フェッチ失敗した案件も再試行される（一時的なネットワークエラーで落ちた分が拾える可能性あり）
- 15ワーカーで走らせるとGemini Free Tier（10 RPM）を超えるため、有料枠前提
- Gemini 2.0 Flash退役後は `batch/config.py` と `batch/detail_scraper.py` の `GEMINI_MODEL` を `gemini-2.5-flash` に変更する必要あり
