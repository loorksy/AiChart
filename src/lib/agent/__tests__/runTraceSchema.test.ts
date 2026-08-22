import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("run trace tables stay in PostgreSQL/SQLite parity", () => {
  const pg = readFileSync(new URL("../../db/pg.ts", import.meta.url), "utf8");
  const sqlite = readFileSync(new URL("../../db/sqlite.ts", import.meta.url), "utf8");
  for (const table of ["agent_runs", "agent_run_steps", "agent_tool_calls"]) {
    assert.match(pg, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test("trace contracts contain no raw reasoning field and stay flag-gated", () => {
  const trace = readFileSync(new URL("../runTrace.ts", import.meta.url), "utf8");
  const flags = readFileSync(new URL("../featureFlags.ts", import.meta.url), "utf8");
  assert.doesNotMatch(trace, /chain.?of.?thought|rawReasoning|hiddenReasoning/i);
  // Default ON (auditable skill/tool/routing decisions); explicit 0 disables.
  assert.match(flags, /agentRunTraceV1:\s*\(\)\s*=>\s*flag\("AGENT_RUN_TRACE_V1",\s*true\)/);
});

test("the web turn writes traces only behind AGENT_RUN_TRACE_V1", () => {
  // The turn body moved from the stream route into webTurn.ts (Work ب);
  // the pinned property is unchanged: trace writes stay flag-gated.
  const turn = readFileSync(new URL("../webTurn.ts", import.meta.url), "utf8");
  assert.match(turn, /FEATURES\.agentRunTraceV1\(\)[\s\S]*?startAgentRun/);
});
