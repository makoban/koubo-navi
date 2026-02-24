/**
 * koubo-navi-proxy - Cloudflare Worker
 *
 * Routes:
 *   POST /api/analyze-company       - 会社URL分析（Gemini API）
 *   GET  /api/areas                  - 利用可能エリア一覧
 *   GET  /api/user/profile           - ユーザープロフィール取得
 *   PUT  /api/user/profile           - プロフィール更新
 *   PUT  /api/user/areas             - エリア設定更新
 *   GET  /api/user/opportunities     - マッチング案件一覧
 *   POST /api/opportunity/analyze    - AI詳細分析
 *   GET  /api/user/subscription      - サブスク情報取得
 *   POST /api/checkout               - Stripe Checkout（サブスク）
 *   POST /api/webhook                - Stripe Webhook（サブスク）
 *   POST /api/cancel-subscription    - サブスク解約
 *   POST /api/user/screen             - 初期30日スクリーニング
 *
 * Required secrets (wrangler secret put):
 *   GEMINI_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_KEY
 *
 * Required vars (wrangler.toml [vars]):
 *   SUPABASE_URL, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const STRIPE_API_BASE = "https://api.stripe.com/v1";

const ALLOWED_ORIGINS = [
  "https://koubo-navi.bantex.jp",
  "https://makoban.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function buildCorsHeaders() {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, stripe-signature");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function addCorsOrigin(response, origin) {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return response;
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

function jsonResponse(data, status = 200) {
  const h = buildCorsHeaders();
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}

function handleOptions() {
  return new Response(null, { status: 204, headers: buildCorsHeaders() });
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function supabaseRequest(path, method, body, env, options = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": options.prefer || "return=representation",
    ...options.headers,
  };
  const fetchOptions = { method, headers };
  if (body) fetchOptions.body = JSON.stringify(body);
  const response = await fetch(url, fetchOptions);
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

async function getUserFromJWT(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { user_id: null, email: null };
  const token = authHeader.slice(7);
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": env.SUPABASE_SERVICE_KEY,
      },
    });
    if (!res.ok) return { user_id: null, email: null };
    const user = await res.json();
    const userId = user.id || null;
    if (userId && !UUID_REGEX.test(userId)) return { user_id: null, email: null };
    return { user_id: userId, email: user.email || null };
  } catch {
    return { user_id: null, email: null };
  }
}

// ---------------------------------------------------------------------------
// Stripe helpers
// ---------------------------------------------------------------------------

async function stripeRequest(path, method, body, env) {
  const options = {
    method,
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
  };
  if (body) options.body = body.toString();
  const response = await fetch(`${STRIPE_API_BASE}${path}`, options);
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

// ---------------------------------------------------------------------------
// POST /api/analyze-company
// ---------------------------------------------------------------------------

async function handleAnalyzeCompany(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse("不正なJSON", 400); }

  const { url: companyUrl, text: companyText } = body;
  if (!companyUrl && !companyText) return errorResponse("url または text のいずれかは必須です", 400);
  if (companyText && typeof companyText === "string" && companyText.trim().length < 50) {
    return errorResponse("テキストは50文字以上入力してください", 400);
  }

  // 1. ページテキストを取得（URLモード）またはテキストをそのまま使用
  let pageText;
  let inputMode;
  if (companyText && typeof companyText === "string" && companyText.trim().length >= 50) {
    // テキスト入力モード
    pageText = companyText.trim().slice(0, 30000);
    inputMode = "text";
  } else {
    // URL入力モード
    if (!companyUrl || typeof companyUrl !== "string") return errorResponse("url は必須です", 400);
    inputMode = "url";
    try {
      const resp = await fetch(companyUrl, {
        headers: { "User-Agent": "KouboNavi/1.0 (bantex.jp)" },
        redirect: "follow",
      });
      if (!resp.ok) return errorResponse(`サイト取得エラー: HTTP ${resp.status}`, 502);
      const html = await resp.text();
      pageText = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 30000);
    } catch (err) {
      return errorResponse(`サイト取得失敗: ${err.message}`, 502);
    }
  }

  // 2. Gemini で分析
  const sourceDesc = inputMode === "url"
    ? "以下はある会社のウェブサイトのテキスト内容です。"
    : "以下はある会社の事業内容の自由記述です。";
  const prompt = `${sourceDesc}
この会社の事業内容・強み・対応可能な業務を分析し、JSON形式で出力してください。

出力フォーマット:
{
  "company_name": "会社名",
  "location": "所在地",
  "business_areas": ["事業分野1", "事業分野2"],
  "services": ["提供サービス1", "提供サービス2"],
  "strengths": ["強み1", "強み2"],
  "target_industries": ["対象業界1"],
  "qualifications": ["保有資格（推定）"],
  "matching_keywords": ["公募マッチング用キーワード1", "キーワード2"]
}

matching_keywordsには行政案件を見つけるためのキーワードを10個以上生成してください。

ウェブサイトテキスト:
${pageText}`;

  const geminiUrl = `${GEMINI_API_BASE}/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  let geminiResp;
  try {
    geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    });
  } catch (err) {
    return errorResponse(`Gemini API接続失敗: ${err.message}`, 502);
  }

  const geminiData = await geminiResp.json();
  if (!geminiResp.ok) return jsonResponse({ error: "Gemini APIエラー", detail: geminiData }, geminiResp.status);

  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let profile;
  try { profile = JSON.parse(text); } catch { profile = {}; }
  if (Array.isArray(profile)) profile = profile[0] || {};

  // 3. DB に保存
  await supabaseRequest(
    `/company_profiles?user_id=eq.${user_id}`,
    "DELETE", null, env, { prefer: "return=minimal" }
  );
  await supabaseRequest("/company_profiles", "POST", {
    user_id,
    company_name: profile.company_name || null,
    location: profile.location || null,
    business_areas: profile.business_areas || [],
    services: profile.services || [],
    strengths: profile.strengths || [],
    target_industries: profile.target_industries || [],
    qualifications: profile.qualifications || [],
    matching_keywords: profile.matching_keywords || [],
    raw_analysis: profile,
  }, env, { prefer: "return=minimal" });

  return jsonResponse(profile);
}

// ---------------------------------------------------------------------------
// GET /api/areas
// ---------------------------------------------------------------------------

async function handleAreas(request, env) {
  const result = await supabaseRequest(
    "/area_sources?active=eq.true&select=id,area_id,area_name,source_name&order=area_id",
    "GET", null, env
  );
  if (!result.ok) return errorResponse("エリア取得失敗", 500);

  // area_id でグルーピング
  const grouped = {};
  for (const src of (result.data || [])) {
    if (!grouped[src.area_id]) {
      grouped[src.area_id] = { area_id: src.area_id, area_name: src.area_name, sources: [] };
    }
    grouped[src.area_id].sources.push({ id: src.id, name: src.source_name });
  }

  return jsonResponse({ areas: Object.values(grouped) });
}

// ---------------------------------------------------------------------------
// GET/PUT /api/user/profile
// ---------------------------------------------------------------------------

async function handleGetProfile(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  // koubo_users + company_profiles を取得
  const userResult = await supabaseRequest(
    `/koubo_users?id=eq.${user_id}&select=*`,
    "GET", null, env
  );
  const profileResult = await supabaseRequest(
    `/company_profiles?user_id=eq.${user_id}&select=*`,
    "GET", null, env
  );
  const areasResult = await supabaseRequest(
    `/user_areas?user_id=eq.${user_id}&active=eq.true&select=area_id`,
    "GET", null, env
  );

  const user = userResult.data?.[0] || null;
  const profile = profileResult.data?.[0] || null;
  const areas = (areasResult.data || []).map(a => a.area_id);

  return jsonResponse({ user, profile, areas });
}

async function handlePutProfile(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse("不正なJSON", 400); }

  const updates = {};
  if (body.notification_threshold !== undefined) updates.notification_threshold = body.notification_threshold;
  if (body.email_notify !== undefined) updates.email_notify = body.email_notify;
  if (body.notification_email !== undefined) updates.notification_email = body.notification_email;
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length > 1) {
    await supabaseRequest(
      `/koubo_users?id=eq.${user_id}`, "PATCH", updates, env,
      { prefer: "return=minimal" }
    );
  }

  // matching_keywords の更新（company_profiles が未作成の場合は upsert）
  if (body.matching_keywords && Array.isArray(body.matching_keywords)) {
    const profileCheck = await supabaseRequest(
      `/company_profiles?user_id=eq.${user_id}&select=id`, "GET", null, env
    );
    if (profileCheck.data && profileCheck.data.length > 0) {
      await supabaseRequest(
        `/company_profiles?user_id=eq.${user_id}`, "PATCH",
        { matching_keywords: body.matching_keywords },
        env, { prefer: "return=minimal" }
      );
    } else {
      await supabaseRequest(
        `/company_profiles`, "POST",
        { user_id, matching_keywords: body.matching_keywords },
        env, { prefer: "return=minimal" }
      );
    }
  }

  return jsonResponse({ updated: true });
}

// ---------------------------------------------------------------------------
// PUT /api/user/areas
// ---------------------------------------------------------------------------

async function handlePutAreas(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse("不正なJSON", 400); }

  const { area_ids } = body;
  if (!Array.isArray(area_ids)) return errorResponse("area_ids は配列で指定してください", 400);
  if (area_ids.length < 1 || area_ids.length > 3) {
    return errorResponse("エリアは1〜3個まで選択できます", 400);
  }

  // 既存のエリア設定を全て削除
  await supabaseRequest(
    `/user_areas?user_id=eq.${user_id}`, "DELETE",
    null, env, { prefer: "return=minimal" }
  );

  // 選択されたエリアを新規挿入
  const rows = area_ids.map(areaId => ({ user_id, area_id: areaId, active: true }));
  await supabaseRequest("/user_areas", "POST", rows, env, {
    prefer: "return=minimal",
  });

  return jsonResponse({ updated: true, area_ids });
}

// ---------------------------------------------------------------------------
// GET /api/user/opportunities
// ---------------------------------------------------------------------------

async function handleGetOpportunities(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  // ティア判定
  const userResult = await supabaseRequest(
    `/koubo_users?id=eq.${user_id}&select=status,trial_ends_at`,
    "GET", null, env
  );
  const user = userResult.data?.[0] || {};
  const now = new Date();
  const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const isPaid = user.status === "active" ||
    (user.status === "trial" && trialEnd && trialEnd > now);
  const tierMaxResults = isPaid ? 100 : 35;  // free: 5表示 + 30ぼかし
  const tier = isPaid ? "paid" : "free";

  const url = new URL(request.url);
  const scoreMin = parseInt(url.searchParams.get("score_min") || "0");
  const requestedLimit = parseInt(url.searchParams.get("limit") || "200");
  const maxLimit = Math.min(requestedLimit, tierMaxResults);
  const category = url.searchParams.get("category");

  // 1. ユーザーの登録エリアを取得
  const areasResult = await supabaseRequest(
    `/user_areas?user_id=eq.${user_id}&active=eq.true&select=area_id`,
    "GET", null, env
  );
  const userAreaIds = (areasResult.data || []).map(a => a.area_id);
  if (userAreaIds.length === 0) {
    return jsonResponse({ opportunities: [], total: 0, total_unfiltered: 0, tier, max_results: tierMaxResults });
  }

  // 2. 登録エリアの全案件を opportunities テーブルから取得
  const areaFilter = userAreaIds.map(id => encodeURIComponent(id)).join(",");
  const oppResult = await supabaseRequest(
    `/opportunities?area_id=in.(${areaFilter})&select=*&order=scraped_at.desc&limit=500`,
    "GET", null, env
  );
  if (!oppResult.ok) return errorResponse("案件取得失敗", 500);

  // 期限切れの案件を除外
  const today = new Date().toISOString().split("T")[0];
  const allOpps = (oppResult.data || []).filter(opp => {
    if (!opp.deadline) return true;
    return opp.deadline >= today;
  });

  // 3. user_opportunities からスコア情報を取得
  const uoResult = await supabaseRequest(
    `/user_opportunities?user_id=eq.${user_id}&select=opportunity_id,match_score,match_reason,recommendation,rank_position,is_dismissed,detailed_analysis`,
    "GET", null, env
  );
  const uoMap = {};
  (uoResult.data || []).forEach(uo => { uoMap[uo.opportunity_id] = uo; });

  // 4. マージ: 全案件にスコア情報を付与
  let items = allOpps.map(opp => {
    const uo = uoMap[opp.id];
    return {
      opportunity_id: opp.id,
      match_score: uo ? uo.match_score : null,
      match_reason: uo ? uo.match_reason : null,
      recommendation: uo ? uo.recommendation : null,
      rank_position: uo ? uo.rank_position : null,
      is_dismissed: uo ? uo.is_dismissed : false,
      detailed_analysis: uo ? uo.detailed_analysis : null,
      opportunities: opp,
    };
  });

  // dismissed を除外
  items = items.filter(i => !i.is_dismissed);

  // スコアフィルター（0=全スコア の場合は未評価も含む）
  if (scoreMin > 0) {
    items = items.filter(i => i.match_score !== null && i.match_score >= scoreMin);
  }

  // カテゴリフィルター
  if (category) {
    items = items.filter(i => i.opportunities?.category === category);
  }

  // ソート: スコアあり（降順）→ スコアなし（日付順）
  items.sort((a, b) => {
    if (a.match_score !== null && b.match_score !== null) return b.match_score - a.match_score;
    if (a.match_score !== null) return -1;
    if (b.match_score !== null) return 1;
    return 0;
  });

  const totalUnfiltered = items.length;

  // ティア制限
  items = items.slice(0, maxLimit);

  // ランキング番号を付与
  items.forEach((item, idx) => {
    item.rank_position = item.rank_position || (idx + 1);
  });

  return jsonResponse({
    opportunities: items,
    total: items.length,
    total_unfiltered: totalUnfiltered,
    tier,
    max_results: tierMaxResults,
    visible_count: isPaid ? items.length : Math.min(5, items.length),
  });
}

// ---------------------------------------------------------------------------
// POST /api/opportunity/analyze - AI詳細分析
// ---------------------------------------------------------------------------

async function handleAnalyzeOpportunity(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse("不正なJSON", 400); }
  const { opportunity_id } = body;
  if (!opportunity_id) return errorResponse("opportunity_id は必須です", 400);

  // キャッシュ確認: 既に詳細分析済みならDBから返す
  const cached = await supabaseRequest(
    `/user_opportunities?user_id=eq.${user_id}&opportunity_id=eq.${opportunity_id}&select=detailed_analysis,analysis_completed_at`,
    "GET", null, env
  );
  const existing = cached.data?.[0];
  if (existing?.detailed_analysis) {
    return jsonResponse(existing.detailed_analysis);
  }

  // 案件データを取得
  const oppResult = await supabaseRequest(
    `/opportunities?id=eq.${opportunity_id}&select=*`,
    "GET", null, env
  );
  const opp = oppResult.data?.[0];
  if (!opp) return errorResponse("案件が見つかりません", 404);

  // ユーザープロフィールを取得
  const profileResult = await supabaseRequest(
    `/company_profiles?user_id=eq.${user_id}&select=*&limit=1`,
    "GET", null, env
  );
  const profile = profileResult.data?.[0] || {};

  // マッチング情報を取得
  const matchResult = await supabaseRequest(
    `/user_opportunities?user_id=eq.${user_id}&opportunity_id=eq.${opportunity_id}&select=match_score,match_reason,recommendation`,
    "GET", null, env
  );
  const matchInfo = matchResult.data?.[0] || {};

  // detail_url がある場合はページを取得
  let detailText = "";
  if (opp.detail_url) {
    try {
      const resp = await fetch(opp.detail_url, {
        headers: { "User-Agent": "KouboNavi/1.0 (bantex.jp)" },
        redirect: "follow",
      });
      if (resp.ok) {
        const html = await resp.text();
        detailText = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, "\n")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 30000);
      }
    } catch { /* ページ取得失敗は無視して案件基本情報のみで分析 */ }
  }

  // Gemini で詳細分析
  const prompt = `あなたは公募案件と企業のマッチング分析の専門家です。
以下の案件情報と企業プロフィールを照らし合わせて、詳細な分析レポートをJSON形式で出力してください。

【案件情報】
タイトル: ${opp.title || "不明"}
カテゴリ: ${opp.category || "不明"}
発注機関: ${opp.organization || "不明"}
手法: ${opp.method || "不明"}
締切: ${opp.deadline || "不明"}
エリア: ${opp.area_id || "不明"}
${detailText ? `\n【案件詳細ページの内容】\n${detailText}\n` : ""}
【企業プロフィール】
会社名: ${profile.company_name || "不明"}
事業分野: ${(profile.business_areas || []).join("、")}
提供サービス: ${(profile.services || []).join("、")}
強み: ${(profile.strengths || []).join("、")}
対象業界: ${(profile.target_industries || []).join("、")}
保有資格: ${(profile.qualifications || []).join("、")}

【既存マッチング情報】
マッチスコア: ${matchInfo.match_score || "不明"}%
マッチ理由: ${matchInfo.match_reason || "不明"}

以下のJSON形式で出力してください:
{
  "summary": "総合評価（200文字程度）",
  "match_points": ["企業とマッチするポイント1", "ポイント2", "ポイント3"],
  "concerns": ["懸念点・リスク1", "懸念点2"],
  "actions": ["具体的なアクション1", "アクション2", "アクション3"],
  "estimated_difficulty": "高 or 中 or 低",
  "recommended_preparation_days": 14
}

match_pointsは3〜5個、concernsは2〜3個、actionsは3〜5個生成してください。
recommended_preparation_daysは準備に必要な日数の目安です。`;

  const geminiUrl = `${GEMINI_API_BASE}/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  let geminiResp;
  try {
    geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    });
  } catch (err) {
    return errorResponse(`Gemini API接続失敗: ${err.message}`, 502);
  }

  const geminiData = await geminiResp.json();
  if (!geminiResp.ok) return errorResponse("AI分析に失敗しました", 502);

  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let analysis;
  try { analysis = JSON.parse(rawText); } catch { return errorResponse("AI分析結果の解析に失敗しました", 502); }

  // Gemini が配列でラップする場合の対応
  if (Array.isArray(analysis)) analysis = analysis[0] || {};

  // DBに保存（キャッシュ）
  await supabaseRequest(
    `/user_opportunities?user_id=eq.${user_id}&opportunity_id=eq.${opportunity_id}`,
    "PATCH",
    {
      detailed_analysis: analysis,
      analysis_requested_at: new Date().toISOString(),
      analysis_completed_at: new Date().toISOString(),
    },
    env,
    { prefer: "return=minimal" }
  );

  return jsonResponse(analysis);
}

// ---------------------------------------------------------------------------
// GET /api/user/subscription
// ---------------------------------------------------------------------------

async function handleGetSubscription(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  const result = await supabaseRequest(
    `/koubo_subscriptions?user_id=eq.${user_id}&select=*&limit=1`,
    "GET", null, env
  );

  const sub = result.data?.[0] || null;
  // koubo_users の status も取得
  const userResult = await supabaseRequest(
    `/koubo_users?id=eq.${user_id}&select=status,trial_ends_at`,
    "GET", null, env
  );
  const user = userResult.data?.[0] || {};

  return jsonResponse({
    subscription: sub,
    user_status: user.status || "none",
    trial_ends_at: user.trial_ends_at || null,
  });
}

// ---------------------------------------------------------------------------
// POST /api/checkout (Subscription)
// ---------------------------------------------------------------------------

async function handleCheckout(request, env) {
  const { user_id, email } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse("不正なJSON", 400); }

  const { plan, success_url, cancel_url } = body;
  const priceId = env.STRIPE_PRICE_MONTHLY;
  if (!priceId) return errorResponse("Price IDが設定されていません", 500);

  const origin = request.headers.get("Origin") ?? "https://koubo-navi.bantex.jp";
  const successUrl = success_url || `${origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = cancel_url || `${origin}/`;

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("metadata[user_id]", user_id);
  params.set("metadata[plan]", plan || "monthly");
  params.set("subscription_data[trial_period_days]", "7");
  params.set("locale", "ja");
  params.set("payment_method_types[0]", "card");
  if (email) params.set("customer_email", email);

  const result = await stripeRequest("/checkout/sessions", "POST", params, env);
  if (!result.ok) return jsonResponse({ error: "Stripe Checkout エラー", detail: result.data }, result.status);

  return jsonResponse({ session_id: result.data.id, url: result.data.url });
}

