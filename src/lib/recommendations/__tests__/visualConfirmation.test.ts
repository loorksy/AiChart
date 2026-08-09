import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  applyVisualConfidencePenalty,
  buildVisualConfirmationAudit,
  DEFAULT_VISUAL_CONTRADICTION_PENALTY_PCT,
  normalizeTimeframesReviewed,
  normalizeVisualConfirmation,
  visualContradictionPenaltyPct,
} from "@/lib/recommendations/visualConfirmation";

describe("normalizeVisualConfirmation", () => {
  it("treats a missing field as not_checked so old callers keep working", () => {
    assert.equal(normalizeVisualConfirmation(undefined), "not_checked");
    assert.equal(normalizeVisualConfirmation(null), "not_checked");
    assert.equal(normalizeVisualConfirmation(""), "not_checked");
    assert.equal(normalizeVisualConfirmation("nonsense"), "not_checked");
  });

  it("accepts the enum in any casing", () => {
    assert.equal(normalizeVisualConfirmation("confirmed"), "confirmed");
    assert.equal(normalizeVisualConfirmation("CONTRADICTED"), "contradicted");
    assert.equal(normalizeVisualConfirmation(" not_checked "), "not_checked");
  });

  it("accepts the boolean shorthand", () => {
    assert.equal(normalizeVisualConfirmation(true), "confirmed");
    assert.equal(normalizeVisualConfirmation(false), "contradicted");
  });
});

describe("normalizeTimeframesReviewed", () => {
  it("canonicalises, de-duplicates, and bounds the list", () => {
    assert.deepEqual(
      normalizeTimeframesReviewed(["15m", "1h", "4h", "1D"]),
      ["15m", "1h", "4h", "1d"],
    );
    assert.deepEqual(normalizeTimeframesReviewed(["1D", "1d"]), ["1d"]);
    assert.equal(
      normalizeTimeframesReviewed(
        Array.from({ length: 20 }, (_, i) => `label${i}`),
      ).length,
      8,
    );
  });

  it("keeps an unrecognised label verbatim — the audit records the claim", () => {
    assert.deepEqual(normalizeTimeframesReviewed(["7h"]), ["7h"]);
  });

  it("returns an empty list for non-arrays", () => {
    assert.deepEqual(normalizeTimeframesReviewed(undefined), []);
    assert.deepEqual(normalizeTimeframesReviewed("1h"), []);
  });
});

describe("applyVisualConfidencePenalty", () => {
  afterEach(() => {
    delete process.env.VISUAL_CONTRADICTION_PENALTY_PCT;
  });

  it("lowers displayed confidence by the configured percentage on contradiction", () => {
    const result = applyVisualConfidencePenalty(80, "contradicted");
    assert.equal(result.applied, true);
    assert.equal(result.penaltyPct, DEFAULT_VISUAL_CONTRADICTION_PENALTY_PCT);
    assert.equal(result.confidence, 68); // 80 × (1 − 0.15)
    assert.equal(result.baseConfidence, 80);
  });

  it("never raises confidence when the picture agrees", () => {
    for (const state of ["confirmed", "not_checked"] as const) {
      const result = applyVisualConfidencePenalty(62.5, state);
      assert.equal(result.confidence, 62.5, state);
      assert.equal(result.applied, false, state);
    }
  });

  it("honours the configurable penalty", () => {
    process.env.VISUAL_CONTRADICTION_PENALTY_PCT = "25";
    assert.equal(visualContradictionPenaltyPct(), 25);
    assert.equal(
      applyVisualConfidencePenalty(80, "contradicted").confidence,
      60,
    );
  });

  it("falls back to the default for an invalid penalty setting", () => {
    process.env.VISUAL_CONTRADICTION_PENALTY_PCT = "-5";
    assert.equal(
      visualContradictionPenaltyPct(),
      DEFAULT_VISUAL_CONTRADICTION_PENALTY_PCT,
    );
  });

  it("clamps the input confidence into 0–100", () => {
    assert.equal(applyVisualConfidencePenalty(140, "confirmed").confidence, 100);
    assert.equal(applyVisualConfidencePenalty(-10, "confirmed").confidence, 0);
    assert.equal(applyVisualConfidencePenalty(Number.NaN, "confirmed").confidence, 0);
  });
});

describe("visual confirmation audit block", () => {
  it("records zero penalty when none was applied", () => {
    const audit = buildVisualConfirmationAudit(
      "confirmed",
      ["1h", "4h"],
      applyVisualConfidencePenalty(70, "confirmed"),
    );
    assert.deepEqual(audit, {
      visual_confirmation: "confirmed",
      timeframes_reviewed: ["1h", "4h"],
      confidence_penalty_pct: 0,
      confidence_before_penalty: null,
    });
  });

  it("preserves the pre-penalty confidence for later review", () => {
    const audit = buildVisualConfirmationAudit(
      "contradicted",
      ["15m"],
      applyVisualConfidencePenalty(70, "contradicted"),
    );
    assert.equal(audit.confidence_before_penalty, 70);
    assert.equal(
      audit.confidence_penalty_pct,
      DEFAULT_VISUAL_CONTRADICTION_PENALTY_PCT,
    );
  });
});

const SRC = join(process.cwd(), "src");

function read(relativePath: string): string {
  return readFileSync(join(SRC, relativePath), "utf8");
}

/**
 * Guardrail 2: visual review is a confirmation layer stacked on the statistical
 * gates, never a substitute. These assertions fail loudly if a future edit
 * teaches an execution path to read the visual fields.
 */
describe("live execution never consults visual review", () => {
  const executionSources = [
    "lib/strategies/evidence.ts",
    "app/api/agent/trade/open/route.ts",
    "lib/bridge/tradeReadiness.ts",
    "lib/executionSafety.ts",
  ];

  it("no execution-authority source references the visual fields", () => {
    for (const path of executionSources) {
      const source = read(path);
      for (const needle of [
        "visual_confirmation",
        "visualConfirmation",
        "timeframes_reviewed",
      ]) {
        assert.ok(
          !source.includes(needle),
          `${path} must not read ${needle} — execution authority is backtest evidence only`,
        );
      }
    }
  });

  it("execution eligibility still requires an active deployment and backtest id", () => {
    const evidence = read("lib/strategies/evidence.ts");
    assert.ok(evidence.includes("Recommendation has no backtest evidence"));
    assert.ok(evidence.includes('deployment?.state !== "active"'));
  });

  it("the contradiction penalty touches displayed confidence only", () => {
    const route = read("app/api/agent/recommendation/route.ts");
    // Statistical evidence stays server-owned and unpenalised.
    assert.ok(
      route.includes("backtested_confidence: deployment?.calibratedConfidence ?? null"),
      "backtested_confidence must keep the raw calibrated value",
    );
    assert.ok(
      route.includes("confidence_low: deployment?.confidenceLow ?? null"),
      "confidence interval must keep the raw calibrated bounds",
    );
    assert.ok(
      route.includes("confidence: displayedConfidence"),
      "displayed confidence is the only penalised figure",
    );
  });
});
