/**
 * Pattern identification: a broad catalog, never a default inverse H&S stamp.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATTERN_IDENTIFICATION_DOCTRINE } from "@/lib/agent/patternDoctrine";
import { SMART_CHART_AGENT_SYSTEM_PROMPT } from "@/lib/agent/systemPrompt";

describe("pattern identification doctrine", () => {
  it("lists classic, candle, and harmonic families", () => {
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /head and shoulders/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /inverse head and shoulders/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /double top/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /triangle/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /cup and handle/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /hammer/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /engulfing/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /Gartley/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /AB=CD/i);
  });

  it("forbids defaulting to inverse H&S and allows zero patterns", () => {
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /ZERO or ONE/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /no clear pattern/i);
    assert.match(PATTERN_IDENTIFICATION_DOCTRINE, /NEVER default to inverse head and shoulders/i);
  });

  it("is wired into the synthesizer and the chart-runtime prompt", () => {
    const synth = readFileSync(
      join(__dirname, "../agents/finalDecisionSynthesizer.ts"),
      "utf8",
    );
    assert.match(synth, /PATTERN_IDENTIFICATION_DOCTRINE/);
    assert.match(SMART_CHART_AGENT_SYSTEM_PROMPT, /NEVER default to inverse head and shoulders/);
    assert.match(SMART_CHART_AGENT_SYSTEM_PROMPT, /Gartley/);
  });

  it("does not inject a low-confidence H&S as the evidence primary pattern", () => {
    const synth = readFileSync(
      join(__dirname, "../agents/finalDecisionSynthesizer.ts"),
      "utf8",
    );
    assert.match(synth, /MIN_CARD_CONFIDENCE/);
    assert.match(synth, /describePrimaryPattern/);
  });
});
