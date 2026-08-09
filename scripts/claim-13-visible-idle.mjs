/** Visible-tab idle wake (#13): leave chart open, poll quotes, interact without reload. */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.PROD_URL || "https://aichart.lork.cloud";
const OUT = "/opt/cursor/artifacts/screenshots";
const EMAIL = process.env.VERIFY_EMAIL;
const PASS = process.env.VERIFY_PASSWORD;
const IDLE_MS = Number(process.env.IDLE_MS || 7 * 60 * 1000);

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: /دخول|log in|login|sign in/i }).click();
  await page.waitForURL(/workspace|console|chart/, { timeout: 90_000 });
}

async function quote(page, sym = "XAUUSDm") {
  const res = await page.request.get(
    `${BASE}/api/instruments/quotes?symbols=${sym}`,
    { timeout: 20_000 },
  );
  return res.ok() ? res.json() : { http: res.status() };
}

async function main() {
  if (!EMAIL || !PASS) process.exit(1);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await login(page);
  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const agree = page.getByRole("button", { name: /موافق|agree/i });
  if (await agree.isVisible().catch(() => false)) await agree.click();
  await page.getByTestId("topbar-chart-toggle").click().catch(() => {});
  await page.waitForTimeout(15_000);

  const navEntry = await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.type);
  const samples = [];
  samples.push({ phase: "warm", q: await quote(page) });
  console.log(`visible idle ${IDLE_MS / 60000} min…`);
  const tickEvery = 60_000;
  const started = Date.now();
  while (Date.now() - started < IDLE_MS) {
    await page.waitForTimeout(tickEvery);
    samples.push({ phase: "idle", atMin: Math.round((Date.now() - started) / 60000), q: await quote(page) });
  }
  const urlBefore = page.url();
  const intervalBtn = page.getByTestId("composer-interval");
  if (await intervalBtn.count()) {
    await intervalBtn.click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("1h")').first().click().catch(() => {});
  } else {
    await page.getByTestId("topbar-chart-toggle").click().catch(() => {});
    await page.waitForTimeout(2000);
    await page.keyboard.press("Tab");
  }
  await page.waitForTimeout(4000);
  const urlAfter = page.url();
  samples.push({ phase: "afterClick", q: await quote(page) });
  await page.screenshot({ path: path.join(OUT, "claim-13-visible-idle-after.png"), fullPage: true });

  const log = {
    idleMs: IDLE_MS,
    visibility: "visible",
    navEntry,
    urlBefore,
    urlAfter,
    reloaded: urlBefore !== urlAfter,
    samples,
    note: "Visible-tab idle (not background/hidden). Prior hidden-tab SSE test is a different failure mode.",
  };
  fs.writeFileSync(path.join(OUT, "claim-13-visible-idle.json"), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
