import { access } from "fs/promises";
import path from "path";
import {
  binanceChartUrl,
  cacheKey,
  getBinanceCaptureConfig,
  type BinanceCaptureMarket,
} from "./binanceCaptureConfig";
import type { ChartDrawing } from "./chartDrawings";
import { buildChartSnapshotBufferForMarket } from "./chartSnapshot";

export type { BinanceCaptureMarket };

export interface BinanceCaptureInput {
  symbol: string;
  interval?: string;
  market_type?: BinanceCaptureMarket;
  full_page?: boolean;
  chart_drawings?: ChartDrawing[];
  userId?: number;
}

export interface BinanceCaptureStatus {
  enabled: boolean;
  chromiumReady: boolean;
  browsersPath: string | null;
  detail: string;
}

const cache = new Map<string, { buffer: Buffer; ts: number }>();

export function isBinanceCaptureEnabled(): boolean {
  return getBinanceCaptureConfig().enabled;
}

/** Probe whether Playwright + Chromium can launch (cached ~2 min in memory). */
let statusCache: { at: number; value: BinanceCaptureStatus } | null = null;

export async function getBinanceCaptureStatus(): Promise<BinanceCaptureStatus> {
  const cfg = getBinanceCaptureConfig();
  if (!cfg.enabled) {
    return {
      enabled: false,
      chromiumReady: false,
      browsersPath: cfg.browsersPath,
      detail: "BINANCE_CAPTURE_ENABLED≠1 — fallback برمجي فقط.",
    };
  }

  if (statusCache && Date.now() - statusCache.at < 120_000) {
    return statusCache.value;
  }

  let chromiumReady = false;
  let detail = "Chromium جاهز.";

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      executablePath: cfg.chromiumExecutable ?? undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    await browser.close();
    chromiumReady = true;
  } catch (err) {
    detail =
      err instanceof Error
        ? err.message
        : "تعذّر تشغيل Chromium — نفّذ: npm run playwright:install";
    chromiumReady = false;
  }

  const value: BinanceCaptureStatus = {
    enabled: true,
    chromiumReady,
    browsersPath: cfg.browsersPath,
    detail,
  };
  statusCache = { at: Date.now(), value };
  return value;
}

async function dismissCookieBanner(page: import("playwright").Page): Promise<void> {
  const selectors = [
    'button[id*="accept"]',
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("I Accept")',
    'button:has-text("Accept")',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 1500 });
        return;
      }
    } catch {
      /* try next */
    }
  }
}

async function screenshotChartArea(
  page: import("playwright").Page,
  fullPage: boolean,
): Promise<Buffer> {
  if (fullPage) {
    return Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
  }

  const chartSelectors = [
    "#chart_container",
    '[data-testid="chart-container"]',
    ".chart-container",
    "canvas",
  ];

  for (const sel of chartSelectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: 8_000 });
      const box = await loc.boundingBox();
      if (box && box.width > 200 && box.height > 150) {
        return Buffer.from(await loc.screenshot({ type: "png" }));
      }
    } catch {
      /* next selector */
    }
  }

  return Buffer.from(
    await page.screenshot({ fullPage: false, type: "png" }),
  );
}

async function captureWithPlaywright(
  input: BinanceCaptureInput,
): Promise<Buffer | null> {
  const cfg = getBinanceCaptureConfig();
  if (!cfg.enabled) return null;

  const market = input.market_type ?? cfg.defaultMarket;
  const interval = input.interval ?? "1h";
  const key = cacheKey(
    input.symbol,
    interval,
    market,
    Boolean(input.full_page),
  );

  if (cfg.cacheTtlMs > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < cfg.cacheTtlMs) {
      return hit.buffer;
    }
  }

  let browser: import("playwright").Browser | null = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: process.env.BINANCE_CAPTURE_HEADLESS !== "0",
      executablePath: cfg.chromiumExecutable ?? undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      viewport: cfg.viewport,
      colorScheme: "dark",
      locale: "en-US",
      userAgent:
        process.env.BINANCE_CAPTURE_USER_AGENT?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(cfg.timeoutMs);

    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "media" || type === "font") {
        void route.abort();
        return;
      }
      void route.continue();
    });

    const url = binanceChartUrl(input.symbol, market);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: cfg.timeoutMs,
    });

    await dismissCookieBanner(page);
    await page.waitForTimeout(2_500);

    try {
      await page.waitForSelector("canvas", { timeout: 12_000 });
    } catch {
      console.warn("[binance-capture] canvas not found — full viewport shot");
    }

    const buffer = await screenshotChartArea(page, Boolean(input.full_page));

    if (cfg.cacheTtlMs > 0) {
      cache.set(key, { buffer, ts: Date.now() });
    }
    return buffer;
  } catch (err) {
    console.warn("[binance-capture] Playwright failed:", err);
    statusCache = null;
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Playwright screenshot from binance.com, with programmatic chart fallback. */
export async function captureBinanceChart(
  input: BinanceCaptureInput,
): Promise<{ buffer: Buffer; source: "playwright" | "fallback" } | null> {
  const hasDrawings =
    Array.isArray(input.chart_drawings) && input.chart_drawings.length > 0;

  const pw = await captureWithPlaywright(input);
  if (pw && !hasDrawings) {
    return { buffer: pw, source: "playwright" };
  }

  if (input.userId == null) {
    if (pw) return { buffer: pw, source: "playwright" };
    console.warn("[binance-capture] fallback needs userId for candle data");
    return null;
  }

  const buffer = await buildChartSnapshotBufferForMarket(
    input.userId,
    input.symbol.toUpperCase(),
    input.interval ?? "1h",
    "crypto",
    { drawings: input.chart_drawings },
  );
  if (!buffer) {
    if (pw) return { buffer: pw, source: "playwright" };
    return null;
  }

  console.warn(
    "[binance-capture] chartSnapshot fallback",
    hasDrawings ? "(drawings overlay)" : "(playwright unavailable)",
  );
  return { buffer, source: "fallback" };
}

/** Resolve default Playwright browsers directory for diagnostics. */
export async function resolvePlaywrightBrowsersDir(): Promise<string | null> {
  const cfg = getBinanceCaptureConfig();
  if (cfg.browsersPath) return cfg.browsersPath;
  try {
    const pw = await import("playwright");
    const chromiumPath = pw.chromium.executablePath();
    return path.dirname(path.dirname(chromiumPath));
  } catch {
    return null;
  }
}

export async function chromiumBinaryExists(): Promise<boolean> {
  try {
    const pw = await import("playwright");
    const p = pw.chromium.executablePath();
    await access(p);
    return true;
  } catch {
    return false;
  }
}
