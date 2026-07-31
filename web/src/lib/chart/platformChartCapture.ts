/**
 * Capture the PLATFORM chart — the licensed TradingView widget the operator
 * actually looks at, with the agent's own drawings on it.
 *
 * Why a headless browser: the TradingView chart is a browser-only runtime.
 * Everything else the platform could return is a re-drawing of the same data
 * by a different renderer (QuickChart) or a picture of MetaTrader (the EA),
 * neither of which is "the chart on the screen". The EA path stays for when a
 * broker terminal is connected and the operator explicitly asks for it.
 *
 * SERVER ONLY. The page is opened with a short-lived session cookie minted for
 * the owning user, so the capture sees exactly that user's layout and nothing
 * else. The browser is launched per capture and always closed.
 */
import { chromium, type Browser } from "playwright";
import { createSessionToken } from "@/lib/auth";
import { getPublicAppUrl } from "@/lib/appUrl";
import { queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("chart.platform-capture");

/** The chart needs time to boot the TV runtime, fetch bars, and paint. */
const NAV_TIMEOUT_MS = 45_000;
const CHART_READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 1_500;

export interface PlatformCaptureInput {
  userId: number;
  symbol: string;
  interval: string;
  /** Layout to open; defaults to the user's own chart layout. */
  layoutId?: string;
  width?: number;
  height?: number;
}

export interface PlatformCaptureResult {
  buffer: Buffer;
  width: number;
  height: number;
}

function chromiumLaunchOptions(): Parameters<typeof chromium.launch>[0] {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    // Containers and minimal VPS images lack the shared-memory size Chromium
    // expects; without these the browser dies on launch instead of rendering.
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  };
}

/**
 * Render the operator's chart headlessly and return a PNG of the chart area.
 *
 * Returns null on any failure — the caller reports an honest "no image"
 * rather than substituting a different picture.
 */
export async function capturePlatformChart(
  input: PlatformCaptureInput,
): Promise<PlatformCaptureResult | null> {
  const base = getPublicAppUrl();
  const user = await queryOne<{ id: number; email: string; role: string }>(
    "SELECT id, email, role FROM users WHERE id = ?",
    [input.userId],
  ).catch(() => null);
  if (!user) {
    log.warn("platform_capture.unknown_user", { userId: input.userId });
    return null;
  }

  const width = input.width ?? 1280;
  const height = input.height ?? 720;
  let browser: Browser | null = null;

  try {
    const token = await createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role === "admin" ? "admin" : "user",
    });

    browser = await chromium.launch(chromiumLaunchOptions());
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    // Same-origin session cookie: the headless page authenticates as the owner
    // and therefore loads that user's layout, drawings, and recommendation.
    const { hostname, protocol } = new URL(base);
    await context.addCookies([
      {
        name: "aichart_session",
        value: token,
        domain: hostname,
        path: "/",
        httpOnly: true,
        secure: protocol === "https:",
        sameSite: "Lax",
      },
    ]);

    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    const target = new URL(
      input.layoutId
        ? `/chart/${encodeURIComponent(input.layoutId)}`
        : `/chart/${encodeURIComponent(input.symbol.toUpperCase())}`,
      base,
    );
    target.searchParams.set("symbol", input.symbol.toUpperCase());
    target.searchParams.set("interval", input.interval);
    // Chrome-free capture mode: the page hides its own UI so the PNG is the
    // chart, not a screenshot of the whole application.
    target.searchParams.set("capture", "1");

    await page.goto(target.toString(), {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });

    // The TradingView widget mounts into a container carrying the symbol; the
    // iframe inside it only exists once the widget actually booted, which is
    // the difference between a chart and an empty box.
    const container = page.locator("div[data-symbol]").first();
    await container.waitFor({ state: "visible", timeout: CHART_READY_TIMEOUT_MS });
    await page
      .locator("div[data-symbol] iframe")
      .first()
      .waitFor({ state: "attached", timeout: CHART_READY_TIMEOUT_MS })
      .catch(() => {
        /* older builds render inline — the container screenshot still works */
      });
    // Bars and drawings paint after the frame attaches.
    await page.waitForTimeout(SETTLE_MS);

    const buffer = await container.screenshot({ type: "png", timeout: 15_000 });

    return { buffer, width, height };
  } catch (error) {
    log.warn("platform_capture.failed", {
      userId: input.userId,
      symbol: input.symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
