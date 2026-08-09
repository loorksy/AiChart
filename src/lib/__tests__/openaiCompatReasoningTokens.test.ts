import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reported in production: picking "GPT-5.6 Luna Pro" from the composer's
 * model picker made a full analysis fail with a "timeout" error. Root cause
 * (two independent investigations converged on it): the OpenAI completion
 * cap was a flat 4096 tokens for every model, with no headroom for reasoning
 * tokens — the same problem anthropic.ts's THINKING_MODELS already solves
 * for Claude 5-family extended thinking, just never mirrored on the OpenAI
 * path. A reasoning-family model (o-series, gpt-5) can spend the whole 4096
 * (or the caller's smaller request, e.g. the decision synthesizer's 3072) on
 * hidden reasoning before any visible JSON starts, truncating the response
 * (finish_reason: "length"). The synthesizer's JSON-parse retry loop then
 * re-runs the whole reasoning pass inside the SAME shared 95s stage
 * deadline — and that retry is what actually blows the budget.
 *
 * No live-provider harness exists in this test environment, so this pins
 * the fix at the source level: reasoning-family models must get real token
 * headroom, mirroring the Claude accommodation exactly.
 */

const SRC = readFileSync(
  path.join(import.meta.dirname, "..", "openaiCompat.ts"),
  "utf8",
);
const CATALOG_SRC = readFileSync(
  path.join(import.meta.dirname, "..", "modelCatalog.ts"),
  "utf8",
);

describe("openaiCompat gives reasoning-family models real token headroom", () => {
  it("classifies o-series and gpt-5 as reasoning models in the shared catalogue helper", () => {
    assert.match(CATALOG_SRC, /export function isReasoningModel/);
    assert.match(CATALOG_SRC, /\/\^o\\d\/\.test\(id\)/);
    assert.match(CATALOG_SRC, /\/\^gpt-5\/\.test\(id\)/);
  });

  it("tokenLimitBody floors reasoning models well above the 4096 flat cap", () => {
    const body = SRC.slice(
      SRC.indexOf("function tokenLimitBody"),
      SRC.indexOf("function reasoningBody"),
    );
    assert.match(body, /isReasoningModel\(model\)/);
    assert.match(
      body,
      /REASONING_MIN_TOKENS/,
      "a reasoning model must not be left on the same 4096 cap that truncates its hidden reasoning + visible answer",
    );
    // The non-reasoning branch must still be capped — this is headroom for
    // reasoning models specifically, not a blanket raise for every model.
    assert.match(body, /Math\.min\(maxTokens \?\? 4096, 4096\)/);
  });

  it("the reasoning token floor is a real number well above 4096, not a no-op", () => {
    const floorMatch = SRC.match(/const REASONING_MIN_TOKENS = (\d+)/);
    assert.ok(floorMatch, "REASONING_MIN_TOKENS must be defined");
    assert.ok(
      Number(floorMatch[1]) > 4096,
      "the floor must exceed the flat cap it replaces, or reasoning models see no benefit",
    );
  });
});
