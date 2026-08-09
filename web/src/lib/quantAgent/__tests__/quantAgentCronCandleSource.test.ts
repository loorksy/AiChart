import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Plan §4 — the Quant Agent cron scan/monitor sweeps must stop borrowing one
 * operator's linked MT account for candles. Real end-to-end coverage of
 * these routes needs a live cron secret, DB locks, and the isolated
 * quant-agent service — heavier than this repo's other route tests attempt
 * (there are no existing tests for these two files at all). What IS cheaply
 * and reliably verifiable, and what actually encodes "works with zero
 * linked MT accounts", is the shape of the candle fetch itself:
 * `fetchQuantAgentAnalysisBars` takes no `userId` parameter (see
 * `marketFeedAnalysis.test.ts` for the functional proof of that function),
 * so a route that calls it can never depend on any particular account being
 * linked, full stop — there is no `userId` value to thread through even by
 * accident.
 *
 * Lives under `lib/quantAgent/__tests__/` rather than `app/api/cron/` on
 * purpose: a `__tests__` folder placed directly under `app/api/cron/` reads
 * as a sibling "route directory" to `candleWarehouseCron.test.ts`'s own
 * `readdirSync(CRON_ROUTES_DIR)` schedule-coverage check, and fails it
 * asserting `/api/cron/__tests__` must be scheduled in `infra/aichart.cron`.
 */
const ROUTES = [
  "src/app/api/cron/quant-agent-scan/route.ts",
  "src/app/api/cron/quant-agent-monitors/route.ts",
];
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf-8");
}

for (const route of ROUTES) {
  test(`${route}: candle fetch uses the analysis-only feed, not the account-linked one`, () => {
    const content = read(route);
    assert.match(
      content,
      /from\s+["']@\/lib\/quantAgent\/marketFeed["']/,
      "must import from marketFeed",
    );
    assert.match(
      content,
      /\bfetchQuantAgentAnalysisBars\b/,
      "must call the userId-less analysis feed",
    );
    assert.doesNotMatch(
      content,
      /\bfetchQuantAgentBars\b/,
      "must NOT call the account-linked (MT-first) feed — that one requires a userId tied to a linked account",
    );
  });

  test(`${route}: the candle-fetch call site never threads userId through`, () => {
    const content = read(route);
    // Every fetchQuantAgentAnalysisBars(...) call in these routes must omit
    // `userId` entirely from its options object — a regression here would
    // silently reintroduce the single-operator coupling this plan removes.
    const calls = [...content.matchAll(/fetchQuantAgentAnalysisBars\(\{([\s\S]*?)\}\)/g)];
    assert.ok(calls.length >= 1, "expected at least one fetchQuantAgentAnalysisBars call");
    for (const call of calls) {
      assert.doesNotMatch(
        call[1] ?? "",
        /\buserId\b/,
        "fetchQuantAgentAnalysisBars call must not pass userId",
      );
    }
  });

  test(`${route}: resolveAgentUserId is still used only for recommendation ownership attribution, not candles`, () => {
    const content = read(route);
    // resolveAgentUserId() itself may remain (owner_user_id attribution on
    // generateQuantRecommendation still needs SOME identity value), but the
    // resolved userId must never reach the candle-fetch call.
    assert.match(content, /resolveAgentUserId\(\)/, "resolveAgentUserId should still be called");
    const candleCallMatch = content.match(/fetchQuantAgentAnalysisBars\(\{([\s\S]*?)\}\)/);
    assert.ok(candleCallMatch, "expected a fetchQuantAgentAnalysisBars call");
    assert.doesNotMatch(candleCallMatch![1] ?? "", /userId/);
  });
}
