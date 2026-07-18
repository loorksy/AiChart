import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync(
  new URL("../../orchestrator.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../../../app/api/agent/chat/stream/route.ts", import.meta.url),
  "utf8",
);
const flags = readFileSync(
  new URL("../../featureFlags.ts", import.meta.url),
  "utf8",
);

test("context v2 stays flag-gated so an explicit 0 preserves the legacy route path", () => {
  assert.match(
    flags,
    /agentContextV2:\s*\(\)\s*=>\s*flag\("AGENT_CONTEXT_V2",\s*true\)/,
  );
  assert.ok(
    route.indexOf("if (FEATURES.agentContextV2())") <
      route.indexOf("getMessages(user.id, sessionId"),
  );
});

test("context remains a language aid and is not passed to market agents", () => {
  assert.doesNotMatch(
    orchestrator,
    /runMarketDataAgent\([\s\S]*?conversationContext/,
  );
  assert.doesNotMatch(
    orchestrator,
    /runExecutionGuardAgent\([\s\S]*?conversationContext/,
  );
  assert.match(
    orchestrator,
    /contextualizeIntentMessage\(userMessage, input\.conversationContext\)/,
  );
  assert.match(
    orchestrator,
    /answerGeneralQuestion\(userMessage, input\.conversationContext(?:,|\))/,
  );
});

test("general and drawing-only paths still return before market analysis", () => {
  const general = orchestrator.indexOf("if (isGeneralOnly(intents))");
  const drawing = orchestrator.indexOf("if (isDrawingOnly(intents))");
  const market = orchestrator.indexOf("runMarketDataAgent(");
  assert.ok(general > 0 && general < market);
  assert.ok(drawing > 0 && drawing < market);
});

test("orchestrator uses free-model path with execution guard — no Risk Agent / trade proposals", () => {
  assert.match(orchestrator, /runMarketDataAgent/);
  assert.match(orchestrator, /runModelFirstDecision/);
  assert.match(orchestrator, /runExecutionGuardAgent/);
  assert.match(orchestrator, /requiresConfirmation/);
  assert.doesNotMatch(orchestrator, /runRiskAgent/);
  assert.doesNotMatch(orchestrator, /buildTradeCandidates/);
  assert.doesNotMatch(orchestrator, /runFinalDecisionSynthesizer/);
  assert.doesNotMatch(orchestrator, /MODEL_FIRST_MODE/);
  assert.doesNotMatch(orchestrator, /getModelFirstMode/);
});
