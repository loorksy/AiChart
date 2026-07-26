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
import { join, resolve } from "node:path";
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

function relative(file: string): string {
  return file.replace(`${process.cwd()}/`, "");
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
