import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertRecommendationTransition,
  canTransitionRecommendation,
  isTerminalRecommendationStatus,
  RecommendationLifecycleError,
} from "../index";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..", "..", "..");

describe("Phase 4 static contracts", () => {
  it("rejects illegal lifecycle transitions deterministically", () => {
    assert.equal(canTransitionRecommendation("draft", "active"), true);
    assert.equal(canTransitionRecommendation("active", "tp_hit"), false);
    assert.equal(isTerminalRecommendationStatus("closed"), true);
    assert.throws(
      () => assertRecommendationTransition("sl_hit", "active"),
      (error: unknown) =>
        error instanceof RecommendationLifecycleError &&
        error.code === "RECOMMENDATION_ILLEGAL_TRANSITION",
    );
  });

  it("maintains SQLite/PostgreSQL schema parity for canonical tables", () => {
    const sqlite = readFileSync(join(lib, "db", "sqlite.ts"), "utf8");
    const pg = readFileSync(join(lib, "db", "pg.ts"), "utf8");
    const tables = [
      "recommendation_history",
      "recommendation_transitions",
      "recommendation_outcomes",
      "recommendation_learning_events",
      "trade_lesson_candidates",
      "gold_agent_weight_versions",
    ];
    for (const table of tables) {
      assert.match(sqlite, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
      assert.match(pg, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
    const columns = [
      "analysis_id",
      "session_id",
      "chat_id",
      "direction",
      "targets_json",
      "risk_json",
      "strategy_id",
      "strategy_version",
      "expires_at",
      "status_reason",
      "engine_version",
    ];
    for (const column of columns) {
      assert.ok(sqlite.includes(column), `SQLite missing ${column}`);
      assert.ok(pg.includes(column), `PostgreSQL missing ${column}`);
    }
  });

  it("exposes owner-scoped reads but no browser mutation routes", () => {
    const collection = readFileSync(
      join(lib, "..", "app", "api", "recommendations", "tracked", "route.ts"),
      "utf8",
    );
    const detail = readFileSync(
      join(lib, "..", "app", "api", "recommendations", "tracked", "[id]", "route.ts"),
      "utf8",
    );
    // Owner-scoped auth: the routes moved from requireUser to the stricter
    // requirePaidAccess — either satisfies the "authenticated reads" contract.
    assert.match(collection, /requireUser|requirePaidAccess/);
    assert.match(detail, /requireUser|requirePaidAccess/);
    assert.doesNotMatch(collection, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.doesNotMatch(detail, /export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("keeps guard and execution modules outside the learning pipeline", () => {
    const goldLearning = readFileSync(join(here, "..", "goldLearning.ts"), "utf8");
    const outcomes = readFileSync(join(here, "..", "outcomes.ts"), "utf8");
    for (const source of [goldLearning, outcomes]) {
      assert.doesNotMatch(source, /riskGuard|executionGuard|marketSyncGuard/);
      assert.doesNotMatch(source, /executeTrade|placeOrder|openPosition/);
    }
  });
});
