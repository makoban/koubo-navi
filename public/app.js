// 公募ナビAI v1.0
// LP + Onboarding + Dashboard

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WORKER_BASE = "https://koubo-navi-proxy.ai-fudosan.workers.dev";
const SUPABASE_URL = "https://ypyrjsdotkeyvzequdez.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_l5yNWlXOZAHABwlbEalGng_R8zioydf";
const GOOGLE_CLIENT_ID = "318879736677-7mhvrrr6fq4d8ngkaahlulb9nu64hskp.apps.googleusercontent.com";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let supabaseClient = null;
let currentUser = null;
let companyProfile = null;
let selectedPlan = "monthly";
let authMode = "login"; // login | signup

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  initSupabase();
  checkUrlParams();
});

function initSupabase() {
  if (typeof supabase === "undefined") {
    console.warn("Supabase SDK not loaded");
    return;
  }
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: "implicit" },
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
      if (session?.user) {
        currentUser = session.user;
        updateAuthUI();
        // Check if user has completed onboarding
        checkUserStatus();
      }
    } else if (event === "SIGNED_OUT") {
      currentUser = null;
      updateAuthUI();
      showPage("landing");
    } else if (event === "PASSWORD_RECOVERY") {
      const newPw = prompt("新しいパスワードを入力してください（6文字以上）:");
      if (newPw && newPw.length >= 6) {
        supabaseClient.auth.updateUser({ password: newPw }).then(({ error }) => {
          alert(error ? `エラー: ${error.message}` : "パスワードを変更しました。");
        });
      }
    }
  });
}

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");
  if (sessionId) {
    // Stripe Checkout から戻ってきた
    window.history.replaceState({}, "", window.location.pathname);
    // Wait for auth to init, then verify
    setTimeout(() => verifyCheckout(sessionId), 1500);
  }
}

// ---------------------------------------------------------------------------
// Auth UI
// ---------------------------------------------------------------------------

function updateAuthUI() {
  const authArea = document.getElementById("authArea");
  if (currentUser) {
    const displayName = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "ユーザー";
    authArea.innerHTML = `
      <span class="header__user">${escapeHtml(displayName)}</span>
      <button class="btn btn--outline btn--sm" onclick="showPage('dashboard')">ダッシュボード</button>
      <button class="btn btn--outline btn--sm" onclick="logoutUser()">ログアウト</button>
    `;
  } else {
    authArea.innerHTML = `
      <button class="btn btn--outline btn--sm" onclick="showLoginModal()">ログイン</button>
    `;
  }
}

function showLoginModal() {
  document.getElementById("loginModal").classList.remove("hidden");
  authMode = "login";
  updateAuthModalUI();
}

function hideLoginModal() {
  document.getElementById("loginModal").classList.add("hidden");
  document.getElementById("authError").classList.add("hidden");
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "signup" : "login";
  updateAuthModalUI();
}

function updateAuthModalUI() {
  const title = document.getElementById("loginModalTitle");
  const submitBtn = document.getElementById("authSubmitBtn");
  const switchText = document.getElementById("authSwitchText");
  const switchBtn = document.getElementById("authSwitchBtn");

  if (authMode === "signup") {
    title.textContent = "新規登録";
    submitBtn.textContent = "登録する";
    switchText.textContent = "アカウントをお持ちの方";
    switchBtn.textContent = "ログイン";
  } else {
    title.textContent = "ログイン";
    submitBtn.textContent = "ログイン";
    switchText.textContent = "アカウントがない場合";
    switchBtn.textContent = "新規登録";
  }
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const errorEl = document.getElementById("authError");
  const submitBtn = document.getElementById("authSubmitBtn");

  errorEl.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "処理中...";

  try {
    let result;
    if (authMode === "signup") {
      result = await supabaseClient.auth.signUp({ email, password });
    } else {
      result = await supabaseClient.auth.signInWithPassword({ email, password });
    }

    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.classList.remove("hidden");
    } else {
      hideLoginModal();
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = authMode === "signup" ? "登録する" : "ログイン";
  }
}

async function loginWithGoogle() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

async function logoutUser() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

