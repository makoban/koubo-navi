# 公募ナビAI v3.1 → v3.2 機能追加仕様書

**作成日**: 2026-02-27
**目的**: 4つの機能改善を実装し、v3.2としてデプロイする

---

## 変更一覧

| # | 機能 | 対象ファイル |
|---|------|-------------|
| 1 | 期限切れ案件の非表示（deadline < today） | workers/index.js |
| 2 | LPヒーローに直近1週間の新着案件数を動的表示 | workers/index.js, public/index.html, public/app.js |
| 3 | 案件一覧にソート機能（締切日/登録日 × 昇順/降順） | workers/index.js, public/app.js, public/style.css |
| 4 | 無料/有料ティア再設計 | workers/index.js, public/app.js |

---

## 1. 期限切れ案件の非表示

### 現状

`workers/index.js:449-451` で既に `deadline < today` を除外している：
```js
if (opp.deadline && opp.deadline < today) return false;
```
ただし `deadline=NULL` の案件（34,167件）は通過してしまう。

### 変更内容

**方針**: deadline が NULL かつ detail_url のページが404の案件は表示しても意味がない。しかし新規取得した案件は deadline=NULL でもまだ生きている可能性がある。

**フィルター条件を変更**:
```js
// 以下のいずれかを満たす案件のみ表示:
// (A) deadline が今日以降
// (B) deadline=NULL かつ scraped_at が直近30日以内（新しいデータ）
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

const allOpps = (oppResult.data || []).filter(opp => {
  if (!opp.detail_url) return false;
  if (BAD_URLS.some(p => opp.detail_url.includes(p))) return false;
  // 期限切れ確定 → 非表示
  if (opp.deadline && opp.deadline < today) return false;
  // deadline不明 かつ 30日以上前のデータ → 非表示
  if (!opp.deadline && opp.scraped_at && opp.scraped_at < thirtyDaysAgo) return false;
  return true;
});
```

**影響**: 表示件数が 43,626 → 約4,600〜5,000件に絞られる。

### DB確認用SQL
```sql
SELECT COUNT(*) FROM opportunities
WHERE (deadline >= CURRENT_DATE)
   OR (deadline IS NULL AND scraped_at >= NOW() - INTERVAL '30 days');
```

---

## 2. LPヒーローに直近1週間の新着案件数

### 現状のLP proof-bar（index.html:60-78）
```html
<div class="proof-bar__number">83+</div>
<div class="proof-bar__label">1エリアの検出案件数</div>
```
→ ハードコードされた静的な数字

### 変更内容

#### 2-1. Worker: 新規APIエンドポイント追加

**`GET /api/stats`**（認証不要・公開API）

```js
async function handleGetStats(env) {
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // 直近1週間の新着件数
  const recentResult = await supabaseRequest(
    `/opportunities?scraped_at=gte.${weekAgo}&deadline=gte.${today}&select=id`,
    "GET", null, env, "head", "count=exact"
  );

  // 有効な案件総数（deadline >= today OR deadline NULL + 直近30日）
  const totalResult = await supabaseRequest(
    `/opportunities?or=(deadline.gte.${today},and(deadline.is.null,scraped_at.gte.${thirtyDaysAgo}))&select=id`,
    "GET", null, env, "head", "count=exact"
  );

  return jsonResponse({
    recent_week: recentResult.count || 0,
    total_active: totalResult.count || 0,
    updated_at: new Date().toISOString(),
  });
}
```

**ルーティング追加**（index.js:990付近）:
```js
if (path === "/api/stats" && method === "GET") return handleGetStats(env);
```

> 注: Supabase REST APIの `Prefer: count=exact` ヘッダーで件数だけ取得する方法を使う。
> `supabaseRequest` 関数にHEADリクエスト対応を追加するか、`&limit=0` + count ヘッダーで対応。

#### 2-2. index.html: proof-barを動的化

