import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAgentMemoryCandidate,
  recallAgentMemoryForContext,
  safeMemoryMatches,
} from "../agentMemory";
import type { SearchSemanticMemoryMatch } from "@/lib/semanticMemory";

function memory(overrides: Partial<SearchSemanticMemoryMatch> = {}): SearchSemanticMemoryMatch {
  return {
    id: 1, user_id: 7, conversation_id: null, category: "risk_preference",
    memory_type: "risk_preference", content: "أفضل مخاطرة هي واحد بالمئة",
    archived: false, created_at: "2026-07-12T00:00:00Z", updated_at: "2026-07-12T00:00:00Z",
    confidence: 0.9, score: 0.8, source: "user", ...overrides,
  };
}

test("safe recall excludes expired/private memory and preserves Arabic", () => {
  const result = safeMemoryMatches({
    now: Date.parse("2026-07-13T00:00:00Z"),
    matches: [
      memory(),
      memory({ id: 2, expires_at: "2026-07-11T00:00:00Z" }),
      memory({ id: 3, content: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----" }),
    ],
  });
  assert.deepEqual(result.map(({ id }) => id), ["1"]);
  assert.match(result[0]!.content, /مخاطرة/);
});

test("symbol, timeframe, confidence and recency influence deterministic ranking", () => {
  const result = safeMemoryMatches({
    symbol: "XAUUSD", timeframe: "15m", now: Date.parse("2026-07-13T00:00:00Z"),
    matches: [
      memory({ id: 1, score: 0.7, confidence: 0.6, created_at: "2025-01-01T00:00:00Z" }),
      memory({ id: 2, score: 0.7, confidence: 0.9, symbol: "XAUUSD", timeframe: "15m" }),
    ],
  });
  assert.equal(result[0]!.id, "2");
});

test("recall is tenant-scoped and failures do not fail the request", async () => {
  let seenUserId = 0;
  const result = await recallAgentMemoryForContext({ userId: 42, query: "gold" }, {
    searchMemories: async (userId) => { seenUserId = userId; throw new Error("embedding down"); },
    searchLessons: async () => { throw new Error("down"); },
    markUsed: async () => {},
  });
  assert.equal(seenUserId, 42);
  assert.deepEqual(result.memories, []);
  assert.ok(result.warnings.includes("semantic_recall_failed"));
});

test("candidate classifier saves durable preferences only", () => {
  assert.equal(classifyAgentMemoryCandidate("مرحبا"), null);
  assert.equal(classifyAgentMemoryCandidate("سعر الذهب 2400 الآن"), null);
  assert.equal(classifyAgentMemoryCandidate("api_key=abcdefghijklmnop"), null);
  assert.equal(classifyAgentMemoryCandidate("أفضل دائماً مخاطرة واحد بالمئة")?.type, "risk_preference");
  assert.equal(classifyAgentMemoryCandidate("I prefer swing trading")?.type, "trading_preference");
});