// ---------------------------------------------------------------------------
// POST /api/cancel-subscription
// ---------------------------------------------------------------------------

async function handleCancelSubscription(request, env) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  const subResult = await supabaseRequest(
    `/koubo_subscriptions?user_id=eq.${user_id}&select=stripe_subscription_id&limit=1`,
    "GET", null, env
  );
  const sub = subResult.data?.[0];
  if (!sub) return errorResponse("サブスクリプションが見つかりません", 404);

  // Stripe API でサブスク解約（期間終了時に停止）
  const params = new URLSearchParams();
  params.set("cancel_at_period_end", "true");
  const result = await stripeRequest(`/subscriptions/${sub.stripe_subscription_id}`, "POST", params, env);
  if (!result.ok) return jsonResponse({ error: "解約エラー", detail: result.data }, result.status);

  // DB更新
  await supabaseRequest(
    `/koubo_subscriptions?user_id=eq.${user_id}`, "PATCH",
    { status: "cancelling", cancelled_at: new Date().toISOString() },
    env, { prefer: "return=minimal" }
  );

  return jsonResponse({ cancelled: true, cancel_at: result.data.cancel_at });
}

// ---------------------------------------------------------------------------
// Stripe Webhook signature verification
// ---------------------------------------------------------------------------

async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    if (!acc[key]) acc[key] = [];
    acc[key].push(value);
    return acc;
  }, {});
  const timestamp = parts["t"]?.[0];
  const signatures = parts["v1"] ?? [];
  if (!timestamp || signatures.length === 0) return { valid: false };

  const tolerance = 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > tolerance) return { valid: false };

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  const valid = signatures.some(s => {
    if (s.length !== computed.length) return false;
    let diff = 0;
    for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ computed.charCodeAt(i);
    return diff === 0;
  });
  return { valid };
}

