/**
 * Live model thinking — not timeframe-keyed templates.
 *
 * Pins: the sink emits sanitized provider deltas (the live path), cadence
 * and dedup hold, and canned narration is fallback only when the live
 * count is zero. Scrubbers still strip CoT phrasing and system identifiers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createLiveThinkingSink,
  emitNarrationFallback,
} from "@/lib/agent/liveThinking";
import { sanitizeThinkingLine } from "@/lib/agent/thinkingNarration";

describe("live thinking sink — provider deltas, not templates", () => {
  it("emits a sanitized model sentence on flush", () => {
    const lines: string[] = [];
    const sink = createLiveThinkingSink((line) => lines.push(line), {
      now: () => 1_000,
      minIntervalMs: 0,
      maxIntervalMs: 0,
    });
    sink.ingestDelta("The 15m rejection at the zone looks real. ");
    sink.ingestDelta("I will sell the follow-through. ");
    sink.flush();
    assert.ok(lines.length >= 1, "live deltas must produce a thinking line");
    assert.match(lines[0]!, /rejection|follow-through|15m/i);
    assert.ok(sink.hasLive());
  });

  it("scrubs chain-of-thought phrasing and system identifiers", () => {
    const lines: string[] = [];
    const sink = createLiveThinkingSink((line) => lines.push(line), {
      now: () => 1,
      minIntervalMs: 0,
      maxIntervalMs: 0,
    });
    sink.ingestDelta(
      "Looking at structure. chain of thought: call gpt-4o with OPENAI_API_KEY. ",
    );
    sink.flush();
    assert.ok(lines.length >= 1);
    const joined = lines.join(" ");
    assert.doesNotMatch(joined, /chain of thought/i);
    assert.doesNotMatch(joined, /OPENAI_API_KEY/);
    assert.doesNotMatch(joined, /gpt-4o/);
    assert.match(joined, /Looking at structure/);
  });

  it("deduplicates consecutive identical lines", () => {
    const lines: string[] = [];
    const sink = createLiveThinkingSink((line) => lines.push(line), {
      now: () => 1,
      minIntervalMs: 0,
      maxIntervalMs: 0,
    });
    sink.noteModelLine("أزن الرفض عند المنطقة.");
    sink.noteModelLine("أزن الرفض عند المنطقة.");
    assert.equal(lines.length, 1);
  });

  it("narration fallback is skipped when live thinking already ran", () => {
    const lines: string[] = [];
    const sink = createLiveThinkingSink((line) => lines.push(line), {
      now: () => 1,
      minIntervalMs: 0,
      maxIntervalMs: 0,
    });
    sink.noteModelLine("الشارت يظهر قناة هابطة واضحة.");
    emitNarrationFallback(
      (line) => lines.push(line),
      ["قرأت 1500 شمعة على فريم 5 - السعر الحالي 4601.89"],
      sink.emittedCount(),
    );
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0]!, /1500/);
  });

  it("narration fallback runs only when the model produced zero thinking", () => {
    const lines: string[] = [];
    emitNarrationFallback(
      (line) => lines.push(line),
      ["قرأت 240 شمعة على فريم 1h — السعر الحالي 4651.38"],
      0,
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /240/);
  });
});

describe("thinking transport — live path exists alongside scrubbers", () => {
  it("the synthesizer streams thinking deltas through callLLMStream", () => {
    const synth = readFileSync(
      join(__dirname, "../agents/finalDecisionSynthesizer.ts"),
      "utf8",
    );
    assert.match(synth, /callLLMStream/);
    assert.match(synth, /onThinkingDelta/);
  });

  it("Anthropic and OpenAI expose the thinking/reasoning channel", () => {
    const anthropic = readFileSync(join(__dirname, "../../anthropic.ts"), "utf8");
    const openai = readFileSync(join(__dirname, "../../openaiCompat.ts"), "utf8");
    assert.match(anthropic, /thinking_delta/);
    assert.match(anthropic, /onThinkingDelta/);
    assert.match(openai, /onThinkingDelta/);
    assert.match(openai, /reasoning_content/);
  });

  it("the orchestrator sinks live thinking and keeps narration as fallback", () => {
    const orch = readFileSync(join(__dirname, "../orchestrator.ts"), "utf8");
    assert.match(orch, /createLiveThinkingSink/);
    assert.match(orch, /emitNarrationFallback/);
    assert.match(orch, /onThinkingDelta/);
    assert.match(orch, /narrateMarketRead/);
  });

  it("web and Telegram still sanitize every thinking line", () => {
    const webTurn = readFileSync(join(__dirname, "../webTurn.ts"), "utf8");
    const webhook = readFileSync(join(__dirname, "../../telegram/webhookAgent.ts"), "utf8");
    assert.match(webTurn, /sanitizeThinkingLine\(text\)/);
    assert.match(webTurn, /send\("thinking"/);
    assert.match(webhook, /sanitizeThinkingLine/);
    const dirty =
      "قرأت 240 شمعة. chain of thought: call gpt-4o with OPENAI_API_KEY";
    const clean = sanitizeThinkingLine(dirty);
    assert.ok(clean.includes("قرأت 240 شمعة"));
    assert.doesNotMatch(clean, /chain of thought/i);
    assert.doesNotMatch(clean, /OPENAI_API_KEY/);
  });
});
