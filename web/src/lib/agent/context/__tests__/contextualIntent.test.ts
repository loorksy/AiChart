import assert from "node:assert/strict";
import test from "node:test";
import { contextualizeIntentMessage } from "../contextualIntent";
import type { AgentConversationContext } from "../types";

const context: AgentConversationContext = {
  messages: [], estimatedTokens: 0, selectedMessageIds: [], removedMessageIds: [],
  compactedMessageIds: [], recalledMemoryIds: [], warnings: [],
  activeRecommendation: {
    id: "r1", source: "canonical", symbol: "XAUUSD", timeframe: "15m",
    direction: "buy", status: "triggered",
  },
};

test("adds recommendation intent hint without adding prices", () => {
  const result = contextualizeIntentMessage("why did you choose that entry?", context);
  assert.match(result, /explain recommendation/);
  assert.doesNotMatch(result, /\d{3,}/);
});

test("does not use historical context without an active resolved recommendation", () => {
  const result = contextualizeIntentMessage("same analysis", { ...context, activeRecommendation: undefined });
  assert.equal(result, "same analysis");
});
