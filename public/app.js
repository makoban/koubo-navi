// 公募ナビAI v2.7
// Fix: AI詳細分析キャッシュ配列修正、トライアルティア制限、KKJ API Count=1000

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
let selectedPlan = "monthly";
let authMode = "login"; // login | signup
let inputMode = "url"; // url | text
let userOnboarded = false;

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
  if (!document.getElementById("onboardingPage").classList.contains("hidden")) return "onboarding";
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
      // User has completed onboarding - remember status but stay on current page
      companyProfile = data.profile;
      userOnboarded = true;
      updateAuthUI();
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
        "マッチングキーワードを生成しています...",
        "プロフィールを作成しています...",
        "もう少しお待ちください...",
      ]
    : [
        "AIが事業内容を分析しています...",
        "事業分野を特定しています...",
        "マッチングキーワードを生成しています...",
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
  selectedPlan = plan;
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

    if (!resp.ok) throw new Error("登録に失敗しました");

    userOnboarded = true;
    goOnboardingStep(3);
  } catch (err) {
    alert(`エラー: ${err.message}`);
  }
}

async function startTrialCheckout() {
  const btn = document.getElementById("startTrialBtn");
  btn.disabled = true;
  btn.textContent = "処理中...";

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
  // After returning from Stripe, show dashboard and trigger initial screening
  showPage("dashboard");
  try {
    const token = await getAccessToken();
    if (token) triggerInitialScreening(token);
  } catch {
    // スクリーニングに失敗してもダッシュボードは表示
  }
}

async function triggerInitialScreening(token) {
  try {
    const screenResp = await fetch(`${WORKER_BASE}/api/user/screen`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const screenData = await screenResp.json();

    if (screenData.status === "already_done") {
      loadOpportunities();
      return;
    }

    if (screenData.status === "screening_started") {
      // スクリーニング進捗を表示
      const list = document.getElementById("opportunityList");
      list.innerHTML = `
        <div class="empty-state" id="screeningProgress">
          <p style="font-size:24px;">&#x1F50D;</p>
          <p style="color:var(--accent);font-weight:600;">AIが過去30日分の案件をスクリーニング中...</p>
          <p>しばらくお待ちください。案件が見つかり次第表示されます。</p>
        </div>
      `;

      // 5秒間隔でポーリング（最大12回 = 60秒）
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const resp = await fetch(`${WORKER_BASE}/api/user/opportunities?limit=1`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await resp.json();
          if ((data.opportunities || []).length > 0 || attempts >= 12) {
            clearInterval(poll);
            loadOpportunities();
          }
        } catch {
          if (attempts >= 12) {
            clearInterval(poll);
            loadOpportunities();
          }
        }
      }, 5000);
    } else {
      loadOpportunities();
    }
  } catch {
    loadOpportunities();
  }
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

    // Status badge
    const statusEl = document.getElementById("dashStatus");
    const userStatus = profileData.user?.status || "trial";
    statusEl.textContent = userStatus === "active" ? "有料プラン" : userStatus === "trial" ? "無料トライアル" : userStatus;
    statusEl.className = `badge badge--${userStatus}`;

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

    if (companyProfile) {
      document.getElementById("dashBusiness").textContent =
        (companyProfile.business_areas || []).join("、") || "-";
      document.getElementById("dashKeywords").textContent =
        (companyProfile.matching_keywords || []).join("、") || "-";
    }

    // Trigger initial screening if not done yet (ensures matches exist even without Stripe return)
    if (profileData.user && !profileData.user.initial_screening_done) {
      triggerInitialScreening(token);
    } else {
      loadOpportunities();
    }

    // Load settings
    loadSettings(profileData);

    // Load subscription
    loadSubscription();
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

let currentTier = "free";
let totalUnfiltered = 0;

