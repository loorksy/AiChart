import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContextMessages } from "../normalizeMessages";
import { selectRelevantTurns } from "../selectRelevantTurns";

function history(contents: string[]) {
  return normalizeContextMessages(contents.map((content, index) => ({
    id: String(index), role: index % 2 ? "assistant" as const : "user" as const,
    content, createdAt: index < 2 ? 100 : undefined, source: "history" as const,
  }))).messages;
}

test("preserves latest user and assistant turns in stable input order", () => {
  const turns = history(["old", "old reply", "latest user", "latest assistant"]);
  const result = selectRelevantTurns(turns, "none", { maxTokens: 200, recentTurnCount: 2 });
  assert.deepEqual(result.turns.map(({ id }) => id), ["2", "3"]);
});

test("selects older English symbol discussion and rejects irrelevant history", () => {
  const turns = history(["XAUUSD liquidity setup on 15m", "gardening", "latest", "reply"]);
  const result = selectRelevantTurns(turns, "why that XAUUSD entry?", {
    maxTokens: 200, recentTurnCount: 2, relevantTurnCount: 1, symbol: "XAUUSD",
  });
  assert.deepEqual(result.turns.map(({ id }) => id), ["0", "2", "3"]);
});

test("matches Arabic and mixed Arabic/English relevance", () => {
  const turns = history(["توصية الذهب ووقف الخسارة", "EURUSD unrelated", "latest"]);
  const result = selectRelevantTurns(turns, "لماذا اخترت وقف XAUUSD في توصية الذهب؟", {
    maxTokens: 200, recentTurnCount: 1, relevantTurnCount: 1,
  });
  assert.deepEqual(result.turns.map(({ id }) => id), ["0", "2"]);
});

test("handles empty and very long history deterministically within budget", () => {
  assert.deepEqual(selectRelevantTurns([], "x", { maxTokens: 10 }).turns, []);
  const turns = history(Array.from({ length: 1_000 }, (_, i) => `message ${i}`));
  const first = selectRelevantTurns(turns, "message 5", { maxTokens: 80, recentTurnCount: 8 });
  const second = selectRelevantTurns(turns, "message 5", { maxTokens: 80, recentTurnCount: 8 });
  assert.ok(first.estimatedTokens <= 80);
  assert.deepEqual(first, second);
});

test("duplicate and missing timestamps do not change deterministic ordering", () => {
  const turns = history(["alpha", "beta", "gamma", "delta"]);
  const result = selectRelevantTurns(turns, "alpha", { maxTokens: 200, recentTurnCount: 3 });
  assert.deepEqual(result.turns.map(({ id }) => id), ["0", "1", "2", "3"]);
});
