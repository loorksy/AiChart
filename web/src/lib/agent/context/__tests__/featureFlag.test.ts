import assert from "node:assert/strict";
import test from "node:test";
import { FEATURES } from "../../featureFlags";

test("AGENT_CONTEXT_V2 is disabled by default and opt-in", () => {
  const previous = process.env.AGENT_CONTEXT_V2;
  try {
    delete process.env.AGENT_CONTEXT_V2;
    assert.equal(FEATURES.agentContextV2(), false);
    process.env.AGENT_CONTEXT_V2 = "1";
    assert.equal(FEATURES.agentContextV2(), true);
  } finally {
    if (previous === undefined) delete process.env.AGENT_CONTEXT_V2;
    else process.env.AGENT_CONTEXT_V2 = previous;
  }
});