// ---------------------------------------------------------------------------
// POST /api/webhook (Subscription events)
// ---------------------------------------------------------------------------

async function handleWebhook(request, env, ctx) {
  if (!env.STRIPE_WEBHOOK_SECRET) return errorResponse("STRIPE_WEBHOOK_SECRET未設定", 500);

  const sigHeader = request.headers.get("stripe-signature");
  if (!sigHeader) return errorResponse("署名ヘッダーなし", 400);

  let rawBody;
  try { rawBody = await request.text(); } catch { return errorResponse("ボディ読取失敗", 400); }

  const { valid } = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return errorResponse("署名不正", 401);

  let event;
  try { event = JSON.parse(rawBody); } catch { return errorResponse("不正なJSON", 400); }

  ctx.waitUntil((async () => {
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data?.object;
          if (!session || session.mode !== "subscription") break;
          const userId = session.metadata?.user_id;
          const plan = session.metadata?.plan || "monthly";
          if (!userId) break;

          // koubo_users を作成または更新
          await supabaseRequest(`/koubo_users?id=eq.${userId}`, "PATCH", {
            status: "active",
          }, env, { prefer: "return=minimal" });

          // サブスク情報を保存
          const subId = session.subscription;
          const customerId = session.customer;
          await supabaseRequest("/koubo_subscriptions", "POST", {
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subId,
            plan,
            status: "active",
          }, env, {
            prefer: "resolution=merge-duplicates,return=minimal",
          });
          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data?.object;
          if (!sub) break;
          const periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
          await supabaseRequest(
            `/koubo_subscriptions?stripe_subscription_id=eq.${sub.id}`, "PATCH",
            {
              status: sub.cancel_at_period_end ? "cancelling" : sub.status,
              current_period_end: periodEnd,
            }, env, { prefer: "return=minimal" }
          );
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data?.object;
          if (!sub) break;
          await supabaseRequest(
            `/koubo_subscriptions?stripe_subscription_id=eq.${sub.id}`, "PATCH",
            { status: "cancelled", cancelled_at: new Date().toISOString() },
            env, { prefer: "return=minimal" }
          );
          // koubo_users のステータスも更新
          const subResult = await supabaseRequest(
            `/koubo_subscriptions?stripe_subscription_id=eq.${sub.id}&select=user_id`,
            "GET", null, env
          );
          if (subResult.data?.[0]?.user_id) {
            await supabaseRequest(
              `/koubo_users?id=eq.${subResult.data[0].user_id}`, "PATCH",
              { status: "cancelled" }, env, { prefer: "return=minimal" }
            );
          }
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data?.object;
          if (!invoice?.subscription) break;
          await supabaseRequest(
            `/koubo_subscriptions?stripe_subscription_id=eq.${invoice.subscription}`, "PATCH",
            { status: "past_due" }, env, { prefer: "return=minimal" }
          );
          break;
        }
      }
    } catch (err) {
      console.error("Webhook処理エラー:", err.message);
    }
  })());

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// User registration helper (called during onboarding)
// ---------------------------------------------------------------------------

