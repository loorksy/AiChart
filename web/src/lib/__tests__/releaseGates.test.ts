import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The gates that guard everything else.
 *
 * Both of these were once broken in the same way: they LOOKED like they were
 * protecting something while protecting nothing. `test:ci` omitted the two
 * files that pin the execution-stage and approval-proof fixes, so a green CI
 * proved nothing about them; and the Redis release validator refused to run
 * anywhere except port 6380 — the port the deployed app uses — so the guard
 * mandated the one instance it existed to protect.
 *
 * A gate that silently stops gating is worse than no gate, because it is
 * trusted. These tests fail if either regresses.
 */

const WEB_ROOT = path.resolve(__dirname, "../../..");

function packageScripts(): Record<string, string> {
  const raw = readFileSync(path.join(WEB_ROOT, "package.json"), "utf8");
  return JSON.parse(raw).scripts as Record<string, string>;
}

describe("test:ci covers the execution-safety suites", () => {
  /** The files that pin the P0 findings. Losing any of them from CI is the regression. */
  const P0_SUITES = [
    "executionStageAndApproval.test.ts",
    "executionMatrix.test.ts",
    "executionAuthorizationPaths.test.ts",
    "executionSourceEnforcement.test.ts",
    "executionSafety.test.ts",
    "executionKillSwitch.test.ts",
  ];

  it("defines a test:execution script", () => {
    assert.ok(packageScripts()["test:execution"], "test:execution must exist");
  });

  it("runs every P0 execution suite", () => {
    const script = packageScripts()["test:execution"] ?? "";
    for (const suite of P0_SUITES) {
      assert.ok(
        script.includes(suite),
        `${suite} pins a P0 finding and must run in test:execution`,
      );
    }
  });

  it("wires test:execution into test:ci", () => {
    const ci = packageScripts()["test:ci"] ?? "";
    assert.ok(
      ci.includes("test:execution"),
      "test:ci must run test:execution — otherwise a green CI says nothing about the execution gates",
    );
  });

  it("keeps the P0 suites reachable from test:ci by some path", () => {
    const scripts = packageScripts();
    const ci = scripts["test:ci"] ?? "";
    const referenced = ci
      .split("&&")
      .map((part) => part.trim().replace(/^npm run /, ""))
      .map((name) => scripts[name] ?? "")
      .join(" ");
    for (const suite of P0_SUITES) {
      assert.ok(referenced.includes(suite), `${suite} is not reachable from test:ci`);
    }
  });
});

describe("the Redis release validator refuses the deployed instance", () => {
  const script = path.join(WEB_ROOT, "scripts", "validate-redis-release.ts");

  /** Run the validator and return its combined output, expecting a non-zero exit. */
  function expectRefusal(env: Record<string, string>): string {
    try {
      // On Windows, npx is a .cmd shim, not a directly-executable binary —
      // execFileSync needs npx.cmd there (or shell:true) or the spawn
      // silently produces no output at all, and the assertions below fail
      // against an empty string instead of against a real refusal message.
      // That made this suite pass on POSIX and fail on Windows, which is
      // exactly the kind of platform-only failure that hides a real
      // regression from whichever OS didn't happen to run it.
      execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", script], {
        cwd: WEB_ROOT,
        env: { ...process.env, ...env },
        encoding: "utf8",
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string };
      return `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    assert.fail("the validator ran when it should have refused");
  }

  it("refuses to run without an explicit isolation declaration", () => {
    const output = expectRefusal({
      REDIS_URL: "redis://:pw@127.0.0.1:6380",
      REDIS_RELEASE_ISOLATED: "",
      DEPLOYED_REDIS_URL: "",
    });
    assert.match(output, /REDIS_RELEASE_ISOLATED/);
  });

  it("refuses when the target IS the deployed instance", () => {
    const output = expectRefusal({
      REDIS_URL: "redis://:pw@127.0.0.1:6380",
      REDIS_RELEASE_ISOLATED: "1",
      DEPLOYED_REDIS_URL: "redis://:pw@127.0.0.1:6380",
    });
    assert.match(output, /deployed instance/);
  });

  it("still requires authentication on the isolated instance", () => {
    const output = expectRefusal({
      REDIS_URL: "redis://127.0.0.1:16383",
      REDIS_RELEASE_ISOLATED: "1",
      DEPLOYED_REDIS_URL: "redis://:pw@127.0.0.1:6380",
    });
    assert.match(output, /require auth/);
  });

  it("does not pin isolation to a port number", () => {
    // The original bug, stated as an assertion: any guard that hard-codes 6380
    // as "the isolated port" is naming the deployed instance.
    const source = readFileSync(script, "utf8");
    assert.doesNotMatch(
      source,
      /assert\.equal\(\s*parsedUrl\.port\s*,\s*["']6380["']/,
      "isolation must not be inferred from a port number",
    );
  });
});