```html
<div class="proof-bar__item">
  <div class="proof-bar__number" id="statRecentWeek">--</div>
  <div class="proof-bar__label">直近1週間の新着</div>
</div>
<div class="proof-bar__item">
  <div class="proof-bar__number" id="statTotalActive">--</div>
  <div class="proof-bar__label">募集中の案件</div>
</div>
<div class="proof-bar__item">
  <div class="proof-bar__number">47</div>
  <div class="proof-bar__label">全都道府県対応</div>
</div>
<div class="proof-bar__item">
  <div class="proof-bar__number">毎朝 8:00</div>
  <div class="proof-bar__label">自動メール配信</div>
</div>
```

#### 2-3. app.js: LP表示時にstats取得

```js
// LP表示時に実行（initSupabase後 or DOMContentLoaded）
async function loadLandingStats() {
  try {
    const res = await fetch(`${WORKER_BASE}/api/stats`);
    const data = await res.json();
    const el1 = document.getElementById("statRecentWeek");
    const el2 = document.getElementById("statTotalActive");
    if (el1) el1.textContent = data.recent_week.toLocaleString() + "件";
    if (el2) el2.textContent = data.total_active.toLocaleString() + "件";
  } catch (e) {
    console.warn("stats取得失敗:", e);
  }
}
```

---

## 3. 案件一覧にソート機能

### 現状

`workers/index.js:434` でハードコード:
```js
&order=scraped_at.desc
```
→ 常に登録日の新しい順

### 変更内容

#### 3-1. Worker: sortパラメータ対応

URLパラメータ `sort` を受け付ける:

| sort値 | 意味 | Supabaseクエリ |
|--------|------|---------------|
| `deadline_asc` | 締切が近い順 | `order=deadline.asc.nullslast` |
| `deadline_desc` | 締切が遠い順 | `order=deadline.desc.nullslast` |
| `scraped_asc` | 登録が古い順 | `order=scraped_at.asc` |
| `scraped_desc`（デフォルト） | 登録が新しい順 | `order=scraped_at.desc` |

```js
// handleGetOpportunities内
const sortParam = url.searchParams.get("sort") || "scraped_desc";
const SORT_MAP = {
  "deadline_asc": "deadline.asc.nullslast",
  "deadline_desc": "deadline.desc.nullslast",
  "scraped_asc": "scraped_at.asc",
  "scraped_desc": "scraped_at.desc",
};
const orderClause = SORT_MAP[sortParam] || "scraped_at.desc";
```

クエリの `order=scraped_at.desc` を `order=${orderClause}` に置換。

#### 3-2. app.js: ソートUIとAPI呼び出し

ダッシュボードの案件一覧ヘッダーにセレクトボックスを追加:

```js
// ソート変更時
async function onSortChange(sortValue) {
  // 案件一覧を再取得
  await loadOpportunities({ sort: sortValue });
}
```

#### 3-3. index.html: ソートUI追加

ダッシュボードの案件一覧セクションに:
```html
<div class="sort-controls">
  <label>並び替え:</label>
  <select id="sortSelect" onchange="onSortChange(this.value)">
    <option value="deadline_asc">締切が近い順</option>
    <option value="scraped_desc" selected>新着順</option>
    <option value="deadline_desc">締切が遠い順</option>
    <option value="scraped_asc">登録が古い順</option>
  </select>
</div>
```

#### 3-4. style.css

```css
.sort-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.sort-controls select {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}
```

---

## 4. 無料/有料ティア再設計

### 現状（v3.1）

| ティア | 動作 |
|-------|------|
| free | 5件表示 + 残りぼかし |
| trial | = paid（全件表示、API 100件） |
| paid | 全件表示 |

### 新ティア設計（v3.2）

| 機能 | 無料（free） | 有料（trial/paid） |
|------|------------|------------------|
| 案件一覧（タイトル・組織・カテゴリ） | **全件見れる** | 全件見れる |
| 案件の詳細情報（予算・要件・連絡先等） | **ロック** | 見れる |
| AI詳細分析 | **ロック** | 使える |
| メール配信 | **なし** | あり |
| ソート | 使える | 使える |

### 変更箇所

#### 4-1. Worker: handleGetOpportunities

