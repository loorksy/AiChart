import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

/**
 * The gate shipped wired into ONE call site — the MCP bridge route behind the
 * create_recommendation tool. The platform's own engine never called it, so
 * every plan produced by web chat, /api/agent/market/analyze and the
 * opportunity scanner was stored ungraded.
 *
 * Web chat is the surface the far-entry problem was reported on, which is why
 * fixing the gate did not fix the complaint. These assertions exist so the
 * platform path cannot quietly lose its grading again.
 */

function read(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

test("the platform write path grades reachability before storing a plan", () => {
  const orchestrator = read("src/lib/agent/orchestrator.ts");
  assert.match(orchestrator, /assessTradability\(/);
  // The verdict must reach the store, not just be computed and dropped.
  assert.match(orchestrator, /tradability,/);
});

test("a plan the market cannot reach keeps its direction and becomes watch-only", () => {
  const orchestrator = read("src/lib/agent/orchestrator.ts");
  assert.match(
    orchestrator,
    /tradability: "watch_only"/,
    "rejected must downgrade, not vanish — the analysis is still valid",
  );
  // Mid-stream, a throw would discard an otherwise sound analysis. That is the
  // MCP route's contract, not this one's.
  assert.doesNotMatch(
    orchestrator,
    /tradability[\s\S]{0,400}throw new ApiError/,
    "the platform path must not refuse the way the tool path does",
  );
});

test("the downgrade is gated, so it can be rolled back without losing the measurement", () => {
  const orchestrator = read("src/lib/agent/orchestrator.ts");
  assert.match(orchestrator, /FEATURES\.tradabilityGateV1\(\)/);
  // Flag OFF still records the verdict: rollback loses the gate, never the data.
  assert.match(orchestrator, /metrics\.tradabilityVerdicts\.inc/);
});

test("the verdict is stored where every reader already looks for it", () => {
  const store = read("src/lib/recommendations/recommendationStore.ts");
  assert.match(store, /JSON\.stringify\(\{ tradability: input\.tradability \}\)/);

  // The active-recommendations reader parses contextJson.tradability.tradability;
  // writing any other shape would store a verdict nothing can read.
  const reader = read("src/app/api/recommendations/active/route.ts");
  assert.match(reader, /parsed\.tradability/);
});

test("an ungradable plan is stored ungraded rather than assumed reachable", () => {
  const orchestrator = read("src/lib/agent/orchestrator.ts");
  // The helper returns null on failure and the spread drops the key, so the
  // context blob carries no verdict at all — never a fabricated "now".
  assert.match(orchestrator, /agent\.tradability\.unavailable/);
  const store = read("src/lib/recommendations/recommendationStore.ts");
  assert.match(store, /input\.tradability\s*\?\s*\{ contextJson/);
});
