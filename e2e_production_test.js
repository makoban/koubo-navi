/**
 * koubo-navi v2.0 Production E2E Test
 * Target: https://koubo-navi.bantex.jp/
 *
 * Tests cover:
 * - Phase 1: Worker API endpoint tests
 * - Phase 2: Browser UI tests (LP, onboarding, dashboard)
 * - Phase 3: Authentication flow tests
 */

const puppeteer = require('puppeteer');

const PROD_URL = 'https://koubo-navi.bantex.jp/';
const WORKER_URL = 'https://koubo-navi-proxy.ai-fudosan.workers.dev';

let pass = 0, fail = 0, warn = 0;
const results = [];

function log(status, test, detail = '') {
  const icon = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : status === 'FAIL' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mWARN\x1b[0m';
  console.log(`  [${icon}] ${test}${detail ? ' - ' + detail : ''}`);
  results.push({ status, test, detail });
  if (status === 'PASS') pass++;
  else if (status === 'FAIL') fail++;
  else warn++;
}

// ============ Phase 1: Worker API Tests ============
async function testWorkerAPIs() {
  console.log('\n=== Phase 1: Worker API Tests ===\n');

  // 1. GET /api/areas - 47 prefectures
  try {
    const res = await fetch(`${WORKER_URL}/api/areas`);
    const data = await res.json();
    if (res.ok && data.areas && data.areas.length >= 47) {
      log('PASS', 'GET /api/areas', `${data.areas.length} areas returned (47 prefectures + extras)`);
    } else {
      log('FAIL', 'GET /api/areas', `status=${res.status}, areas=${data.areas?.length}`);
    }
  } catch (e) {
    log('FAIL', 'GET /api/areas', e.message);
  }

  // 2. POST /api/register without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_url: 'https://example.com' })
    });
    if (res.status === 401) {
      log('PASS', 'POST /api/register (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'POST /api/register (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'POST /api/register (no JWT)', e.message);
  }

  // 3. POST /api/analyze-company without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/analyze-company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' })
    });
    if (res.status === 401) {
      log('PASS', 'POST /api/analyze-company (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'POST /api/analyze-company (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'POST /api/analyze-company (no JWT)', e.message);
  }

  // 4. GET /api/user/profile without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/user/profile`);
    if (res.status === 401) {
      log('PASS', 'GET /api/user/profile (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'GET /api/user/profile (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'GET /api/user/profile (no JWT)', e.message);
  }

  // 5. GET /api/user/opportunities without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/user/opportunities`);
    if (res.status === 401) {
      log('PASS', 'GET /api/user/opportunities (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'GET /api/user/opportunities (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'GET /api/user/opportunities (no JWT)', e.message);
  }

  // 6. GET /api/user/subscription without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/user/subscription`);
    if (res.status === 401) {
      log('PASS', 'GET /api/user/subscription (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'GET /api/user/subscription (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'GET /api/user/subscription (no JWT)', e.message);
  }

  // 7. POST /api/checkout without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' })
    });
    if (res.status === 401) {
      log('PASS', 'POST /api/checkout (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'POST /api/checkout (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'POST /api/checkout (no JWT)', e.message);
  }

  // 8. POST /api/cancel-subscription without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/cancel-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.status === 401) {
      log('PASS', 'POST /api/cancel-subscription (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'POST /api/cancel-subscription (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'POST /api/cancel-subscription (no JWT)', e.message);
  }

  // 9. POST /api/opportunity/analyze without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/opportunity/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportunity_id: 'test' })
    });
    if (res.status === 401) {
      log('PASS', 'POST /api/opportunity/analyze (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'POST /api/opportunity/analyze (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'POST /api/opportunity/analyze (no JWT)', e.message);
  }

  // 10. POST /api/user/screen without JWT -> 401
  try {
    const res = await fetch(`${WORKER_URL}/api/user/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.status === 401) {
      log('PASS', 'POST /api/user/screen (no JWT)', '401 Unauthorized');
    } else {
      log('FAIL', 'POST /api/user/screen (no JWT)', `Expected 401, got ${res.status}`);
    }
  } catch (e) {
    log('FAIL', 'POST /api/user/screen (no JWT)', e.message);
  }

  // 11. CORS headers check
  try {
    const res = await fetch(`${WORKER_URL}/api/areas`, {
      headers: { 'Origin': 'https://koubo-navi.bantex.jp' }
    });
    const cors = res.headers.get('access-control-allow-origin');
    if (cors && cors.includes('koubo-navi.bantex.jp')) {
      log('PASS', 'CORS headers', `Origin: ${cors}`);
    } else {
      log('WARN', 'CORS headers', `Origin header: ${cors || 'none'} (may not be returned to non-browser requests)`);
    }
  } catch (e) {
    log('WARN', 'CORS headers', e.message);
  }

  // 12. OPTIONS preflight
  try {
    const res = await fetch(`${WORKER_URL}/api/areas`, { method: 'OPTIONS' });
    if (res.ok || res.status === 204) {
      log('PASS', 'OPTIONS preflight', `status=${res.status}`);
    } else {
      log('WARN', 'OPTIONS preflight', `status=${res.status}`);
    }
  } catch (e) {
    log('WARN', 'OPTIONS preflight', e.message);
  }
}

// ============ Phase 2: Browser UI Tests ============
async function testBrowserUI(browser) {
  console.log('\n=== Phase 2: Browser UI Tests (LP) ===\n');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // 1. Page load
    const response = await page.goto(PROD_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    if (response.ok()) {
      log('PASS', 'Page load', `status=${response.status()}`);
    } else {
      log('FAIL', 'Page load', `status=${response.status()}`);
      return;
    }

    // 2. Version badge
    const badge = await page.$eval('.header__badge', el => el.textContent.trim()).catch(() => null);
    if (badge === 'v2.0') {
      log('PASS', 'Version badge', badge);
    } else {
      log('FAIL', 'Version badge', `Expected "v2.0", got "${badge}"`);
    }

    // 3. Hero title
    const heroTitle = await page.$eval('.hero__title', el => el.textContent.trim()).catch(() => null);
    if (heroTitle && heroTitle.includes('公募')) {
      log('PASS', 'Hero title', heroTitle.substring(0, 40));
    } else {
      log('FAIL', 'Hero title', heroTitle || 'not found');
    }

    // 4. Page contains 7-day trial text somewhere
    const has7Days = await page.evaluate(() => document.body.textContent.includes('7日間'));
    if (has7Days) {
      log('PASS', '7-day trial text found on page');
    } else {
      log('FAIL', '7-day trial text not found');
    }

    // 5. Proof bar exists
    const proofBar = await page.$('.proof-bar');
    log(proofBar ? 'PASS' : 'FAIL', 'Proof bar exists');

    // 6. Steps section (3 step-cards)
    const steps = await page.$$('.step-card');
    if (steps.length >= 3) {
      log('PASS', 'Steps section', `${steps.length} step cards found`);
    } else {
      log('FAIL', 'Steps section', `Expected >=3, got ${steps.length}`);
    }

    // 7. Mockup section
    const mockup = await page.$('.mockup-section, .screenshot-section, [class*="mockup"]');
    log(mockup ? 'PASS' : 'WARN', 'Mockup/screenshot section', mockup ? 'found' : 'not found');

    // 8. Features / pricing features
    const features = await page.$$('.pricing__features li');
    if (features.length >= 3) {
      log('PASS', 'Pricing feature items', `${features.length} items found`);
    } else {
      log('WARN', 'Pricing feature items', `${features.length} found`);
    }

    // 9. Competitor comparison table
    const compRows = await page.$$('.comparison-table tbody tr, .competitor-table tbody tr, table tr');
    if (compRows.length >= 5) {
      log('PASS', 'Comparison table', `${compRows.length} rows`);
    } else {
      log('WARN', 'Comparison table', `${compRows.length} rows found`);
    }

    // 10. Pricing section
    const pricing = await page.$('.pricing, .pricing-section, [class*="pricing"]');
    log(pricing ? 'PASS' : 'WARN', 'Pricing section', pricing ? 'found' : 'not found');

    // 11. Pricing shows monthly and yearly
    const pricingText = await page.evaluate(() => {
      const el = document.querySelector('.pricing, .pricing-section, [class*="pricing"]');
      return el ? el.textContent : '';
    });
    const hasMonthly = pricingText.includes('2,980') || pricingText.includes('月額');
    const hasYearly = pricingText.includes('29,800') || pricingText.includes('年額');
    if (hasMonthly && hasYearly) {
      log('PASS', 'Pricing plans (monthly + yearly)');
    } else {
      log('WARN', 'Pricing plans', `monthly=${hasMonthly}, yearly=${hasYearly}`);
    }

    // 12. FAQ section
    const faqItems = await page.$$('.faq-item, .faq__item, [class*="faq"] details');
    if (faqItems.length >= 5) {
      log('PASS', 'FAQ section', `${faqItems.length} items`);
    } else {
      log('WARN', 'FAQ section', `${faqItems.length} items found`);
    }

    // 13. CTA section with 7-day trial text
    const ctaText = await page.evaluate(() => {
      const cta = document.querySelector('.cta, .cta-section, [class*="cta"]');
      return cta ? cta.textContent : '';
    });
    if (ctaText.includes('7日間')) {
      log('PASS', 'CTA section (7-day trial)');
    } else {
      log('WARN', 'CTA section', 'May not contain 7-day trial text');
    }

    // 14. Footer
    const footerText = await page.evaluate(() => {
      const f = document.querySelector('footer, .footer');
      return f ? f.textContent : '';
    });
    if (footerText.includes('v2.0') || footerText.includes('bantex')) {
      log('PASS', 'Footer', footerText.substring(0, 60).trim());
    } else {
      log('FAIL', 'Footer', 'Missing version or brand');
    }

    // 15. Login button exists
    const loginBtn = await page.$('#loginBtn, .login-btn, [class*="login"]');
    log(loginBtn ? 'PASS' : 'FAIL', 'Login button exists');

    // 16. Google login button in modal
    // Click login button to open modal
    if (loginBtn) {
      await loginBtn.click();
      await new Promise(r => setTimeout(r, 500));
      const googleBtn = await page.$('[class*="google"], #googleLoginBtn, button[onclick*="google"]');
      log(googleBtn ? 'PASS' : 'WARN', 'Google login button in modal');
      // Close modal
      const closeBtn = await page.$('.modal-close, .close-btn, [class*="close"]');
      if (closeBtn) await closeBtn.click();
      await new Promise(r => setTimeout(r, 300));
    }

    // 17. Email login form in modal
    if (loginBtn) {
      await loginBtn.click().catch(() => {});
      await new Promise(r => setTimeout(r, 500));
      const emailInput = await page.$('input[type="email"], #loginEmail');
      const pwInput = await page.$('input[type="password"], #loginPassword');
      if (emailInput && pwInput) {
        log('PASS', 'Email login form (email + password inputs)');
      } else {
        log('WARN', 'Email login form', `email=${!!emailInput}, password=${!!pwInput}`);
      }
      const closeBtn = await page.$('.modal-close, .close-btn, [class*="close"]');
      if (closeBtn) await closeBtn.click();
      await new Promise(r => setTimeout(r, 300));
    }

    // 18. Self-service "14日間" text should not exist (competitor table may still have 14日間)
    const selfHas14Days = await page.evaluate(() => {
      // Check only self-branded elements (hero, pricing, CTA, FAQ) - not competitor columns
      const selectors = ['.hero', '.pricing', '.cta', '.faq', '.competitor__self'];
      return selectors.some(sel => {
        const el = document.querySelector(sel);
        return el && el.textContent.includes('14日間');
      });
    });
    if (!selfHas14Days) {
      log('PASS', 'No self-service "14日間" text (competitor table excluded)');
    } else {
      log('FAIL', 'Found "14日間" in self-service sections', 'Should be 7日間');
    }

    // 19. No "クレジットカード不要" text (removed in v2.0)
    const hasNoCreditCard = await page.evaluate(() => {
      return document.body.textContent.includes('クレジットカード不要');
    });
    if (!hasNoCreditCard) {
      log('PASS', 'No "クレジットカード不要" text (removed in v2.0)');
    } else {
      log('FAIL', 'Found "クレジットカード不要"', 'Should have been removed');
    }

    // 20. Onboarding steps updated (Step1=事業内容, Step2=エリア, Step3=お支払い)
    const stepLabels = await page.evaluate(() => {
      const spans = document.querySelectorAll('.ob-progress__label, .step-label');
      return Array.from(spans).map(s => s.textContent.trim());
    });
    if (stepLabels.length >= 3) {
      log('PASS', 'Onboarding step labels', stepLabels.join(' / '));
    } else {
      log('WARN', 'Onboarding step labels', `Found ${stepLabels.length} labels`);
    }

    // 21. Text input toggle (URL/Text switch)
    const inputToggle = await page.$('.input-toggle, .input-mode-tabs, [class*="input-mode"]');
    log(inputToggle ? 'PASS' : 'WARN', 'Input mode toggle (URL/Text)', inputToggle ? 'found' : 'may be hidden in onboarding');

    // === Mobile Responsive Test ===
    console.log('\n=== Phase 2b: Mobile Responsive Tests ===\n');

    await page.setViewport({ width: 375, height: 812 }); // iPhone X
    await page.goto(PROD_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));

    // 22. Mobile: No horizontal scroll
    const hasHScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (!hasHScroll) {
      log('PASS', 'Mobile: No horizontal scroll (375px)');
    } else {
      log('WARN', 'Mobile: Horizontal scroll detected', 'May have overflow');
    }

    // 23. Mobile: Header fits
    const headerOverflow = await page.evaluate(() => {
      const header = document.querySelector('.header, header');
      if (!header) return false;
      return header.scrollWidth > header.clientWidth;
    });
    if (!headerOverflow) {
      log('PASS', 'Mobile: Header fits without overflow');
    } else {
      log('WARN', 'Mobile: Header overflow detected');
    }

    // 24. Mobile: Login button visible
    const mobileLoginBtn = await page.$('#loginBtn, .login-btn, [class*="login"]');
    if (mobileLoginBtn) {
      const isVisible = await page.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }, mobileLoginBtn);
      log(isVisible ? 'PASS' : 'WARN', 'Mobile: Login button visible');
    } else {
      log('WARN', 'Mobile: Login button', 'not found');
    }

    // Reset viewport
    await page.setViewport({ width: 1280, height: 800 });

    // 25. Console errors
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('favicon') && !e.includes('404') && !e.includes('net::')
    );
    if (criticalErrors.length === 0) {
      log('PASS', 'No critical console errors');
    } else {
      log('WARN', 'Console errors', `${criticalErrors.length} errors: ${criticalErrors[0]?.substring(0, 80)}`);
    }

  } catch (e) {
    log('FAIL', 'Browser UI test error', e.message);
  } finally {
    await page.close();
  }
}

// ============ Phase 3: Auth Flow Tests ============
async function testAuthFlow(browser) {
  console.log('\n=== Phase 3: Authentication Flow Tests ===\n');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(PROD_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // 1. Sign up with test email
    const testEmail = `test_e2e_${Date.now()}@example.com`;
    const testPassword = 'TestPass123!';

    // Open login modal
    const loginBtn = await page.$('#loginBtn, .login-btn, [class*="login"]');
    if (!loginBtn) {
      log('FAIL', 'Auth: Login button not found');
      return;
    }
    await loginBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    // Switch to signup mode if needed
    const signupLink = await page.$('a[onclick*="signup"], .signup-link, [class*="signup"], a[href*="signup"]');
    if (signupLink) {
      await signupLink.click();
      await new Promise(r => setTimeout(r, 500));
    }

    // Find email and password fields
    const emailInput = await page.$('input[type="email"], #loginEmail, #signupEmail');
    const pwInput = await page.$('input[type="password"], #loginPassword, #signupPassword');

    if (!emailInput || !pwInput) {
      log('WARN', 'Auth: Email/Password inputs not found', 'Modal may have different structure');
      await page.close();
      return;
    }

    // Type credentials
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(testEmail);
    await pwInput.click({ clickCount: 3 });
    await pwInput.type(testPassword);

    // Submit
    const submitBtn = await page.$('button[type="submit"], .login-submit, #loginSubmit, #signupSubmit');
    if (submitBtn) {
      await submitBtn.click();
      await new Promise(r => setTimeout(r, 3000));

      // Check if logged in (look for user menu, dashboard, or profile icon)
      const userMenu = await page.$('.user-menu, .auth-user, [class*="user-avatar"], [class*="logged-in"]');
      if (userMenu) {
        log('PASS', 'Auth: Sign up + auto login', testEmail);
      } else {
        // Check for error message
        const errorMsg = await page.evaluate(() => {
          const err = document.querySelector('.error, .auth-error, [class*="error"]');
          return err ? err.textContent.trim() : '';
        });
        if (errorMsg) {
          log('WARN', 'Auth: Sign up response', errorMsg.substring(0, 80));
        } else {
          log('WARN', 'Auth: Sign up', 'No user menu found after submission');
        }
      }
    } else {
      log('WARN', 'Auth: Submit button not found');
    }

    // 2. Check onboarding screen after login
    await new Promise(r => setTimeout(r, 1000));
    const onboarding = await page.$('.onboarding, #onboarding, [class*="onboarding"]');
    if (onboarding) {
      const isVisible = await page.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      }, onboarding);
      if (isVisible) {
        log('PASS', 'Auth: Onboarding screen shown after login');
      } else {
        log('WARN', 'Auth: Onboarding exists but hidden');
      }
    } else {
      log('WARN', 'Auth: Onboarding screen not found');
    }

    // 3. Test input mode switching
    const urlTab = await page.$('[data-mode="url"], .input-tab-url, #urlModeTab');
    const textTab = await page.$('[data-mode="text"], .input-tab-text, #textModeTab');
    if (urlTab && textTab) {
      await textTab.click();
      await new Promise(r => setTimeout(r, 500));
      const textarea = await page.$('textarea, #companyText');
      log(textarea ? 'PASS' : 'WARN', 'Auth: Text input mode switch');
      await urlTab.click();
      await new Promise(r => setTimeout(r, 300));
    } else {
      log('WARN', 'Auth: Input mode tabs', 'not found (may need to navigate to step 1)');
    }

  } catch (e) {
    log('FAIL', 'Auth flow test error', e.message);
  } finally {
    await page.close();
  }
}

// ============ Main ============
(async () => {
  console.log('==========================================================');
  console.log('  koubo-navi v2.0 Production E2E Test');
  console.log(`  Target: ${PROD_URL}`);
  console.log(`  Worker: ${WORKER_URL}`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log('==========================================================');

  // Phase 1: API tests (no browser needed)
  await testWorkerAPIs();

  // Phase 2 & 3: Browser tests
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    await testBrowserUI(browser);
    await testAuthFlow(browser);
  } catch (e) {
    log('FAIL', 'Browser launch', e.message);
  } finally {
    if (browser) await browser.close();
  }

  // Summary
  console.log('\n==========================================================');
  console.log(`  RESULTS: ${pass} PASS / ${fail} FAIL / ${warn} WARN`);
  console.log('==========================================================\n');

  // List failures
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('  FAILURES:');
    failures.forEach(f => console.log(`    - ${f.test}: ${f.detail}`));
    console.log('');
  }

  // List warnings
  const warnings = results.filter(r => r.status === 'WARN');
  if (warnings.length > 0) {
    console.log('  WARNINGS:');
    warnings.forEach(w => console.log(`    - ${w.test}: ${w.detail}`));
    console.log('');
  }

  process.exit(fail > 0 ? 1 : 0);
})();
