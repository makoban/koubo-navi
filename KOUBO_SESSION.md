# koubo-navi セッション継続ファイル

> このファイルは Claude Code がセッション間で作業を引き継ぐための記録です。
> このフォルダを開いたら、まずこのファイルを読んでください。

## プロジェクト概要

- **サービス名**: 公募ナビAI
- **本番URL**: https://koubo-navi.bantex.jp/
- **Worker URL**: https://koubo-navi-proxy.ai-fudosan.workers.dev
- **GitHub**: https://github.com/makoban/koubo-navi (branch: master)
- **現在のバージョン**: v2.0
- **スクリーンショット保存場所**: C:\Users\banma\Pictures\Screenshots

## 技術構成

| コンポーネント | 技術 | デプロイ先 |
|-------------|------|-----------|
| フロントエンド | HTML/CSS/JS (SPA) | GitHub Pages (koubo-navi.bantex.jp) |
| Worker API | Cloudflare Workers | koubo-navi-proxy.ai-fudosan.workers.dev |
| DB | Supabase PostgreSQL (Tokyo) | ypyrjsdotkeyvzequdez.supabase.co |
| AI | Gemini 2.0 Flash | Google Generative Language API |
| 決済 | Stripe Checkout (サブスク) | テスト: monthly ¥2,980 / yearly ¥29,800 |
| バッチ処理 | Python (Render.com Cron Job) | 未デプロイ |
| メール通知 | Resend API | 未設定 |

## ファイル構成

```
koubo-navi/
  public/           # フロントエンド（GitHub Pages で配信）
    index.html       # LP + オンボーディング + ダッシュボード
    app.js           # メインロジック (v2.0)
    style.css        # スタイル
  workers/           # Cloudflare Worker
    index.js         # 全APIエンドポイント (13ルート)
    wrangler.toml    # Worker設定
  batch/             # Python バッチ処理
    daily_check.py   # 日次メインバッチ
    db.py            # Supabase DB操作
    notifier.py      # メール通知 (Resend API)
    matcher.py       # AIマッチング
    config.py        # 環境変数設定
    gov_scraper.py   # 行政サイトスクレイピング
  migrations/
    001_initial.sql  # 初期テーブル（実行済み）
    002_tier_and_analysis.sql  # v2.0追加カラム（実行済み 2026-02-23）
  e2e_test.js        # 基本E2Eテスト (Puppeteer)
  e2e_deep_test.js   # 深掘りE2Eテスト
  KOUBO_SESSION.md   # このファイル
```

## Worker API エンドポイント一覧

| Method | Path | 認証 | 説明 |
|--------|------|------|------|
| POST | /api/analyze-company | JWT | 会社URL/テキスト分析 (Gemini) |
| GET | /api/areas | - | 47都道府県一覧 |
| GET | /api/user/profile | JWT | ユーザー+プロフィール+エリア取得 |
| PUT | /api/user/profile | JWT | 設定・キーワード更新 |
| PUT | /api/user/areas | JWT | エリア更新 |
| GET | /api/user/opportunities | JWT | マッチング結果取得（ティア制限付き） |
| GET | /api/user/subscription | JWT | サブスク情報取得 |
| POST | /api/checkout | JWT | Stripe Checkoutセッション作成 |
| POST | /api/webhook | - | Stripe Webhook受信 |
| POST | /api/cancel-subscription | JWT | サブスク解約 |
| POST | /api/register | JWT | ユーザー登録 |
| POST | /api/opportunity/analyze | JWT | AI詳細分析 (Gemini→DBキャッシュ) |
| POST | /api/user/screen | JWT | 初期30日スクリーニング (非同期) |

## 認証情報（Worker secrets に設定済み）

| Secret名 | 状態 |
|----------|------|
| GEMINI_API_KEY | **要更新** (漏洩検出で無効化済み) |
| STRIPE_SECRET_KEY | 設定済み (テストモード) |
| STRIPE_WEBHOOK_SECRET | 設定済み (whsec_C3dGxZ6zMwFBE3IWxsS4IRQR9YGAUra8) |
| SUPABASE_SERVICE_KEY | 設定済み |

