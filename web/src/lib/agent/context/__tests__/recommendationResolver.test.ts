import assert from "node:assert/strict";
import test from "node:test";
import { resolveActiveRecommendationContext } from "../recommendationResolver";
import type { SafeRecommendationContext } from "../types";

function rec(id: string, source: SafeRecommendationContext["source"], overrides: Partial<SafeRecommendationContext> = {}): SafeRecommendationContext {
  return { id, source, symbol: "XAUUSD", timeframe: "15m", direction: "buy", status: "triggered", createdAt: 1, ...overrides };
}

test("canonical recommendation outranks session, chart and history", () => {
  const selected = resolveActiveRecommendationContext({ recommendationSources: [rec("h", "history"), rec("c", "chart"), rec("s", "session"), rec("p", "canonical")] });
  assert.equal(selected?.id, "p");
});

test("newer canonical recommendation for the same symbol is selected", () => {
  const selected = resolveActiveRecommendationContext({ recommendationSources: [
    rec("older", "canonical", { createdAt: 10 }),
    rec("newer", "canonical", { createdAt: 20 }),
  ] });
  assert.equal(selected?.id, "newer");
});

test("terminal and expired historical recommendations are not active", () => {
  const selected = resolveActiveRecommendationContext({ recommendationSources: [rec("p", "canonical", { status: "expired" }), rec("h", "history", { status: "cancelled" })] });
  assert.equal(selected, undefined);
});

test("matches symbol and timeframe and supports chart restore", () => {
  const selected = resolveActiveRecommendationContext({
    symbol: "XAUUSD", timeframe: "15m",
    recommendationSources: [rec("other-symbol", "canonical", { symbol: "EURUSD" }), rec("other-tf", "session", { timeframe: "1h" }), rec("chart", "chart")],
  });
  assert.equal(selected?.id, "chart");
});

test("new analysis after cancelled recommendation can become active", () => {
  const selected = resolveActiveRecommendationContext({ recommendationSources: [
    rec("old", "canonical", { status: "cancelled", createdAt: 10 }),
    rec("new", "session", { direction: "sell", status: "pending_entry", createdAt: 20 }),
  ] });
  assert.equal(selected?.id, "new");
  assert.equal(selected?.direction, "sell");
});

test("opposite historical direction cannot override active canonical direction", () => {
  const selected = resolveActiveRecommendationContext({ recommendationSources: [
    rec("current", "canonical", { direction: "buy" }),
    rec("historical-opposite", "history", { direction: "sell", createdAt: 999 }),
  ] });
  assert.equal(selected?.id, "current");
  assert.equal(selected?.direction, "buy");
});
