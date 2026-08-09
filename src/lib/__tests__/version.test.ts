import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";
import { APP_VERSION, gitCommit, releaseIdentity } from "@/lib/version";

test("release identity exposes a semantic version and the exact git commit", () => {
  const identity = releaseIdentity();
  assert.match(identity.version, /^\d+\.\d+\.\d+$/);
  assert.equal(identity.version, APP_VERSION);
  // In a git checkout (PM2/bare-metal layout) the commit must resolve to the
  // real HEAD — "unknown" is only acceptable when no .git and no env exist.
  const expected = execSync("git rev-parse HEAD", { cwd: process.cwd() })
    .toString()
    .trim()
    .toLowerCase();
  assert.equal(gitCommit(), expected);
});
