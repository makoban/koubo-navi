/**
 * 公募ナビAI - E2E テスト（Puppeteer）
 *
 * テスト項目:
 *   1. LP ページ読み込み・表示確認
 *   2. 各セクション（hero, steps, comparison, sample, pricing, FAQ, CTA）
 *   3. ヘッダー・フッター
 *   4. ログインモーダル
 *   5. Supabase Auth（サインアップ、ログイン、ログアウト）
 *   6. Worker API テスト
 *   7. Stripe テストモード Checkout
 *   8. ダッシュボード表示
 *   9. レスポンシブ表示
 */

const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;
const WORKER_BASE = "https://koubo-navi-proxy.ai-fudosan.workers.dev";
const SUPABASE_URL = "https://ypyrjsdotkeyvzequdez.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_l5yNWlXOZAHABwlbEalGng_R8zioydf";
const STRIPE_TEST_KEY = process.env.STRIPE_TEST_KEY || "";

// テスト用アカウント（ユニークにするため timestamp を付与）
const TEST_EMAIL = `test_koubo_${Date.now()}@test.bantex.jp`;
const TEST_PASSWORD = "TestPass123!";

// ---------------------------------------------------------------------------
// Test Results
// ---------------------------------------------------------------------------

const results = [];
let passed = 0;
let failed = 0;

function report(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} - ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Simple HTTP Server (serves public/ directory)
// ---------------------------------------------------------------------------

