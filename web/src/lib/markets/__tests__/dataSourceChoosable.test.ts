import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { isOandaDataOnly } from "../forexDataSource";

/**
 * FOREX_DATA_SOURCE is the deployment's DEFAULT feed, not a prohibition.
 *
 * It used to short-circuit both marketDataAvailability and
 * resolveMarketDataSource, and `getForexDataSourceMode` falls back to "oanda"
 * for any other value, so `isOandaDataOnly()` was true on every deployment
 * that had not overridden it — production included, with
 * FOREX_DATA_SOURCE=oanda written out. The result: the picker shipped to let
 * an operator choose between multiple pipes could only ever offer one. The
 * other row sat greyed out, labelled "link an account to use this" while the
 * account was linked and the real reason was an environment variable.
 *
 * These tests pin the split: the flag decides `auto`, and a trader's explicit
 * choice of a pipe their account has connected is honoured.
 */

const ORIGINAL = process.env.FOREX_DATA_SOURCE;

describe("the market-data flag is a default, not a kill switch", () => {
  beforeEach(() => {
    process.env.FOREX_DATA_SOURCE = "oanda";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FOREX_DATA_SOURCE;
    else process.env.FOREX_DATA_SOURCE = ORIGINAL;
  });

  it("still reads as OANDA-default in production's configuration", () => {
    assert.equal(isOandaDataOnly(), true);
  });

  it("no longer appears in the availability answer", async () => {
    // Availability is a question about the account, so the module must not
    // consult the deployment flag at all when answering it.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../marketDataSource.ts", import.meta.url),
        "utf8",
      ),
    );
    const availabilityBody = src.slice(
      src.indexOf("export async function marketDataAvailability"),
      src.indexOf("function normalizePreference"),
    );
    assert.ok(
      !availabilityBody.includes("isOandaDataOnly"),
      "availability must reflect connections, not the deployment default",
    );
  });

  it("only decides the auto branch", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../marketDataSource.ts", import.meta.url),
        "utf8",
      ),
    );
    const resolver = src.slice(
      src.indexOf("export async function resolveMarketDataSource"),
    );
    const flagAt = resolver.indexOf("isOandaDataOnly()");
    const explicitAt = resolver.indexOf('wanted === "oanda"');
    assert.ok(flagAt > 0, "the flag must still set the default");
    assert.ok(
      flagAt > explicitAt,
      "the flag must be consulted after the explicit-choice branches, so a stored choice wins",
    );
  });
});

describe("the candle fetcher honours the resolved source", () => {
  it("does not clamp a caller's source to the platform feed", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../ohlc/fetchOhlc.ts", import.meta.url), "utf8"),
    );
    assert.ok(
      !src.includes("isOandaDataOnly"),
      "fetchOhlc must serve the pipe the resolver chose, or the picker reports a source it is not reading",
    );
    assert.match(
      src,
      /const forexSource: OhlcSource = options\.source \?\? "oanda"/,
      "an absent source still defaults to the platform feed",
    );
  });
});

describe("the two controls no longer both say «المنصة»", () => {
  it("names the data feed and the linking method differently", async () => {
    const fs = await import("node:fs");
    const ar = fs.readFileSync(
      new URL("../../i18n/ar.ts", import.meta.url),
      "utf8",
    );
    const pick = (key: string) =>
      ar.match(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`))?.[1] ?? "";

    // «عبر المنصّة» is where the ACCOUNT runs; the data feed is whose PRICES.
    // Naming both of them "المنصة" is what sent the operator looking for the
    // cloud account under a row that means OANDA.
    assert.equal(pick("data_source.short.oanda"), "OANDA");
    assert.ok(!pick("data_source.oanda").includes("المنصة"));
    assert.ok(pick("connect.method.platform").includes("المنصّة"));
  });
});
