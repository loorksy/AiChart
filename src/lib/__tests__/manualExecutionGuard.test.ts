/**
 * Execution is MANUAL-ONLY — the revived layer's constitution, structurally.
 *
 * The owner deliberately revived a narrow execution layer (linked MT5 via
 * MetaAPI, one market order per explicit human press). What must now stay
 * true forever is not "no execution exists" but something sharper:
 *
 *   1. the ANALYSIS cannot reach the order path — no agent loop, resident
 *      tool, scheduler, sweep, or scan imports the execution modules;
 *   2. the decision contract still cannot express an order — a plan carries
 *      no volume, no lots, no "execute now";
 *   3. execution never writes the recommendation record — the agent is
 *      graded on its plans, not on what anyone executed;
 *   4. the MCP surface carries exactly the sanctioned manual pair, keeps
 *      every auto/approval-shaped tool dead, and no analysis tool steers
 *      the model toward executing;
 *   5. the execution routes authenticate a HUMAN (session or bridge user) —
 *      there is no service path that fires an order.
 *
 * A failure here is not style. It means an order could happen with nobody
 * pressing anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { chainTo, walkValueImports } from "./helpers/importGraph";

const SRC = path.join(import.meta.dirname, "..", "..");
const REPO = path.join(SRC, "..");
const SKIP = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(REPO, file).replaceAll(path.sep, "/");
}

/**
 * 1a. Who may even NAME the execution modules. The order path is imported by
 * the execution layer itself, its routes, and the Telegram button flow —
 * nothing else, ever. (Web components call the routes over HTTP.)
 */
test("only the sanctioned surfaces import @/lib/execution", () => {
  const allowed = [
    /^src\/lib\/execution\//,
    /^src\/app\/api\/execution\//,
    /^src\/lib\/telegram\/executionFlow\.ts$/,
    /^src\/lib\/telegram\/webhookAgent\.ts$/,
  ];
  const offenders = walk(SRC)
    .filter((file) => !/__tests__/.test(file))
    .filter((file) => /@\/lib\/execution\//.test(readFileSync(file, "utf8")))
    .map(rel)
    .filter((file) => !allowed.some((pattern) => pattern.test(file)));
  assert.deepEqual(
    offenders,
    [],
    "a new importer of the order path must be a human-press surface, and must be added here deliberately",
  );
});

/**
 * 1b. The analysis and automation trees never REACH the order path, even
 * transitively. These are the roots that run with no human pressing
 * anything: the orchestrator, the resident agent loop and its tool set, the
 * scanner, the sweep, the re-evaluation cycle, and the scheduler.
 */
test("no agent, resident, scheduler, sweep, or scan path reaches the order modules", () => {
  const roots = [
    "src/lib/agent/orchestrator.ts",
    "src/lib/resident/agentLoop.ts",
    "src/lib/resident/agentTools.ts",
    "src/lib/resident/host.ts",
    "src/lib/opportunityScan.ts",
    "src/lib/recommendations/recommendationTracker.ts",
    "src/lib/recommendations/reevaluationCycle.ts",
    "src/lib/scheduler/internalScheduler.ts",
  ]
    .map((entry) => path.join(REPO, entry))
    .filter((entry) => existsSync(entry));
  assert.ok(roots.length >= 6, "the automation roots moved — update the guard, do not delete it");

  const forbidden = [
    path.join(REPO, "src", "lib", "execution", "orders.ts"),
    path.join(REPO, "src", "lib", "execution", "metaapiTrade.ts"),
    path.join(REPO, "src", "lib", "telegram", "executionFlow.ts"),
  ];
  const result = walkValueImports(roots);
  const reached = forbidden.filter((file) => result.reachable.has(file));
  assert.deepEqual(
    reached.map((file) => chainTo(result, file)),
    [],
    "an automation path that can reach the order send is an order with nobody pressing anything",
  );
});

/**
 * 2. The decision contract itself. A plan that could carry a size or an
 * execute flag would be one integration away from being acted on — the
 * synthesizer's schema offers a direction and levels, and nothing that
 * commands.
 */
test("the decision contract cannot express an order", () => {
  const synth = readFileSync(
    path.join(SRC, "lib", "agent", "agents", "finalDecisionSynthesizer.ts"),
    "utf8",
  );
  for (const field of ["volume", "lots", "lotSize", "orderTicket", "executeNow"]) {
    assert.doesNotMatch(
      synth,
      new RegExp(`\\b${field}\\s*:`),
      `the plan schema must not carry ${field} — a size is the last thing between a plan and an order`,
    );
  }
});

/**
 * 3. Execution records, it never grades. The ledger is its own table; the
 * execution modules neither import a recommendation writer nor touch the
 * recommendation tables in SQL. The agent's record stays the agent's.
 */
test("execution never writes the recommendation record", () => {
  const writers =
    /createCanonicalRecommendation|createTrackedRecommendation|updateTrackedRecommendation|recordRecommendationOutcome|transitionRecommendation|applyRecommendationRevision|INTO recommendations\b|UPDATE recommendations\b|INTO recommendation_outcomes|INTO gate_records/;
  for (const file of walk(path.join(SRC, "lib", "execution"))) {
    if (/__tests__/.test(file)) continue;
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      writers,
      `${rel(file)} must never write the recommendation record — executions are not outcomes`,
    );
  }
});

