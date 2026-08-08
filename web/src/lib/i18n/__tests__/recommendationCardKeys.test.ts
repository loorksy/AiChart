/**
 * The tracker card builds i18n keys DYNAMICALLY (`rec.footer.${state}`,
 * `rec.exec_state.${state}`, `rec.setup_type.${type}`), which the dictionary
 * parity test cannot see — parity only proves ar/en agree, not that a key a
 * component will actually ask for exists. This test iterates the real
 * executionState union and asserts every derived key resolves in both locales
 * (a missing key returns the raw key string, which is what shipped to prod as
 * "rec.footer.awaiting_activation").
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { t } from "@/lib/i18n";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

type ExecutionState = NonNullable<TrackedRecommendation["executionState"]>;

/**
 * Compile-time exhaustive: adding a state to the union without listing it here
 * fails `tsc`, so the runtime loop can never silently skip a state.
 */
const EXECUTION_STATES = Object.keys({
  valid_now: true,
  awaiting_activation: true,
  expired: true,
  invalidated: true,
  blocked: true,
} satisfies Record<ExecutionState, true>) as ExecutionState[];

const LOCALES = ["ar", "en"] as const;

describe("recommendation card dynamic i18n keys", () => {
  it("resolves rec.footer.* and rec.exec_state.* for every execution state in both locales", () => {
    for (const locale of LOCALES) {
      for (const state of EXECUTION_STATES) {
        for (const key of [`rec.footer.${state}`, `rec.exec_state.${state}`]) {
          assert.notEqual(t(locale, key), key, `${locale} is missing "${key}"`);
        }
      }
    }
  });

  it("resolves the cancelled presentation keys in both locales", () => {
    for (const locale of LOCALES) {
      for (const key of [
        "rec.footer.cancelled",
        "rec.status.cancelled",
        "rec.tip.cancelled",
      ]) {
        assert.notEqual(t(locale, key), key, `${locale} is missing "${key}"`);
      }
    }
  });

  it("resolves setup-type labels for the common setup types in both locales", () => {
    const setupTypes = [
      "scalp",
      "trend_continuation",
      "reversal_after_sweep",
      "range_boundary",
      "breakout_retest",
    ];
    for (const locale of LOCALES) {
      for (const type of setupTypes) {
        const key = `rec.setup_type.${type}`;
        assert.notEqual(t(locale, key), key, `${locale} is missing "${key}"`);
      }
    }
  });
});