async function handlePasswordReset() {
  const email = document.getElementById("authEmail").value.trim();
  if (!email) {
    alert("メールアドレスを入力してください。");
    return;
  }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  alert(error ? `エラー: ${error.message}` : "パスワードリセットメールを送信しました。");
}

// ---------------------------------------------------------------------------
// Page Navigation
// ---------------------------------------------------------------------------

function showPage(page) {
  document.getElementById("landingPage").classList.toggle("hidden", page !== "landing");
  document.getElementById("onboardingPage").classList.toggle("hidden", page !== "onboarding");
  document.getElementById("dashboardPage").classList.toggle("hidden", page !== "dashboard");

  if (page === "dashboard") {
    loadDashboard();
  }
}

async function checkUserStatus() {
  if (!currentUser) return;

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${WORKER_BASE}/api/user/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();

    if (data.user) {
      // User has completed onboarding
      companyProfile = data.profile;
      showPage("dashboard");
    }
    // else: user exists in auth but hasn't onboarded → stay on landing
  } catch {
    // Not onboarded yet
  }
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function startOnboarding(plan) {
  if (plan) selectedPlan = plan;
  if (!currentUser) {
    showLoginModal();
    authMode = "signup";
    updateAuthModalUI();
    // After login, resume onboarding
    const origCallback = supabaseClient.auth.onAuthStateChange;
    return;
  }
  showPage("onboarding");
  goOnboardingStep(1);
  loadAreas();
}

function goOnboardingStep(step) {
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`obStep${i}`).classList.toggle("hidden", i !== step);
  }
  // Update progress indicators
  document.querySelectorAll(".onboarding__step").forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle("active", s === step);
    el.classList.toggle("done", s < step);
  });
}

