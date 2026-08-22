/**
 * FMP_API_KEY is platform configuration, not a box variable.
 *
 * The calendar key used to be readable ONLY from process.env, so the admin
 * panel could not configure the news layer in either process. These proofs
 * pin the repaired contract:
 *
 *   1. a key saved from the panel (the platform_config table) configures the
 *      news layer with no env var anywhere, and the FMP request carries it;
 *   2. a cold config cache + a table row + one refresh — exactly what initDb
 *      does at every process boot, worker included — resolves the key;
 *   3. env remains the fallback (FMP_API_KEY and the legacy aliases);
 *   4. when both exist, the table wins.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-news-config-"));
process.env.DB_PATH = join(dir, "config.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "news-config-test-secret";
delete process.env.DATABASE_URL;
delete process.env.FMP_API_KEY;
delete process.env.NEWS_API_KEY;
delete process.env.ECONOMIC_CALENDAR_API_KEY;
// Isolate the FMP source: the keyless feed would read as "configured" too.
process.env.FOREX_FACTORY_CALENDAR_V1 = "false";

let config: typeof import("@/lib/platformConfig");
let news: typeof import("@/lib/agent/news/newsProvider");
let cache: typeof import("@/lib/agent/news/calendarCache");

const realFetch = globalThis.fetch;

/** Serve an empty calendar while recording every requested URL. */
function captureFetch(urls: string[]): void {
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

before(async () => {
  config = await import("@/lib/platformConfig");
  news = await import("@/lib/agent/news/newsProvider");
  cache = await import("@/lib/agent/news/calendarCache");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  cache.resetCalendarCacheForTests();
  delete process.env.FMP_API_KEY;
  delete process.env.NEWS_API_KEY;
  delete process.env.ECONOMIC_CALENDAR_API_KEY;
  config.clearPlatformConfigCache();
});

after(async () => {
  // Leave no table row behind for any suite sharing this process.
  await config.savePlatformConfig({ FMP_API_KEY: "" });
});

describe("FMP key resolution: panel table first, env as fallback", () => {
  it("a panel-saved key configures the news layer with no env at all", async () => {
    await config.savePlatformConfig({ FMP_API_KEY: "db-key-123" });

    assert.equal(news.newsProviderConfigured(), true);
    const provider = news.getNewsProvider();
    assert.ok(provider, "a table-configured key must build the FMP provider");

    const urls: string[] = [];
    captureFetch(urls);
    await provider!.getEconomicEvents({
      currencies: ["XAU", "USD"],
      from: new Date(),
      to: new Date(Date.now() + 60_000),
    });
    const fmpCall = urls.find((u) => u.includes("financialmodelingprep.com"));
    assert.ok(fmpCall, "the FMP request must actually be made");
    assert.match(fmpCall!, /apikey=db-key-123/, "the request carries the TABLE key");
  });

  it("a cold cache resolves the table key after one refresh — the boot path", async () => {
    await config.savePlatformConfig({ FMP_API_KEY: "db-key-123" });

    // A new process starts with an empty config cache: before any DB load the
    // sync read sees nothing (there is no env var to fall back to)…
    config.clearPlatformConfigCache();
    assert.equal(news.newsProviderConfigured(), false);

    // …and the boot-time refresh (initDb runs this in web and worker alike)
    // is what makes the panel key visible to the process.
    await config.refreshPlatformConfigCache();
    assert.equal(news.newsProviderConfigured(), true);
  });

  it("env keys remain the fallback, aliases included", async () => {
    await config.savePlatformConfig({ FMP_API_KEY: "" }); // no table row
    config.clearPlatformConfigCache();
    assert.equal(news.newsProviderConfigured(), false);

    process.env.FMP_API_KEY = "env-key";
    assert.equal(news.newsProviderConfigured(), true);

    delete process.env.FMP_API_KEY;
    config.clearPlatformConfigCache();
    process.env.NEWS_API_KEY = "alias-key";
    assert.equal(news.newsProviderConfigured(), true);
  });

  it("when the table and env disagree, the table wins", async () => {
    process.env.FMP_API_KEY = "env-key";
    await config.savePlatformConfig({ FMP_API_KEY: "db-key-wins" });

    const provider = news.getNewsProvider();
    const urls: string[] = [];
    captureFetch(urls);
    await provider!.getEconomicEvents({
      currencies: ["XAU", "USD"],
      from: new Date(),
      to: new Date(Date.now() + 60_000),
    });
    const fmpCall = urls.find((u) => u.includes("financialmodelingprep.com"));
    assert.match(fmpCall ?? "", /apikey=db-key-wins/);
  });
});
