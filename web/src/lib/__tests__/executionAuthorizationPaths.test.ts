/**
 * Only two things may cause a real order: the operator approved this trade, or
 * they earlier chose auto mode and the plan's own condition was met.
 *
 * That invariant is easy to state and easy to erode — a new route, a helper
 * "just for testing", a convenience wrapper. This test reads the source and
 * fails when a third caller appears, because by the time it shows up in
 * production the money has already moved.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, it } from "node:test";

const SRC = resolve(process.cwd(), "src");

/** Files allowed to call executeIntent, and why. */
const AUTHORIZED_CALLERS = new Map<string, string>([
  ["src/app/api/agent/trade/open/route.ts", "explicit approval, or the operator's auto mode"],
  ["src/lib/approvalFlow.ts", "the operator pressing approve on a proposed trade"],
  ["src/lib/recommendations/autoExecutor.ts", "standing authorisation after a plan activates"],
  [
    "src/app/api/trades/intents/[id]/route.ts",
    "the operator approving a pending intent in the platform",
  ],
  [
    "src/lib/quantAgent/bots/liveExecution.ts",
    "standing per-bot live arming — createIntent then executeIntent only",
  ],
]);

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Repo-relative path with POSIX separators.
 *
 * The allowlist is written with forward slashes, so the comparison has to be
 * too. On Windows `join` produces backslashes and a naive replace leaves an
 * absolute path that matches no key — which makes this guard fail everywhere
 * instead of only where a real violation exists.
 */
function relative(file: string): string {
  return file.slice(process.cwd().length + 1).split(sep).join("/");
}

describe("execution authorization paths", () => {
  it("only the authorized callers can place an order", () => {
    const callers = walk(SRC)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        // The definition itself is not a call site.
        if (relative(file) === "src/lib/execution.ts") return false;
        return /\bexecuteIntent\s*\(/.test(text);
      })
      .map(relative)
      .sort();

    const unexpected = callers.filter((file) => !AUTHORIZED_CALLERS.has(file));
    assert.deepEqual(
      unexpected,
      [],
      `unexpected execution call site(s): ${unexpected.join(", ")} — every order must come from an explicit approval or the operator's auto mode`,
    );
  });

  it("every creation site stamps how the order was authorised", () => {
    // The choke point can only enforce a source that was written. Each module
    // that creates an EXECUTABLE intent must say which of the two authorisations
    // it is acting under — an unstamped intent is treated as legacy and only
    // executes behind an explicit approval.
    const stamped = new Map<string, RegExp>([
      ["lib/approvalFlow.ts", /authorization_source: "user_approved"/],
      ["lib/tradeFlow.ts", /authorization_source: "user_approved"/],
      ["lib/recommendations/autoExecutor.ts", /authorization_source: "standing_auto"/],
      ["lib/quantAgent/bots/liveExecution.ts", /authorization_source: "standing_auto"/],
      // The bridge route is STANDING-AUTO ONLY. Its body is composed by the
      // caller — a model, on the MCP surface — so a body flag must never mint a
      // `user_approved` intent. Real approvals are created pending and flipped
      // by the authenticated approval path, which writes the server-side proof
      // the choke point demands.
      [
        "app/api/agent/trade/open/route.ts",
        /authorization_source: "standing_auto"/,
      ],
    ]);
    for (const [file, pattern] of stamped) {
      assert.match(
        readFileSync(join(SRC, file), "utf8"),
        pattern,
        `${file} must stamp the intent's authorization_source`,
      );
    }

    // The forgeable pattern must never come back: nothing a caller writes in
    // the request body may decide the authorisation source or stand in for an
    // approval at the choke point.
    const openRoute = readFileSync(
      join(SRC, "app/api/agent/trade/open/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      openRoute,
      /authorization_source:[^,\n]*approved_by_user/,
      "trade/open must not derive the authorisation source from the body",
    );
    assert.match(
      openRoute,
      /explicitApproval: false/,
      "trade/open can never claim to hold an explicit approval",
    );
  });

  it("the choke point itself enforces the stamped source", () => {
    // Route-level checks are advisory; the invariant lives in executeIntent.
    // It must READ the source, re-verify standing authorisation at execution
    // time, and refuse by name — not trust whatever route built the intent.
    const execution = readFileSync(join(SRC, "lib/execution.ts"), "utf8");
    assert.match(execution, /intent\.authorization_source/);
    assert.match(execution, /isAutoExecutionAuthorized/);
    assert.match(execution, /"auto_mode_revoked"/);
    assert.match(execution, /"unauthorized_source"/);
    // Explicit approval is consulted, not merely accepted and dropped.
    assert.match(execution, /explicitApproval/);
  });

  it("the auto path records that it was standing authorisation, not an approval", () => {
    const auto = readFileSync(
      join(SRC, "lib/recommendations/autoExecutor.ts"),
      "utf8",
    );
    assert.match(auto, /authorization_source: "standing_auto"/);
    // An auto trade must never masquerade as a per-trade approval: the audit
    // trail is how an operator reconstructs who decided what.
    assert.match(auto, /explicitApproval: false/);
  });

  it("the bot path records standing authorisation bound to bot_id, not an approval", () => {
    const bot = readFileSync(join(SRC, "lib/quantAgent/bots/liveExecution.ts"), "utf8");
    assert.match(bot, /authorization_source: "standing_auto"/);
    assert.match(bot, /bot_id:/);
    assert.match(bot, /explicitApproval: false/);
    assert.match(bot, /notional:\s*0/);
  });

  it("auto execution stays off unless an operator turns it on", () => {
    const auto = readFileSync(
      join(SRC, "lib/recommendations/autoExecutor.ts"),
      "utf8",
    );
    // The default branch of the stage parser must be "off".
    assert.match(auto, /return "off";/);
    assert.match(auto, /AUTO_EXECUTION_STAGE/);
  });

  it("the strategy-gated autonomous route is gone", () => {
    const route = readFileSync(
      join(SRC, "app/api/agent/trade/open/route.ts"),
      "utf8",
    );
    // Whether a trade may be placed is the operator's decision, not a
    // statistical property of a strategy.
    assert.doesNotMatch(route, /checkRecommendationExecutionEligibility/);
    assert.match(route, /isAutoExecutionAuthorized/);
  });
});