async function analyzeCompany() {
  const urlInput = document.getElementById("companyUrlInput");
  const btn = document.getElementById("analyzeBtn");
  const status = document.getElementById("analyzeStatus");
  let url = urlInput.value.trim();

  if (!url) { alert("URLを入力してください"); return; }
  if (!url.startsWith("http")) url = "https://" + url;

  btn.disabled = true;
  btn.textContent = "分析中...";
  status.textContent = "AIがウェブサイトを読み取っています...（10〜30秒）";
  status.classList.remove("hidden");

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${WORKER_BASE}/api/analyze-company`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || "分析に失敗しました");
    }

    companyProfile = await resp.json();
    renderProfileCard();
    goOnboardingStep(2);
    status.classList.add("hidden");
  } catch (err) {
    status.textContent = `エラー: ${err.message}`;
    status.style.color = "var(--danger)";
  } finally {
    btn.disabled = false;
    btn.textContent = "AIで分析する";
  }
}

function renderProfileCard() {
  if (!companyProfile) return;
  const card = document.getElementById("profileCard");
  const p = companyProfile;
  card.innerHTML = `
    <div class="profile-card__row">
      <span class="profile-card__label">会社名</span>
      <span class="profile-card__value">${escapeHtml(p.company_name || "不明")}</span>
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">所在地</span>
      <span class="profile-card__value">${escapeHtml(p.location || "不明")}</span>
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">事業分野</span>
      <span class="profile-card__value">${escapeHtml((p.business_areas || []).join("、"))}</span>
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">提供サービス</span>
      <span class="profile-card__value">${escapeHtml((p.services || []).join("、"))}</span>
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">強み</span>
      <span class="profile-card__value">${escapeHtml((p.strengths || []).join("、"))}</span>
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">マッチングKW</span>
      <span class="profile-card__value">
        <div class="keyword-tags">
          ${(p.matching_keywords || []).map(kw => `<span class="keyword-tag">${escapeHtml(kw)}</span>`).join("")}
        </div>
      </span>
    </div>
  `;
}

async function loadAreas() {
  try {
    const resp = await fetch(`${WORKER_BASE}/api/areas`);
    const data = await resp.json();
    const container = document.getElementById("areaSelector");
    container.innerHTML = (data.areas || []).map(area => `
      <label class="area-checkbox" onclick="toggleAreaCheckbox(this)">
        <input type="checkbox" value="${escapeHtml(area.area_id)}" checked>
        <div class="area-checkbox__info">
          <h4>${escapeHtml(area.area_name)}</h4>
          <p>${area.sources.length} データソース</p>
        </div>
      </label>
    `).join("");
    // Mark as checked
    container.querySelectorAll(".area-checkbox").forEach(el => el.classList.add("checked"));
  } catch {
    document.getElementById("areaSelector").innerHTML = "<p>エリア情報の取得に失敗しました。</p>";
  }
}

function toggleAreaCheckbox(el) {
  const cb = el.querySelector("input");
  cb.checked = !cb.checked;
  el.classList.toggle("checked", cb.checked);
}

async function completeOnboarding() {
  const btn = document.getElementById("completeOnboardingBtn");
  btn.disabled = true;
  btn.textContent = "登録中...";

  const areaIds = Array.from(document.querySelectorAll("#areaSelector input:checked"))
    .map(cb => cb.value);

  if (areaIds.length === 0) {
    alert("少なくとも1つのエリアを選択してください");
    btn.disabled = false;
    btn.textContent = "登録を完了する";
    return;
  }

  try {
    const token = await getAccessToken();
    const companyUrl = document.getElementById("companyUrlInput").value.trim();

    // Register user
    const resp = await fetch(`${WORKER_BASE}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ company_url: companyUrl, area_ids: areaIds }),
    });

    if (!resp.ok) throw new Error("登録に失敗しました");

    // Start Stripe Checkout for subscription
    const checkoutResp = await fetch(`${WORKER_BASE}/api/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan: selectedPlan,
        success_url: window.location.origin + window.location.pathname + "?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: window.location.origin + window.location.pathname,
      }),
    });

    const checkoutData = await checkoutResp.json();
    if (checkoutData.url) {
      window.location.href = checkoutData.url;
    } else {
      // If checkout fails (e.g., no price ID), go to dashboard anyway (trial)
      showPage("dashboard");
    }
  } catch (err) {
    alert(`エラー: ${err.message}`);
    btn.disabled = false;
    btn.textContent = "登録を完了する";
  }
}

async function verifyCheckout(sessionId) {
  // After returning from Stripe, show dashboard
  showPage("dashboard");
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  if (!currentUser) return;

  try {
    const token = await getAccessToken();

    // Load profile
    const profileResp = await fetch(`${WORKER_BASE}/api/user/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profileData = await profileResp.json();

    if (profileData.profile) {
      companyProfile = profileData.profile;
      document.getElementById("dashCompanyName").textContent = profileData.profile.company_name || "";
    }

    // Status badge
    const statusEl = document.getElementById("dashStatus");
    const userStatus = profileData.user?.status || "trial";
    statusEl.textContent = userStatus === "active" ? "有料プラン" : userStatus === "trial" ? "無料トライアル" : userStatus;
    statusEl.className = `badge badge--${userStatus}`;

    // Load filter options
    const areasResp = await fetch(`${WORKER_BASE}/api/areas`);
    const areasData = await areasResp.json();
    const filterArea = document.getElementById("filterArea");
    filterArea.innerHTML = '<option value="">全エリア</option>' +
      (areasData.areas || []).map(a => `<option value="${a.area_id}">${a.area_name}</option>`).join("");

    // Load opportunities
    loadOpportunities();

    // Load settings
    loadSettings(profileData);

    // Load subscription
    loadSubscription();
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

async function loadOpportunities() {
  const token = await getAccessToken();
  const scoreMin = document.getElementById("filterScore").value;
  const area = document.getElementById("filterArea").value;

  const params = new URLSearchParams({ score_min: scoreMin, limit: "100" });
  if (area) params.set("area", area);

  try {
    const resp = await fetch(`${WORKER_BASE}/api/user/opportunities?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    renderOpportunities(data.opportunities || []);
  } catch {
    renderOpportunities([]);
  }
}

function renderOpportunities(items) {
  const list = document.getElementById("opportunityList");
  const countEl = document.getElementById("oppCount");
  countEl.textContent = `${items.length}件`;

  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>条件に合う案件がありません。</p>
        <p>毎朝8:00に新しい案件がチェックされます。</p>
      </div>
    `;
    return;
  }

  list.innerHTML = items.map(item => {
    const opp = item.opportunities || {};
    const score = item.match_score;
    const scoreClass = score >= 80 ? "high" : score >= 60 ? "mid" : "low";
    const rec = item.recommendation || "";

    return `
      <div class="opp-card">
        <div class="opp-card__score opp-card__score--${scoreClass}">${score}%</div>
        <div class="opp-card__body">
          <div class="opp-card__title">${escapeHtml(opp.title || item.title || "不明")}</div>
          <div class="opp-card__meta">
            ${escapeHtml(opp.organization || "")} / ${escapeHtml(opp.category || "")} / ${escapeHtml(opp.method || "")}
            ${opp.deadline ? ` / 締切: ${opp.deadline}` : ""}
          </div>
          <div class="opp-card__reason">${escapeHtml(item.match_reason || "")}</div>
          <div class="opp-card__actions">
            ${opp.detail_url ? `<a href="${escapeHtml(opp.detail_url)}" target="_blank" class="btn btn--outline btn--sm">詳細を見る</a>` : ""}
            <span class="keyword-tag">${escapeHtml(rec)}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function loadSettings(profileData) {
  if (!profileData) return;

  // Profile info
  const settingsProfile = document.getElementById("settingsProfile");
  if (companyProfile) {
    settingsProfile.innerHTML = `
      <div class="profile-card__row"><span class="profile-card__label">会社名</span><span class="profile-card__value">${escapeHtml(companyProfile.company_name || "")}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">事業分野</span><span class="profile-card__value">${escapeHtml((companyProfile.business_areas || []).join("、"))}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">URL</span><span class="profile-card__value">${escapeHtml(profileData.user?.company_url || "")}</span></div>
    `;
  }

  // Notification settings
  const user = profileData.user || {};
  document.getElementById("settingEmailNotify").checked = user.email_notify !== false;
  document.getElementById("settingThreshold").value = user.notification_threshold || 40;
  document.getElementById("thresholdValue").textContent = `${user.notification_threshold || 40}%`;

  // Keywords
  renderKeywordEditor();
}

function renderKeywordEditor() {
  if (!companyProfile) return;
  const container = document.getElementById("keywordEditor");
  const keywords = companyProfile.matching_keywords || [];
  container.innerHTML = `
    <div class="keyword-tags">
      ${keywords.map((kw, i) => `
        <span class="keyword-tag">
          ${escapeHtml(kw)}
          <button class="keyword-tag__remove" onclick="removeKeyword(${i})">×</button>
        </span>
      `).join("")}
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;">
      <input type="text" id="newKeywordInput" class="input input--sm" placeholder="キーワードを追加">
      <button class="btn btn--outline btn--sm" onclick="addKeyword()">追加</button>
    </div>
  `;
}

async function removeKeyword(index) {
  if (!companyProfile) return;
  const keywords = [...(companyProfile.matching_keywords || [])];
  keywords.splice(index, 1);
  companyProfile.matching_keywords = keywords;
  renderKeywordEditor();
  await saveKeywords(keywords);
}

async function addKeyword() {
  const input = document.getElementById("newKeywordInput");
  const kw = input.value.trim();
  if (!kw) return;

  if (!companyProfile.matching_keywords) companyProfile.matching_keywords = [];
  companyProfile.matching_keywords.push(kw);
  input.value = "";
  renderKeywordEditor();
  await saveKeywords(companyProfile.matching_keywords);
}

async function saveKeywords(keywords) {
  const token = await getAccessToken();
  await fetch(`${WORKER_BASE}/api/user/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ matching_keywords: keywords }),
  });
}

