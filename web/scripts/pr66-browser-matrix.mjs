/**
 * PR66 authenticated browser / accessibility matrix against an RC host.
 *
 *   WEB_BASE_URL=http://127.0.0.1:3019 \
 *   WEB_TEST_EMAIL=... WEB_TEST_PASSWORD=... \
 *   node scripts/pr66-browser-matrix.mjs
 *
 * Stores only sanitized artifacts under /tmp/pr66-browser-matrix (no secrets).
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.WEB_BASE_URL || "http://127.0.0.1:3019").replace(/\/$/, "");
const EMAIL = process.env.WEB_TEST_EMAIL || "";
const PASSWORD = process.env.WEB_TEST_PASSWORD || "";
const OUT = process.env.PR66_BROWSER_OUT || "/tmp/pr66-browser-matrix";

const VIEWPORTS = [
  { name: "mobile-360", width: 360, height: 740 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1920", width: 1920, height: 1080 },
];

const LOCALES = [
  { name: "ar-rtl-dark", lang: "ar", dir: "rtl", theme: "dark" },
  { name: "ar-rtl-light", lang: "ar", dir: "rtl", theme: "light" },
  { name: "en-ltr-dark", lang: "en", dir: "ltr", theme: "dark" },
  { name: "en-ltr-light", lang: "en", dir: "ltr", theme: "light" },
];

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, "screens"), { recursive: true });
}

function record(results, name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  const email = page.locator('input[type="email"], input[name="email"]').first();
  const password = page.locator('input[type="password"], input[name="password"]').first();
  await email.waitFor({ state: "visible", timeout: 30000 });
  await email.fill(EMAIL);
  await password.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  // SaaS login redirects to /console (or /awaiting-approval) — not /chat.
  await page
    .waitForURL(/\/(console|awaiting-approval|chat|dashboard|signals|plan)/, {
      timeout: 60000,
    })
    .catch(() => null);
  await page.waitForTimeout(500);
  const me = await page.request.get(`${BASE}/api/auth/me`).catch(() => null);
  if (me && me.ok()) return true;
  // Cookie may still be present even if /api/auth/me shape differs.
  const cookies = await page.context().cookies();
  return cookies.some((c) => /session|token|auth/i.test(c.name) && c.value);
}

async function setLocaleTheme(page, locale) {
  await page.evaluate(
    ({ lang, dir, theme }) => {
      document.documentElement.lang = lang;
      document.documentElement.dir = dir;
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("dark", theme === "dark");
      try {
        localStorage.setItem("aichart.locale", lang);
        localStorage.setItem("aichart.theme", theme);
        localStorage.setItem("theme", theme);
      } catch {
        /* ignore */
      }
    },
    locale,
  );
}

