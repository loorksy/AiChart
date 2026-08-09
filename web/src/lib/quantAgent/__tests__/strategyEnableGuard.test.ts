import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";

/**
 * Enabling a generated strategy is the single most consequential write in the
 * Quant Agent surface: it admits LLM-written Python into
 * `registered_strategies_with_generated`, which the every-15-minutes
 * `quant-agent-scan` cron then executes to emit Telegram recommendations on
 * the SHARED, symbol-scoped feed — for every user, not just whoever generated
 * it. Two properties of that route are therefore worth pinning down.
 *
 * Source inspection rather than a live request, matching
 * `quantAgentCronCandleSource.test.ts`'s reasoning: exercising the route for
 * real needs a session cookie, the DB, and the isolated quant-agent service.
 * What is cheap and reliable to assert is that the two specific footguns that
 * were present cannot silently return.
 */
const ROUTE = "src/app/api/quant-agent/strategies/[strategyId]/enable/route.ts";
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

/**
 * Comments are stripped before matching. The route's own header explains what
 * the old shape was and quotes it, so a naive text search finds the very
 * pattern it is meant to forbid — the assertions below are about the CODE,
 * not about whether anyone is allowed to describe the bug in prose.
 */
function codeOf(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const source = codeOf(ROUTE);

/**
 * Regression: the schema read `z.object({ enabled: z.boolean().optional() })`
 * and the handler read `body.enabled ?? true`. An empty or malformed body —
 * a stray curl, a client bug, a retried request that lost its payload — took
 * the ENABLE branch. The default action of the endpoint must never be to make
 * generated code live.
 */
test("enable route: a missing `enabled` field is rejected, never defaulted to true", () => {
  assert.doesNotMatch(
    source,
    /enabled\s*\?\?\s*true/,
    "`body.enabled ?? true` makes an empty body an enable — pass the value through instead",
  );
  assert.doesNotMatch(
    source,
    /enabled:\s*z\.boolean\(\)\.optional\(\)/,
    "`enabled` must be required so zod rejects an empty body with a 400",
  );
  assert.match(source, /enabled:\s*z\.boolean\(\)/, "`enabled` must still be a required boolean");

  // Prove the shape actually behaves: the schema the route uses rejects {}.
  const schema = z.object({ enabled: z.boolean() });
  assert.equal(schema.safeParse({}).success, false, "an empty body must not parse");
  assert.equal(schema.safeParse({ enabled: true }).success, true);
  assert.equal(schema.safeParse({ enabled: false }).success, true);
});

/**
 * Regression: the route resolved a user id and then did nothing with it.
 * Strategy rows are global and carry no owner column, so any signed-in
 * account — or any holder of AICHART_SERVICE_TOKEN via the bridge branch of
 * `resolveQuantAgentUserId` — could enable any other account's generated
 * strategy for the whole platform. Admin-only is the honest minimum until
 * strategies are genuinely user-scoped.
 */
test("enable route: the toggle is admin-only, checked on the resolved user", () => {
  assert.match(
    source,
    /getPublicUser\(userId\)/,
    "the actor must be loaded from the RESOLVED id so the bridge path is held to the same bar",
  );
  assert.match(source, /role\s*!==\s*"admin"/, "non-admins must be rejected");
  assert.match(source, /403/, "the rejection must be a 403");

  // The check has to precede the write, not merely exist somewhere in the file.
  const adminCheck = source.indexOf('role !== "admin"');
  const write = source.indexOf("setQuantStrategyEnabled(");
  assert.ok(adminCheck >= 0 && write >= 0, "both the admin check and the write must be present");
  assert.ok(adminCheck < write, "the admin check must run BEFORE the enable write");
});
