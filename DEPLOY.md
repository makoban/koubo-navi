# 公募ナビAI - デプロイガイド

## アーキテクチャ

```
[GitHub Pages] → フロントエンド (public/)
[Cloudflare Worker] → API (workers/)
[Supabase] → DB + Auth
[Stripe] → サブスク決済
[Render.com Cron] → バッチ処理 (batch/)
```

## 現在のデプロイ状況

| コンポーネント | URL | 状態 |
|-----------|-----|------|
| Worker | `https://koubo-navi-proxy.ai-fudosan.workers.dev` | デプロイ済み |
| Supabase | `https://ypyrjsdotkeyvzequdez.supabase.co` | テーブル作成済み |
| Stripe テスト商品 | `prod_U1ui6dTf97JnLv` | 作成済み |
| フロントエンド | 未デプロイ（GitHub Pages待ち） | - |
| バッチ | 未デプロイ（Render.com待ち） | - |

## Stripe テスト情報

| 項目 | 値 |
|------|-----|
| テスト商品ID | `prod_U1ui6dTf97JnLv` |
| 月額Price ID (¥2,980) | `price_1T3qtU1TYnppSLqN4aYmJE8G` |
| 年額Price ID (¥29,800) | `price_1T3qtW1TYnppSLqNNXDaSRY9` |
| テスト公開キー | `pk_test_51SlP0L1TYnppSLqN6tbx...` |
| テストカード | 4242 4242 4242 4242 / 任意 |

## Worker secrets（設定済み）

```
GEMINI_API_KEY         → AIzaSy... (設定済み)
STRIPE_SECRET_KEY      → sk_test_... (テストモード、設定済み)
STRIPE_WEBHOOK_SECRET  → whsec_... (Webhook登録後に更新が必要)
SUPABASE_SERVICE_KEY   → sb_secret_... (設定済み)
```

## フロントエンドのデプロイ手順

### GitHub Pages

1. GitHubリポジトリ作成: `makoban/koubo-navi`
2. `public/` 配下のファイルをプッシュ
3. Settings → Pages → Source: `main` → `/public`
4. カスタムドメイン: `koubo-navi.bantex.jp`
5. CNAME レコード追加: `koubo-navi.bantex.jp` → `makoban.github.io`

### 動作確認

```
https://koubo-navi.bantex.jp/
```

## バッチのデプロイ手順（Render.com）

1. Render Dashboard → New → Cron Job
2. GitHub: `makoban/koubo-navi`（batch/ ディレクトリ）
3. Runtime: Python 3
4. Build Command: `pip install -r batch/requirements.txt`
5. Start Command: `python batch/main.py`
6. Schedule: `0 17 * * *` (UTC 17:00 = JST 02:00)
7. Region: Singapore
8. Plan: Starter (~$1/月)

### 環境変数

```
GEMINI_API_KEY=（CLAUDE.mdまたはWorker secretsで確認）
SUPABASE_URL=https://ypyrjsdotkeyvzequdez.supabase.co
SUPABASE_SERVICE_KEY=（CLAUDE.mdまたはWorker secretsで確認）
RESEND_API_KEY=（Resendアカウント作成後に設定）
FROM_EMAIL=公募ナビAI <noreply@bantex.jp>
```

## Stripe Webhook 設定

1. Stripe ダッシュボード → Developers → Webhooks
2. エンドポイント: `https://koubo-navi-proxy.ai-fudosan.workers.dev/api/webhook`
3. 対象イベント:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Webhook Secret を取得
5. Worker secret を更新:
   ```
   echo "whsec_xxxx" | npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## E2E テスト

```bash
cd koubo-navi
node e2e_test.js
```

結果: 45/45 PASS

## 本番移行チェックリスト

- [ ] GitHub リポジトリ作成・Pages 設定
- [ ] カスタムドメイン CNAME 設定
- [ ] Stripe Webhook エンドポイント登録・Secret 更新
- [ ] Stripe 本番 Price ID 作成・wrangler.toml 更新
- [ ] Stripe 本番 Secret Key でWorker secret 更新
- [ ] Render.com Cron Job デプロイ
- [ ] Resend API キー取得・設定
- [ ] bantex.jp 法的ページに公募ナビAI 情報追記
- [ ] 動作確認テスト
