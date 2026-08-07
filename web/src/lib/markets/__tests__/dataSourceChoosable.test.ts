/**
 * The single-pipe reality: the user's own linked MetaTrader account is the
 * ONLY market-data source. There is no platform feed and nothing to pick
 * between — the resolver's job is to say whether the one pipe is connected,
 * so an unlinked account is routed to the link flow instead of being handed
 * a substitute feed.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-data-source-"));
process.env.DB_PATH = join(dir, "data-source.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "data-source-test-secret";
delete process.env.DATABASE_URL;

let unlinkedUser = 0;
let cloudUser = 0;
let bridgeUser = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  const insertUser = (email: string) =>
    db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [email, "x", "user", "active"],
    );
  unlinkedUser = await insertUser("unlinked@example.com");
  cloudUser = await insertUser("cloud@example.com");
  bridgeUser = await insertUser("bridge@example.com");
  const store = await import("@/lib/store");
  await store.saveMtAccount(cloudUser, {
    platform: "mt5",
    server: "Broker-Server",
    login: "12345",
    password: "secret",
    metaapiAccountId: "cloud-account-id",
    state: "DEPLOYED",
  });
  // The self-hosted bridge is still the user's OWN account — it counts as linked.
  await store.saveMtAccount(bridgeUser, {
    platform: "mt5",
    server: "Local-Server",
    login: "67890",
    password: "secret",
    metaapiAccountId: "mt5local",
    state: "DEPLOYED",
  });
});

describe("resolveMarketDataSource — one pipe, honestly reported", () => {
  it("answers metaapi_not_connected when nothing is linked (absence, not a substitute)", async () => {
    const { resolveMarketDataSource } = await import("../marketDataSource");
    const decision = await resolveMarketDataSource(unlinkedUser, null);
    assert.equal(decision.source, "metaapi");
    assert.equal(decision.reason, "metaapi_not_connected");
    assert.equal(decision.available.metaapi, false);
  });

  it("answers auto_metaapi for a linked MetaApi cloud account", async () => {
    const { resolveMarketDataSource } = await import("../marketDataSource");
    const decision = await resolveMarketDataSource(cloudUser, null);
    assert.equal(decision.source, "metaapi");
    assert.equal(decision.reason, "auto_metaapi");
    assert.equal(decision.available.metaapi, true);
  });

  it("counts the self-hosted mt5local bridge as a linked account", async () => {
    const { resolveMarketDataSource } = await import("../marketDataSource");
    const decision = await resolveMarketDataSource(bridgeUser, null);
    assert.equal(decision.source, "metaapi");
    assert.equal(decision.reason, "auto_metaapi");
    assert.equal(decision.available.metaapi, true);
  });

  it("says no_user for an anonymous request", async () => {
    const { resolveMarketDataSource } = await import("../marketDataSource");
    const decision = await resolveMarketDataSource(null, null);
    assert.equal(decision.source, "metaapi");
    assert.equal(decision.reason, "no_user");
    assert.equal(decision.available.metaapi, false);
  });

  it("ignores a legacy requested-source string — there is nothing else to grant", async () => {
    const { resolveMarketDataSource } = await import("../marketDataSource");
    const decision = await resolveMarketDataSource(cloudUser, "some-old-feed");
    assert.equal(decision.source, "metaapi");
    assert.equal(decision.reason, "auto_metaapi");
  });
});

describe("the retired platform feed left no trace in the resolver or fetcher", () => {
  it("marketDataSource.ts no longer references the old feed", () => {
    const src = readFileSync(
      new URL("../marketDataSource.ts", import.meta.url),
      "utf8",
    );
    assert.ok(
      !/oanda/i.test(src),
      "the resolver must not mention the retired platform feed",
    );
    assert.match(
      src,
      /export type MarketDataSource = "metaapi"/,
      "the source union collapsed to the single pipe",
    );
  });

  it("fetchOhlc.ts serves only the user's own account", () => {
    const src = readFileSync(
      new URL("../../ohlc/fetchOhlc.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!/oanda/i.test(src), "no retired-feed fallback may remain");
    assert.match(
      src,
      /export type OhlcSource = "metaapi"/,
      "the candle source union collapsed to the single pipe",
    );
  });
});
