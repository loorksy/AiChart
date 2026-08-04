import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reproduced live on production: a browser whose cached symbol predated
 * case-preservation held "XAUUSDM" (fully uppercase — no lowercase letter
 * survives to normalise back). normalizeSymbolCase cannot recover a broker's
 * true spelling ("XAUUSDm") from a string that never carried the lowercase
 * letter, so this route's cloudQuote() — the only MetaApi caller still
 * forwarding the client's raw symbol straight to getSymbolPrice instead of
 * resolving it through symbol_catalogue like every sibling caller
 * (instruments/quotes, fetchOhlc, metaapi/streaming) — asked MetaApi for an
 * instrument that does not exist, silently fell back to OANDA, and OANDA
 * rejected the broker-suffixed spelling too: price stayed null for a linked,
 * working account.
 *
 * No RTL/jsdom harness or live MetaApi credential exists in this test
 * environment, so this pins the fix at the source level: cloudQuote must
 * resolve through resolveBrokerSymbol before querying MetaApi.
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