async function checkPage(page, pathName) {
  const res = await page.goto(`${BASE}${pathName}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const status = res?.status() ?? 0;
  await page.waitForTimeout(800);
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 2000);
  const hasCrash =
    /Application error|Unhandled Runtime Error|Internal Server Error|Something went wrong/i.test(
      bodyText,
    );
  return { status, hasCrash, bodyText };
}

async function a11yBasics(page) {
  return page.evaluate(() => {
    const issues = [];
    const main = document.querySelector("main, [role='main'], #__next, body");
    if (!main) issues.push("no-main-landmark");
    const buttons = [...document.querySelectorAll("button, a[href], input, select, textarea")];
    const unlabeled = buttons.filter((el) => {
      const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
      const text = (el.textContent || "").trim();
      const title = el.getAttribute("title");
      const type = el.getAttribute("type");
      if (type === "hidden") return false;
      return !(aria || text || title || el.getAttribute("placeholder"));
    });
    if (unlabeled.length > 12) issues.push(`many-unlabeled-controls:${unlabeled.length}`);
    // Escape should not throw
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { issues, interactive: buttons.length };
  });
}

async function run() {
  if (!EMAIL || !PASSWORD) {
    console.error("WEB_TEST_EMAIL and WEB_TEST_PASSWORD required");
    process.exit(2);
  }
  ensureOut();
  const results = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const loggedIn = await login(page);
  record(results, "login", loggedIn);
  if (!loggedIn) {
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ results }, null, 2));
    await browser.close();
    process.exit(1);
  }

  // Subscription / trial identity via API (no password echoed)
  const meRes = await page.request.get(`${BASE}/api/auth/me`);
  const me = meRes.ok() ? await meRes.json().catch(() => ({})) : {};
  record(
    results,
    "subscription-trial-identity",
    meRes.ok(),
    `keys=${Object.keys(me).slice(0, 8).join(",")}`,
  );

  for (const pathName of ["/console", "/chat", "/signals", "/dashboard", "/reports"]) {
    const { status, hasCrash } = await checkPage(page, pathName);
    record(results, `route${pathName.replaceAll("/", "-")}`, status < 500 && !hasCrash, `status=${status}`);
  }

  // Chart / selectors presence on chat (best-effort structural checks)
  await checkPage(page, "/chat");
  const chatBits = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    return {
      hasSymbol: /EURUSD|XAUUSD|GBPUSD|symbol/i.test(text) || !!document.querySelector("[data-symbol], select, [role='combobox']"),
      hasTimeframe: /M5|M15|H1|5m|15m|1h|timeframe/i.test(text),
      hasModel: /model|gpt|o3|reasoning/i.test(text),
      hasChart: !!document.querySelector("canvas, iframe, [class*='chart'], #tv_chart_container"),
    };
  });
  record(results, "chart-loading-structural", chatBits.hasChart || chatBits.hasSymbol, JSON.stringify(chatBits));
  record(results, "symbol-selector-structural", chatBits.hasSymbol, "");
  record(results, "timeframe-selector-structural", chatBits.hasTimeframe, "");
  record(results, "model-reasoning-selector-structural", chatBits.hasModel, "");

  // Locale × theme × viewport matrix (sampled screenshots, crash-free)
  for (const locale of LOCALES) {
    for (const vp of VIEWPORTS) {
      const caseName = `${locale.name}@${vp.name}`;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setLocaleTheme(page, locale);
      const { status, hasCrash } = await checkPage(page, "/chat");
      const dirOk = await page.evaluate((expected) => document.documentElement.dir === expected, locale.dir);
      const a11y = await a11yBasics(page);
      const ok = status < 500 && !hasCrash && dirOk && a11y.issues.length === 0;
      record(
        results,
        `matrix-${caseName}`,
        ok,
        `status=${status} crash=${hasCrash} dirOk=${dirOk} a11y=${a11y.issues.join("|") || "none"}`,
      );
      if (vp.name === "mobile-390" || vp.name === "desktop-1440") {
        const shot = path.join(OUT, "screens", `${caseName}.png`);
        await page.screenshot({ path: shot, fullPage: false });
      }
    }
  }

  // Keyboard / Escape
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  record(results, "keyboard-escape", true, "no-throw");

  // Historical tracked API under auth
  const tracked = await page.request.get(`${BASE}/api/recommendations/tracked`);
  const stats = await page.request.get(`${BASE}/api/recommendations/tracked/stats`);
  record(results, "tracked-api", tracked.ok(), `status=${tracked.status()}`);
  record(results, "tracked-stats-api", stats.ok(), `status=${stats.status()}`);

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const summary = {
    base: BASE,
    commitProbe: null,
    passed,
    failed,
    total: results.length,
    results,
  };
  try {
    const health = await fetch(`${BASE}/api/healthz`).then((r) => r.json());
    summary.commitProbe = health.commit ?? null;
  } catch {
    /* ignore */
  }
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nbrowser matrix: pass=${passed} fail=${failed} total=${results.length}`);
  console.log(`artifacts=${OUT}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
