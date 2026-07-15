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

test("newer preference supersedes an older contradicting one (user correction wins)", () => {
  const now = Date.now();
  const old = memory({
    id: 10,
    content: "أفضل التداول على الذهب بأسلوب سكالب سريع مع مخاطرة عالية",
    memory_type: "trading_preference",
    created_at: new Date(now - 90 * 86_400_000).toISOString(),
    score: 0.95,
  });
  const corrected = memory({
    id: 11,
    content: "أفضل التداول على الذهب بأسلوب سوينغ هادئ مع مخاطرة منخفضة",
    memory_type: "trading_preference",
    created_at: new Date(now - 1 * 86_400_000).toISOString(),
    score: 0.6,
  });
  const result = safeMemoryMatches({ matches: [old, corrected], now });
  const ids = result.map((m) => m.id);
  assert.ok(ids.includes("11"), "the newer correction must be recalled");
  assert.ok(!ids.includes("10"), "the contradicted older preference must be superseded");
});

test("near-duplicate memories are deduplicated keeping the newest", () => {
  const now = Date.now();
  const a = memory({
    id: 20,
    content: "Prefer tight stop loss placement below structure",
    memory_type: "risk_preference",
    created_at: new Date(now - 30 * 86_400_000).toISOString(),
    score: 0.9,
  });
  const b = memory({
    id: 21,
    content: "Prefer tight stop loss placement below structure always",
    memory_type: "risk_preference",
    created_at: new Date(now - 2 * 86_400_000).toISOString(),
    score: 0.7,
  });
  const result = safeMemoryMatches({ matches: [a, b], now });
  assert.equal(result.filter((m) => ["20", "21"].includes(m.id)).length, 1);
  assert.equal(result.find((m) => ["20", "21"].includes(m.id))?.id, "21");
});

test("explicit user preferences outrank inferred memories of equal similarity", () => {
  const now = Date.now();
  const inferred = memory({
    id: 30,
    content: "يفضل المستخدم التحليل على فريم الساعة",
    memory_type: "user_preference",
    source: "agent",
    created_at: new Date(now - 5 * 86_400_000).toISOString(),
    score: 0.8,
  });
  const explicit = memory({
    id: 31,
    content: "أنا أفضل متابعة فريم الأربع ساعات دائماً",
    memory_type: "user_preference",
    source: "explicit_user_preference",
    created_at: new Date(now - 5 * 86_400_000).toISOString(),
    score: 0.8,
  });
  const result = safeMemoryMatches({ matches: [inferred, explicit], now });
  assert.equal(result[0]?.id, "31");
});
