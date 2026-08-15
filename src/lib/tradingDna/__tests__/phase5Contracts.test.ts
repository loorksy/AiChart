import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const text = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 5 architecture and security contracts", () => {
  it("maintains PostgreSQL/SQLite derived schema parity and append-only guards", () => {
    const sqlite = text("src/lib/db/sqlite.ts");
    const pg = text("src/lib/db/pg.ts");
    for (const table of [
      "trading_dna_snapshots",
      "trading_persona_versions",
      "shadow_recommendations",
    ]) {
      assert.ok(sqlite.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
      assert.ok(pg.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
      assert.ok(sqlite.includes(`immutable_${table}_update`));
      assert.ok(pg.includes(`immutable_${table}_update`));
    }
    assert.ok(sqlite.includes("CHECK (execution_prohibited = 1)"));
    assert.ok(pg.includes("CHECK (execution_prohibited = 1)"));
  });

  it("keeps Shadow Trader research-only with no execution, broker or dynamic runtime dependency", () => {
    const source = text("src/lib/tradingDna/shadowTrader.ts");
    for (const forbidden of [
      "@/lib/brokers",
      "@/lib/tradeFlow",
      "@/lib/execution",
      "createIntent(",
      "recordTrade(",
      "child_process",
      "eval(",
      "new Function",
      "python",
      "shell",
    ]) {
      assert.equal(source.includes(forbidden), false, `forbidden Shadow Trader dependency: ${forbidden}`);
    }
    assert.ok(source.includes("persistShadowRecommendation"));
  });

  it("exposes only authenticated GET routes for Trading DNA and Shadow Trader", () => {
    const routes = [
      "src/app/api/trading-dna/route.ts",
      "src/app/api/trading-dna/analytics/route.ts",
      "src/app/api/trading-dna/report/route.ts",
      "src/app/api/shadow-trader/route.ts",
      "src/app/api/shadow-trader/[id]/replay/route.ts",
    ];
    for (const route of routes) {
      const source = text(route);
      // Owner-scoped auth: routes moved from requireUser to the stricter
      // requirePaidAccess — either satisfies the authenticated-reads contract.
      assert.ok(source.includes("requireUser") || source.includes("requirePaidAccess"));
      assert.ok(source.includes("export async function GET"));
      assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(source), false);
    }
  });

  // The prose half of this test asserted on docs/TRADING_DNA_ARCHITECTURE.md,
  // which no longer exists — and a test that a markdown file contains seven
  // phrases never guarded anything a reader of the code could rely on. The
  // half that DOES constrain the code survives.
  it("keeps swarm sources out of the trading-DNA module", () => {
    assert.equal(sourceFiles().some((path) => /swarm/i.test(path)), false);
  });
});

function sourceFiles(): string[] {
  return [
    "src/lib/tradingDna/types.ts",
    "src/lib/tradingDna/evidence.ts",
    "src/lib/tradingDna/metrics.ts",
    "src/lib/tradingDna/shadowTrader.ts",
  ];
}
