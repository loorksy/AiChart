/**
 * Thinking narration — the live trace is DERIVED from run evidence, never a
 * scripted ticker, and never an internals side-channel.
 *
 * Pins three properties:
 *  1. every line interpolates the real values it was given (different
 *     evidence => different sentence), and there is no line without a value;
 *  2. the gate line speaks the localized checklist label, never the internal
 *     gate id / snake_case name;
 *  3. both live transports (webTurn.ts SSE and Telegram's progress bubble)
 *     scrub + sanitize through sanitizeThinkingLine before a thinking line
 *     is shown — Telegram used to omit the seam entirely.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  narrateFollowupCheck,
  narrateGateOutcome,
  narrateHigherTimeframe,
  narrateMarketRead,
  narrateNews,
  narrateStructure,
  narrateWeighing,
  sanitizeThinkingLine,
} from "@/lib/agent/thinkingNarration";
import { scrubInternalIdentifiers } from "@/lib/agent/userSafeOutbound";
import type { GateVerdict } from "@/lib/agent/gates/types";

const verdict = (over: Partial<GateVerdict>): GateVerdict => ({
  id: "G1",
  name: "news_and_events",
  status: "pass",
  startedAt: 1,
  finishedAt: 2,
  ...over,
});

describe("thinkingNarration — evidence in, sentence out", () => {
  it("market read carries the actual candle count, interval and price", () => {
    const line = narrateMarketRead({
      locale: "ar",
      interval: "1h",
      candleCount: 240,
      currentPrice: 4651.375,
    })!;
    assert.match(line, /240/);
    assert.match(line, /1h/);
    assert.match(line, /4651\.38/);
  });

  it("no evidence, no line — a value-less step emits nothing", () => {
    assert.equal(
      narrateMarketRead({ locale: "ar", interval: "1h", candleCount: 0, currentPrice: 4650 }),
      null,
    );
    assert.equal(
      narrateMarketRead({ locale: "ar", interval: "1h", candleCount: 10, currentPrice: NaN }),
      null,
    );
  });

  it("different evidence produces different sentences (never a fixed string)", () => {
    const a = narrateMarketRead({ locale: "ar", interval: "1h", candleCount: 240, currentPrice: 4651.3 });
    const b = narrateMarketRead({ locale: "ar", interval: "15m", candleCount: 96, currentPrice: 4702.8 });
    assert.notEqual(a, b);
    const s1 = narrateStructure({ locale: "ar", interval: "1h", trend: "uptrend" });
    const s2 = narrateStructure({ locale: "ar", interval: "1h", trend: "downtrend" });
    assert.notEqual(s1, s2);
  });

  it("structure with levels names the actual support and resistance", () => {
    const line = narrateStructure({
      locale: "ar",
      interval: "1h",
      trend: "uptrend",
      nearestSupport: 4620.5,
      nearestResistance: 4688.25,
    });
    assert.match(line, /4620\.50/);
    assert.match(line, /4688\.25/);
  });

  it("higher timeframe and news lines localize in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const htf = narrateHigherTimeframe({ locale, higherInterval: "4h", higherBias: "bullish" });
      assert.match(htf, /4h/);
      assert.ok(htf.length > 5);
      const news = narrateNews({ locale, level: "high" });
      assert.notEqual(news, narrateNews({ locale, level: "low" }));
    }
  });

  it("weighing distinguishes candidates from none", () => {
    const some = narrateWeighing({ locale: "ar", candidateCount: 3 });
    const none = narrateWeighing({ locale: "ar", candidateCount: 0 });
    assert.match(some, /3/);
    assert.notEqual(some, none);
  });

  it("a gate veto speaks the checklist label and reason — never the internal id", () => {
    const line = narrateGateOutcome({
      locale: "ar",
      verdicts: [verdict({})],
      allowed: false,
      vetoedBy: verdict({ status: "veto", reasonAr: "حدث عالي الأثر بعد 20 دقيقة" }),
    });
    assert.match(line, /حدث عالي الأثر بعد 20 دقيقة/);
    assert.doesNotMatch(line, /\bG1\b/);
    assert.doesNotMatch(line, /news_and_events/);
  });

  it("a passed chain reports the real verdict count", () => {
    const line = narrateGateOutcome({
      locale: "ar",
      verdicts: [verdict({}), verdict({ id: "G4" }), verdict({ id: "G6" })],
      allowed: true,
    });
    assert.match(line, /3/);
  });

  it("the follow-up line names the plan's direction and entry", () => {
    const line = narrateFollowupCheck({ locale: "ar", direction: "buy", entry: 4655.5 });
    assert.match(line, /4655\.50/);
  });

  it("every narration line survives the internals scrub unchanged", () => {
    const lines = [
      narrateMarketRead({ locale: "ar", interval: "1h", candleCount: 240, currentPrice: 4651.3 })!,
      narrateStructure({ locale: "ar", interval: "1h", trend: "uptrend", nearestSupport: 4620, nearestResistance: 4690 }),
      narrateHigherTimeframe({ locale: "ar", higherInterval: "4h", higherBias: "bearish" }),
      narrateNews({ locale: "ar", level: "unknown" }),
      narrateWeighing({ locale: "ar", candidateCount: 2 }),
      narrateGateOutcome({ locale: "ar", verdicts: [verdict({})], allowed: true }),
      narrateFollowupCheck({ locale: "en", direction: "sell", entry: 4700 }),
    ];
    for (const line of lines) {
      assert.equal(scrubInternalIdentifiers(line), line.trim(), line);
    }
  });
});

describe("thinking transport contract", () => {
  const webTurn = readFileSync(join(__dirname, "../webTurn.ts"), "utf8");
  const orchestrator = readFileSync(join(__dirname, "../orchestrator.ts"), "utf8");
  const webhook = readFileSync(join(__dirname, "../../telegram/webhookAgent.ts"), "utf8");
  const liveProgress = readFileSync(join(__dirname, "../../telegram/liveProgress.ts"), "utf8");

  it("webTurn scrubs and sanitizes before emitting the `thinking` SSE event", () => {
    assert.match(
      webTurn,
      /sanitizeThinkingLine\(text\)/,
      "the thinking emitter must pass both guards",
    );
    assert.match(webTurn, /send\("thinking"/);
  });

  it("the orchestrator narrates through the optional emitThinking seam only", () => {
    assert.match(orchestrator, /emitThinking\?\.\(/);
    assert.match(orchestrator, /narrateMarketRead/);
    assert.match(orchestrator, /narrateGateOutcome/);
  });

  it("Telegram wires the same sanitized thinking seam the web uses", () => {
    assert.match(webhook, /emitThinking:/);
    assert.match(webhook, /sanitizeThinkingLine/);
    assert.match(webhook, /reporter\.onThinking/);
    assert.match(liveProgress, /sanitizeThinkingLine/);
  });

  it("sanitizeThinkingLine strips chain-of-thought phrasing and system identifiers", () => {
    const dirty =
      "قرأت 240 شمعة. chain of thought: call gpt-4o with OPENAI_API_KEY at https://api.openai.com";
    const clean = sanitizeThinkingLine(dirty);
    assert.ok(clean.includes("قرأت 240 شمعة"));
    assert.doesNotMatch(clean, /chain of thought/i);
    assert.doesNotMatch(clean, /OPENAI_API_KEY/);
    assert.doesNotMatch(clean, /gpt-4o/);
    assert.doesNotMatch(clean, /api\.openai\.com/);
    // Honest narration survives the same scrub unchanged.
    const honest = narrateMarketRead({
      locale: "ar",
      interval: "1h",
      candleCount: 240,
      currentPrice: 4651.3,
    })!;
    assert.equal(sanitizeThinkingLine(honest), honest.trim());
  });
});
