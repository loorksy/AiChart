import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envelopeBadge, isOperationalBlocker } from "@/lib/agent/executionModeBadge";
import {
  descriptiveEnvelope,
  executionValidatedEnvelope,
  operationalBlockerEnvelope,
} from "@/lib/agent/resultEnvelope";

describe("envelopeBadge mapping (phase-0 persistent badge)", () => {
  it("labels a descriptive_only result as non-executable", () => {
    const badge = envelopeBadge(descriptiveEnvelope({ traceId: "t1" }));
    assert.deepEqual(badge, { labelKey: "agent.mode.descriptive", tone: "descriptive" });
  });

  it("labels validated results by their execution mode", () => {
    assert.equal(envelopeBadge(executionValidatedEnvelope({ executionMode: "shadow" }))?.tone, "shadow");
    assert.equal(envelopeBadge(executionValidatedEnvelope({ executionMode: "demo" }))?.tone, "demo");
    assert.equal(envelopeBadge(executionValidatedEnvelope({ executionMode: "live" }))?.tone, "live");
  });

  it("labels an operational blocker distinctly", () => {
    const badge = envelopeBadge(
      operationalBlockerEnvelope({
        failureStage: "market_data",
        failureCode: "timeout",
        retryable: true,
        traceId: "t2",
      }),
    );
    assert.deepEqual(badge, { labelKey: "agent.mode.blocker", tone: "blocker" });
  });

  it("never implies execution authority when there is no envelope", () => {
    assert.equal(envelopeBadge(undefined), null);
    assert.equal(envelopeBadge(null), null);
  });

  it("isOperationalBlocker is true only for a blocker envelope", () => {
    assert.equal(
      isOperationalBlocker(
        operationalBlockerEnvelope({
          failureStage: "final_decision",
          failureCode: "auth",
          retryable: false,
        }),
      ),
      true,
    );
    assert.equal(isOperationalBlocker(descriptiveEnvelope()), false);
    assert.equal(isOperationalBlocker(executionValidatedEnvelope({ executionMode: "live" })), false);
    assert.equal(isOperationalBlocker(undefined), false);
  });
});