/**
 * 4. The MCP surface: exactly the sanctioned manual pair; every auto- or
 * approval-shaped tool stays dead; and no ANALYSIS tool instructs the model
 * toward execution — the operator commands it, or it does not happen.
 */
test("MCP carries the manual pair only, and analysis tools never steer into execution", async () => {
  const { TOOL_CATALOG } = (await import(
    path.join(REPO, "mcp", "src", "tools", "schemas", "index.ts")
  )) as {
    TOOL_CATALOG: Array<{
      name: string;
      description: string;
      annotations: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }>;
  };

  const dead =
    /^(open_trade|close_trade|close_partial|modify_sl_tp|cancel_mt5_order|place_order|request_approval|respond_approval|get_pending_approvals|get_trade_readiness|set_agent_trade_mode)$/;
  assert.deepEqual(
    TOOL_CATALOG.map((tool) => tool.name).filter((name) => dead.test(name)),
    [],
    "the old auto/approval tool names must never come back",
  );

  const execute = TOOL_CATALOG.find((tool) => tool.name === "execute_recommendation");
  assert.ok(execute, "the manual execute tool is part of the sanctioned surface");
  assert.equal(execute!.annotations.destructiveHint, true);
  assert.match(
    execute!.description,
    /explicitly asked|operator explicitly/i,
    "the tool's own contract states operator-command-only",
  );
  assert.match(execute!.description, /NEVER on your own initiative/i);

  const trades = TOOL_CATALOG.find((tool) => tool.name === "get_execution_trades");
  assert.ok(trades, "the read-only trades tool is part of the sanctioned surface");
  assert.equal(trades!.annotations.readOnlyHint, true);

  // Analysis tools do not funnel the model toward the order path.
  const steering = TOOL_CATALOG.filter(
    (tool) =>
      tool.name !== "execute_recommendation" &&
      tool.name !== "get_execution_trades" &&
      /execute_recommendation/.test(tool.description),
  ).map((tool) => tool.name);
  assert.deepEqual(
    steering,
    [],
    "an analysis tool naming the execute tool is an instruction to call it",
  );
});

/**
 * 5. The routes authenticate a human — a session user or the MCP bridge's
 * per-user identity. No route in the execution family is open or
 * service-anonymous.
 */
test("every execution route resolves a human user", () => {
  const routes = walk(path.join(SRC, "app", "api", "execution")).filter((file) =>
    /route\.ts$/.test(file),
  );
  assert.ok(routes.length >= 3, "the execution routes moved — update the guard");
  for (const file of routes) {
    assert.match(
      readFileSync(file, "utf8"),
      /resolveExecutionUserId/,
      `${rel(file)} must resolve the pressing user before anything else`,
    );
  }
});
