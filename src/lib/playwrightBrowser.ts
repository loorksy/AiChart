import { chromium, type Browser } from "playwright";

export interface BrowseOptions {
  mode?: "screenshot" | "text" | "both";
  selector?: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
}

export interface BrowseResult {
  url: string;
  title: string;
  screenshotBase64?: string;
  textContent?: string;
  error?: string;
}

/**
 * Navigates to a given URL using a headless Playwright Chromium instance,
 * optionally waits for a selector, and returns a screenshot (base64) or text content.
 */
export async function browseUrlWithPlaywright(
  url: string,
  options: BrowseOptions = {},
): Promise<BrowseResult> {
  const mode = options.mode ?? "both";
  const width = options.width ?? 1280;
  const height = options.height ?? 800;
  const timeoutMs = options.timeoutMs ?? 30000;

  let browser: Browser | null = null;
  try {
    const launchOptions: any = {
      headless: true,
    };

    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }

    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width, height },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // Wait until network is idle
    await page.goto(url, { waitUntil: "networkidle" });

    if (options.selector) {
      try {
        await page.waitForSelector(options.selector, { timeout: 10000 });
      } catch (e) {
        // Continue even if selector wait timed out
      }
    }

    const title = await page.title();
    const result: BrowseResult = { url, title };

    if (mode === "screenshot" || mode === "both") {
      const buf = await page.screenshot({ type: "png" });
      result.screenshotBase64 = buf.toString("base64");
    }

    if (mode === "text" || mode === "both") {
      const text = await page.evaluate(() => document.body.innerText);
      result.textContent = text.replace(/\s+/g, " ").trim().slice(0, 8000);
    }

    return result;
  } catch (err: any) {
    return {
      url,
      title: "",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