```js
// 旧: ティアで表示件数を制限
// const tierMaxResults = (isActive || isTrial) ? 100 : 35;

// 新: 全件返すが、freeの場合は詳細フィールドを除外
const isPaid = isActive || isTrial;

items = items.map(item => {
  if (!isPaid) {
    // 無料: 基本情報のみ（詳細をマスク）
    const opp = item.opportunities;
    item.opportunities = {
      id: opp.id,
      title: opp.title,
      organization: opp.organization,
      category: opp.category,
      industry_category: opp.industry_category,
      area_id: opp.area_id,
      deadline: opp.deadline,
      scraped_at: opp.scraped_at,
      detail_url: opp.detail_url,
      // 以下を除外（undefinedになる）
      // budget, requirements, contact_info, detailed_summary,
      // contract_period, bid_opening_date, briefing_date
    };
    item.detailed_analysis = null; // AI分析もマスク
  }
  return item;
});
```

レスポンスに `is_paid` フラグを追加:
```js
return jsonResponse({
  opportunities: items,
  total: items.length,
  total_unfiltered: totalUnfiltered,
  tier,
  is_paid: isPaid,
  // ...
});
```

#### 4-2. Worker: handleAnalyzeOpportunity

```js
// 無料ユーザーはAI分析を拒否
if (!isPaid) {
  return errorResponse("AI詳細分析は有料プランの機能です", 403);
}
```

#### 4-3. app.js: カード表示の分岐

```js
function renderOpportunityCard(item, isPaid) {
  const opp = item.opportunities;

  // 基本情報（全員表示）
  let html = `<div class="card">
    <h3>${opp.title}</h3>
    <span class="badge">${opp.industry_category || ""}</span>
    <p>${opp.organization || ""}</p>
    ${opp.deadline ? `<p>締切: ${opp.deadline}</p>` : ""}
  `;

  if (isPaid) {
    // 有料: 詳細情報を表示
    if (opp.budget) html += `<p>予算: ${opp.budget}</p>`;
    if (opp.contact_info) html += `<p>連絡先: ${opp.contact_info}</p>`;
    if (opp.detailed_summary) html += `<p>${opp.detailed_summary}</p>`;
    html += `<button onclick="analyzeOpportunity('${opp.id}')">AI詳細分析</button>`;
  } else {
    // 無料: ロック表示
    html += `<div class="card__locked">
      <p>予算・要件・連絡先・AI分析は有料プランで閲覧できます</p>
      <button class="btn btn--primary btn--sm" onclick="showPricingModal()">プランを見る</button>
    </div>`;
  }

  html += `</div>`;
  return html;
}
```

#### 4-4. style.css: ロック表示

```css
.card__locked {
  background: linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.03));
  border-top: 1px dashed #ddd;
  padding: 12px;
  margin-top: 8px;
  text-align: center;
  color: #888;
  font-size: 13px;
}
```

---

## 実装手順

```
1. workers/index.js を修正
   - handleGetOpportunities: フィルター強化 + sort対応 + ティア再設計
   - handleAnalyzeOpportunity: 無料ユーザー拒否
   - handleGetStats: 新規追加
   - ルーティングに /api/stats 追加
   → wrangler deploy

2. public/index.html を修正
   - proof-bar を動的ID化
   - ソートUI追加
   - バージョン v3.1 → v3.2

3. public/app.js を修正
   - loadLandingStats() 追加
   - ソート機能（onSortChange, loadOpportunities にsortパラメータ）
   - カード表示のティア分岐（renderOpportunityCard）
   - AI分析ボタンの無料ユーザー制御

4. public/style.css を修正
   - .sort-controls
   - .card__locked

5. git push → GitHub Pages 自動反映
6. E2Eテスト実行
```

---

## バージョン更新箇所（3箇所同時）

1. `public/index.html` ヘッダーバッジ: `<div class="header__badge">v3.2</div>`
2. `public/index.html` フッター: コピーライト年
3. `public/app.js` 冒頭コメント: `// 公募ナビAI v3.2`

---

## DB状態の参考値（2026-02-27時点）

| 指標 | 件数 |
|------|------|
| 全案件 | 43,626 |
| deadline >= today | 4,635 |
| deadline < today（終了） | 4,824 |
| deadline NULL | 34,167 |
| バックフィル済み（詳細あり） | 430 |
| v3.2フィルター後の表示見込み | 約4,600〜5,000 |
