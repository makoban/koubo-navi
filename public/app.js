// 公募ナビAI v3.5.4
// 新規登録フロー刷新: メールのみ登録 + パスワードメール送信 + オンボーディング廃止

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WORKER_BASE = "https://koubo-navi-proxy.ai-fudosan.workers.dev";
const SUPABASE_URL = "https://ypyrjsdotkeyvzequdez.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_l5yNWlXOZAHABwlbEalGng_R8zioydf";
const GOOGLE_CLIENT_ID = "318879736677-7mhvrrr6fq4d8ngkaahlulb9nu64hskp.apps.googleusercontent.com";
const MAX_AREAS = 3;

const AREA_NAMES = {
  "hokkaido": "北海道", "aomori": "青森県", "iwate": "岩手県", "miyagi": "宮城県",
  "akita": "秋田県", "yamagata": "山形県", "fukushima": "福島県",
  "ibaraki": "茨城県", "tochigi": "栃木県", "gunma": "群馬県", "saitama": "埼玉県",
  "chiba": "千葉県", "tokyo": "東京都", "kanagawa": "神奈川県",
  "niigata": "新潟県", "toyama": "富山県", "ishikawa": "石川県", "fukui": "福井県",
  "yamanashi": "山梨県", "nagano": "長野県", "gifu": "岐阜県", "shizuoka": "静岡県",
  "aichi": "愛知県", "mie": "三重県",
  "shiga": "滋賀県", "kyoto": "京都府", "osaka": "大阪府", "hyogo": "兵庫県",
  "nara": "奈良県", "wakayama": "和歌山県",
  "tottori": "鳥取県", "shimane": "島根県", "okayama": "岡山県", "hiroshima": "広島県",
  "yamaguchi": "山口県",
  "tokushima": "徳島県", "kagawa": "香川県", "ehime": "愛媛県", "kochi": "高知県",
  "fukuoka": "福岡県", "saga": "佐賀県", "nagasaki": "長崎県", "kumamoto": "熊本県",
  "oita": "大分県", "miyazaki": "宮崎県", "kagoshima": "鹿児島県", "okinawa": "沖縄県",
  "national": "全国",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let supabaseClient = null;
let currentUser = null;
let companyProfile = null;
let authMode = "login"; // login | signup
let inputMode = "url"; // url | text
let userOnboarded = false;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  initSupabase();
  checkUrlParams();
  loadLandingStats();
});

async function loadLandingStats() {
  try {
    const res = await fetch(`${WORKER_BASE}/api/stats`);
    const data = await res.json();
    // Proof-bar
    const el1 = document.getElementById("statRecentWeek");
    const el2 = document.getElementById("statTotalActive");
    if (el1 && data.recent_week != null) el1.textContent = data.recent_week.toLocaleString() + "件";
    if (el2 && data.total_active != null) el2.textContent = data.total_active.toLocaleString() + "件";
    // Hero banner
    const h1 = document.getElementById("heroTotalActive");
    const h2 = document.getElementById("heroTotalChecked");
    if (h1 && data.total_active != null) h1.textContent = data.total_active.toLocaleString();
    if (h2 && data.total_checked != null) h2.textContent = data.total_checked.toLocaleString();
  } catch (e) {
    console.warn("stats取得失敗:", e);
  }
}

function initSupabase() {
  if (typeof supabase === "undefined") {
    console.warn("Supabase SDK not loaded");
    return;
  }
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
      if (session?.user) {
        currentUser = session.user;
        updateAuthUI();
        // ユーザー状態確認 (未登録なら自動登録)
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
    const currentPage = getCurrentPage();
    authArea.innerHTML = `
      <span class="header__user">${escapeHtml(displayName)}</span>
      ${currentPage === "dashboard" ? `<button class="btn btn--outline btn--sm" onclick="showPage('landing')">トップページ</button>` : ""}
      ${currentPage !== "dashboard" && userOnboarded ? `<button class="btn btn--primary btn--sm" onclick="showPage('dashboard')">ダッシュボード</button>` : ""}
      <button class="btn btn--outline btn--sm" onclick="logoutUser()">ログアウト</button>
    `;
  } else {
    authArea.innerHTML = `
      <button class="btn btn--outline btn--sm" onclick="showLoginModal()">ログイン</button>
    `;
  }
}

function getCurrentPage() {
  if (!document.getElementById("dashboardPage").classList.contains("hidden")) return "dashboard";
  return "landing";
}

function showLoginModal() {
  document.getElementById("loginModal").classList.remove("hidden");
  authMode = "login";
  updateAuthModalUI();
}

function hideLoginModal() {
  document.getElementById("loginModal").classList.add("hidden");
  document.getElementById("authError").classList.add("hidden");
  const successEl = document.getElementById("authSuccess");
  if (successEl) successEl.classList.add("hidden");
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
  const passwordField = document.getElementById("authPassword");
  const resetLink = document.querySelector(".auth-reset");

  if (authMode === "signup") {
    title.textContent = "新規登録";
    submitBtn.textContent = "登録する（パスワードをメール送信）";
    switchText.textContent = "アカウントをお持ちの方";
    switchBtn.textContent = "ログイン";
    passwordField.classList.add("hidden");
    passwordField.required = false;
    if (resetLink) resetLink.classList.add("hidden");
  } else {
    title.textContent = "ログイン";
    submitBtn.textContent = "ログイン";
    switchText.textContent = "アカウントがない場合";
    switchBtn.textContent = "新規登録";
    passwordField.classList.remove("hidden");
    passwordField.required = true;
    if (resetLink) resetLink.classList.remove("hidden");
  }
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const errorEl = document.getElementById("authError");
  const submitBtn = document.getElementById("authSubmitBtn");
  const successEl = document.getElementById("authSuccess");

  errorEl.classList.add("hidden");
  if (successEl) successEl.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "処理中...";

  try {
    if (authMode === "signup") {
      // 新規登録: サーバーでアカウント作成 + パスワードメール送信
      const resp = await fetch(`${WORKER_BASE}/api/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        errorEl.textContent = data.error || "登録に失敗しました";
        errorEl.classList.remove("hidden");
      } else {
        // 成功メッセージを表示してログインモードに切り替え
        if (successEl) {
          successEl.textContent = "パスワードをメールで送信しました。メールを確認してログインしてください。";
          successEl.classList.remove("hidden");
        } else {
          alert("パスワードをメールで送信しました。メールを確認してログインしてください。");
        }
        authMode = "login";
        updateAuthModalUI();
        document.getElementById("authEmail").value = email;
      }
    } else {
      // ログイン: Supabase Auth でログイン
      const result = await supabaseClient.auth.signInWithPassword({ email, password });
      if (result.error) {
        errorEl.textContent = result.error.message;
        errorEl.classList.remove("hidden");
      } else {
        hideLoginModal();
      }
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = authMode === "signup" ? "登録する（パスワードをメール送信）" : "ログイン";
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
  try {
    await fetch(`${WORKER_BASE}/api/password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, origin: window.location.origin }),
    });
    alert("パスワードリセットメールを送信しました。");
  } catch {
    alert("エラーが発生しました。もう一度お試しください。");
  }
}

// ---------------------------------------------------------------------------
// Page Navigation
// ---------------------------------------------------------------------------

