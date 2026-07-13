import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentConversationContext } from "../buildAgentConversationContext";

function build(overrides: Partial<Parameters<typeof buildAgentConversationContext>[0]> = {}) {
  return buildAgentConversationContext({
    userId: 1,
    sessionId: "s1",
    userMessage: "why did you choose that entry?",
    locale: "en",
    tokenBudget: 300,
    ...overrides,
  });
}

test("preserves under-budget history and current user message", () => {
  const result = build({ persistedMessages: [
    { id: "u1", role: "user", content: "question" },
    { id: "a1", role: "assistant", content: "answer", recommendationId: "r1" },
  ] });
  assert.deepEqual(result.messages.map(({ id }) => id), ["u1", "a1", "current:s1"]);
});

test("reduces over-budget history, truncates oversized prose, and is deterministic", () => {
  const persistedMessages = Array.from({ length: 80 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? "assistant" as const : "user" as const,
    content: index === 0 ? "x".repeat(8_000) : `irrelevant history ${index} ${"z".repeat(100)}`,
  }));
  const first = build({ persistedMessages, tokenBudget: 180 });
  const second = build({ persistedMessages, tokenBudget: 180 });
  assert.ok(first.estimatedTokens <= 180);
  assert.ok(first.removedMessageIds.length > 0);
  assert.ok(first.compactedMessageIds.includes("m0"));
  assert.deepEqual(first, second);
});

test("does not alter current user message", () => {
  const text = "حافظ على هذه الرسالة كما هي XAUUSD";
  const result = build({ userMessage: text, locale: "ar", tokenBudget: 100 });
  assert.equal(result.messages.at(-1)?.content, text);
});

test("omits stale historical market prices", () => {
  const result = build({ persistedMessages: [{
    id: "price", role: "assistant", content: "XAUUSD is 2400", historicalMarketData: true,
  }] });
  assert.ok(!result.selectedMessageIds.includes("price"));
  assert.ok(result.warnings.some(({ code }) => code === "historical_market_data_omitted"));
});

test("preserves active recommendation metadata", () => {
  const result = build({
    chartContext: { symbol: "XAUUSD", interval: "15m" },
    activeRecommendation: {
      id: "r2", source: "canonical", symbol: "XAUUSD", timeframe: "15m",
      direction: "buy", status: "triggered", analysisId: "a2", summary: "Liquidity sweep",
    },
  });
  assert.equal(result.activeRecommendation?.id, "r2");
  assert.ok(result.messages.some(({ kind, recommendationId }) => kind === "recommendation" && recommendationId === "r2"));
});

test("excludes expired and unsafe memory", () => {
  const result = build({ now: 1_000, recalledMemories: [
    { id: "expired", content: "old", expiresAt: 999 },
    { id: "key", content: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----" },
    { id: "safe", content: "أفضل مخاطرة هي واحد بالمئة" },
  ] });
  assert.deepEqual(result.recalledMemoryIds, ["safe"]);
  assert.ok(result.messages.every(({ role }) => role !== ("system" as never)));
});

test("prefers the recent complete tool pair under pressure", () => {
  const result = build({ tokenBudget: 90, persistedMessages: [
    { id: "old-call", role: "assistant", kind: "tool_call", toolCall: { id: "old", name: "read" }, content: "old call" },
    { id: "old-result", role: "tool", kind: "tool_result", toolCallId: "old", content: "old result" },
    { id: "recent-call", role: "assistant", kind: "tool_call", toolCall: { id: "recent", name: "read" }, content: "recent call" },
    { id: "recent-result", role: "tool", kind: "tool_result", toolCallId: "recent", content: "recent result" },
  ] });
  assert.ok(result.selectedMessageIds.includes("recent-call"));
  assert.ok(result.selectedMessageIds.includes("recent-result"));
});