async function saveSettings() {
  const token = await getAccessToken();
  const threshold = parseInt(document.getElementById("settingThreshold").value);
  document.getElementById("thresholdValue").textContent = `${threshold}%`;

  await fetch(`${WORKER_BASE}/api/user/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email_notify: document.getElementById("settingEmailNotify").checked,
      notification_threshold: threshold,
    }),
  });
}

async function reanalyzeCompany() {
  const url = prompt("会社URLを入力してください:", "");
  if (!url) return;
  const token = await getAccessToken();
  const resp = await fetch(`${WORKER_BASE}/api/analyze-company`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: url.startsWith("http") ? url : "https://" + url }),
  });
  if (resp.ok) {
    companyProfile = await resp.json();
    alert("再分析が完了しました。");
    loadDashboard();
  } else {
    alert("再分析に失敗しました。");
  }
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

async function loadSubscription() {
  const token = await getAccessToken();
  try {
    const resp = await fetch(`${WORKER_BASE}/api/user/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    renderSubscription(data);
  } catch {
    renderSubscription({});
  }
}

function renderSubscription(data) {
  const container = document.getElementById("subscriptionInfo");
  const sub = data.subscription;
  const status = data.user_status || "none";
  const trialEnd = data.trial_ends_at;

  if (status === "none" || !sub) {
    // No subscription yet
    container.innerHTML = `
      <div class="sub-card">
        <div class="sub-card__plan">${status === "trial" ? "無料トライアル中" : "未登録"}</div>
        ${trialEnd ? `<div class="sub-card__info">トライアル終了日: ${new Date(trialEnd).toLocaleDateString("ja-JP")}</div>` : ""}
        <button class="btn btn--primary btn--lg" onclick="startCheckout('monthly')">月額プラン ¥2,980 で開始</button>
        <button class="btn btn--outline btn--lg" style="margin-top:12px" onclick="startCheckout('yearly')">年額プラン ¥29,800 で開始</button>
      </div>
    `;
    return;
  }

  const planLabel = sub.plan === "yearly" ? "年額プラン" : "月額プラン";
  const priceLabel = sub.plan === "yearly" ? "¥29,800/年" : "¥2,980/月";
  const statusLabel = sub.status === "active" ? "有効" :
    sub.status === "cancelling" ? "解約予定" :
    sub.status === "past_due" ? "支払い遅延" : sub.status;
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("ja-JP")
    : "—";

  container.innerHTML = `
    <div class="sub-card">
      <div class="sub-card__plan">${planLabel}</div>
      <div class="sub-card__price">${priceLabel}</div>
      <div class="sub-card__info">
        ステータス: ${statusLabel}<br>
        ${sub.status === "cancelling" ? `解約日: ${periodEnd}` : `次回請求日: ${periodEnd}`}
      </div>
      ${sub.status === "active" ? `<button class="btn btn--danger" onclick="cancelSubscription()">解約する</button>` : ""}
      ${sub.status === "cancelling" ? `<p style="color:var(--text-muted);margin-top:12px;">契約期間の終了まではサービスをご利用いただけます。</p>` : ""}
    </div>
  `;
}