function showPage(page) {
  document.getElementById("landingPage").classList.toggle("hidden", page !== "landing");
  const obPage = document.getElementById("onboardingPage");
  if (obPage) obPage.classList.add("hidden");
  document.getElementById("dashboardPage").classList.toggle("hidden", page !== "dashboard");

  if (page === "dashboard") {
    userOnboarded = true;
    loadDashboard();
  }
  // ページ切替時にヘッダーボタンを更新
  updateAuthUI();
  window.scrollTo(0, 0);
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
      // ユーザー登録済み → ダッシュボード表示可能
      companyProfile = data.profile;
      userOnboarded = true;
      updateAuthUI();
    } else {
      // 未登録（Google OAuthで初回ログインなど）→ 自動登録
      await autoRegisterUser(token);
    }
  } catch {
    // エラー時は何もしない
  }
}

async function autoRegisterUser(token) {
  try {
    const resp = await fetch(`${WORKER_BASE}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    if (resp.ok || resp.status === 409) {
      userOnboarded = true;
      updateAuthUI();
    }
  } catch {
    // 登録失敗は無視
  }
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function startOnboarding() {
  if (!currentUser) {
    // 未ログイン → 新規登録モーダル表示
    showLoginModal();
    authMode = "signup";
    updateAuthModalUI();
    return;
  }
  // ログイン済み → ダッシュボードへ
  showPage("dashboard");
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

function switchInputMode(mode) {
  inputMode = mode;
  const urlGroup = document.getElementById("urlInputGroup");
  const textGroup = document.getElementById("textInputGroup");
  const tabUrl = document.getElementById("tabUrl");
  const tabText = document.getElementById("tabText");

  if (mode === "url") {
    urlGroup.classList.remove("hidden");
    textGroup.classList.add("hidden");
    tabUrl.classList.add("active");
    tabText.classList.remove("active");
  } else {
    urlGroup.classList.add("hidden");
    textGroup.classList.remove("hidden");
    tabUrl.classList.remove("active");
    tabText.classList.add("active");
  }
}

async function analyzeCompany() {
  const status = document.getElementById("analyzeStatus");
  let requestBody;
  let btn;

  if (inputMode === "url") {
    btn = document.getElementById("analyzeBtn");
    let url = document.getElementById("companyUrlInput").value.trim();
    if (!url) { alert("URLを入力してください"); return; }
    if (!url.startsWith("http")) url = "https://" + url;
    requestBody = { url };
  } else {
    btn = document.getElementById("analyzeBtnText");
    const text = document.getElementById("companyTextInput").value.trim();
    if (!text || text.length < 50) { alert("事業内容を50文字以上入力してください"); return; }
    requestBody = { text };
  }

  btn.disabled = true;
  btn.textContent = "分析中...";
  status.classList.remove("hidden");
  status.style.color = "";

  // 進捗ステップメッセージ（時間経過で更新）
  const steps = inputMode === "url"
    ? [
        "AIがウェブサイトにアクセスしています...",
        "ページ内容を読み取っています...",
        "事業内容を解析しています...",
        "業種カテゴリを判定しています...",
        "プロフィールを作成しています...",
        "もう少しお待ちください...",
      ]
    : [
        "AIが事業内容を分析しています...",
        "事業分野を特定しています...",
        "業種カテゴリを判定しています...",
        "プロフィールを作成しています...",
        "もう少しお待ちください...",
      ];
  let stepIdx = 0;
  status.textContent = steps[0];
  const stepTimer = setInterval(() => {
    stepIdx++;
    if (stepIdx < steps.length) {
      status.textContent = steps[stepIdx];
    }
  }, inputMode === "url" ? 8000 : 5000);

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${WORKER_BASE}/api/analyze-company`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || "分析に失敗しました");
    }

    companyProfile = await resp.json();
    renderProfileCard();
    // Show profile section in the same step
    document.getElementById("profileSection").classList.remove("hidden");
    status.classList.add("hidden");
  } catch (err) {
    status.textContent = `エラー: ${err.message}`;
    status.style.color = "var(--danger)";
  } finally {
    clearInterval(stepTimer);
    btn.disabled = false;
    btn.textContent = "AIで分析する";
  }
}

function confirmProfileAndNext() {
  // Collect edited profile values
  companyProfile = getEditedProfile();
  goOnboardingStep(2);
  loadAreas();
}

function renderProfileCard() {
  if (!companyProfile) return;
  const card = document.getElementById("profileCard");
  const p = companyProfile;
  card.innerHTML = `
    <div class="profile-card__row">
      <span class="profile-card__label">会社名</span>
      <input class="input input--sm profile-edit" id="editCompanyName" value="${escapeHtml(p.company_name || "")}">
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">所在地</span>
      <input class="input input--sm profile-edit" id="editLocation" value="${escapeHtml(p.location || "")}">
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">事業分野</span>
      <input class="input input--sm profile-edit" id="editBusinessAreas" value="${escapeHtml((p.business_areas || []).join("、"))}">
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">提供サービス</span>
      <input class="input input--sm profile-edit" id="editServices" value="${escapeHtml((p.services || []).join("、"))}">
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">強み</span>
      <input class="input input--sm profile-edit" id="editStrengths" value="${escapeHtml((p.strengths || []).join("、"))}">
    </div>
    <div class="profile-card__row">
      <span class="profile-card__label">マッチングKW</span>
      <input class="input input--sm profile-edit" id="editKeywords" value="${escapeHtml((p.matching_keywords || []).join("、"))}" placeholder="カンマ区切りで入力">
    </div>
  `;
}

function getEditedProfile() {
  const splitJa = (val) => val.split(/[、,]/).map(s => s.trim()).filter(Boolean);
  return {
    ...companyProfile,
    company_name: document.getElementById("editCompanyName")?.value.trim() || companyProfile.company_name,
    location: document.getElementById("editLocation")?.value.trim() || companyProfile.location,
    business_areas: splitJa(document.getElementById("editBusinessAreas")?.value || ""),
    services: splitJa(document.getElementById("editServices")?.value || ""),
    strengths: splitJa(document.getElementById("editStrengths")?.value || ""),
    matching_keywords: splitJa(document.getElementById("editKeywords")?.value || ""),
  };
}

const REGION_MAP = {
  "北海道・東北": ["hokkaido","aomori","iwate","miyagi","akita","yamagata","fukushima"],
  "関東": ["ibaraki","tochigi","gunma","saitama","chiba","tokyo","kanagawa"],
  "中部": ["niigata","toyama","ishikawa","fukui","yamanashi","nagano","gifu","shizuoka","aichi","mie"],
  "近畿": ["shiga","kyoto","osaka","hyogo","nara","wakayama"],
  "中国": ["tottori","shimane","okayama","hiroshima","yamaguchi"],
  "四国": ["tokushima","kagawa","ehime","kochi"],
  "九州・沖縄": ["fukuoka","saga","nagasaki","kumamoto","oita","miyazaki","kagoshima","okinawa"],
};

async function loadAreas() {
  try {
    const resp = await fetch(`${WORKER_BASE}/api/areas`);
    const data = await resp.json();
    const areas = data.areas || [];
    const areaMap = {};
    areas.forEach(a => { areaMap[a.area_id] = a; });

    const container = document.getElementById("areaSelector");
    let html = "";

    for (const [regionName, areaIds] of Object.entries(REGION_MAP)) {
      const regionAreas = areaIds.filter(id => areaMap[id]);
      if (regionAreas.length === 0) continue;
      html += `<div class="area-region-group">
        <div class="area-region-group__title">${escapeHtml(regionName)}</div>
        <div class="area-region-group__items">`;
      for (const areaId of regionAreas) {
        const area = areaMap[areaId];
        html += `<div class="area-checkbox" onclick="toggleAreaCheckbox(this)">
          <input type="checkbox" value="${escapeHtml(area.area_id)}">
          <div class="area-checkbox__info">
            <h4>${escapeHtml(area.area_name)}</h4>
          </div>
        </div>`;
      }
      html += `</div></div>`;
    }

    container.innerHTML = html;
    updateAreaCount();
  } catch {
    document.getElementById("areaSelector").innerHTML = "<p>エリア情報の取得に失敗しました。</p>";
  }
}

