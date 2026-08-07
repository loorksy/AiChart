import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reproduced live on production: a browser whose cached symbol predated
 * case-preservation held "XAUUSDM" (fully uppercase — no lowercase letter
 * survives to normalise back). normalizeSymbolCase cannot recover a broker's
 * true spelling ("XAUUSDm") from a string that never carried the lowercase
 * letter, so cloudQuote() must resolve the raw client symbol through the
 * symbol catalogue before asking MetaApi — like every sibling caller
 * (instruments/quotes, fetchOhlc, metaapi/streaming) — or it queries an
 * instrument that does not exist and the price stays null for a linked,
 * working account.
 *
 * The user's own MetaTrader account is also the ONLY pipe: on any failure the
 * route reports absence (requires_link / online:false), never a substitute
 * feed. No RTL/jsdom harness or live MetaApi credential exists in this test
 * environment, so both invariants are pinned at the source level.
 */

const SRC = readFileSync(
  path.join(import.meta.dirname, "..", "route.ts"),
  "utf8",
);

describe("forex-price route resolves the broker's real symbol spelling", () => {
  it("imports the catalogue resolver", () => {
    assert.match(
      SRC,
      /import \{ resolveBrokerSymbol \} from "@\/lib\/markets\/symbolCatalogue"/,
    );
  });

  it("resolves the broker symbol before querying MetaApi", () => {
    const cloudQuoteBody = SRC.slice(
      SRC.indexOf("async function cloudQuote"),
      SRC.indexOf("\n}", SRC.indexOf("async function cloudQuote")),
    );
    assert.match(
      cloudQuoteBody,
      /const brokerSymbol = await resolveBrokerSymbol\(userId, symbol\)/,
      "a raw client-cached symbol must be resolved against the catalogue, not trusted verbatim",
    );
    assert.match(
      cloudQuoteBody,
      /rpc\.getSymbolPrice\(brokerSymbol, true\)/,
      "the resolved broker spelling must actually be sent to MetaApi, not the raw input",
    );
    assert.doesNotMatch(
      cloudQuoteBody,
      /rpc\.getSymbolPrice\(symbol, true\)/,
      "must not regress to forwarding the unresolved raw symbol",
    );
  });
});

describe("the user's own account is the only pipe", () => {
  it("never mentions the retired platform feed", () => {
    assert.ok(
      !/oanda/i.test(SRC),
      "the route must not fall back to (or even name) the retired platform feed",
    );
  });

  it("answers an unlinked user with requires_link, not substitute data", () => {
    assert.match(
      SRC,
      /requires_link: true/,
      "absence must carry the reason so the client routes the user to the link flow",
    );
    assert.match(
      SRC,
      /اربط حساب MetaTrader/,
      "the user-facing message must name the missing link",
    );
  });
});
