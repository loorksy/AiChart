import assert from "node:assert/strict";
import test from "node:test";
import { FEATURES } from "../../featureFlags";

test("AGENT_CONTEXT_V2 defaults ON and an explicit 0 disables it", () => {
  const previous = process.env.AGENT_CONTEXT_V2;
  try {
    delete process.env.AGENT_CONTEXT_V2;
    assert.equal(FEATURES.agentContextV2(), true);
    // getPlatformValue caches the first non-empty value per process, so only
    // one explicit override can be asserted here: fail-safe disable.
    process.env.AGENT_CONTEXT_V2 = "0";
    assert.equal(FEATURES.agentContextV2(), false);
  } finally {
    if (previous === undefined) delete process.env.AGENT_CONTEXT_V2;
    else process.env.AGENT_CONTEXT_V2 = previous;
  }
});