function updateAreaCount() {
  const checked = document.querySelectorAll("#areaSelector input:checked").length;
  const countEl = document.getElementById("areaCount");
  if (countEl) countEl.textContent = checked;

  document.querySelectorAll("#areaSelector input[type=checkbox]").forEach(cb => {
    if (!cb.checked && checked >= MAX_AREAS) {
      cb.disabled = true;
      cb.closest(".area-checkbox")?.classList.add("area-checkbox--disabled");
    } else {
      cb.disabled = false;
      cb.closest(".area-checkbox")?.classList.remove("area-checkbox--disabled");
    }
  });
}

function toggleAreaCheckbox(el) {
  const cb = el.querySelector("input");
  if (!cb.checked) {
    const checked = document.querySelectorAll("#areaSelector input:checked").length;
    if (checked >= MAX_AREAS) {
      alert(`エリアは最大${MAX_AREAS}つまで選択できます`);
      return;
    }
  }
  cb.checked = !cb.checked;
  el.classList.toggle("checked", cb.checked);
  updateAreaCount();
}

function selectPlan(plan) {
  // reserved for future use
}

function deselectAllAreas() {
  document.querySelectorAll("#areaSelector input[type=checkbox]").forEach(cb => {
    cb.checked = false;
    cb.closest(".area-checkbox")?.classList.remove("checked");
  });
  updateAreaCount();
}

