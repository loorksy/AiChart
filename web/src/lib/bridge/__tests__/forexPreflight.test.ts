import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BridgeErrorCode } from "@/lib/bridge/errors";
import { evaluateForexQuoteGate } from "@/lib/bridge/forexPreflight";

describe("forex open_trade pre-flight", () => {
  it("rejects when heartbeat is not fresh", () => {
    const failure = evaluateForexQuoteGate(false, null, "EURUSD");
    assert.ok(failure);
    assert.equal(failure!.error.code, BridgeErrorCode.EA_OFFLINE);
  });

  it("rejects stale quote before execution", () => {
    const failure = evaluateForexQuoteGate(
      true,
      {
        bid: 1.08,
        ask: 1.0802,
        quoteAgeMs: 12_000,
        source: "stale",
      },
      "EURUSD",
      5000,
      30,
    );
    assert.ok(failure);
    assert.equal(failure!.error.code, BridgeErrorCode.STALE_QUOTE);
    assert.equal(failure!.error.retryAfterMs, 2000);
  });

  it("rejects when spread exceeds max pips", () => {
    const failure = evaluateForexQuoteGate(
      true,
      {
        bid: 1.08,
        ask: 1.09,
        quoteAgeMs: 100,
        source: "live",
      },
      "EURUSD",
      5000,
      5,
    );
    assert.ok(failure);
    assert.equal(failure!.error.code, BridgeErrorCode.SPREAD_TOO_WIDE);
  });

  it("passes fresh quote with acceptable spread", () => {
    const failure = evaluateForexQuoteGate(
      true,
      {
        bid: 1.08,
        ask: 1.0802,
        quoteAgeMs: 200,
        source: "live",
      },
      "EURUSD",
      5000,
      30,
    );
    assert.equal(failure, null);
  });
});
