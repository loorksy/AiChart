import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("semantic memory metadata stays in PostgreSQL/SQLite parity", () => {
  const pg = readFileSync(new URL("../../db/pg.ts", import.meta.url), "utf8");
  const sqlite = readFileSync(new URL("../../db/sqlite.ts", import.meta.url), "utf8");
  for (const column of [
    "source", "memory_type", "confidence", "safety_classification", "expires_at",
    "last_used_at", "use_count", "source_chat_id", "source_message_id",
    "source_recommendation_id", "source_trade_id", "locale", "symbol", "timeframe", "strategy_id",
  ]) {
    assert.match(pg, new RegExp(`\\b${column}\\b`));
    assert.match(sqlite, new RegExp(`\\b${column}\\b`));
  }
});

test("Context V2 keeps recall inside the disabled-by-default flag", () => {
  // The turn body moved into webTurn.ts (Work ب); the pinned property is
  // unchanged: recall runs only under the flag, before the agent run.
  const turn = readFileSync(new URL("../webTurn.ts", import.meta.url), "utf8");
  const flag = turn.indexOf("if (FEATURES.agentContextV2())");
  const recall = turn.indexOf("recallAgentMemoryForContext(");
  const run = turn.indexOf("withUsageContext(");
  assert.ok(flag > 0 && recall > flag && recall < run);
});
