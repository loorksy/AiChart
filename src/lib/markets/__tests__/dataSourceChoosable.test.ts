/**
 * The single-pipe reality: the platform's OANDA feed is the ONLY market-data
 * source, configured once at the platform level. There is no per-user
 * account link involved in data availability at all — a user's broker
 * link only matters for later execution, never for
 * whether quotes/candles/recommendations are available.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("resolveMarketDataSource — one pipe, platform-level, honestly reported", () => {
  it("always answers oanda regardless of user identity or account link", async () => {
    const { resolveMarketDataSource } = await import("../marketDataSource");
    for (const userId of [null, 0, 1, 999]) {
      const decision = await resolveMarketDataSource(userId, null);
      assert.equal(decision.source, "oanda");
      assert.equal(decision.preference, "auto");
    }
  });

  it("ignores a legacy requested-source string — there is nothing else to grant", async () => {
    const { resolveMarketDataSource } = await import("../marketDataSource");
    const decision = await resolveMarketDataSource(1, "some-old-feed");
    assert.equal(decision.source, "oanda");
  });

  it("reason and availability reflect only whether OANDA itself is configured", async () => {
    const { resolveMarketDataSource, marketDataAvailability } = await import(
      "../marketDataSource"
    );
    const decision = await resolveMarketDataSource();
    const availability = await marketDataAvailability();
    assert.equal(decision.available.oanda, availability.oanda);
    assert.ok(
      decision.reason === "auto_oanda" || decision.reason === "oanda_not_configured",
    );
  });
});

describe("the retired MetaApi-linking gate left no trace in the resolver or fetcher", () => {
  it("marketDataSource.ts no longer gates data on a user's MetaApi link", () => {
    const src = readFileSync(
      new URL("../marketDataSource.ts", import.meta.url),
      "utf8",
    );
    assert.ok(
      !/getMtAccount/i.test(src),
      "the resolver must not read a user's own broker link for data availability",
    );
    assert.match(
      src,
      /export type MarketDataSource = "oanda"/,
      "the source union collapsed to the single OANDA pipe",
    );
  });

  it("fetchOhlc.ts serves candles from OANDA, not the user's own account", () => {
    const src = readFileSync(
      new URL("../../ohlc/fetchOhlc.ts", import.meta.url),
      "utf8",
    );
    assert.match(
      src,
      /export type OhlcSource = "oanda"/,
      "the candle source union collapsed to the single OANDA pipe",
    );
    assert.ok(
      !/getMtAccount|mt5Rates|getMetaApiAccount/.test(src),
      "candles must not be fetched from the user's own MT5/MetaApi account",
    );
  });
});
