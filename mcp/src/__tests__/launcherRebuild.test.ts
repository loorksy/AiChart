import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The launcher must notice that its build is out of date.
 *
 * `infra/aichart-mcp.sh` used to build only when `dist/index.js` was missing.
 * That file exists forever after the first build, so every later
 * `pm2 restart aichart-mcp` re-launched the same bundle no matter what had
 * been merged. Production ran a three-day-old build with no visible symptom —
 * the web app deployed and restarted normally beside it — while the MCP server
 * kept advertising tools whose backing routes had already been deleted. The
 * model was offered a tool; calling it returned 404.
 *
 * Nothing in the type system or the test suite can see that: the stale code is
 * correct, it is simply not the code that was merged. So the check lives here,
 * on the launcher text itself.
 */

const LAUNCHER = readFileSync(
  path.join(import.meta.dirname, "..", "..", "..", "infra", "aichart-mcp.sh"),
  "utf8",
);

describe("the MCP launcher rebuilds a stale dist", () => {
  it("does not gate the build on existence alone", () => {
    // The exact shape of the original bug: a lone existence test with nothing
    // else deciding whether to build.
    const gate = LAUNCHER.match(/if\s*\[\[\s*!\s*-f\s+dist\/index\.js\s*\]\]\s*;\s*then\s*\n\s*npm\s+ci\s*\n\s*npm\s+run\s+build\s*\n\s*fi/);
    assert.equal(
      gate,
      null,
      "a build gated only on dist/index.js existing never rebuilds after the first run",
    );
  });

  it("compares the build against the sources that produce it", () => {
    assert.match(
      LAUNCHER,
      /-newer\s+dist\/index\.js/,
      "the launcher must compare dist against its inputs, not just check it exists",
    );
    for (const input of ["src", "package.json", "tsconfig.json"]) {
      assert.ok(
        new RegExp(`find[^\\n]*\\b${input.replace(".", "\\.")}\\b`).test(LAUNCHER),
        `${input} changes the build output, so it must be part of the staleness check`,
      );
    }
  });

  it("still ends by executing the built entrypoint", () => {
    // Guards against a rewrite that builds correctly and then runs the wrong
    // thing — the launcher's whole job is the last line.
    assert.match(LAUNCHER, /exec node dist\/index\.js\s*$/);
  });
});
