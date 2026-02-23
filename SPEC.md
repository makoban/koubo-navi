# 公募ナビAI — 完全仕様書 v0.1

**作成日**: 2026-02-23
**作成者**: 番野誠（bantex）
**ステータス**: 設計中（MVP策定完了）
**プロトタイプ**: `koubo-navi/` フォルダに試作版 v0.1 あり（動作確認済み）

---

## 目次

1. [サービス概要](#1-サービス概要)
2. [機能仕様](#2-機能仕様)
3. [エリア戦略](#3-エリア戦略)
4. [技術アーキテクチャ](#4-技術アーキテクチャ)
5. [運用設計](#5-運用設計)
6. [リリース計画](#6-リリース計画)
7. [収益モデル](#7-収益モデル)
8. [リスクと対策](#8-リスクと対策)

---

## 1. サービス概要

### 1-1. サービス名・コンセプト

| 項目 | 内容 |
|------|------|
| サービス名 | 公募ナビAI（koubo-navi） |
| キャッチコピー | URLを入れるだけ。あとは寝て待つ。 |
| サブキャッチ | 行政の公募・入札案件を、AIが毎日自動でチェックして通知する |
| ターゲット | 中小企業・フリーランス・士業事務所（行政案件に関心があるが自力でチェックしていない事業者） |
| 価格 | サブスク月額 ¥2,980（税込）/ 年額 ¥29,800（税込・約2ヶ月分お得） |
| ドメイン候補 | koubo-navi.bantex.jp |

### 1-2. サービスの核心価値

**「自分で検索しない」プッシュ型が唯一の差別化軸**

従来の公募・入札情報サービスはポータルサイトに載っている案件を「自分で検索する」プル型が主流。
公募ナビAIは、ユーザーが自社URLを登録するだけで、AIが事業内容を自動理解し、毎日バックグラウンドで案件を探して通知する。

```
従来型: ユーザーが毎日サイトをチェック → 時間と労力がかかる
公募ナビAI: 登録したら終わり → 朝メールを見るだけ
```

### 1-3. ターゲットユーザー詳細

| セグメント | 規模 | ニーズ | 課題 |
|-----------|------|--------|------|
| IT企業（ソフト開発・DX支援） | 2〜20名 | 行政のDX案件 | 案件を探す時間がない |
| 印刷・デザイン会社 | 1〜10名 | 行政の印刷物・広報案件 | どこに公募が出るかわからない |
| 警備・清掃会社 | 5〜50名 | 施設管理委託 | 毎日チェックが面倒 |
| コンサル・士業 | 1〜5名 | 業務委託・調査案件 | 専門分野の案件だけ欲しい |
| 建設・設備会社 | 5〜30名 | 工事・修繕入札 | 自治体ごとにページが違いすぎる |

### 1-4. 競合との差別化

| サービス | 特徴 | 弱点 | 公募ナビAIの優位点 |
|---------|------|------|--------------------|
| NJSS（入札情報速報サービス） | 全国網羅・老舗 | 月額8万円〜、法人向け大規模 | 中小向け低価格 |
| 入札王 | 自治体ページ自動収集 | 自社マッチング機能なし | AIによる自動マッチング |
| JeFFnet | 電子入札対応 | 電子入札業者向け特化 | 登録不要業種にも対応 |
| 自治体HP手動確認 | 無料 | 時間コスト極大 | 自動化・通知 |
| **公募ナビAI** | URL登録だけで完結 | 対応エリア初期は限定的 | 圧倒的な操作簡単さ |

**最大の差別化**: 「自社URLを入れるだけ」で事業内容をAIが自動判断。業種・キーワードを手動設定不要。

---

## 2. 機能仕様

### 2-1. ユーザー登録・初期設定フロー

```
[ランディングページ]
        |
        v
[メールアドレス + パスワードで登録]
  ※ Google OAuth も対応（Supabase Auth）
        |
        v
[Step 1: 会社URLを入力]
  例: https://bantex.jp
  → 「分析中...」スピナー（10〜30秒）
        |
        v
[Step 2: AI分析結果の確認・編集]
  表示内容:
  - 会社名（推定）
  - 事業分野（推定）: 例「AIサービス、デジタルサイネージ販売、パイプベンダー販売」
  - マッチングキーワード（推定、編集可）
  ユーザーは内容を確認し、修正できる
        |
        v
[Step 3: 対応エリアを選択]
  チェックボックスで選択（初期は10〜20自治体）
  例: □ 愛知県  □ 名古屋市  □ 東京都  □ 大阪府  □ 国（省庁）
        |
        v
[Step 4: 通知設定]
  - メール通知: ON/OFF（デフォルトON）
  - 通知時刻: 毎朝8:00（固定、Phase 2でカスタム化）
  - スコア閾値: デフォルト40以上を通知（スライダーで変更可）
        |
        v
[Step 5: サブスク決済（Stripe）]
  月額 ¥2,980 または 年額 ¥29,800
  クレジットカード決済
        |
        v
[登録完了]
  「次の案件チェックは明日朝8:00です。」
  → マイページへ遷移
```

### 2-2. 日次バッチ処理フロー

```
毎日 02:00 (JST) — Render.com Cron Job 起動

┌─────────────────────────────────────────────┐
│  バッチ処理: daily_check.py                    │
└─────────────────────────────────────────────┘
         |
         v
[1] アクティブユーザー一覧取得
    SELECT * FROM users WHERE status='active'
         |
         v
[2] ユーザーごとに並列処理（最大5並列）
    ┌────────────────────────────────┐
    │ [2-1] 登録エリアの公募ページをスクレイピング   │
    │        → opportunities テーブルに保存       │
    │       （既存案件は重複チェックでスキップ）     │
    │                                          │
    │ [2-2] AIマッチング実行                     │
    │        company_profile × opportunities    │
    │        → match_score を計算               │
    │        → user_opportunities に保存         │
    │                                          │
    │ [2-3] 新着案件（score >= threshold）を抽出  │
    │        前回通知日以降の新規案件のみ           │
    │                                          │
    │ [2-4] 通知送信（新着ありの場合のみ）         │
    │        → メール送信                        │
    └────────────────────────────────┘
         |
         v
[3] 処理ログ記録
    batch_logs テーブルに保存
         |
         v
[4] エラーアラート
    処理失敗ユーザーが存在する場合は
    番野誠のメールに管理者通知
```

### 2-3. 通知仕様

#### メール通知（Phase 1 から実装）

**件名**: 「[公募ナビAI] 本日 X件の新着案件があります ― {会社名}」

**本文構成**:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
公募ナビAI 本日の案件レポート
━━━━━━━━━━━━━━━━━━━━━━━━━━━
{会社名} 様 / {日付}

本日の新着案件: X件（スコア40%以上）

━━━ 注目案件 TOP 3 ━━━━━━━━━━━━━━━━

[1] ★★★ マッチ度: 85%
    案件名: ノーコード・ローコードツール運用業務
    発注元: 愛知県 総務部
    締切日: 2026-03-31
    分類: IT / 企画競争
    理由: DX推進・業務効率化に合致。AI導入支援の知見も活用可能。
    詳細: https://www.pref.aichi.jp/...

[2] ★★  マッチ度: 68%
    ...

[3] ★★  マッチ度: 60%
    ...

━━━ その他の案件 ━━━━━━━━━━━━━━━━━━

全 X件の案件をマイページで確認する:
  https://koubo-navi.bantex.jp/dashboard

━━━━━━━━━━━━━━━━━━━━━━━━━━━
通知設定の変更: https://koubo-navi.bantex.jp/settings
配信停止: https://koubo-navi.bantex.jp/unsubscribe
━━━━━━━━━━━━━━━━━━━━━━━━━━━
公募ナビAI by bantex — https://bantex.jp
```

**メール送信方法**: Resend（API経由、無料1日100通）または SendGrid（既存契約ある場合）

#### LINE通知（Phase 2 で実装）

- LINE Notify または LINE Messaging API を使用
- 要約版のみ通知（詳細はマイページへ誘導）
- 「本日 X件の新着案件 → マイページで確認」

### 2-4. マイページ機能仕様

#### ダッシュボード（トップ）

- 本日の新着案件数バッジ
- 今週のマッチ件数グラフ
- 直近 7日間の注目案件リスト（スコア順）

#### 案件一覧ページ

| 機能 | 詳細 |
|------|------|
| フィルター | スコア範囲・発注元・カテゴリ・締切日 |
| ソート | スコア順・締切順・新着順 |
| 案件カード | タイトル・スコア・発注元・締切・理由・詳細URL |
| 期間 | 過去30日分を表示（Phase 2で90日に拡張） |

#### プロフィール編集

- 会社URL（変更可。再分析ボタンあり）
- マッチングキーワード（手動追加・削除可）
- 対応エリア選択（チェックボックス）
- スコア閾値調整（スライダー）
- 通知メール設定（ON/OFF・時刻）

#### 支払い・プラン

- 現在のプラン表示
- 次回請求日
- プラン変更（月額↔年額）
- 解約ボタン（Stripe Customer Portal）

---

## 3. エリア戦略

### 3-1. 初期対応エリアの選択基準

MVP では保守の安定性を優先し、以下の基準でエリアを選定する。

1. **行政ページが安定している**（更新頻度が高すぎず、URL変更リスクが低い）
2. **テキスト形式で案件一覧が掲載されている**（PDF専用、ログイン必須は除外）
3. **bantexのビジネスエリアと重なる**（愛知・東京・大阪を優先）
4. **1都道府県で複数の案件が取れる**（3ソース以上が望ましい）

### 3-2. 推奨初期エリア（MVP: 5エリア・12ソース）

| エリアID | エリア名 | データソース数 | 主なURL | 優先度 |
|---------|---------|-------------|---------|--------|
| `aichi` | 愛知県 | 3 | pref.aichi.jp / city.nagoya.jp / moj.go.jp | 最高（動作確認済） |
| `tokyo` | 東京都 | 3 | zaimu.metro.tokyo.lg.jp + 中央省庁2 | 高（市場規模最大） |
| `osaka` | 大阪府 | 2 | pref.osaka.jp / city.osaka.lg.jp | 高（第2の市場） |
| `national` | 国（省庁） | 2 | 各省庁調達情報ページ | 中（IT・コンサル向け） |
| `kanagawa` | 神奈川県 | 2 | pref.kanagawa.jp / city.yokohama.jp | 中（関東補完） |

**合計**: 5エリア・12ソース・推定 200〜400件/日

### 3-3. エリア拡大タイムライン

```
Phase 1（MVP）: 5エリア・12ソース（上記）
  └─ 愛知・東京・大阪・国・神奈川

Phase 2（6ヶ月後）: 13エリア・30ソース
  └─ + 福岡・北海道・宮城・埼玉・千葉・広島・京都・兵庫

Phase 3（1年後）: 全国47都道府県対応
  └─ 主要政令指定都市（20市）を追加
  └─ 電子入札システム（CALS/EC）との連携検討

Phase 4（2年後）: 全国1,700自治体
  └─ 収益が安定してから着手（保守コスト増大に注意）
```

### 3-4. データソース管理方法

#### エリア設定ファイル（`areas.json`）をDB管理

```json
{
  "aichi": {
    "name": "愛知県",
    "active": true,
    "sources": [
      {
        "id": "aichi-pref-main",
        "name": "愛知県 入札・契約・公売情報",
        "url": "https://www.pref.aichi.jp/life/5/19/",
        "active": true,
        "last_checked": "2026-02-23T02:00:00Z",
        "last_success": "2026-02-23T02:00:00Z",
        "consecutive_failures": 0,
        "notes": ""
      }
    ]
  }
}
```

#### URL変更検知の仕組み

- 連続3回失敗（`consecutive_failures >= 3`）でSlackアラートを送信
- 管理画面（bantex内部用）からURLを変更できるようにする
- 定期的な手動確認: 月1回、全ソースURLの死活チェックを実施

---

## 4. 技術アーキテクチャ

### 4-1. システム構成図

```
┌─────────────────────────────────────────────────────────┐
│  フロントエンド（GitHub Pages + カスタムドメイン）          │
│  koubo-navi.bantex.jp                                    │
│  HTML + CSS + Vanilla JS（ai-fudosanと同一スタック）       │
└───────────────┬─────────────────────────────────────────┘
                │ HTTPS API
                v
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker（APIゲートウェイ）                      │
│  koubo-navi-proxy.bantex.workers.dev                     │
│  ・認証（JWT検証）                                        │
│  ・会社分析API呼び出し中継                                 │
│  ・Stripe Checkout作成                                    │
│  ・Webhook受信（サブスク開始/解約）                        │
└───────────────┬─────────────────────────────────────────┘
                │
     ┌──────────┼──────────────┐
     v          v              v
┌─────────┐ ┌──────────┐ ┌────────────────────────────────┐
│ Supabase │ │  Stripe  │ │ Render.com（バッチ処理）         │
│  Auth    │ │  決済    │ │  daily_check.py (Cron: 02:00)  │
│  DB      │ │          │ │  ・スクレイピング                 │
│  PGSQL   │ │          │ │  ・Gemini AIマッチング           │
└─────────┘ └──────────┘ │  ・メール通知（Resend）           │
                          └─────────────┬──────────────────┘
                                        │ REST API
                                        v
                          ┌─────────────────────────────────┐
                          │ Gemini 2.0 Flash API（Google）   │
                          │  ・会社分析                       │
                          │  ・案件抽出                       │
                          │  ・マッチング判定                  │
                          └─────────────────────────────────┘
```

### 4-2. データベース設計（Supabase PostgreSQL）

#### テーブル一覧

| テーブル名 | 用途 | レコード数目安 |
|-----------|------|-------------|
| `users` | ユーザー基本情報 | 〜1,000 |
| `company_profiles` | 会社分析結果（JSON） | users と 1:1 |
| `user_areas` | ユーザーごとのエリア設定 | users × areas |
| `opportunities` | スクレイピングした公募案件 | 〜50,000/年 |
| `user_opportunities` | ユーザーごとのマッチング結果 | 〜500,000/年 |
| `notifications` | 通知送信履歴 | 〜365,000/年 |
| `batch_logs` | バッチ処理ログ | 〜365/年 |
| `area_sources` | エリア・データソース定義 | 〜100 |
| `subscriptions` | Stripeサブスク情報 | users と 1:1 |

#### DDL（主要テーブル）

```sql
-- ユーザー基本情報
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  company_url TEXT NOT NULL,
  notification_email TEXT,
  notification_threshold INTEGER DEFAULT 40,  -- スコア閾値(%)
  notification_time TEXT DEFAULT '08:00',     -- 通知時刻(HH:MM, JST)
  email_notify BOOLEAN DEFAULT true,
  line_notify BOOLEAN DEFAULT false,
  line_user_id TEXT,
  status TEXT DEFAULT 'active',  -- active/paused/cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会社プロフィール（AI分析結果）
CREATE TABLE company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT,
  location TEXT,
  business_areas TEXT[],
  services TEXT[],
  strengths TEXT[],
  target_industries TEXT[],
  qualifications TEXT[],
  matching_keywords TEXT[],
  raw_analysis JSONB,   -- Gemini の生レスポンス
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ユーザーごとのエリア設定
CREATE TABLE user_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL,   -- 例: 'aichi', 'tokyo'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, area_id)
);

-- スクレイピング済み公募案件（全ユーザー共通キャッシュ）
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  organization TEXT,
  category TEXT,
  method TEXT,
  deadline DATE,
  budget TEXT,
  summary TEXT,
  requirements TEXT,
  detail_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  -- 重複チェック用: 同一ソース・同一タイトルは1件だけ保持
  UNIQUE(source_id, title)
);

CREATE INDEX idx_opportunities_area_scraped
  ON opportunities(area_id, scraped_at DESC);

-- ユーザーごとのマッチング結果
CREATE TABLE user_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL,  -- 0-100
  match_reason TEXT,
  risk_notes TEXT,
  recommendation TEXT,
  action_items TEXT[],
  is_notified BOOLEAN DEFAULT false,
  notified_at TIMESTAMPTZ,
  is_bookmarked BOOLEAN DEFAULT false,
  is_dismissed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, opportunity_id)
);

CREATE INDEX idx_user_opp_score
  ON user_opportunities(user_id, match_score DESC);
CREATE INDEX idx_user_opp_notified
  ON user_opportunities(user_id, is_notified, created_at DESC);

-- 通知送信履歴
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,  -- 'email' / 'line'
  status TEXT NOT NULL,   -- 'sent' / 'failed' / 'skipped'
  opportunities_count INTEGER,
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- バッチ実行ログ
CREATE TABLE batch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  users_processed INTEGER DEFAULT 0,
  opportunities_scraped INTEGER DEFAULT 0,
  matches_created INTEGER DEFAULT 0,
  notifications_sent INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  error_details JSONB,
  status TEXT DEFAULT 'running'  -- 'running' / 'completed' / 'failed'
);

-- エリア・データソース定義（管理テーブル）
CREATE TABLE area_sources (
  id TEXT PRIMARY KEY,  -- 例: 'aichi-pref-main'
  area_id TEXT NOT NULL,
  area_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  url TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  consecutive_failures INTEGER DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stripeサブスク情報
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  plan TEXT NOT NULL,      -- 'monthly' / 'yearly'
  status TEXT NOT NULL,    -- 'active' / 'past_due' / 'cancelled'
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

#### RLS（Row Level Security）設定

```sql
-- users: 自分のレコードのみ参照・更新可
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own ON users
  USING (id = auth.uid());

-- company_profiles: 自分のレコードのみ
ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_own ON company_profiles
  USING (user_id = auth.uid());

-- user_opportunities: 自分のマッチング結果のみ
ALTER TABLE user_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY uo_own ON user_opportunities
  USING (user_id = auth.uid());

-- opportunities: 全ユーザー読み取り可（認証済みユーザーのみ）
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY opp_authenticated ON opportunities
  FOR SELECT USING (auth.role() = 'authenticated');
```

### 4-3. Cloudflare Worker API設計

**Worker名**: `koubo-navi-proxy`
**Worker URL**: `https://koubo-navi-proxy.bantex.workers.dev`

| エンドポイント | メソッド | 認証 | 概要 |
|-------------|---------|------|------|
| `/api/analyze-company` | POST | JWT必須 | 会社URL分析（Gemini呼び出し） |
| `/api/areas` | GET | JWT必須 | 利用可能エリア一覧取得 |
| `/api/user/profile` | GET | JWT必須 | ユーザーのプロフィール取得 |
| `/api/user/profile` | PUT | JWT必須 | プロフィール更新（URL再分析含む） |
| `/api/user/areas` | PUT | JWT必須 | エリア設定更新 |
| `/api/user/opportunities` | GET | JWT必須 | マッチング案件一覧取得 |
| `/api/user/opportunities/:id/bookmark` | PUT | JWT必須 | ブックマーク切り替え |
| `/api/user/opportunities/:id/dismiss` | PUT | JWT必須 | 案件を非表示にする |
| `/api/checkout` | POST | JWT必須 | Stripe Checkout作成 |
| `/api/webhook` | POST | 署名検証 | Stripe Webhook受信 |
| `/api/user/subscription` | GET | JWT必須 | サブスク情報取得 |

#### `/api/analyze-company` リクエスト/レスポンス

```json
// Request
POST /api/analyze-company
Authorization: Bearer {jwt}
{
  "url": "https://bantex.jp"
}

// Response 200
{
  "company_name": "株式会社バンテックス",
  "location": "愛知県名古屋市天白区",
  "business_areas": ["AIサービス", "デジタルサイネージ販売", "パイプベンダー販売"],
  "services": ["AI導入支援", "カスタムAIソリューション", "DX推進"],
  "strengths": ["3分野を横断する総合プロデュース力"],
  "matching_keywords": ["AI導入支援", "DX推進", "デジタルサイネージ", "業務効率化"],
  "qualifications": []
}
```

#### `/api/user/opportunities` クエリパラメータ

```
GET /api/user/opportunities
  ?score_min=40       # スコア下限（デフォルト40）
  &score_max=100      # スコア上限（デフォルト100）
  &category=IT        # カテゴリフィルター（省略可）
  &area=aichi         # エリアフィルター（省略可）
  &sort=score         # score / deadline / created_at
  &limit=50           # 件数（デフォルト50）
  &offset=0           # ページング
  &days=30            # 過去N日分（デフォルト30）
```

### 4-4. バッチ処理設計（Render.com Cron Job）

#### ファイル構成

```
koubo-navi-batch/
├── main.py              # エントリポイント（バッチ制御）
├── daily_check.py       # 日次バッチのメインロジック
├── company_analyzer.py  # 会社分析（プロトタイプから移植）
├── gov_scraper.py       # スクレイピング（プロトタイプから移植）
├── matcher.py           # AIマッチング（プロトタイプから移植）
├── notifier.py          # メール通知（Resend API）
├── db.py                # Supabase DB操作
├── config.py            # 設定・エリア定義（拡張版）
├── areas.json           # エリア・ソースURL定義
├── requirements.txt
└── Procfile             # Render.com用
```

#### `daily_check.py` 主要ロジック（擬似コード）

```python
def run_daily_batch():
    log = BatchLog.start()

    # 1. アクティブユーザー取得
    users = db.get_active_users()  # status='active', subscription.status='active'

    # 2. 今日スクレイピングが必要なエリアを特定（全ユーザーの和集合）
    required_areas = set()
    for user in users:
        required_areas.update(user.active_area_ids)

    # 3. エリアごとにスクレイピング（重複なし）
    area_opportunities = {}
    for area_id in required_areas:
        opps = scrape_area(area_id)                     # gov_scraper.py
        saved_opps = db.upsert_opportunities(opps)      # 重複チェック込みで保存
        area_opportunities[area_id] = saved_opps
        log.opportunities_scraped += len(saved_opps)

    # 4. ユーザーごとにマッチング
    for user in users:
        user_opps = []
        for area_id in user.active_area_ids:
            user_opps.extend(area_opportunities.get(area_id, []))

        if not user_opps:
            continue

        # マッチング実行（プロトタイプの matcher.py を使用）
        matches = match_opportunities(user.company_profile, user_opps)
        db.save_user_opportunities(user.id, matches)
        log.matches_created += len(matches)

        # 5. 通知対象案件を抽出（スコア閾値以上 && 未通知）
        to_notify = [
            m for m in matches
            if m['match_score'] >= user.notification_threshold
            and not db.is_notified(user.id, m['opportunity_id'])
        ]

        if to_notify and user.email_notify:
            send_email_notification(user, to_notify)    # notifier.py
            db.mark_as_notified(user.id, [m['opportunity_id'] for m in to_notify])
            log.notifications_sent += 1

    log.finish(status='completed')
```

#### Render.com設定

| 項目 | 値 |
|------|-----|
| Service Type | Cron Job |
| Repository | makoban/koubo-navi-batch (Private) |
| Runtime | Python 3.11 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `python main.py` |
| Schedule | `0 17 * * *`（UTC 17:00 = JST 02:00） |
| Region | Singapore（bantex-tweet-botと同じ） |
| Plan | Starter（〜$1/月） |

#### 環境変数（Render.com）

| 変数名 | 内容 |
|--------|------|
| `DATABASE_URL` | Supabase PostgreSQL 接続URL |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase Service Role Key（RLSバイパス） |
| `GEMINI_API_KEY` | Gemini API Key |
| `RESEND_API_KEY` | Resend メール送信APIキー |
| `ADMIN_EMAIL` | エラー通知先メール（番野誠） |

---

## 5. 運用設計

### 5-1. 日次処理スケジュール

| 時刻（JST） | 処理 |
|------------|------|
| 02:00 | バッチ開始（スクレイピング + マッチング） |
| 02:00〜04:00 | ユーザー数×エリア数に応じた処理時間（推定） |
| 08:00 | メール通知送信（バッチ完了後に配信） |

**推定処理時間（ユーザー100人、エリア5、ソース12の場合）**:

- スクレイピング: 12ソース × 30秒 = 約6分
- AIマッチング: 100ユーザー × 200件 / 15件バッチ = 1,333回API呼び出し
  - 推定: 1ユーザー約2分30秒 → 100ユーザーを5並列で処理 → 約50分
- 合計: 約1時間以内（02:00〜03:00に収まる見込み）

### 5-2. コスト試算

| 項目 | 単価 | ユーザー100人/月のコスト |
|------|------|----------------------|
| Gemini 2.0 Flash API | 〜¥1/ユーザー/日 | 〜¥3,000/月 |
| Render.com Cron | $1/月 | 〜¥150/月 |
| Supabase | Free（500MB以内） | ¥0 |
| Cloudflare Worker | Free（100,000req/日） | ¥0 |
| Resend メール | Free（3,000通/月） | ¥0〜 |
| GitHub Pages | Free | ¥0 |
| **合計** | | **〜¥3,150/月** |

**100ユーザー時の収支**:
- 収入: ¥2,980 × 100 = ¥298,000/月
- 原価: ¥3,150/月（Gemini + Render）
- Stripe手数料: ¥298,000 × 3.6% = ¥10,728/月
- **粗利: 約¥284,000/月（粗利率 約95%）**

### 5-3. エラー監視・アラート

#### アラート送信条件

| 条件 | アラート先 | 重大度 |
|------|-----------|--------|
| バッチ全体が失敗 | 番野誠のメール | Critical |
| スクレイピング連続3回失敗（特定ソース） | 番野誠のメール | Warning |
| Gemini API 呼び出しエラー率 > 20% | 番野誠のメール | Warning |
| 通知メール送信失敗 | ログ記録のみ | Info |
| Stripe Webhook受信失敗 | ログ記録 + メール | Warning |

#### アラートメール形式（管理者向け）

```
件名: [公募ナビAI] CRITICAL: バッチ処理が失敗しました (2026-02-23)

エラー内容:
  TypeError: 'NoneType' object is not iterable
  at daily_check.py line 87

影響ユーザー数: 23名（通知未送信）

バッチログID: batch_xxxxx
詳細: Supabase batch_logs テーブルを確認してください
```

### 5-4. スクレイピングURL変更時の対応フロー

```
[検知] スクレイピングが3回連続失敗
    |
    v
[自動] 番野誠のメールにアラート送信
    |
    v
[手動] 対象の行政サイトにアクセスして新URLを確認
    |
    v
[手動] area_sources テーブルの url カラムを更新
  例: UPDATE area_sources SET url='新URL', consecutive_failures=0
      WHERE id='aichi-pref-main';
    |
    v
[確認] 次回バッチ実行で正常稼働を確認
```

Phase 2以降では管理画面からURL変更ができるように改善する。

---

## 6. リリース計画

### 6-1. MVP（最小限の製品）の範囲

**MVP の定義**: 「1社のユーザーが登録から通知受信まで完結できる状態」

| 機能 | MVP | Phase 2 | Phase 3 |
|------|-----|---------|---------|
| メール＋PW登録 | ◯ | | |
| Google OAuth | | ◯ | |
| URL入力→会社分析 | ◯ | | |
| プロフィール確認・編集 | ◯ | | |
| エリア選択（5エリア） | ◯ | | |
| Stripe月額サブスク | ◯ | | |
| Stripe年額サブスク | | ◯ | |
| 日次バッチ（スクレイピング+マッチング） | ◯ | | |
| メール通知 | ◯ | | |
| LINE通知 | | ◯ | |
| マイページ（案件一覧） | ◯ | | |
| フィルター・ソート | ◯（基本のみ） | ◯（詳細） | |
| ブックマーク機能 | | ◯ | |
| 案件非表示機能 | | ◯ | |
| プロフィール再分析 | | ◯ | |
| 対応エリア（エリア数） | 5エリア | 13エリア | 47都道府県 |
| 管理画面（内部用） | | ◯ | |
| LINE通知 | | ◯ | |
| 案件スコア調整（AI学習） | | | ◯ |
| チームプラン | | | ◯ |

### 6-2. フェーズ別ロードマップ

#### Phase 1: MVP（4〜6週間）

**目標**: 最初の有料ユーザー10名獲得

| 週 | 作業内容 |
|----|---------|
| 1週目 | Supabase DB作成・Cloudflare Worker基礎実装・フロントエンド骨格 |
| 2週目 | 会社分析API・エリア選択・Stripe決済フロー |
| 3週目 | バッチ処理（daily_check.py）・Resendメール通知 |
| 4週目 | マイページ・プロフィール編集・E2Eテスト |
| 5週目 | LP（ランディングページ）作成・Google Ads設定 |
| 6週目 | ベータユーザー招待（5〜10名）・フィードバック収集 |

**Phase 1 完了の定義**:
- 登録から通知受信まで手動ガイドなしで完結できる
- 有料ユーザーが1名以上いる
- バッチが7日間連続正常稼働している

#### Phase 2: 成長期（3〜6ヶ月）

**目標**: 有料ユーザー100名・MRR ¥298,000

- LINE通知の実装
- エリア拡大（5→13エリア）
- 年額プランの追加
- 管理画面の構築（URL変更・ユーザー管理）
- Google Ads本格稼働

#### Phase 3: 拡張期（6〜12ヶ月）

**目標**: 有料ユーザー300名・MRR ¥900,000

- 全国47都道府県対応
- ブックマーク・非表示機能
- スコア閾値の自動最適化（フィードバック学習）
- チームプラン（複数担当者）
- 他のbantexサービスとのクロスセル

### 6-3. LP（ランディングページ）構成案

```
[ヒーロー]
  キャッチ: URLを入れるだけ。あとは寝て待つ。
  サブ: 行政の公募・入札案件を、AIが毎日自動でチェック
  CTA: 無料で始める（14日間無料トライアル）

[3ステップ説明]
  Step 1: 会社URLを入力するだけ
  Step 2: AIが事業内容を自動理解
  Step 3: 毎朝、ぴったりの案件をメールでお届け

[実績・数字]
  対応エリア: 5エリア
  登録データソース: 12
  マッチング精度: 最高75%

[通知サンプル]
  実際のメール通知イメージを画像で表示

[料金]
  月額 ¥2,980（税込）
  年額 ¥29,800（税込）
  14日間無料トライアル

[FAQ]
  Q: 自分で調べなくていいの？
  Q: どんな案件が届くの？
  Q: 解約はいつでもできる？

[CTA]
  今すぐ無料登録
```

---

## 7. 収益モデル

### 7-1. 価格設定の根拠

| 比較対象 | 価格 | 公募ナビAIとの比較 |
|---------|------|-----------------|
| NJSS（法人向け） | ¥80,000〜/月 | 1/27の価格 |
| 入札王（中小向け） | ¥9,800/月 | 1/3の価格 |
| 社員が手動確認（機会コスト） | ¥50,000〜/月相当 | 1/17の価格 |
| **公募ナビAI** | ¥2,980/月 | 最安・最シンプル |

月額¥2,980は「ランチ1回分の価格で行政案件チェックを自動化」という訴求が可能。
初期ユーザー獲得のための低価格設定。100名到達後に¥4,980への値上げを検討。

### 7-2. 収益シミュレーション

| ユーザー数 | MRR | 年間収益 | 原価 | 純利益 |
|-----------|-----|---------|------|--------|
| 10名 | ¥29,800 | ¥357,600 | ¥315 | ¥28,815/月 |
| 50名 | ¥149,000 | ¥1,788,000 | ¥1,575 | ¥141,917/月 |
| 100名 | ¥298,000 | ¥3,576,000 | ¥3,150 | ¥283,550/月 |
| 300名 | ¥894,000 | ¥10,728,000 | ¥9,450 | ¥849,621/月 |

※ Stripe手数料3.6%・消費税考慮済み

### 7-3. 無料トライアル設計

- **14日間無料**（クレジットカード登録必須）
- トライアル期間中も全機能利用可能
- 14日後に自動課金開始（キャンセル通知メールを3日前・1日前に送信）
- Stripeの `trial_period_days: 14` で実装可能

---

## 8. リスクと対策

### 8-1. 技術リスク

| リスク | 発生確率 | 影響度 | 対策 |
|--------|---------|--------|------|
| 行政ページのURL変更 | 高 | 中 | 自動検知アラート + 月次手動確認 |
| Gemini API コスト増大 | 中 | 高 | BATCH_SIZE調整 + スコア低案件のスキップ |
| スクレイピング禁止（robots.txt改訂） | 低 | 高 | 利用規約確認・User-Agent明記・delay追加 |
| Render.com Cron 実行失敗 | 中 | 中 | リトライ機構 + アラートメール |
| Supabase Free枠超過 | 中 | 低 | ユーザー100名で $25/月のPro移行 |

### 8-2. ビジネスリスク

| リスク | 発生確率 | 影響度 | 対策 |
|--------|---------|--------|------|
| 競合（NJSS等）が低価格プランを出す | 低 | 高 | 「操作の簡単さ」という差別化を維持 |
| AI精度が低く解約される | 中 | 高 | プロンプト改善・スコアキャリブレーション |
| 行政入札が電子入札のみになる | 低 | 中 | 電子入札システムのAPI連携を検討 |
| スパム扱いでメール到達率低下 | 低 | 高 | Resendの送信ドメイン設定・SPF/DKIM設定 |

### 8-3. 法的考慮事項

- **スクレイピングの適法性**: 行政ページは一般公開情報。非商業的利用の範囲。公序良俗に反しない形で実施。
- **個人情報**: 法人情報のみ扱う。個人情報保護法の対象外。
- **著作権**: 案件情報は事実の羅列であり著作物性が低い。要約・整形して提供するため問題なし。
- **利用規約への記載**: 「AI分析の精度は保証しない。最終判断はユーザー自身が行うこと」を明記。

---

## Appendix A: プロトタイプの動作実績

プロトタイプ（`koubo-navi/` フォルダ）を bantex.jp で動作確認した結果:

| 項目 | 実績 |
|------|------|
| 対象URL | https://bantex.jp |
| 分析エリア | 愛知県（3ソース） |
| 検出案件数 | **83件** |
| 最高マッチスコア | **75%**（ノーコード・ローコードツール案件） |
| 処理時間 | **約2分30秒** |
| Gemini API呼び出し回数 | **9回** |
| 推定コスト/回 | **¥5〜10** |

**注目のマッチング結果（Top 3）**:

1. 「ノーコード・ローコードツール運用業務企画提案」愛知県 — 75% (IT/企画競争)
2. 「会計書類の電子化」会計局管理課 — 75% (その他/不明)
3. AI・DX関連案件が上位を占めている

→ この精度はMVPとして十分実用的。

---

## Appendix B: Gemini API コスト詳細試算

**条件**: ユーザー100名、エリア5（ソース12）、1エリア平均70件/ソース

| 処理 | 1回あたりトークン | 1日のAPI呼び出し回数 | 1日のコスト |
|------|-----------------|-------------------|-----------|
| 案件抽出（ソースごと） | 〜8,000 input + 2,000 output | 12回 | 〜¥6 |
| マッチング（ユーザー×バッチ） | 〜5,000 input + 3,000 output | 100ユーザー × 6バッチ = 600回 | 〜¥60 |
| 会社分析（新規登録時のみ） | 〜5,000 input + 1,000 output | 〜5回（新規登録） | 〜¥1 |
| **1日合計** | | | **〜¥67** |
| **1ヶ月合計** | | | **〜¥2,010** |

Gemini 2.0 Flash は入力¥0.075/1Mトークン、出力¥0.30/1Mトークン（2026年2月時点）。

---

## Appendix C: bantexサービス展開との関連

| サービス | 対象 | 価格 | 共通インフラ |
|---------|------|------|-----------|
| ai-fudosan | 不動産事業者 | ¥300/回 | Stripe、Supabase、Worker、Gemini |
| ai-shoken | 店舗出店検討者 | ¥300/回 | 同上 |
| 公募ナビAI | 行政案件受注希望企業 | ¥2,980/月 | 同上 + Render.com Cron |

**クロスセルの可能性**: ai-fudosanユーザー（不動産業者）に対して公募ナビAIを「行政の不動産整備案件を自動通知」として訴求できる。

---

*最終更新: 2026-02-23*
*次回更新タイミング: Phase 1 MVP実装開始時*
