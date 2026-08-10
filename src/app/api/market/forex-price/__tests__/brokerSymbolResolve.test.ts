import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The forex-price route migrated from the user's own MetaTrader account to
 * the platform's OANDA feed (see the OANDA-only market-data migration): no
 * account link, no per-broker symbol-spelling resolution — every symbol is
 * canonicalised once (forexCanonicalKey) and checked against the fixed
 * 20-instrument allowlist before being sent to OANDA. No RTL/jsdom harness
 * exists in this test environment, so this is pinned at the source level.
 */

const SRC = readFileSync(
  path.join(import.meta.dirname, "..", "route.ts"),
  "utf8",
);

describe("forex-price route sources quotes from OANDA, not a broker account", () => {
  it("imports the OANDA pricing adapter, not the MetaApi RPC client", () => {
    assert.match(
      SRC,
      /import \{ fetchOandaPricing, oandaConfigured \} from "@\/lib\/markets\/oanda"/,
    );
    assert.doesNotMatch(
      SRC,
      /getRpcConnection|resolveBrokerSymbol|getMtAccount/,
      "must not regress to reading the user's own broker account for market data",
    );
  });

  it("canonicalises the symbol and checks it against the fixed universe before quoting", () => {
    const quoteBody = SRC.slice(
      SRC.indexOf("async function oandaQuote"),
      SRC.indexOf("\n}", SRC.indexOf("async function oandaQuote")),
    );
    assert.match(
      quoteBody,
      /const canonical = forexCanonicalKey\(symbol\) \|\| symbol/,
    );
    assert.match(
      quoteBody,
      /if \(!TRADABLE_SET\.has\(canonical\)\) return null/,
    );
    assert.match(
      quoteBody,
      /fetchOandaPricing\(\[canonical\]\)/,
      "the resolved canonical symbol must actually be sent to OANDA",
    );
  });
});

describe("OANDA is the only pipe, platform-level", () => {
  it("never mentions the retired MetaApi/broker-account data path", () => {
    assert.ok(
      !/MetaTrader|metaapi_account_id/i.test(SRC),
      "the route must not fall back to (or even name) the retired per-account data path",
    );
  });

  it("answers with a clear unavailable state when OANDA isn't configured", () => {
    assert.match(SRC, /oandaConfigured\(\)/);
    assert.match(
      SRC,
      /بيانات السوق غير متاحة حاليًا/,
      "the user-facing message must describe a platform outage, not a missing user link",
    );
  });
});
