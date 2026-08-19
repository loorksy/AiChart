import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Companion to the reasoning-token-headroom fix (openaiCompatReasoningTokens
 * test): AGENT_TIMEOUTS.general (20s) was calibrated against the fast
 * platform default (gpt-4.1). getQuickModel() honours an explicit user model
 * pick for the quick tier too, so picking a reasoning-family model pins
 * short general-question calls (explain_chart_drawings / general-only /
 * account-help intents) onto a model that "thinks" before answering — a real
 * risk of blowing a 20s deadline even with the token fix in place, since
 * this is a wall-clock latency problem, not a truncation problem.
 *
 * These three call sites are early-return paths that never run alongside
 * the deep-tier decision call, so widening them for a reasoning model has no
 * TOTAL_RUN_BUDGET_MS conflict to worry about.
 *
 * No live-provider harness exists in this test environment, so this pins
 * the fix at the source level.
 */

const SRC = readFileSync(
  path.join(import.meta.dirname, "..", "orchestrator.ts"),
  "utf8",
);

describe("orchestrator widens the general-question deadline for reasoning models", () => {
  it("defines a helper that doubles the deadline when the quick-tier model is reasoning-class", () => {
    const body = SRC.slice(
      SRC.indexOf("function generalStageTimeoutMs"),
      SRC.indexOf("\n}", SRC.indexOf("function generalStageTimeoutMs")),
    );
    assert.match(body, /isReasoningModel\(getQuickModel\(\)\)/);
    assert.match(body, /AGENT_TIMEOUTS\.general \* 2/);
  });

  it("drawing and greeting paths use the helper, not the raw constant", () => {
    const callSites = [...SRC.matchAll(/(?<!function )generalStageTimeoutMs\(\)/g)];
    assert.equal(
      callSites.length,
      2,
      "explain_chart_drawings and settleGeneralAnswer must both use the widened deadline",
    );
    assert.match(SRC, /settleGeneralAnswer\(/);
    assert.equal(
      (SRC.match(/answerGeneralQuestion\(/g) ?? []).length,
      2,
      "general-only and account-help must both go through settleGeneralAnswer",
    );
    assert.doesNotMatch(
      SRC,
      /AGENT_TIMEOUTS\.general,\n\s*null,/,
      "no call site may pass the raw constant directly — that would silently drop the reasoning-model widening",
    );
  });
});
