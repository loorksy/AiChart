#!/usr/bin/env node
/**
 * Smoke test — Binance chart screenshot via Playwright.
 * From web/:  npm run playwright:setup && npm run playwright:test-capture
 * Optional:   npm run playwright:test-capture -- BTCUSDT futures
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));

const symbol = (process.argv[2] ?? "BTCUSDT").toUpperCase();
const market = process.argv[3] === "spot" ? "spot" : "futures";

function chartUrl(sym, m) {
  const s = sym.replace(/[^A-Z0-9]/g, "");
  if (m === "spot") {
    const pair = s.endsWith("USDT") ? `${s.slice(0, -4)}_${s.slice(-4)}` : s;
    return `https://www.binance.com/en/trade/${pair}?type=spot`;
  }
  return `https://www.binance.com/en/futures/${s}`;
}

if (process.env.BINANCE_CAPTURE_ENABLED !== "1") {
  console.warn("⚠️  Set BINANCE_CAPTURE_ENABLED=1 in web/.env");
}

const url = chartUrl(symbol, market);
console.log("Launching Chromium…", url);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3000);
  try {
    await page.waitForSelector("canvas", { timeout: 12_000 });
  } catch {
    console.warn("canvas not found — using viewport screenshot");
  }
  const png = await page.screenshot({ type: "png" });
  const dir = resolve(__dirname, "../data");
  mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `capture-test-${symbol}-${market}.png`);
  writeFileSync(out, png);
  console.log(`✅ ${png.length} bytes → ${out}`);
} finally {
  await browser.close();
}