function startServer() {
  const publicDir = path.join(__dirname, "public");

  const MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };

  const server = http.createServer((req, res) => {
    let filePath = path.join(publicDir, req.url === "/" ? "index.html" : req.url);

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(PORT);
  console.log(`Local server started on port ${PORT}`);
  return server;
}

// ---------------------------------------------------------------------------
// API Tests (Node.js fetch, no browser needed)
// ---------------------------------------------------------------------------

async function runApiTests() {
  console.log("\n=== API Tests ===\n");

  // Test 1: Worker /api/areas
  try {
    const resp = await fetch(`${WORKER_BASE}/api/areas`, {
      headers: { Origin: BASE_URL },
    });
    const data = await resp.json();
    const hasAreas = data.areas && data.areas.length > 0;
    report("GET /api/areas", resp.ok && hasAreas,
      hasAreas ? `${data.areas.length} areas` : "no areas returned");
  } catch (err) {
    report("GET /api/areas", false, err.message);
  }

  // Test 2: Supabase Auth - Sign Up
  let accessToken = "";
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    const data = await resp.json();
    accessToken = data.access_token || "";
    report("Supabase Sign Up", resp.ok && !!accessToken,
      accessToken ? `token: ${accessToken.slice(0, 20)}...` : `error: ${JSON.stringify(data)}`);
  } catch (err) {
    report("Supabase Sign Up", false, err.message);
  }

  // Test 3: Worker /api/analyze-company (requires auth)
  if (accessToken) {
    try {
      const resp = await fetch(`${WORKER_BASE}/api/analyze-company`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          Origin: BASE_URL,
        },
        body: JSON.stringify({ url: "https://bantex.jp" }),
      });
      const data = await resp.json();
      const hasProfile = !!data.company_name || !!data.business_areas;
      report("POST /api/analyze-company", resp.ok && hasProfile,
        hasProfile ? `company: ${data.company_name}` : `resp: ${JSON.stringify(data).slice(0, 100)}`);
    } catch (err) {
      report("POST /api/analyze-company", false, err.message);
    }
  }

  // Test 4: Worker /api/register
  if (accessToken) {
    try {
      const resp = await fetch(`${WORKER_BASE}/api/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          Origin: BASE_URL,
        },
        body: JSON.stringify({
          company_url: "https://bantex.jp",
          area_ids: ["aichi", "national"],
        }),
      });
      const data = await resp.json();
      report("POST /api/register", resp.ok && data.registered,
        data.registered ? `trial_ends_at: ${data.trial_ends_at}` : `error: ${JSON.stringify(data)}`);
    } catch (err) {
      report("POST /api/register", false, err.message);
    }
  }

  // Test 5: Worker /api/user/profile
  if (accessToken) {
    try {
      const resp = await fetch(`${WORKER_BASE}/api/user/profile`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: BASE_URL,
        },
      });
      const data = await resp.json();
      report("GET /api/user/profile", resp.ok && !!data.user,
        data.user ? `status: ${data.user.status}` : "no user data");
    } catch (err) {
      report("GET /api/user/profile", false, err.message);
    }
  }

  // Test 6: Worker /api/user/opportunities
  if (accessToken) {
    try {
      const resp = await fetch(`${WORKER_BASE}/api/user/opportunities?score_min=0&limit=10`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: BASE_URL,
        },
      });
      const data = await resp.json();
      report("GET /api/user/opportunities", resp.ok,
        `${data.opportunities?.length || 0} opportunities`);
    } catch (err) {
      report("GET /api/user/opportunities", false, err.message);
    }
  }

  // Test 7: Worker /api/user/subscription
  if (accessToken) {
    try {
      const resp = await fetch(`${WORKER_BASE}/api/user/subscription`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: BASE_URL,
        },
      });
      const data = await resp.json();
      report("GET /api/user/subscription", resp.ok,
        `status: ${data.user_status}, sub: ${data.subscription ? "yes" : "none"}`);
    } catch (err) {
      report("GET /api/user/subscription", false, err.message);
    }
  }

  // Test 8: Stripe Checkout Session (test mode)
  if (accessToken) {
    try {
      const resp = await fetch(`${WORKER_BASE}/api/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          Origin: BASE_URL,
        },
        body: JSON.stringify({
          plan: "monthly",
          success_url: `${BASE_URL}/?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${BASE_URL}/`,
        }),
      });
      const data = await resp.json();
      const hasUrl = !!data.url && data.url.includes("checkout.stripe.com");
      report("POST /api/checkout (Stripe)", resp.ok && hasUrl,
        hasUrl ? `url: ${data.url.slice(0, 60)}...` : `error: ${JSON.stringify(data).slice(0, 100)}`);
    } catch (err) {
      report("POST /api/checkout (Stripe)", false, err.message);
    }
  }

  // Test 9: Worker unauthenticated → 401
  try {
    const resp = await fetch(`${WORKER_BASE}/api/user/profile`, {
      headers: { Origin: BASE_URL },
    });
    report("Unauthenticated /api/user/profile → 401", resp.status === 401,
      `status: ${resp.status}`);
  } catch (err) {
    report("Unauthenticated → 401", false, err.message);
  }

  return accessToken;
}

// ---------------------------------------------------------------------------
// Browser Tests (Puppeteer)
// ---------------------------------------------------------------------------