async function startCheckout(plan) {
  if (!currentUser) { showLoginModal(); return; }
  const token = await getAccessToken();
  const resp = await fetch(`${WORKER_BASE}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      plan,
      success_url: window.location.origin + window.location.pathname + "?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: window.location.origin + window.location.pathname,
    }),
  });
  const data = await resp.json();
  if (data.url) {
    window.location.href = data.url;
  } else {
    alert("決済ページの作成に失敗しました: " + (data.error || "不明なエラー"));
  }
}

async function cancelSubscription() {
  if (!confirm("サブスクリプションを解約しますか？\n契約期間の終了までサービスは利用できます。")) return;
  const token = await getAccessToken();
  const resp = await fetch(`${WORKER_BASE}/api/cancel-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (resp.ok) {
    alert("解約リクエストを送信しました。契約期間の終了までサービスをご利用いただけます。");
    loadSubscription();
  } else {
    const err = await resp.json();
    alert("解約に失敗しました: " + (err.error || ""));
  }
}

// ---------------------------------------------------------------------------
// Tab Navigation
// ---------------------------------------------------------------------------

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${tabName}`));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function getAccessToken() {
  if (!supabaseClient) return "";
  const { data } = await supabaseClient.auth.getSession();
  return data?.session?.access_token || "";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
