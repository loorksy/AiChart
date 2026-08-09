import assert from "node:assert/strict";
import test from "node:test";
import {
  QUANT_AGENT_MEMORY_CATEGORY,
  QUANT_AGENT_MEMORY_SOURCE,
  draftMemoryCandidate,
} from "@/lib/agent/quantAgentChat/memory";

test("category/source constants are dedicated to Quant Agent Chat", () => {
  assert.equal(QUANT_AGENT_MEMORY_CATEGORY, "quant_agent_note");
  assert.equal(QUANT_AGENT_MEMORY_SOURCE, "quant_agent_chat");
});

test("draftMemoryCandidate surfaces a candidate for note-worthy phrasing", () => {
  const en = draftMemoryCandidate("please remember I only trade XAUUSD");
  assert.ok(en);
  assert.match(en!.content, /remember I only trade XAUUSD/);

  const ar = draftMemoryCandidate("تذكر أنني أفضل توصيات الذهب فقط");
  assert.ok(ar);
});

test("draftMemoryCandidate returns null for plain conversation", () => {
  assert.equal(draftMemoryCandidate("what is the current XAUUSD recommendation?"), null);
  assert.equal(draftMemoryCandidate(""), null);
  assert.equal(draftMemoryCandidate("   "), null);
});

test("draftMemoryCandidate truncates very long content", () => {
  const long = `remember this: ${"x".repeat(500)}`;
  const candidate = draftMemoryCandidate(long);
  assert.ok(candidate);
  assert.ok(candidate!.content.length <= 400);
  assert.ok(candidate!.content.endsWith("…"));
});
