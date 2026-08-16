import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync(new URL("../../orchestrator.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../../../app/api/agent/chat/stream/route.ts", import.meta.url), "utf8");
const flags = readFileSync(new URL("../../featureFlags.ts", import.meta.url), "utf8");

test("context v2 stays flag-gated so an explicit 0 preserves the legacy route path", () => {
  assert.match(flags, /agentContextV2:\s*\(\)\s*=>\s*flag\("AGENT_CONTEXT_V2",\s*true\)/);
  assert.ok(route.indexOf("if (FEATURES.agentContextV2())") < route.indexOf("getMessages(user.id, sessionId"));
});

test("context remains a language aid and is not passed to market or risk agents", () => {
  // Bound each check to the call STATEMENT (no `;` inside an argument list
  // here) — the old `[\s\S]*?` span reached from the market-agent call to any
  // later mention of conversationContext in the file, so the sanctioned
  // language-aid uses further down (the synthesizer's continuity block) made
  // it a false positive. What is forbidden is the context appearing in these
  // agents' ARGUMENTS, not existing later in the module.
  assert.doesNotMatch(orchestrator, /runMarketDataAgent\([^;]*conversationContext/);
  assert.doesNotMatch(orchestrator, /runRiskAgent\([^;]*conversationContext/);
  assert.doesNotMatch(orchestrator, /runExecutionGuardAgent\([^;]*conversationContext/);
  assert.match(orchestrator, /contextualizeIntentMessage\(userMessage, input\.conversationContext\)/);
  // The synthesizer receives conversation history ONLY through the sanctioned
  // compactor, which frames it as untrusted continuity context — never raw.
  assert.match(
    orchestrator,
    /conversationBlock: conversationBlockForSynth\(input\.conversationContext\)/,
  );
  // The general-answer path gained a third argument when answers began
  // streaming (the emitAnswerText sink). What this guards is which agents see
  // conversationContext, not the arity of the call, so it matches the two
  // arguments it cares about and lets the rest of the signature move.
  assert.match(
    orchestrator,
    /answerGeneralQuestion\(userMessage, input\.conversationContext[,)]/,
  );
});

test("general and drawing-only paths still return before market analysis", () => {
  const general = orchestrator.indexOf("if (isGeneralOnly(intents))");
  const drawing = orchestrator.indexOf("if (isDrawingOnly(intents))");
  const market = orchestrator.indexOf("runMarketDataAgent(");
  assert.ok(general > 0 && general < market);
  assert.ok(drawing > 0 && drawing < market);
});

// The execution guard and its confirmation handshake were DELETED with the
// rest of the execution layer: this is a recommendations-only platform and
// nothing here can place an order, so there is no order to guard. What this
// test now asserts is the inverse — that the orchestrator still runs the market
// and risk stages, and that no execution path grew back into it.
test("market and risk stages remain, with no execution path in the orchestrator", () => {
  assert.match(orchestrator, /runMarketDataAgent/);
  assert.match(orchestrator, /runRiskAgent/);
  assert.doesNotMatch(orchestrator, /runExecutionGuardAgent|requiresConfirmation|executeIntent/);
});

// Gap policy v1.2: "gapped" now means CATASTROPHIC data loss only — that tier
// still stops the fleet. Significant gaps degrade to a warning + evidence and
// analysis proceeds (the model stays the sole authority over the direction).
test("catastrophic candle gaps stop the market fleet before specialist analysis", () => {
  const gapGate = orchestrator.indexOf(
    'market.dataQuality.coverage.status === "gapped"',
  );
  // The specialist fleet is wrapped in classified failure capture:
  // withTimeout(captureStage("structure", runStructureAgent(...)), …).
  const specialistFleet = orchestrator.indexOf(
    'captureStage("structure", runStructureAgent',
  );
  assert.ok(gapGate > 0 && gapGate < specialistFleet);
});

test("significant gaps proceed to analysis as a warning, not a block", () => {
  const warningBranch = orchestrator.indexOf(
    'market.dataQuality.coverage.gapSeverity === "significant"',
  );
  // The specialist fleet is wrapped in classified failure capture:
  // withTimeout(captureStage("structure", runStructureAgent(...)), …).
  const specialistFleet = orchestrator.indexOf(
    'captureStage("structure", runStructureAgent',
  );
  assert.ok(warningBranch > 0 && warningBranch < specialistFleet);
  // The significant branch emits a warning event — it must NOT early-return.
  const branchSlice = orchestrator.slice(warningBranch, specialistFleet);
  assert.doesNotMatch(branchSlice, /decision:\s*"action_required"/);
  assert.match(branchSlice, /status:\s*"warning"/);
});
