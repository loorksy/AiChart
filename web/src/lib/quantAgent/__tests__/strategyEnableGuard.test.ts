import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Making a generated strategy live is the one action here that starts LLM-
 * written Python running on a schedule. This guards the properties that make
 * that safe.
 *
 * It used to guard a different mechanism: the toggle was admin-only. That was
 * the right call at the time and for a specific reason — strategy rows were
 * global and `registered_strategies_with_generated` loaded every enabled one
 * for every caller, so an owner activating their own strategy injected it into
 * OTHER people's recommendations. With no owner column there was nothing to
 * check ownership against, and admin-only was the honest minimum.
 *
 * Strategies now carry an owner and the registry is scoped to it, so the
 * isolation is real rather than administrative. The guard therefore moved with
 * it: it no longer asserts "only admins", it asserts the three things that
 * actually keep one user's strategy out of another user's signals.
 *
 * If you are here because this failed, the question is not how to make it pass
 * — it is whether the change you made lets one account's generated code run
 * for a different account.
 */

const SRC = join(process.cwd(), "src");
/**
 * Comments here EXPLAIN the old defaulting bug and quote it, so an assertion
 * that reads raw source matches the very text warning against the thing. Only
 * executable code can actually reintroduce it.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const route = stripComments(
  readFileSync(
    join(SRC, "app", "api", "quant-agent", "strategies", "[strategyId]", "status", "route.ts"),
    "utf8",
  ),
);
const client = stripComments(readFileSync(join(SRC, "lib", "quantAgent", "client.ts"), "utf8"));

test("the old enable route is gone, not merely bypassed", () => {
  // A leftover route with the previous `body.enabled ?? true` default would be
  // a second, weaker door into the same action.
  let exists = true;
  try {
    readFileSync(
      join(SRC, "app", "api", "quant-agent", "strategies", "[strategyId]", "enable", "route.ts"),
      "utf8",
    );
  } catch {
    exists = false;
  }
  assert.equal(exists, false, "the enable route was replaced by the status route; delete it");
});

test("status route: the transition is required, never defaulted", () => {
  assert.match(
    route,
    /z\.enum\(QUANT_STRATEGY_STATUSES\)/,
    "the status must be validated against the known set",
  );
  assert.ok(
    !/\?\?\s*"active"/.test(route) && !/\?\?\s*true/.test(route),
    'no defaulting: the predecessor read `body.enabled ?? true`, so an empty ' +
      "body took the enable branch. A missing status must be a 400.",
  );
  assert.match(route, /400/, "a malformed body must be rejected, not interpreted");
});

test("status route: ownership travels to the service and is settled there", () => {
  assert.match(
    route,
    /resolveQuantAgentUserId\(req\)/,
    "the actor must come from the resolved id, so the bridge path (service " +
      "token + user header) is held to the same bar as a browser session",
  );
  // The route must hand the RESOLVED id to the client, not anything the caller
  // supplied in the body.
  assert.match(
    route,
    /setQuantStrategyStatus\(\s*\{\s*userId,/,
    "the resolved userId must be the one sent to the service",
  );
  assert.ok(
    !/owner_user_id/.test(route),
    "the route must not read an owner from the request body — a caller " +
      "asserting who they are is not the same as the row agreeing",
  );
});

test("client: the owner is stamped at creation and on every transition", () => {
  // An ownerless generated strategy is either everybody's or nobody's, and the
  // first of those is the bug this whole change exists to close.
  const generateCalls = client.match(/owner_user_id: context\.userId/g) ?? [];
  assert.ok(
    generateCalls.length >= 3,
    "both generate paths and the status transition must send the owner; " +
      `found ${generateCalls.length}`,
  );
  assert.match(
    client,
    /body: JSON\.stringify\(\{ status, owner_user_id: context\.userId \}\)/,
    "the transition must carry the owner for the service to check against",
  );
});