async function loadOpportunities() {
  const token = await getAccessToken();
  const scoreMin = document.getElementById("filterScore").value;

  const params = new URLSearchParams({ score_min: scoreMin, limit: "200" });

  try {
    const resp = await fetch(`${WORKER_BASE}/api/user/opportunities?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    currentTier = data.tier || "free";
    totalUnfiltered = data.total_unfiltered || 0;
    renderOpportunities(data.opportunities || []);
  } catch {
    renderOpportunities([]);
  }
}

function renderOpportunities(items) {
  const list = document.getElementById("opportunityList");
  const countEl = document.getElementById("oppCount");
  const visibleCount = currentTier === "paid" ? items.length : currentTier === "trial" ? Math.min(10, items.length) : Math.min(5, items.length);
  countEl.textContent = `${items.length}件`;

  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>現在マッチする案件はまだありません。</p>
        <p>AIが毎朝8:00に行政サイトをチェックし、新しい案件が見つかり次第こちらに表示されます。</p>
        <p style="color:var(--text-muted);margin-top:8px;">初回スクリーニングには最大24時間かかる場合があります。</p>
      </div>
    `;
    return;
  }

  let html = items.map((item, idx) => {
    const opp = item.opportunities || {};
    const score = item.match_score;
    const hasScore = score !== null && score !== undefined;
    const scoreClass = !hasScore ? "unscored" : score >= 80 ? "high" : score >= 60 ? "mid" : "low";
    const scoreLabel = hasScore ? `${score}%` : "未評価";
    const rec = item.recommendation || "";
    const rank = item.rank_position || (idx + 1);
    const oppId = item.opportunity_id || opp.id || "";
    const isBlurred = (currentTier !== "paid") && idx >= visibleCount;

    const areaName = AREA_NAMES[opp.area_id] || opp.area_id || "";
    const deadlineStr = opp.deadline || "";
    const summaryText = opp.summary || "";

    return `
      <div class="opp-card ${isBlurred ? 'opp-card--blurred' : ''}" id="opp-${escapeHtml(oppId)}">
        ${isBlurred ? '<div class="opp-card__blur-overlay" onclick="switchTab(\'subscription\')"><span>有料プランで表示</span></div>' : ''}
        <div class="opp-card__rank">#${rank}</div>
        <div class="opp-card__score opp-card__score--${scoreClass}">${scoreLabel}</div>
        <div class="opp-card__body">
          <div class="opp-card__title">${escapeHtml(opp.title || item.title || "不明")}</div>
          <div class="opp-card__meta">
            ${areaName ? `<span class="opp-card__area">${escapeHtml(areaName)}</span>` : ""}
            ${escapeHtml(opp.organization || "")}
            ${opp.category ? ` / ${escapeHtml(opp.category)}` : ""}
            ${opp.method ? ` / ${escapeHtml(opp.method)}` : ""}
          </div>
          ${deadlineStr ? `<div class="opp-card__deadline">締切: ${escapeHtml(deadlineStr)}</div>` : ""}
          ${summaryText ? `<div class="opp-card__summary">${escapeHtml(summaryText)}</div>` : ""}
          ${rec ? `<div class="opp-card__reason">${escapeHtml(rec)}</div>` : ""}
          <div class="opp-card__actions">
            ${opp.detail_url ? `<a href="${escapeHtml(opp.detail_url)}" target="_blank" class="btn btn--outline btn--sm">詳細を見る</a>` : ""}
            <button class="btn btn--primary btn--sm" onclick="analyzeOpportunity('${escapeHtml(oppId)}')">AI詳細分析</button>
          </div>
          <div class="opp-card__analysis hidden" id="analysis-${escapeHtml(oppId)}"></div>
        </div>
      </div>
    `;
  }).join("");

  // Upgrade CTA for free/trial tier
  if (currentTier !== "paid" && items.length > visibleCount) {
    const ctaText = currentTier === "trial"
      ? "有料プランにアップグレードすると全件確認できます"
      : "有料プランにアップグレードすると全件確認できます";
    html += `
      <div class="upgrade-cta">
        <p><strong>${items.length - visibleCount}件</strong>の案件がぼかし表示されています</p>
        <p>${ctaText}</p>
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

  // ローディング表示
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="analysis-loading">AI が詳細分析中...</div>`;

  try {
    const token = await getAccessToken();
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

  // Profile info - full display
  const settingsProfile = document.getElementById("settingsProfile");
  if (companyProfile) {
    const p = companyProfile;
    const companyUrl = profileData.user?.company_url || "";
    settingsProfile.innerHTML = `
      <div class="profile-card__row"><span class="profile-card__label">会社名</span><span class="profile-card__value">${escapeHtml(p.company_name || "")}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">所在地</span><span class="profile-card__value">${escapeHtml(p.location || "")}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">事業分野</span><span class="profile-card__value">${escapeHtml((p.business_areas || []).join("、"))}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">提供サービス</span><span class="profile-card__value">${escapeHtml((p.services || []).join("、"))}</span></div>
      <div class="profile-card__row"><span class="profile-card__label">強み</span><span class="profile-card__value">${escapeHtml((p.strengths || []).join("、"))}</span></div>
      ${companyUrl ? `<div class="profile-card__row"><span class="profile-card__label">URL</span><span class="profile-card__value"><a href="${escapeHtml(companyUrl)}" target="_blank" style="color:var(--accent)">${escapeHtml(companyUrl)}</a></span></div>` : ""}
    `;
  }

  // Notification settings
  const user = profileData.user || {};
  document.getElementById("settingEmailNotify").checked = user.email_notify !== false;
  document.getElementById("settingThreshold").value = user.notification_threshold || 0;
  document.getElementById("thresholdValue").textContent = `${user.notification_threshold || 0}%`;

  // Keywords
  renderKeywordEditor();

  // Area editor
  renderSettingsAreas(profileData);
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

function switchSettingsInputMode(mode) {
  const urlGroup = document.getElementById("settingsUrlGroup");
  const textGroup = document.getElementById("settingsTextGroup");
  const tabUrl = document.getElementById("settingsTabUrl");
  const tabText = document.getElementById("settingsTabText");

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

async function reanalyzeCompany(mode) {
  const statusEl = document.getElementById("settingsAnalyzeStatus");
  let requestBody;

  if (mode === "text") {
    const text = document.getElementById("settingsTextInput").value.trim();
    if (!text || text.length < 50) { alert("事業内容を50文字以上入力してください"); return; }
    requestBody = { text };
  } else {
    const url = document.getElementById("settingsUrlInput").value.trim();
    if (!url) { alert("URLを入力してください"); return; }
    requestBody = { url: url.startsWith("http") ? url : "https://" + url };
  }

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

    companyProfile = await resp.json();

    // Save updated profile to server
    await fetch(`${WORKER_BASE}/api/user/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(companyProfile),
    });

    statusEl.textContent = "再分析が完了しました";
    statusEl.style.color = "var(--success)";
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

  if (status === "none" || !sub) {
    // No subscription yet
    container.innerHTML = `
      <div class="sub-card">
        <div class="sub-card__plan">${status === "trial" ? "無料トライアル中" : "無料プラン"}</div>
        ${trialEnd ? `<div class="sub-card__info">トライアル終了日: ${new Date(trialEnd).toLocaleDateString("ja-JP")}</div>` : ""}
        <p class="sub-card__desc">無料プラン: 上位5件表示 + 30件ぼかし表示</p>
        <button class="btn btn--primary btn--lg" onclick="startCheckout('monthly')">月額プラン ¥2,980 で開始</button>
        ${status === "trial" ? `<button class="btn btn--danger" style="margin-top:12px" onclick="cancelSubscription()">解約する</button>` : ""}
      </div>
    `;
    return;
  }

  const planLabel = "月額プラン";
  const priceLabel = "¥2,980/月";
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