async function runBrowserTests(accessToken) {
  console.log("\n=== Browser Tests ===\n");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    // Suppress console noise
    page.on("console", () => {});

    // -- Test: Page Load --
    const response = await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    report("Page Load (HTTP 200)", response.status() === 200, `status: ${response.status()}`);

    // -- Test: Title --
    const title = await page.title();
    report("Page Title", title.includes("公募ナビAI"), title);

    // -- Test: Header --
    const headerTitle = await page.$eval(".header__title", el => el.textContent.trim());
    report("Header Title", headerTitle === "公募ナビAI", headerTitle);

    const badge = await page.$eval(".header__badge", el => el.textContent.trim());
    report("Version Badge", badge === "v2.0", badge);

    // -- Test: Hero Section --
    const heroTitle = await page.$eval(".hero__title", el => el.textContent.trim());
    report("Hero Title", heroTitle.includes("公募・入札案件"), heroTitle);

    const heroLabel = await page.$(".hero__label");
    report("Hero Label Exists", !!heroLabel);

    const heroBtn = await page.$(".hero .btn--primary");
    report("Hero CTA Button Exists", !!heroBtn);

    // -- Test: Proof Bar --
    const proofItems = await page.$$(".proof-bar__item");
    report("Proof Bar Items", proofItems.length === 4, `count: ${proofItems.length}`);

    // -- Test: Service Sample (Browser Mockup) --
    const mockup = await page.$(".mockup");
    report("Browser Mockup Exists", !!mockup);

    const mockupOpps = await page.$$(".mockup-opp");
    report("Mockup Opportunity Cards (3)", mockupOpps.length === 3, `count: ${mockupOpps.length}`);

    // -- Test: Steps Section --
    const stepCards = await page.$$(".step-card");
    report("3 Step Cards", stepCards.length === 3, `count: ${stepCards.length}`);

    // -- Test: Comparison Section --
    const compCards = await page.$$(".comparison__card");
    report("Comparison Cards (Before/After)", compCards.length === 2, `count: ${compCards.length}`);

    // -- Test: Competitor Comparison Table --
    const compTable = await page.$(".competitor__table");
    report("Competitor Table Exists", !!compTable);

    const compRows = await page.$$(".competitor__table tbody tr");
    report("Competitor Table Rows (9)", compRows.length === 9, `count: ${compRows.length}`);

    const selfCells = await page.$$(".competitor__self");
    report("Self-highlight Cells Exist", selfCells.length >= 9, `count: ${selfCells.length}`);

    // -- Test: Sample Score Cards --
    const sampleCards = await page.$$(".sample-card");
    report("Sample Score Cards", sampleCards.length === 3, `count: ${sampleCards.length}`);

    const sampleScores = await page.$$eval(".sample-card__score", els => els.map(e => e.textContent.trim()));
    report("Sample Scores Values", sampleScores.includes("85%") && sampleScores.includes("68%") && sampleScores.includes("42%"),
      sampleScores.join(", "));

    // -- Test: Pricing Section --
    const pricingCards = await page.$$(".pricing__card");
    report("Pricing Cards", pricingCards.length === 2, `count: ${pricingCards.length}`);

    const monthlyPrice = await page.$eval(".pricing__card .pricing__price", el => el.textContent.trim());
    report("Monthly Price ¥2,980", monthlyPrice.includes("2,980"), monthlyPrice);

    const yearlyPrice = await page.$eval(".pricing__card--yearly .pricing__price", el => el.textContent.trim());
    report("Yearly Price ¥29,800", yearlyPrice.includes("29,800"), yearlyPrice);

    // -- Test: FAQ Section --
    const faqItems = await page.$$(".faq__item");
    report("FAQ Items (6)", faqItems.length === 6, `count: ${faqItems.length}`);

    // -- Test: CTA Section --
    const ctaTitle = await page.$eval(".cta h2", el => el.textContent.trim());
    report("CTA Section", ctaTitle.includes("7日間"), ctaTitle);

    // -- Test: Footer --
    const footerText = await page.$eval(".footer", el => el.textContent.trim());
    report("Footer Contains v2.0", footerText.includes("v2.0"));
    report("Footer Contains bantex", footerText.includes("bantex"));

    const footerLinks = await page.$$eval(".footer__links a", els => els.map(e => ({
      text: e.textContent.trim(),
      href: e.href,
    })));
    report("Footer Links (3)", footerLinks.length === 3, footerLinks.map(l => l.text).join(", "));

    // -- Test: Login Modal --
    await page.click("#loginBtn");
    await page.waitForSelector("#loginModal:not(.hidden)", { timeout: 3000 });
    const modalTitle = await page.$eval("#loginModalTitle", el => el.textContent.trim());
    report("Login Modal Opens", modalTitle === "ログイン", modalTitle);

    const googleBtn = await page.$(".btn--google");
    report("Google Login Button Exists", !!googleBtn);

    const passwordResetBtn = await page.$(".auth-reset");
    report("Password Reset Link Exists", !!passwordResetBtn);

    // Close modal
    await page.click(".modal__close");
    await page.waitForSelector("#loginModal.hidden", { timeout: 3000 });
    report("Login Modal Closes", true);

    // -- Test: Login with test account --
    await page.click("#loginBtn");
    await page.waitForSelector("#loginModal:not(.hidden)", { timeout: 3000 });
    await page.type("#authEmail", TEST_EMAIL);
    await page.type("#authPassword", TEST_PASSWORD);
    await page.click("#authSubmitBtn");

    // Wait for auth to complete
    await page.waitForFunction(() => {
      const authArea = document.getElementById("authArea");
      return authArea && authArea.textContent.includes("ダッシュボード");
    }, { timeout: 10000 });
    report("Login Success", true);

    // -- Test: Dashboard Navigation --
    await page.click('[onclick="showPage(\'dashboard\')"]');
    await page.waitForSelector("#dashboardPage:not(.hidden)", { timeout: 5000 });
    report("Dashboard Page Visible", true);

    // -- Test: Dashboard Tabs --
    const tabs = await page.$$eval(".tab", els => els.map(e => e.textContent.trim()));
    report("Dashboard Tabs (3)", tabs.length === 3 && tabs.includes("案件一覧") && tabs.includes("設定") && tabs.includes("プラン"),
      tabs.join(", "));

    // -- Test: Opportunity List --
    const oppList = await page.$("#opportunityList");
    report("Opportunity List Exists", !!oppList);

    // -- Test: Filter Bar --
    const filterScore = await page.$("#filterScore");
    const filterArea = await page.$("#filterArea");
    report("Filter Controls Exist", !!filterScore && !!filterArea);

    // -- Test: Settings Tab --
    await page.click('[data-tab="settings"]');
    await page.waitForSelector("#tab-settings.active", { timeout: 3000 });
    report("Settings Tab Opens", true);

    const emailNotifyCheckbox = await page.$("#settingEmailNotify");
    report("Email Notify Checkbox Exists", !!emailNotifyCheckbox);

    const thresholdSlider = await page.$("#settingThreshold");
    report("Threshold Slider Exists", !!thresholdSlider);

    // -- Test: Subscription Tab --
    await page.click('[data-tab="subscription"]');
    await page.waitForSelector("#tab-subscription.active", { timeout: 3000 });
    report("Subscription Tab Opens", true);

    const subInfo = await page.$("#subscriptionInfo");
    report("Subscription Info Exists", !!subInfo);

    // -- Test: Logout --
    await page.click('[onclick="logoutUser()"]');
    await page.waitForFunction(() => {
      const authArea = document.getElementById("authArea");
      return authArea && authArea.textContent.includes("ログイン");
    }, { timeout: 10000 });
    report("Logout Success", true);

    // -- Test: Responsive (Mobile 375px) --
    await page.setViewport({ width: 375, height: 812 });
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });

    const mobileHero = await page.$(".hero__title");
    report("Mobile: Hero Visible", !!mobileHero);

    const mobilePricing = await page.$$(".pricing__card");
    report("Mobile: Pricing Cards Visible", mobilePricing.length === 2);

    // -- Test: Console Errors --
    const consoleErrors = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    // Wait a bit for any async errors
    await new Promise(r => setTimeout(r, 2000));
    report("No Console Errors", consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join("; ").slice(0, 200) : "clean");

  } catch (err) {
    report("Browser Test Error", false, err.message);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("  公募ナビAI - E2E テスト");
  console.log("=".repeat(60));

  const server = startServer();

  try {
    // Phase 1: API Tests
    const accessToken = await runApiTests();

    // Phase 2: Browser Tests
    await runBrowserTests(accessToken);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log(`  結果: ${passed} PASS / ${failed} FAIL (合計 ${passed + failed})`);
    console.log("=".repeat(60));

    if (failed > 0) {
      console.log("\n  Failed tests:");
      results.filter(r => !r.ok).forEach(r => {
        console.log(`    - ${r.name}: ${r.detail}`);
      });
    }
    console.log();

  } finally {
    server.close();
    console.log("Local server stopped.");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