async function registerAndGoToPayment() {
  const areaIds = Array.from(document.querySelectorAll("#areaSelector input:checked"))
    .map(cb => cb.value);

  if (areaIds.length === 0) {
    alert("少なくとも1つのエリアを選択してください");
    return;
  }
  if (areaIds.length > MAX_AREAS) {
    alert(`エリアは最大${MAX_AREAS}つまで選択できます`);
    return;
  }

  try {
    const token = await getAccessToken();
    const companyUrl = document.getElementById("companyUrlInput")?.value.trim() || "";
    const companyText = document.getElementById("companyTextInput")?.value.trim() || "";

    // Register user + save profile + areas
    const resp = await fetch(`${WORKER_BASE}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        company_url: companyUrl || undefined,
        company_text: companyText || undefined,
        area_ids: areaIds,
        profile: companyProfile,
      }),
    });

    if (resp.status === 409) {
      // 既登録ユーザーがオンボーディングを通過しようとした場合
      // ダッシュボードへリダイレクトして既存データを保護する
      userOnboarded = true;
      showPage("dashboard");
      return;
    }
    if (!resp.ok) throw new Error("登録に失敗しました");

    userOnboarded = true;
    goOnboardingStep(3);
  } catch (err) {
    alert(`エラー: ${err.message}`);
  }
}

async function startTrialCheckout() {
  const btn = document.getElementById("startTrialBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "処理中...";
  }

  try {
    const token = await getAccessToken();
    const checkoutResp = await fetch(`${WORKER_BASE}/api/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan: "monthly",
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
    btn.textContent = "トライアルを開始する";
  }
}

async function verifyCheckout(sessionId) {
  // Google Ads 購入コンバージョン送信
  if (typeof gtag === 'function') {
    gtag('event', 'conversion', {
      send_to: 'AW-17822680636/ObktCNO1nvwbELyMwrJC',
      value: 3980,
      currency: 'JPY'
    });
  }
  showPage("dashboard");
  loadOpportunities();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  if (!currentUser) return;
  userOnboarded = true;

  try {
    const token = await getAccessToken();

    // Load profile
    const profileResp = await fetch(`${WORKER_BASE}/api/user/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profileData = await profileResp.json();

    if (profileData.profile) {
      companyProfile = profileData.profile;
    }
    // companyProfile may already be set from onboarding AI analysis
    document.getElementById("dashCompanyName").textContent =
      companyProfile?.company_name || profileData.user?.notification_email?.split("@")[0] || "";

    // Status badge (trial期限切れ判定を含む)
    const statusEl = document.getElementById("dashStatus");
    const rawStatus = profileData.user?.status || "trial";
    const trialEndsAt = profileData.user?.trial_ends_at;
    const isTrialExpired = rawStatus === "trial" && trialEndsAt && new Date(trialEndsAt) <= new Date();
    const userStatus = isTrialExpired ? "expired" : rawStatus;
    statusEl.textContent = userStatus === "active" ? "有料プラン" : userStatus === "permanent_free" ? "永久無料プラン" : userStatus === "trial" ? "無料トライアル" : "無料プラン";
    statusEl.className = `badge badge--${userStatus === "expired" ? "free" : userStatus === "permanent_free" ? "active" : userStatus}`;

    // Load all areas for name resolution
    const areasResp = await fetch(`${WORKER_BASE}/api/areas`);
    const areasData = await areasResp.json();
    const allAreas = areasData.areas || [];
    const areaNameMap = {};
    allAreas.forEach(a => { areaNameMap[a.area_id] = a.area_name; });

    const userAreaIds = profileData.areas || [];

    // Info panel: 登録エリア & プロフィール要約
    const userAreaNames = userAreaIds.map(id => areaNameMap[id] || id);
    document.getElementById("dashAreas").textContent = userAreaNames.length > 0
      ? userAreaNames.join("、") : "未設定";

    const industryCats = companyProfile?.industry_categories || [];
    const hasOnlySonota = industryCats.length === 0 || (industryCats.length === 1 && industryCats[0] === "その他");

    if (companyProfile) {
      document.getElementById("dashBusiness").textContent =
        (companyProfile.business_areas || []).join("、") || "-";
      const indEl = document.getElementById("dashIndustries");
      if (indEl) {
        indEl.textContent = industryCats.join("、") || "未設定";
      }
    }

    // 業種またはエリア未設定の場合、設定を促すバナー表示
    const setupBanner = document.getElementById("setupBanner");
    if (setupBanner) {
      if (hasOnlySonota || userAreaIds.length === 0) {
        const msgs = [];
        if (hasOnlySonota) msgs.push("業種カテゴリ");
        if (userAreaIds.length === 0) msgs.push("エリア");
        setupBanner.innerHTML = `
          <div class="setup-banner">
            <span>${msgs.join("・")}を設定すると、マッチする案件が表示されます。</span>
            <button class="btn btn--primary btn--sm" onclick="switchTab('settings')">設定する</button>
          </div>`;
        setupBanner.classList.remove("hidden");
      } else {
        setupBanner.classList.add("hidden");
      }
    }

    // 案件一覧を読み込み（業種マッチ方式）
    loadOpportunities();

    // Load settings
    loadSettings(profileData);

    // Load subscription
    loadSubscription();
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

let currentTier = "free";
let currentIsPaid = false;
let totalUnfiltered = 0;
let userIndustries = [];

async function loadOpportunities() {
  const token = await getAccessToken();
  const industryFilter = document.getElementById("filterIndustry")?.value || "";
  const sortValue = document.getElementById("sortSelect")?.value || "scraped_desc";

  const params = new URLSearchParams({ limit: "500" });
  if (industryFilter) params.set("industry", industryFilter);
  if (sortValue) params.set("sort", sortValue);

  try {
    const resp = await fetch(`${WORKER_BASE}/api/user/opportunities?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    currentTier = data.tier || "free";
    currentIsPaid = data.is_paid || false;
    totalUnfiltered = data.total_unfiltered || 0;
    userIndustries = data.user_industries || [];
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
        <p>現在マッチする案件はありません。</p>
        <p>AIが毎朝8:00に行政サイトをチェックし、貴社の業種にマッチする案件をお届けします。</p>
      </div>
    `;
    return;
  }

  let html = items.map((item) => {
    const opp = item.opportunities || {};
    const oppId = item.opportunity_id || opp.id || "";

    const areaName = AREA_NAMES[opp.area_id] || opp.area_id || "";
    const deadlineStr = opp.deadline || "";
    const publishedStr = opp.published_date || "";
    const bidDateStr = opp.bid_opening_date || "";
    const contractStr = opp.contract_period || "";
    const briefingStr = opp.briefing_date || "";
    const scrapedAt = opp.scraped_at ? opp.scraped_at.split("T")[0] : "";
    const summaryText = opp.detailed_summary || opp.summary || "";
    const industryCategory = opp.industry_category || "";
    const budgetStr = opp.budget || "";
    const contactStr = opp.contact_info || "";

    const detailUrl = opp.detail_url || "";

    // 日付行: あるものだけ表示
    const dateParts = [];
    if (publishedStr) dateParts.push(`<span class="opp-card__date">公開: ${escapeHtml(publishedStr)}</span>`);
    if (deadlineStr) dateParts.push(`<span class="opp-card__deadline">締切: ${escapeHtml(deadlineStr)}</span>`);
    if (bidDateStr) dateParts.push(`<span class="opp-card__date">開札: ${escapeHtml(bidDateStr)}</span>`);
    if (briefingStr) dateParts.push(`<span class="opp-card__date">説明会: ${escapeHtml(briefingStr)}</span>`);
    if (contractStr) dateParts.push(`<span class="opp-card__date">履行: ${escapeHtml(contractStr)}</span>`);
    if (!dateParts.length) dateParts.push(`<span class="opp-card__date">取得: ${escapeHtml(scrapedAt)}</span>`);

    // 基本情報（全ユーザー共通）
    let cardHtml = `
      <div class="opp-card" id="opp-${escapeHtml(oppId)}">
        <div class="opp-card__body">
          <div class="opp-card__title">${escapeHtml(opp.title || item.title || "不明")}</div>
          <div class="opp-card__meta">
            ${areaName ? `${escapeHtml(areaName)} ` : ""}${escapeHtml(opp.organization || "")}
            ${opp.method ? ` / ${escapeHtml(opp.method)}` : ""}
          </div>
          <div class="opp-card__dates">${dateParts.join("")}</div>
          ${industryCategory ? `<span class="opp-card__industry">${escapeHtml(industryCategory)}</span>` : ""}`;

    if (currentIsPaid) {
      // 有料ユーザー: 詳細情報 + アクション
      if (budgetStr) cardHtml += `<div class="opp-card__meta">予算: ${escapeHtml(budgetStr)}</div>`;
      if (summaryText) cardHtml += `<div class="opp-card__summary">${escapeHtml(summaryText)}</div>`;
      if (contactStr) cardHtml += `<div class="opp-card__contact">${escapeHtml(contactStr)}</div>`;
      cardHtml += `<div class="opp-card__actions">
            ${detailUrl ? `<a href="${escapeHtml(detailUrl)}" target="_blank" class="btn btn--outline btn--sm">詳細を見る</a>` : ""}
            <button class="btn btn--primary btn--sm" onclick="analyzeOpportunity('${escapeHtml(oppId)}')">AI詳細分析</button>
          </div>
          <div class="opp-card__analysis hidden" id="analysis-${escapeHtml(oppId)}"></div>`;
    } else {
      // 無料ユーザー: カード全体をぼかし表示
      if (budgetStr) cardHtml += `<div class="opp-card__meta">予算: ${escapeHtml(budgetStr)}</div>`;
      if (summaryText) cardHtml += `<div class="opp-card__summary">${escapeHtml(summaryText)}</div>`;
      cardHtml += `</div></div>`;
      return `<div class="opp-card-blur-wrapper">
  <div style="filter:blur(5px);pointer-events:none;">${cardHtml}</div>
  <div class="opp-card-blur-overlay">
    <p>有料プランで案件の詳細を閲覧できます</p>
    <button class="btn btn--primary btn--sm" onclick="switchTab('subscription')">プランを見る</button>
  </div>
</div>`;
    }

    cardHtml += `</div></div>`;
    return cardHtml;
  }).join("");

  // Upgrade CTA for free tier
  if (!currentIsPaid) {
    html += `
      <div class="upgrade-cta">
        <p>詳細情報・AI分析は有料プランで利用できます</p>
        <button class="btn btn--primary" onclick="switchTab('subscription')">プランをアップグレード</button>
      </div>
    `;
  }

  list.innerHTML = html;
}

// ---------------------------------------------------------------------------
// AI Detailed Analysis
// ---------------------------------------------------------------------------

async function analyzeOpportunity(oppId) {
  const panel = document.getElementById(`analysis-${oppId}`);
  if (!panel) return;

  // トグル: 既に表示済みなら閉じる
  if (!panel.classList.contains("hidden") && panel.querySelector(".analysis-panel")) {
    panel.classList.add("hidden");
    return;
  }

  // セッション確認: 未ログインならログインモーダル表示
  const token = await getAccessToken();
  if (!token) {
    showLoginModal();
    return;
  }

  // ローディング表示
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="analysis-loading">AI が詳細分析中...</div>`;

  try {
    const resp = await fetch(`${WORKER_BASE}/api/opportunity/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ opportunity_id: oppId }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || "分析に失敗しました");
    }

    const analysis = await resp.json();
    panel.innerHTML = renderDetailedAnalysis(analysis);

  } catch (err) {
    panel.innerHTML = `<div class="analysis-loading" style="color:var(--danger)">分析エラー: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDetailedAnalysis(a) {
  const diffClass = a.estimated_difficulty === "高" ? "high" : a.estimated_difficulty === "低" ? "low" : "mid";

  const matchPoints = (a.match_points || []).map(p => `<li>${escapeHtml(p)}</li>`).join("");
  const concerns = (a.concerns || []).map(c => `<li>${escapeHtml(c)}</li>`).join("");
  const actions = (a.actions || []).map(ac => `<li>${escapeHtml(ac)}</li>`).join("");

  return `
    <div class="analysis-panel">
      <div class="analysis-panel__summary">${escapeHtml(a.summary || "")}</div>

      <div class="analysis-panel__section analysis-panel__section--match">
        <h4>&#x2714; マッチポイント</h4>
        <ul>${matchPoints}</ul>
      </div>

      <div class="analysis-panel__section analysis-panel__section--concern">
        <h4>&#x26A0; 懸念点</h4>
        <ul>${concerns}</ul>
      </div>

      <div class="analysis-panel__section analysis-panel__section--action">
        <h4>&#x1F4CB; アクションプラン</h4>
        <ul>${actions}</ul>
      </div>

      <div class="analysis-panel__meta">
        <span class="analysis-badge analysis-badge--difficulty-${diffClass}">難易度: ${escapeHtml(a.estimated_difficulty || "中")}</span>
        <span class="analysis-badge analysis-badge--days">準備目安: ${a.recommended_preparation_days || "?"}日</span>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function loadSettings(profileData) {
  if (!profileData) return;

  // アカウント情報セクション
  const accountSection = document.getElementById("settingsAccount");
  if (accountSection) {
    const user = profileData.user || {};
    const email = currentUser?.email || user.notification_email || "";
    const isGoogleUser = currentUser?.app_metadata?.provider === "google";
    accountSection.innerHTML = `
      <div class="profile-card__row">
        <span class="profile-card__label">メールアドレス</span>
        <span class="profile-card__value">${escapeHtml(email)}</span>
      </div>
      <div class="profile-card__row">
        <span class="profile-card__label">ログイン方法</span>
        <span class="profile-card__value">${isGoogleUser ? "Google アカウント" : "メール + パスワード"}</span>
      </div>
      ${!isGoogleUser ? `
      <div id="passwordChangeSection" style="margin-top:12px;">
        <button class="btn btn--outline btn--sm" onclick="togglePasswordChange()">パスワードを変更</button>
        <div id="passwordChangeForm" class="hidden" style="margin-top:12px;">
          <input type="password" id="newPassword" class="input" placeholder="新しいパスワード（6文字以上）" minlength="6" style="margin-bottom:8px;">
          <input type="password" id="newPasswordConfirm" class="input" placeholder="パスワード確認" minlength="6" style="margin-bottom:8px;">
          <div style="display:flex;gap:8px;">
            <button class="btn btn--primary btn--sm" onclick="changePassword()">変更する</button>
            <button class="btn btn--outline btn--sm" onclick="togglePasswordChange()">キャンセル</button>
          </div>
          <div id="passwordChangeStatus" class="status-msg hidden" style="margin-top:8px;"></div>
        </div>
      </div>` : ""}
    `;
  }

  // Profile info - full display
  const settingsProfile = document.getElementById("settingsProfile");
  const p = companyProfile || {};
  const companyUrl = profileData.user?.company_url || "";
  const hasProfile = p.company_name || (p.business_areas || []).length > 0;

  if (hasProfile) {
    settingsProfile.innerHTML = `
      <div class="profile-card__row"><span class="profile-card__label">会社名</span><span class="profile-card__value">${escapeHtml(p.company_name || "未設定")}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">所在地</span><span class="profile-card__value">${escapeHtml(p.location || "未設定")}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">事業分野</span><span class="profile-card__value">${escapeHtml((p.business_areas || []).join("、") || "未設定")}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">提供サービス</span><span class="profile-card__value">${escapeHtml((p.services || []).join("、") || "未設定")}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">強み</span><span class="profile-card__value">${escapeHtml((p.strengths || []).join("、") || "未設定")}</span></div>
      ${companyUrl ? `<div class="profile-card__row"><span class="profile-card__label">URL</span><span class="profile-card__value"><a href="${escapeHtml(companyUrl)}" target="_blank" style="color:var(--accent)">${escapeHtml(companyUrl)}</a></span></div>` : ""}
      <button class="btn btn--outline btn--sm" onclick="startProfileEdit()" style="margin-top:12px;">プロフィールを編集</button>
    `;
  } else {
    // プロフィール未設定 → 業種選択を直接表示
    const currentCats = (p.industry_categories || []);
    settingsProfile.innerHTML = `
      <div class="settings-empty-profile">
        <p style="color:var(--text-secondary);margin-bottom:12px;">業種カテゴリを選択すると、マッチする案件が表示されます。</p>
        <div style="margin-bottom:12px;">
          <label class="input-label" style="margin-bottom:8px;display:block;">業種カテゴリ（1つ以上選択）</label>
          <div id="quickIndustryCategories" style="display:flex;flex-wrap:wrap;gap:8px;">
            ${ALL_INDUSTRY_CATEGORIES.map(cat => {
              const checked = currentCats.includes(cat) ? "checked" : "";
              return `<label style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
                <input type="checkbox" value="${escapeHtml(cat)}" ${checked} class="quick-industry-checkbox"> ${escapeHtml(cat)}
              </label>`;
            }).join("")}
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <p style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">HPのURLを入力するとAIが業種を自動判定します（任意）</p>
          <div style="display:flex;gap:8px;">
            <input type="url" id="quickCompanyUrl" class="input input--sm" placeholder="https://example.co.jp" style="flex:1;">
            <button class="btn btn--outline btn--sm" onclick="quickAnalyzeUrl()">AI判定</button>
          </div>
          <div id="quickAnalyzeStatus" class="status-msg hidden" style="margin-top:4px;font-size:12px;"></div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn--primary btn--sm" onclick="saveQuickIndustry()">業種を保存</button>
          <button class="btn btn--outline btn--sm" onclick="startProfileEdit()">詳細を編集</button>
        </div>
        <div id="quickSaveStatus" class="status-msg hidden" style="margin-top:8px;"></div>
      </div>
    `;
  }

  // Notification settings
  const user = profileData.user || {};
  document.getElementById("settingEmailNotify").checked = user.email_notify !== false;
  // Area editor
  renderSettingsAreas(profileData);
}


// ---------------------------------------------------------------------------
// Settings: Area Editor
// ---------------------------------------------------------------------------

let _allAreasCache = [];
let _userAreaIdsCache = [];

async function renderSettingsAreas(profileData) {
  const container = document.getElementById("settingsAreaEditor");
  if (!container) return;

  _userAreaIdsCache = profileData?.areas || [];

  // Load all areas if not cached
  if (_allAreasCache.length === 0) {
    try {
      const resp = await fetch(`${WORKER_BASE}/api/areas`);
      const data = await resp.json();
      _allAreasCache = data.areas || [];
    } catch {
      container.innerHTML = "<p>エリア情報の取得に失敗しました。</p>";
      return;
    }
  }

  const areaMap = {};
  _allAreasCache.forEach(a => { areaMap[a.area_id] = a; });

  // Current areas display
  const currentAreaNames = _userAreaIdsCache.map(id => areaMap[id]?.area_name || id);

  let html = `<div class="settings-area-current">
    <span class="settings-area-label">現在の登録エリア:</span>
    <div class="settings-area-tags">
      ${currentAreaNames.length > 0
        ? currentAreaNames.map(name => `<span class="keyword-tag">${escapeHtml(name)}</span>`).join("")
        : '<span style="color:var(--text-muted)">未設定</span>'}
    </div>
    <button class="btn btn--outline btn--sm" onclick="toggleAreaEditor()" id="areaEditorToggleBtn" style="margin-top:12px;">エリアを変更する</button>
  </div>`;

  // Area selector (hidden by default)
  html += `<div id="settingsAreaSelector" class="hidden" style="margin-top:16px;">
    <p style="color:var(--text-secondary);margin-bottom:8px;">最大3エリアまで選択できます。</p>
    <div class="settings-area-count">選択済み: <strong id="settingsAreaCount">${_userAreaIdsCache.length}</strong> / 3</div>`;

  for (const [regionName, areaIds] of Object.entries(REGION_MAP)) {
    const regionAreas = areaIds.filter(id => areaMap[id]);
    if (regionAreas.length === 0) continue;
    html += `<div class="area-region-group area-region-group--settings">
      <div class="area-region-group__title">${escapeHtml(regionName)}</div>
      <div class="area-region-group__items">`;
    for (const areaId of regionAreas) {
      const area = areaMap[areaId];
      const isChecked = _userAreaIdsCache.includes(areaId);
      const checkedAttr = isChecked ? "checked" : "";
      const checkedClass = isChecked ? "checked" : "";
      html += `<div class="area-checkbox ${checkedClass}" onclick="toggleSettingsAreaCheckbox(this)">
        <input type="checkbox" value="${escapeHtml(area.area_id)}" ${checkedAttr}>
        <div class="area-checkbox__info">
          <h4>${escapeHtml(area.area_name)}</h4>
        </div>
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `<div style="margin-top:16px;display:flex;gap:8px;">
    <button class="btn btn--primary btn--sm" onclick="saveSettingsAreas()">エリアを保存</button>
    <button class="btn btn--outline btn--sm" onclick="toggleAreaEditor()">キャンセル</button>
  </div>
  <div id="settingsAreaStatus" class="status-msg hidden" style="margin-top:8px;"></div>
  </div>`;

  container.innerHTML = html;
  updateSettingsAreaCount();
}

function toggleAreaEditor() {
  const selector = document.getElementById("settingsAreaSelector");
  if (!selector) return;
  selector.classList.toggle("hidden");
  const btn = document.getElementById("areaEditorToggleBtn");
  if (btn) btn.textContent = selector.classList.contains("hidden") ? "エリアを変更する" : "閉じる";
}

function toggleSettingsAreaCheckbox(el) {
  const cb = el.querySelector("input");
  if (!cb.checked) {
    const checked = document.querySelectorAll("#settingsAreaSelector input:checked").length;
    if (checked >= MAX_AREAS) {
      alert(`エリアは最大${MAX_AREAS}つまで選択できます`);
      return;
    }
  }
  cb.checked = !cb.checked;
  el.classList.toggle("checked", cb.checked);
  updateSettingsAreaCount();
}

function updateSettingsAreaCount() {
  const checked = document.querySelectorAll("#settingsAreaSelector input:checked").length;
  const countEl = document.getElementById("settingsAreaCount");
  if (countEl) countEl.textContent = checked;

  document.querySelectorAll("#settingsAreaSelector input[type=checkbox]").forEach(cb => {
    if (!cb.checked && checked >= MAX_AREAS) {
      cb.disabled = true;
      cb.closest(".area-checkbox")?.classList.add("area-checkbox--disabled");
    } else {
      cb.disabled = false;
      cb.closest(".area-checkbox")?.classList.remove("area-checkbox--disabled");
    }
  });
}

async function saveSettingsAreas() {
  const areaIds = Array.from(document.querySelectorAll("#settingsAreaSelector input:checked"))
    .map(cb => cb.value);
  const statusEl = document.getElementById("settingsAreaStatus");

  if (areaIds.length === 0) {
    alert("少なくとも1つのエリアを選択してください");
    return;
  }

  statusEl.textContent = "保存中...";
  statusEl.classList.remove("hidden");
  statusEl.style.color = "";

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${WORKER_BASE}/api/user/areas`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ area_ids: areaIds }),
    });
    if (!resp.ok) throw new Error("保存に失敗しました");

    statusEl.textContent = "エリアを更新しました";
    statusEl.style.color = "var(--success)";

    // Reload dashboard to refresh filter and info panel
    setTimeout(() => { loadDashboard(); }, 800);
  } catch (err) {
    statusEl.textContent = `エラー: ${err.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

async function saveSettings() {
  const token = await getAccessToken();
  await fetch(`${WORKER_BASE}/api/user/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email_notify: document.getElementById("settingEmailNotify").checked,
    }),
  });
}

function togglePasswordChange() {
  const form = document.getElementById("passwordChangeForm");
  if (form) form.classList.toggle("hidden");
}

async function changePassword() {
  const newPw = document.getElementById("newPassword").value;
  const confirmPw = document.getElementById("newPasswordConfirm").value;
  const statusEl = document.getElementById("passwordChangeStatus");

  if (!newPw || newPw.length < 6) {
    statusEl.textContent = "パスワードは6文字以上で入力してください";
    statusEl.style.color = "var(--danger)";
    statusEl.classList.remove("hidden");
    return;
  }
  if (newPw !== confirmPw) {
    statusEl.textContent = "パスワードが一致しません";
    statusEl.style.color = "var(--danger)";
    statusEl.classList.remove("hidden");
    return;
  }

  statusEl.textContent = "変更中...";
  statusEl.style.color = "";
  statusEl.classList.remove("hidden");

  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPw });
    if (error) throw error;
    statusEl.textContent = "パスワードを変更しました";
    statusEl.style.color = "var(--success)";
    document.getElementById("newPassword").value = "";
    document.getElementById("newPasswordConfirm").value = "";
    setTimeout(() => togglePasswordChange(), 1500);
  } catch (err) {
    statusEl.textContent = `エラー: ${err.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

const ALL_INDUSTRY_CATEGORIES = ["IT・DX", "建設・土木", "コンサル・調査", "広告・クリエイティブ", "設備・物品", "清掃・管理", "医療・福祉", "教育・研修", "環境・エネルギー", "その他"];

function startProfileEdit() {
  const editPanel = document.getElementById("settingsProfileEdit");
  editPanel.classList.remove("hidden");

  // Pre-fill fields with current profile
  const p = companyProfile || {};
  document.getElementById("editCompanyName").value = p.company_name || "";
  document.getElementById("editLocation").value = p.location || "";
  document.getElementById("editBusinessAreas").value = (p.business_areas || []).join("、");
  document.getElementById("editServices").value = (p.services || []).join("、");
  document.getElementById("editStrengths").value = (p.strengths || []).join("、");

  // Render industry category checkboxes
  const container = document.getElementById("editIndustryCategories");
  const current = p.industry_categories || [];
  container.innerHTML = ALL_INDUSTRY_CATEGORIES.map(cat => {
    const checked = current.includes(cat) ? "checked" : "";
    return `<label style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
      <input type="checkbox" value="${escapeHtml(cat)}" ${checked} class="industry-cat-checkbox"> ${escapeHtml(cat)}
    </label>`;
  }).join("");

  // Default to manual mode
  switchProfileEditMode("manual");
}

function cancelProfileEdit() {
  document.getElementById("settingsProfileEdit").classList.add("hidden");
  const statusEl = document.getElementById("settingsAnalyzeStatus");
  statusEl.classList.add("hidden");
  statusEl.textContent = "";
}

function switchProfileEditMode(mode) {
  const manualGroup = document.getElementById("profileEditManual");
  const urlGroup = document.getElementById("profileEditUrl");
  const tabManual = document.getElementById("settingsEditTabManual");
  const tabUrl = document.getElementById("settingsEditTabUrl");

  if (mode === "manual") {
    manualGroup.classList.remove("hidden");
    urlGroup.classList.add("hidden");
    tabManual.classList.add("active");
    tabUrl.classList.remove("active");
  } else {
    manualGroup.classList.add("hidden");
    urlGroup.classList.remove("hidden");
    tabManual.classList.remove("active");
    tabUrl.classList.add("active");
  }
}

function _splitInput(val) {
  return val.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
}

async function saveQuickIndustry() {
  const cats = Array.from(document.querySelectorAll(".quick-industry-checkbox:checked")).map(cb => cb.value);
  if (cats.length === 0) { alert("業種カテゴリを1つ以上選択してください"); return; }

  const statusEl = document.getElementById("quickSaveStatus");
  statusEl.textContent = "保存中...";
  statusEl.classList.remove("hidden");
  statusEl.style.color = "";

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${WORKER_BASE}/api/user/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ industry_categories: cats }),
    });
    if (!resp.ok) throw new Error("保存に失敗しました");

    companyProfile = { ...companyProfile, industry_categories: cats };
    statusEl.textContent = "業種を保存しました";
    statusEl.style.color = "var(--success)";
    setTimeout(() => loadDashboard(), 800);
  } catch (err) {
    statusEl.textContent = `エラー: ${err.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

async function quickAnalyzeUrl() {
  const url = document.getElementById("quickCompanyUrl").value.trim();
  if (!url) { alert("URLを入力してください"); return; }
  const statusEl = document.getElementById("quickAnalyzeStatus");
  statusEl.textContent = "AIが分析中...";
  statusEl.classList.remove("hidden");
  statusEl.style.color = "";

  try {
    const token = await getAccessToken();
    const requestUrl = url.startsWith("http") ? url : "https://" + url;
    const resp = await fetch(`${WORKER_BASE}/api/analyze-company`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: requestUrl }),
    });
    if (!resp.ok) throw new Error("分析に失敗しました");

    const analyzed = await resp.json();
    const cats = analyzed.industry_categories || [];

    // チェックボックスを更新
    document.querySelectorAll(".quick-industry-checkbox").forEach(cb => {
      cb.checked = cats.includes(cb.value);
    });

    // プロフィール全体も保存
    await fetch(`${WORKER_BASE}/api/user/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...analyzed, company_url: requestUrl }),
    });
    companyProfile = { ...companyProfile, ...analyzed };

    statusEl.textContent = `判定完了: ${cats.join("、")}`;
    statusEl.style.color = "var(--success)";
  } catch (err) {
    statusEl.textContent = `エラー: ${err.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

async function saveProfileManual() {
  const companyName = document.getElementById("editCompanyName").value.trim();

  const profileUpdate = {
    company_name: companyName || null,
    location: document.getElementById("editLocation").value.trim(),
    business_areas: _splitInput(document.getElementById("editBusinessAreas").value),
    services: _splitInput(document.getElementById("editServices").value),
    strengths: _splitInput(document.getElementById("editStrengths").value),
    industry_categories: Array.from(document.querySelectorAll(".industry-cat-checkbox:checked")).map(cb => cb.value),
  };

  if (profileUpdate.industry_categories.length === 0) {
    alert("業種カテゴリを1つ以上選択してください");
    return;
  }

  const statusEl = document.getElementById("settingsAnalyzeStatus");
  statusEl.textContent = "保存中...";
  statusEl.classList.remove("hidden");
  statusEl.style.color = "";

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${WORKER_BASE}/api/user/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(profileUpdate),
    });
    if (!resp.ok) throw new Error("保存に失敗しました");

    // Update local state
    companyProfile = { ...companyProfile, ...profileUpdate };

    statusEl.textContent = "プロフィールを更新しました";
    statusEl.style.color = "var(--success)";
    cancelProfileEdit();
    loadDashboard();
  } catch (err) {
    statusEl.textContent = `エラー: ${err.message}`;
    statusEl.style.color = "var(--danger)";
  }
}

async function reanalyzeCompany() {
  const statusEl = document.getElementById("settingsAnalyzeStatus");
  const url = document.getElementById("settingsUrlInput").value.trim();
  if (!url) { alert("URLを入力してください"); return; }
  const requestBody = { url: url.startsWith("http") ? url : "https://" + url };

  statusEl.textContent = "AIが分析中...";
  statusEl.classList.remove("hidden");
  statusEl.style.color = "";

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${WORKER_BASE}/api/analyze-company`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) throw new Error("分析に失敗しました");

    const analyzed = await resp.json();

    // Save updated profile + company_url to server
    await fetch(`${WORKER_BASE}/api/user/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...analyzed, company_url: requestBody.url }),
    });

    companyProfile = { ...companyProfile, ...analyzed };

    statusEl.textContent = "分析が完了しました";
    statusEl.style.color = "var(--success)";
    cancelProfileEdit();
    loadDashboard();
  } catch (err) {
    statusEl.textContent = `エラー: ${err.message}`;
    statusEl.style.color = "var(--danger)";
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

  if (status === "permanent_free") {
    container.innerHTML = `
      <div class="sub-card">
        <div class="sub-card__plan">永久無料プラン</div>
        <p class="sub-card__desc">全機能を無料でご利用いただけます。</p>
      </div>
    `;
    return;
  }

  if (status === "none" || !sub) {
    // No subscription yet
    const isActiveTrial = status === "trial";
    const isExpired = status === "expired";
    const planLabel = isActiveTrial ? "無料トライアル中" : isExpired ? "トライアル期限切れ" : "無料プラン";
    container.innerHTML = `
      <div class="sub-card">
        <div class="sub-card__plan">${planLabel}</div>
        ${trialEnd ? `<div class="sub-card__info">トライアル終了日: ${new Date(trialEnd).toLocaleDateString("ja-JP")}</div>` : ""}
        ${isExpired ? `<p class="sub-card__desc" style="color:#f59e0b;">トライアル期間が終了しました。有料プランにアップグレードすると全機能をご利用いただけます。</p>` : ""}
        <p class="sub-card__desc">無料プラン: 案件一覧は閲覧可・詳細とAI分析は有料プラン限定</p>
        <button class="btn btn--primary btn--lg" onclick="startCheckout('monthly')">月額プラン ¥3,980 で開始</button>
      </div>
    `;
    return;
  }

  const planLabel = "月額プラン";
  const priceLabel = "¥3,980/月";
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
  if (!confirm("本当に解約しますか？\n\n・契約期間の終了まではサービスを引き続きご利用いただけます\n・解約後は無料プラン（5件表示）に移行します")) return;
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

// ---------------------------------------------------------------------------
// LP Sample Data (サンプルカード用のデモデータ)
// ---------------------------------------------------------------------------

const SAMPLE_DETAILS = [
  {
    title: "DX推進に係る業務効率化ツール導入支援業務委託",
    org: "愛知県 総務部 デジタル推進課",
    method: "企画競争（プロポーザル）",
    deadline: "2026年3月15日",
    published: "2026年2月20日",
    budget: "3,500万円（税込）",
    period: "2026年4月1日〜2027年3月31日",
    summary: "愛知県庁内の業務効率化を目的として、RPA・ワークフローツール等のDX関連ソリューションの選定・導入支援・職員研修・運用サポートを包括的に行う委託業務。対象部署は総務部を含む5部局、約200名の職員が利用予定。",
    contact: "愛知県総務部デジタル推進課 担当: 山田 TEL: 052-XXX-XXXX",
  },
  {
    title: "公共施設予約システムの更改及び運用保守業務",
    org: "名古屋市 市民経済局",
    method: "一般競争入札",
    deadline: "2026年3月22日",
    published: "2026年2月28日",
    budget: "8,200万円（税込・5年間総額）",
    period: "2026年7月1日〜2031年6月30日",
    summary: "名古屋市が管理する公共施設（体育館・会議室・ホール等 約150施設）の予約システムをオンプレミスからクラウド基盤へ移行し、市民向けオンライン予約機能の拡充、管理者向けダッシュボードの構築、及び5年間の運用保守を行う業務。",
    contact: "名古屋市市民経済局 情報システム課 担当: 佐藤 TEL: 052-XXX-XXXX",
  },
  {
    title: "庁舎空調設備保守点検業務委託",
    org: "東京都 財務局",
    method: "指名競争入札",
    deadline: "2026年3月10日",
    published: "2026年2月15日",
    budget: "1,800万円（税込・年額）",
    period: "2026年4月1日〜2027年3月31日",
    summary: "東京都庁舎（第一本庁舎・第二本庁舎）の空調設備に関する定期保守点検（年4回）、フィルター清掃・交換、緊急時の修繕対応、及び設備台帳の管理を行う業務委託。対象設備は中央熱源方式の空調機約320台。",
    contact: "東京都財務局 建築保全部 設備課 担当: 鈴木 TEL: 03-XXXX-XXXX",
  },
];

const SAMPLE_ANALYSES = [
  {
    summary: "自治体DX推進の業務効率化ツール導入支援案件です。IT・DXコンサルティング、RPA導入実績のある企業に高い親和性があります。プロポーザル方式のため、提案力と実績が重視されます。",
    match_points: [
      "DX推進・業務効率化ツールの導入支援経験が直接活かせる案件",
      "プロポーザル方式のため、価格だけでなく提案内容で差別化が可能",
      "愛知県での自治体DX実績があれば大きなアドバンテージ",
    ],
    concerns: [
      "5部局200名規模の大型案件のため、十分な体制構築が必要",
      "職員研修を含むため、研修実施体制・カリキュラム作成能力が求められる",
      "締切まで短期間のため、提案書作成の迅速な対応が必要",
    ],
    actions: [
      "過去の自治体DX支援実績を整理し、提案書のベースを作成する",
      "RPA・ワークフローツールのベンダーとの協業体制を確認する",
      "愛知県の既存DX計画・方針を事前調査し、提案に反映する",
      "プロジェクトマネージャー候補と技術チームの体制案を準備する",
    ],
    estimated_difficulty: "中",
    recommended_preparation_days: 14,
  },
  {
    summary: "名古屋市の公共施設予約システムのクラウド移行と5年間の運用保守案件です。自治体向けシステム開発・クラウド移行の実績がある企業に適しています。長期契約のため安定した収益が見込めます。",
    match_points: [
      "クラウド移行＋運用保守の長期契約で安定収益が期待できる",
      "公共施設予約システムの構築経験があれば強力なアピール材料",
      "5年間の運用保守契約により、継続的なリレーション構築が可能",
    ],
    concerns: [
      "150施設規模のデータ移行計画の策定が求められる",
      "既存システムからの移行に伴うダウンタイムの最小化が必須",
      "市民向けUIのアクセシビリティ対応が評価ポイントになる可能性",
    ],
    actions: [
      "類似の公共施設予約システム構築・移行実績をまとめる",
      "クラウド基盤（AWS/Azure/GCP）の選定根拠を準備する",
      "移行スケジュールとリスク軽減策のドラフトを作成する",
      "5年間の運用保守体制と費用の見積もりを準備する",
    ],
    estimated_difficulty: "高",
    recommended_preparation_days: 18,
  },
  {
    summary: "東京都庁舎の空調設備保守点検業務です。ビル設備管理・空調保守の実績がある企業に適しています。指名競争入札のため、実績と信頼性が重要です。",
    match_points: [
      "年間契約の安定した保守点検業務で、継続受注の可能性が高い",
      "東京都庁舎という大型施設の実績は、他案件獲得にも有利",
      "定期点検＋緊急対応の組み合わせで、技術力をアピール可能",
    ],
    concerns: [
      "指名競争入札のため、過去の都関連実績や有資格者の配置が求められる",
      "中央熱源方式の空調機320台という規模に対応できる体制が必要",
      "緊急時対応の体制（24時間対応等）が評価される可能性",
    ],
    actions: [
      "冷凍機械責任者・建築物環境衛生管理技術者等の有資格者をリストアップ",
      "過去の官公庁・大型ビルの空調保守実績を整理する",
      "緊急時対応フロー（連絡体制・駆付時間）のドラフトを準備する",
      "年間保守スケジュールのモデルプランを作成する",
    ],
    estimated_difficulty: "低",
    recommended_preparation_days: 10,
  },
];

function showSampleDetail(idx) {
  const panel = document.getElementById(`sample-panel-${idx}`);
  if (!panel) return;
  if (!panel.classList.contains("hidden") && panel.dataset.mode === "detail") {
    panel.classList.add("hidden");
    return;
  }
  const d = SAMPLE_DETAILS[idx];
  panel.dataset.mode = "detail";
  panel.innerHTML = `
    <div class="analysis-panel" style="border-left:3px solid var(--accent);">
      <div style="background:rgba(201,169,110,0.15);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--accent);font-weight:bold;">
        &#x1F4CB; これはサンプル表示です。実際の案件データではありません。
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-weight:bold;font-size:15px;margin-bottom:8px;">${escapeHtml(d.title)}</div>
        <div style="color:var(--text-muted);font-size:13px;">${escapeHtml(d.org)} / ${escapeHtml(d.method)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:13px;">
        <div><span style="color:var(--text-muted);">公開日:</span> ${escapeHtml(d.published)}</div>
        <div><span style="color:var(--text-muted);">締切:</span> ${escapeHtml(d.deadline)}</div>
        <div><span style="color:var(--text-muted);">予算:</span> ${escapeHtml(d.budget)}</div>
        <div><span style="color:var(--text-muted);">履行期間:</span> ${escapeHtml(d.period)}</div>
      </div>
      <div style="font-size:14px;line-height:1.7;margin-bottom:12px;">${escapeHtml(d.summary)}</div>
      <div style="font-size:13px;color:var(--text-muted);">連絡先: ${escapeHtml(d.contact)}</div>
    </div>
  `;
  panel.classList.remove("hidden");
}

function showSampleAnalysis(idx) {
  const panel = document.getElementById(`sample-panel-${idx}`);
  if (!panel) return;
  if (!panel.classList.contains("hidden") && panel.dataset.mode === "analysis") {
    panel.classList.add("hidden");
    return;
  }
  const a = SAMPLE_ANALYSES[idx];
  panel.dataset.mode = "analysis";
  const diffClass = a.estimated_difficulty === "高" ? "high" : a.estimated_difficulty === "低" ? "low" : "mid";
  panel.innerHTML = `
    <div class="analysis-panel">
      <div style="background:rgba(201,169,110,0.15);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--accent);font-weight:bold;">
        &#x1F4CB; これはサンプル表示です。実際のAI分析結果ではありません。
      </div>
      <div class="analysis-panel__summary">${escapeHtml(a.summary)}</div>
      <div class="analysis-panel__section analysis-panel__section--match">
        <h4>&#x2714; マッチポイント</h4>
        <ul>${a.match_points.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
      </div>
      <div class="analysis-panel__section analysis-panel__section--concern">
        <h4>&#x26A0; 懸念点</h4>
        <ul>${a.concerns.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
      </div>
      <div class="analysis-panel__section analysis-panel__section--action">
        <h4>&#x1F4CB; アクションプラン</h4>
        <ul>${a.actions.map(ac => `<li>${escapeHtml(ac)}</li>`).join("")}</ul>
      </div>
      <div class="analysis-panel__meta">
        <span class="analysis-badge analysis-badge--difficulty-${diffClass}">難易度: ${escapeHtml(a.estimated_difficulty)}</span>
        <span class="analysis-badge analysis-badge--days">準備目安: ${a.recommended_preparation_days}日</span>
      </div>
    </div>
  `;
  panel.classList.remove("hidden");
}