async function handleRegisterUser(request, env) {
  const { user_id, email } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse("不正なJSON", 400); }

  const { company_url, company_text, area_ids, profile } = body;
  if (!company_url && !company_text) {
    return errorResponse("company_url または company_text のいずれかは必須です", 400);
  }

  const trialEnd = new Date(Date.now() + 7 * 86400000).toISOString();

  // koubo_users を upsert
  const userData = {
    id: user_id,
    notification_email: email,
    status: "trial",
    trial_ends_at: trialEnd,
  };
  if (company_url) userData.company_url = company_url;
  if (company_text) userData.company_text = company_text;

  await supabaseRequest("/koubo_users", "POST", userData, env, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });

  // プロフィールを保存（DELETE + POST で確実にupsert）
  if (profile && typeof profile === "object") {
    await supabaseRequest(`/company_profiles?user_id=eq.${user_id}`, "DELETE", null, env, { prefer: "return=minimal" });
    await supabaseRequest("/company_profiles", "POST", {
      user_id,
      company_name: profile.company_name || null,
      location: profile.location || null,
      business_areas: profile.business_areas || [],
      services: profile.services || [],
      strengths: profile.strengths || [],
      matching_keywords: profile.matching_keywords || [],
    }, env, { prefer: "return=minimal" });
  }

  // エリア設定を保存
  if (Array.isArray(area_ids)) {
    if (area_ids.length < 1 || area_ids.length > 3) {
      return errorResponse("エリアは1〜3個まで選択できます", 400);
    }
    // 既存を削除して新規挿入
    await supabaseRequest(
      `/user_areas?user_id=eq.${user_id}`, "DELETE",
      null, env, { prefer: "return=minimal" }
    );
    const rows = area_ids.map(areaId => ({ user_id, area_id: areaId, active: true }));
    await supabaseRequest("/user_areas", "POST", rows, env, {
      prefer: "return=minimal",
    });
  }

  return jsonResponse({ registered: true, trial_ends_at: trialEnd });
}

