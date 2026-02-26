# 公募ナビAI (koubo-navi)

行政の公募・入札案件をAIが毎日自動チェックし、ユーザーの事業にマッチする案件を通知するサブスクサービス。

- **URL**: https://koubo-navi.bantex.jp/
- **GitHub**: makoban/koubo-navi
- **バージョン**: v3.1
- **料金**: 月額 ¥2,980（税込）

## クイックスタート

```bash
# Python依存（バッチ処理用）
pip install -r requirements.txt

# Node依存（E2Eテスト用）
npm install

# 環境変数
cp .env.example .env
# GEMINI_API_KEY を設定

# E2Eテスト
node e2e_test.js
```

## アーキテクチャ

```
[GitHub Pages]         → フロントエンド (public/)
[Cloudflare Worker]    → API (workers/)
[Supabase]             → DB + Auth
[Stripe]               → サブスク決済 (¥2,980/月)
[Render.com Cron]      → バッチ処理 (batch/)
[Gemini 2.0 Flash]     → AI分析
```

## ディレクトリ構成

```
公募ナビ/
├── public/              # フロントエンド（GitHub Pages）
│   ├── index.html       #   メインHTML v3.1
│   ├── app.js           #   アプリロジック v3.1
│   └── style.css        #   スタイル
├── workers/             # Cloudflare Worker API
│   ├── index.js         #   全APIエンドポイント
│   └── wrangler.toml    #   Wrangler設定
├── batch/               # バッチ処理（Render.com Cron）
│   ├── main.py          #   エントリーポイント
│   ├── gov_scraper.py   #   政府系サイトスクレイピング
│   ├── daily_check.py   #   日次チェック
│   ├── db.py            #   Supabase DB操作
│   ├── matcher.py       #   マッチングロジック
│   ├── notifier.py      #   メール通知
│   ├── gemini_client.py #   Gemini API呼び出し
│   ├── initial_load.py  #   初期データロード
│   ├── bulk_reload.py   #   一括リロード
│   ├── run_matching.py  #   マッチング実行
│   └── config.py        #   バッチ設定
├── migrations/          # SQLマイグレーション
│   ├── 001_initial.sql
│   └── 002_tier_and_analysis.sql
├── tests/               # テスト
├── e2e_test.js          # E2Eテスト
├── e2e_production_test.js # 本番E2Eテスト
├── config.py            # メイン設定（API/エリア定義）
├── SPEC.md              # 詳細仕様書
├── DEPLOY.md            # デプロイガイド
├── .env.example         # 環境変数テンプレート
└── .gitignore
```

## 主要機能

- **業種カテゴリマッチング**: 10業種でSQL一致（AIスコアリング廃止、コスト0）
- **詳細バックフィル**: Geminiで案件詳細を自動抽出・キャッシュ
- **壊れたURL検出**: p-portal汎用URLを検知し自動フィルター
- **ティア制御**: trial=paid（全件表示）、free=5件+ぼかし
- **Stripe決済**: 月額¥2,980サブスク

## ドキュメント

- `SPEC.md` — サービス全体の詳細仕様書
- `DEPLOY.md` — デプロイ手順・環境変数・Stripe/Webhook設定
- `KOUBO_SESSION.md` — 開発セッション履歴
