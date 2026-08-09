import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateExecutionIntent } from "@/lib/executionSafety";
import type { AdminLimits, TradeIntent } from "@/lib/types";

function intent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    id: 1, user_id: 1, recommendation_id: 1, symbol: "EURUSD", side: "buy",
    notional: 100, market: "forex", broker: "metaapi", entry: 1.1,
    stop_loss: 1.09, take_profit: 1.12, confidence: 1, rationale: "AI candidate",
    status: "approved", reason: null, practice: 0, market_type: "spot",
    order_type: "market", limit_price: null, created_at: "now", updated_at: "now",
    ...overrides,
  };
}

const allowed: AdminLimits = { user_id: 1, can_execute: 1, claude_quota: 0, updated_at: "now" };

describe("technical execution safety", () => {
  it("does not use confidence as an execution gate", () => {
    assert.equal(validateExecutionIntent(intent({ confidence: 0 }), allowed).ok, true);
    assert.equal(validateExecutionIntent(intent({ confidence: 100 }), allowed).ok, true);
  });

  it("requires technical authorization and a valid mandatory stop", () => {
    assert.equal(validateExecutionIntent(intent(), { ...allowed, can_execute: 0 }).ok, false);
    assert.equal(validateExecutionIntent(intent({ stop_loss: null }), allowed).ok, false);
    assert.equal(validateExecutionIntent(intent({ stop_loss: 1.11 }), allowed).ok, false);
    assert.equal(validateExecutionIntent(intent({ side: "sell", stop_loss: 1.11 }), allowed).ok, true);
  });
});