// ---------------------------------------------------------------------------
// POST /api/user/screen - 初期30日スクリーニング
// ---------------------------------------------------------------------------

async function handleInitialScreen(request, env, ctx) {
  const { user_id } = await getUserFromJWT(request, env);
  if (!user_id) return errorResponse("認証が必要です", 401);

  // 既にスクリーニング済みかチェック
  const userCheck = await supabaseRequest(
    `/koubo_users?id=eq.${user_id}&select=initial_screening_done`,
    "GET", null, env
  );
  if (userCheck.data?.[0]?.initial_screening_done) {
    return jsonResponse({ status: "already_done" });
  }

  // 即時レスポンスを返し、バックグラウンドで処理
  ctx.waitUntil((async () => {
    try {
      // ユーザーのエリアを取得
      const areasResult = await supabaseRequest(
        `/user_areas?user_id=eq.${user_id}&active=eq.true&select=area_id`,
        "GET", null, env
      );
      const areaIds = (areasResult.data || []).map(a => a.area_id);
      if (areaIds.length === 0) return;

      // ユーザーのプロフィールを取得
      const profileResult = await supabaseRequest(
        `/company_profiles?user_id=eq.${user_id}&select=*&limit=1`,
        "GET", null, env
      );
      const profile = profileResult.data?.[0] || {};
      const keywords = profile.matching_keywords || [];

      // 過去30日分の案件を取得
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const areaFilter = areaIds.map(a => `area_id.eq.${a}`).join(",");
      const oppsResult = await supabaseRequest(
        `/opportunities?or=(${areaFilter})&scraped_at=gte.${since}&select=id,title,category,organization,method,area_id,deadline&order=scraped_at.desc&limit=50`,
        "GET", null, env
      );
      const opportunities = oppsResult.data || [];
      if (opportunities.length === 0) {
        await supabaseRequest(`/koubo_users?id=eq.${user_id}`, "PATCH", {
          initial_screening_done: true,
          initial_screening_at: new Date().toISOString(),
        }, env, { prefer: "return=minimal" });
        return;
      }

      // 15件ずつバッチでGeminiマッチング
      const batchSize = 15;
      let allMatches = [];

      for (let i = 0; i < opportunities.length; i += batchSize) {
        const batch = opportunities.slice(i, i + batchSize);
        const oppList = batch.map((o, idx) => `${idx + 1}. タイトル: ${o.title || "不明"} / カテゴリ: ${o.category || "不明"} / 発注機関: ${o.organization || "不明"} / 手法: ${o.method || "不明"}`).join("\n");

        const prompt = `あなたは公募案件と企業のマッチング評価の専門家です。

【企業プロフィール】
会社名: ${profile.company_name || "不明"}
事業分野: ${(profile.business_areas || []).join("、")}
サービス: ${(profile.services || []).join("、")}
強み: ${(profile.strengths || []).join("、")}
キーワード: ${keywords.join("、")}

【案件リスト】
${oppList}

各案件について以下のJSON配列で出力してください:
[
  {
    "index": 1,
    "match_score": 75,
    "match_reason": "マッチする理由（1-2文）",
    "recommendation": "応募推奨 or 検討 or 見送り"
  }
]

match_scoreは0-100の整数で、企業と案件の適合度を評価してください。
`;

        const geminiUrl = `${GEMINI_API_BASE}/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
        try {
          const geminiResp = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
            }),
          });
          if (geminiResp.ok) {
            const gd = await geminiResp.json();
            const rawText = gd?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
            let matches;
            try { matches = JSON.parse(rawText); } catch { matches = []; }
            if (!Array.isArray(matches)) matches = [];

            for (const m of matches) {
              const oppIdx = (m.index || 0) - 1;
              if (oppIdx >= 0 && oppIdx < batch.length && m.match_score >= 0) {
                allMatches.push({
                  user_id,
                  opportunity_id: batch[oppIdx].id,
                  match_score: Math.min(100, Math.max(0, Math.round(m.match_score))),
                  match_reason: (m.match_reason || "").slice(0, 500),
                  recommendation: m.recommendation || "検討",
                });
              }
            }
          }
        } catch { /* バッチ失敗は無視して続行 */ }
      }

      // ランキング付与（スコア降順）
      allMatches.sort((a, b) => b.match_score - a.match_score);
      allMatches.forEach((m, idx) => { m.rank_position = idx + 1; });

      // DBに保存
      for (const m of allMatches) {
        await supabaseRequest("/user_opportunities", "POST", {
          ...m,
          is_dismissed: false,
        }, env, {
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      }

      // スクリーニング完了フラグ更新
      await supabaseRequest(`/koubo_users?id=eq.${user_id}`, "PATCH", {
        initial_screening_done: true,
        initial_screening_at: new Date().toISOString(),
      }, env, { prefer: "return=minimal" });

    } catch (err) {
      console.error("初期スクリーニングエラー:", err.message);
    }
  })());

  return jsonResponse({ status: "screening_started" });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function router(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return handleOptions();

  if (path === "/api/analyze-company" && method === "POST") return handleAnalyzeCompany(request, env);
  if (path === "/api/areas" && method === "GET") return handleAreas(request, env);
  if (path === "/api/user/profile" && method === "GET") return handleGetProfile(request, env);
  if (path === "/api/user/profile" && method === "PUT") return handlePutProfile(request, env);
  if (path === "/api/user/areas" && method === "PUT") return handlePutAreas(request, env);
  if (path === "/api/user/opportunities" && method === "GET") return handleGetOpportunities(request, env);
  if (path === "/api/opportunity/analyze" && method === "POST") return handleAnalyzeOpportunity(request, env);
  if (path === "/api/user/subscription" && method === "GET") return handleGetSubscription(request, env);
  if (path === "/api/checkout" && method === "POST") return handleCheckout(request, env);
  if (path === "/api/webhook" && method === "POST") return handleWebhook(request, env, ctx);
  if (path === "/api/cancel-subscription" && method === "POST") return handleCancelSubscription(request, env);
  if (path === "/api/register" && method === "POST") return handleRegisterUser(request, env);
  if (path === "/api/user/screen" && method === "POST") return handleInitialScreen(request, env, ctx);

  return jsonResponse({ error: `未定義: ${method} ${path}` }, 404);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    try {
      const response = await router(request, env, ctx);
      return addCorsOrigin(response, origin);
    } catch (err) {
      console.error("内部エラー:", err.message, err.stack);
      return addCorsOrigin(errorResponse("内部サーバーエラー", 500), origin);
    }
  },
};