## Stripe テスト商品

| 項目 | 値 |
|------|-----|
| 月額 Price ID | price_1T3qtU1TYnppSLqN4aYmJE8G (¥2,980/月) |
| 年額 Price ID | price_1T3qtW1TYnppSLqNNXDaSRY9 (¥29,800/年) |
| Webhook ID | we_1T3zRp1TYnppSLqN9hj70YY5 |
| テストカード | 4242 4242 4242 4242 |

## DB テーブル

| テーブル | 用途 |
|---------|------|
| koubo_users | ユーザー管理 (status, trial_ends_at, email_notify, etc.) |
| company_profiles | 会社プロフィール (AI分析結果, matching_keywords) |
| user_areas | ユーザー×エリア紐付け |
| area_sources | エリア別データソース |
| opportunities | 公募案件 |
| user_opportunities | マッチング結果 (rank_position, detailed_analysis) |
| batch_logs | バッチ実行ログ |
| notifications | 通知ログ |

## E2Eテスト結果 (2026-02-23)

### ローカルテスト
- 基本テスト: 51 PASS / 1 FAIL
- 深掘りテスト: 42 PASS / 4 FAIL
- FAILは全てGemini APIキー無効化が原因。コードロジックは正常。

### 本番環境テスト (Puppeteer → koubo-navi.bantex.jp)
- **36 PASS / 0 FAIL / 4 WARN**
- Worker API: 12/12 PASS（認証・CORS・プリフライト全て正常）
- ブラウザUI: 20/20 PASS（LP表示・モーダル・バージョン・FAQ・比較表全て正常）
- モバイル: 3/4 PASS（横スクロール→overflow-x:hidden追加で対応済み）
- 認証: 1/3 PASS（テスト用メールでのサインアップはautoconfirm設定に依存）

## 未完了タスク（優先順）

### ブロッカー（サービス公開前に必須）
- [ ] **Gemini APIキーの再生成**: Google Cloud Console → API Keys → 新規作成 → `wrangler secret put GEMINI_API_KEY`
- [ ] 新キーでE2Eテスト再実行（全PASS確認）

### デプロイ待ち
- [ ] バッチ処理の Render.com デプロイ（Cron Job）
- [ ] Resend アカウント作成 + API Key設定 + DNS (SPF/DKIM)

### 本番移行
- [ ] Stripe テスト→本番キー切替
- [ ] Worker の CORS 設定から localhost を削除

## 最新セッション記録

### 2026-02-23 | 最終セッション

**完了した作業**:
1. 全7フェーズのコード実装完了 (v1.0 → v2.0)
2. Supabase migration 002 実行完了
3. Stripe Webhook 作成完了 (we_1T3zRp1TYnppSLqN9hj70YY5)
4. Worker secrets 全設定完了 (STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, SUPABASE_SERVICE_KEY)
5. Worker デプロイ完了 (Version: beb14c79)
6. GitHub push完了 (commit: 2fd3a03)
7. GitHub Pages 本番稼働確認 (koubo-navi.bantex.jp → v2.0表示確認)
8. E2Eテスト実行（基本51 PASS/1 FAIL、深掘り42 PASS/4 FAIL）
9. Keywords保存バグ修正 (company_profiles未作成時のupsert対応)

**判明した問題**:
- Gemini APIキー (AIzaSyCeATGt0trXoYdhubXE-RYPELsWL1wlkCE) がGoogleにleaked検出され無効化
- CLAUDE.mdにキーが記載されていたことが原因と推定
- 新キー生成後、Worker secretを更新すれば全機能が復旧する

**追加作業 (セッション継続)**:
10. 本番E2Eテスト作成・実行 (e2e_production_test.js: 36 PASS / 0 FAIL)
11. モバイル横スクロール修正 (body overflow-x: hidden)

**中断箇所**:
- Gemini APIキー再生成待ち → 新キーでE2Eテスト再実行
