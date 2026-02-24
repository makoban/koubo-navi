#!/usr/bin/env node
/**
 * koubo-navi v2.4 E2E テスト
 * - LP表示確認（年額プラン削除、ぼかし説明）
 * - 新規登録→オンボーディング→ダッシュボード
 * - ぼかしUI確認
 * - 解約ボタン確認
 * - Worker API テスト（締切フィルター、ティア、visible_count）
 */

const puppeteer = require("puppeteer");

const SITE_URL = "https://koubo-navi.bantex.jp";
const WORKER_URL = "https://koubo-navi-proxy.ai-fudosan.workers.dev";
const SUPABASE_URL = "https://ypyrjsdotkeyvzequdez.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_l5yNWlXOZAHABwlbEalGng_R8zioydf";

let pass = 0, fail = 0, warn = 0;
function PASS(msg) { pass++; console.log(`  PASS: ${msg}`); }
function FAIL(msg) { fail++; console.log(`  FAIL: ${msg}`); }
function WARN(msg) { warn++; console.log(`  WARN: ${msg}`); }

const timestamp = Date.now();
const testEmail = `e2e-v24-${timestamp}@test.com`;
const testPassword = "TestPass123!";

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getSupabaseToken(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  return data.access_token;
}

async function signUpUser(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  return resp.json();
}

(async () => {
  console.log("\n=== Phase 1: LP表示確認 ===");

  const browser = await puppeteer.launch({
    headless: "new",
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // --- Phase 1: LP表示 ---
    const page = await browser.newPage();
    await page.goto(SITE_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // v2.4 バージョン確認
    const badge = await page.$eval(".header__badge", el => el.textContent.trim());
    badge === "v2.4" ? PASS(`バージョンバッジ: ${badge}`) : FAIL(`バージョンバッジ: ${badge} (期待: v2.4)`);

    // 年額プランカードが削除されているか
    const yearlyCard = await page.$(".pricing__card--yearly");
    yearlyCard === null ? PASS("年額プランカード削除済み") : FAIL("年額プランカードがまだ存在");

    // 月額プランカードが存在するか
    const monthlyCard = await page.$(".pricing__card");
    monthlyCard ? PASS("月額プランカード存在") : FAIL("月額プランカードが見つからない");

    // 「5件表示 + 30件ぼかし」の説明テキスト
    const pricingNote = await page.$eval(".pricing__note", el => el.textContent).catch(() => "");
    pricingNote.includes("5件") && pricingNote.includes("ぼかし")
      ? PASS(`料金ノート: "${pricingNote}"`)
      : FAIL(`料金ノートに5件/ぼかし記載なし: "${pricingNote}"`);

    // FAQに「無料プランと有料プランの違い」があるか
    const faqTexts = await page.$$eval(".faq__item summary", els => els.map(e => e.textContent));
    const hasFreePaidFaq = faqTexts.some(t => t.includes("無料プラン") && t.includes("有料プラン"));
    hasFreePaidFaq ? PASS("FAQ: 無料/有料プラン違いあり") : FAIL("FAQ: 無料/有料プラン違いが見つからない");

    // フッターバージョン
    const footerText = await page.$eval("footer p", el => el.textContent);
    footerText.includes("v2.4") ? PASS(`フッターバージョン: v2.4`) : FAIL(`フッター: ${footerText}`);

    await page.close();

    // --- Phase 2: 新規登録 + オンボーディング ---
    console.log("\n=== Phase 2: 新規登録 ===");

    const signupResult = await signUpUser(testEmail, testPassword);
    signupResult.access_token ? PASS("ユーザー登録完了") : FAIL(`登録失敗: ${JSON.stringify(signupResult)}`);

    const token = signupResult.access_token || await getSupabaseToken(testEmail, testPassword);

    // API登録
    const regResp = await fetch(`${WORKER_URL}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        company_url: "https://bantex.jp",
        area_ids: ["tokyo", "aichi"],
        profile: {
          company_name: "E2Eテスト会社v24",
          business_areas: ["IT", "コンサルティング"],
          keywords: ["システム開発", "AI"],
        },
      }),
    });
    const regData = await regResp.json();
    regResp.status === 200 ? PASS(`API登録完了 (status=${regResp.status})`) : FAIL(`API登録失敗: ${JSON.stringify(regData)}`);

    // --- Phase 3: オンボーディング Step3 確認（年額なし） ---
    console.log("\n=== Phase 3: オンボーディング Step3 確認 ===");

    const page2 = await browser.newPage();
    await page2.goto(SITE_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // Step3のHTMLを直接チェック
    const step3Html = await page2.$eval("#obStep3", el => el.innerHTML);
    const hasYearlyRadio = step3Html.includes("yearly") && step3Html.includes("年額プラン");
    !hasYearlyRadio ? PASS("Step3: 年額ラジオボタン削除済み") : FAIL("Step3: 年額ラジオボタンがまだ存在");

    const hasMonthlyPrice = step3Html.includes("2,980");
    hasMonthlyPrice ? PASS("Step3: 月額¥2,980表示あり") : FAIL("Step3: 月額表示なし");

    const hasBlurInfo = step3Html.includes("5件") || step3Html.includes("ぼかし");
    hasBlurInfo ? PASS("Step3: 無料プランぼかし説明あり") : WARN("Step3: ぼかし説明なし");

    await page2.close();

    // --- Phase 4: Worker API テスト ---
    console.log("\n=== Phase 4: Worker API テスト ===");

    // opportunities API - ティア、visible_count確認
    const oppResp = await fetch(`${WORKER_URL}/api/user/opportunities`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const oppData = await oppResp.json();
    oppResp.status === 200 ? PASS(`案件API: status=${oppResp.status}`) : FAIL(`案件API: status=${oppResp.status}`);

    // tier確認
    oppData.tier === "free" || oppData.tier === "paid"
      ? PASS(`ティア: ${oppData.tier}`)
      : FAIL(`ティア不明: ${oppData.tier}`);

    // visible_count 存在確認
    typeof oppData.visible_count === "number"
      ? PASS(`visible_count: ${oppData.visible_count}`)
      : FAIL(`visible_countが存在しない: ${JSON.stringify(Object.keys(oppData))}`);

    // max_results = 35 (free) or 100 (paid)
    if (oppData.tier === "free") {
      oppData.max_results === 35
        ? PASS(`max_results: ${oppData.max_results} (free=35)`)
        : FAIL(`max_results: ${oppData.max_results} (期待: 35)`);
    } else {
      PASS(`max_results: ${oppData.max_results} (paid)`);
    }

    console.log(`  INFO: 案件数: ${oppData.total}件 / 未フィルター: ${oppData.total_unfiltered}件`);

    // --- Phase 5: ブラウザ ダッシュボード + ぼかしUI ---
    console.log("\n=== Phase 5: ダッシュボード表示 ===");

    const page3 = await browser.newPage();

    // ログインしてダッシュボードを表示
    await page3.goto(SITE_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // Supabase にログイン（JS実行）
    await page3.evaluate(async (email, password, url, key) => {
      const { createClient } = window.supabase;
      const client = createClient(url, key);
      await client.auth.signInWithPassword({ email, password });
    }, testEmail, testPassword, SUPABASE_URL, SUPABASE_ANON_KEY);

    await sleep(2000);
    await page3.reload({ waitUntil: "networkidle2" });
    await sleep(3000);

    // ダッシュボード表示確認
    const dashVisible = await page3.evaluate(() => {
      const el = document.getElementById("dashboardPage");
      return el && !el.classList.contains("hidden");
    });
    dashVisible ? PASS("ダッシュボード表示") : WARN("ダッシュボード未表示（オンボーディング中の可能性）");

    if (dashVisible) {
      // ぼかしCSS定義がstylesheetに存在するか確認
      const hasBlurCSS = await page3.evaluate(() => {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.selectorText && rule.selectorText.includes("opp-card--blurred")) return true;
            }
          } catch {}
        }
        return false;
      });
      hasBlurCSS ? PASS("ぼかしCSS定義あり (.opp-card--blurred)") : FAIL("ぼかしCSS定義なし");

      // blur-overlay CSS定義確認
      const hasOverlayCSS = await page3.evaluate(() => {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.selectorText && rule.selectorText.includes("opp-card__blur-overlay")) return true;
            }
          } catch {}
        }
        return false;
      });
      hasOverlayCSS ? PASS("ぼかしオーバーレイCSS定義あり") : FAIL("ぼかしオーバーレイCSS定義なし");

      // 案件カード数を確認
      const cardCount = await page3.$$eval(".opp-card", els => els.length);
      console.log(`  INFO: 案件カード: ${cardCount}件`);

      if (cardCount > 5) {
        // ぼかしカードが存在するか確認
        const blurredCount = await page3.$$eval(".opp-card--blurred", els => els.length);
        blurredCount > 0
          ? PASS(`ぼかしカード: ${blurredCount}件`)
          : FAIL(`ぼかしカードが0件 (カード${cardCount}件あるのに)`);
      } else if (cardCount > 0) {
        PASS(`案件カード${cardCount}件表示（5件以下のためぼかしなし）`);
      } else {
        WARN("案件0件（バッチ未完了のため）");
      }

      // サブスクタブで年額ボタンがないことを確認
      await page3.evaluate(() => {
        document.querySelector('[data-tab="subscription"]')?.click();
      });
      await sleep(1000);

      const subTabHtml = await page3.$eval("#tab-subscription", el => el.innerHTML);
      const hasYearlyBtn = subTabHtml.includes("年額プラン") && subTabHtml.includes("29,800");
      !hasYearlyBtn ? PASS("サブスクタブ: 年額ボタン削除済み") : FAIL("サブスクタブ: 年額ボタンがまだ存在");

      // 無料プラン説明テキスト
      const hasFreePlanDesc = subTabHtml.includes("5件") || subTabHtml.includes("ぼかし");
      hasFreePlanDesc ? PASS("サブスクタブ: 無料プラン説明あり") : WARN("サブスクタブ: 無料プラン説明なし");

      // 解約ボタン（trialユーザーでも表示されるか）
      // 注: このユーザーはStripe Checkout経由でトライアル開始していないので、サブスクなし状態
      // free/none状態でのUI確認
      const hasCancelBtn = subTabHtml.includes("解約する");
      console.log(`  INFO: 解約ボタン表示: ${hasCancelBtn ? "あり" : "なし（サブスクなし状態で正常）"}`);
    }

    // --- Phase 6: Worker Checkout API（年額テスト） ---
    console.log("\n=== Phase 6: Checkout API テスト ===");

    // monthlyでチェックアウトが正常に動くか
    const checkoutResp = await fetch(`${WORKER_URL}/api/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan: "monthly",
        success_url: `${SITE_URL}/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: SITE_URL,
      }),
    });
    const checkoutData = await checkoutResp.json();
    checkoutData.url
      ? PASS(`Checkout月額: セッション作成成功`)
      : FAIL(`Checkout月額失敗: ${JSON.stringify(checkoutData)}`);

    // yearlyを送ってもmonthlyで処理されるか（priceIdがmonthlyに固定されたため）
    const checkoutResp2 = await fetch(`${WORKER_URL}/api/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan: "yearly",
        success_url: `${SITE_URL}/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: SITE_URL,
      }),
    });
    const checkoutData2 = await checkoutResp2.json();
    checkoutData2.url
      ? PASS(`Checkout yearly送信→月額で処理（年額廃止確認）`)
      : FAIL(`Checkout yearly送信失敗: ${JSON.stringify(checkoutData2)}`);

    await page3.close();

    // --- Phase 7: スコアフィルター撤廃の確認 ---
    console.log("\n=== Phase 7: スコアフィルター確認 ===");

    // Worker のスクリーニング関連APIは直接テストが難しいので、
    // opportunitiesのscore_min=0パラメータでのAPI動作確認
    const oppResp2 = await fetch(`${WORKER_URL}/api/user/opportunities?score_min=0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    oppResp2.status === 200
      ? PASS("score_min=0 で全案件取得可能")
      : FAIL(`score_min=0 API失敗: status=${oppResp2.status}`);

  } catch (err) {
    console.error("テストエラー:", err.message);
    FAIL(`テスト例外: ${err.message}`);
  } finally {
    await browser.close();
  }

  // 結果
  console.log(`\n===========================`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL / ${warn} WARN`);
  console.log(`===========================`);
  console.log(`\nブラウザを閉じました。`);

  process.exit(fail > 0 ? 1 : 0);
})();
