/**
 * A test file that no script runs is not a test. It is a file.
 *
 * This guard exists because of what it found. `decisionTruncation.test.ts` —
 * the entire regression for the blocking 95-second analysis failure — was
 * committed, passed when invoked by hand, and was referenced by no npm script
 * at all. `npm run test:ci` never executed it, so the invariants it pins were
 * unenforced from the moment they were written. It was not alone: 46 of the
 * repo's 264 test files were in the same state, including
 * `adminContract.test.ts` (the two-sided contract guard written for the
 * Operations-screen defect), `uiNoRawValues.test.ts` (the guard against
 * printing `undefined` to a user), `adminSurfaceParity.test.ts` and
 * `modelProviderBinding.test.ts`. Every one of them passed. None of them ran.
 *
 * That is worse than having no test, because the green suite is read as proof.
 *
 * The scripts name their files explicitly rather than globbing, and that is a
 * deliberate choice — some suites need their own process and their own env
 * ordering. The cost of the choice is that adding a file is not the same as
 * running it, and nothing said so. Now something does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "..", "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".next", "build", "dist", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".test.ts")) out.push(path.relative(REPO, full));
  }
  return out;
}

/** Does any `test:*` script name this file — literally or through a glob? */
function referencedBy(patterns: string[], file: string): boolean {
  for (const pattern of patterns) {
    if (pattern === file) return true;
    if (!pattern.includes("*")) continue;
    // Shell globbing, reduced to what the scripts actually use: `*` inside one
    // path segment, `**` across segments.
    const rx = new RegExp(
      `^${pattern
        .split("/")
        .map((seg) =>
          seg === "**"
            ? "(?:.+)"
            : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
        )
        .join("/")
        .replace(/\(\?:\.\+\)\//g, "(?:.+/)?")}$`,
    );
    if (rx.test(file)) return true;
  }
  return false;
}

test("every test file is run by some npm script", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const patterns = Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith("test"))
    .flatMap(([, command]) => command.split(/\s+/))
    .filter((token) => token.endsWith(".ts"));

  const files = [
    ...walk(path.join(REPO, "src")),
    ...walk(path.join(REPO, "chart-host")),
  ];
  assert.ok(files.length > 100, "the walker found the test tree");

  const orphans = files.filter((file) => !referencedBy(patterns, file)).sort();
  assert.deepEqual(
    orphans,
    [],
    `these test files are never executed by any script — add them to one:\n${orphans.join("\n")}`,
  );
});

test("every script a test file is wired into is reachable from test:ci", () => {
  // A file listed in a script that `test:ci` never calls is orphaned twice
  // over, and harder to notice.
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const ci = pkg.scripts["test:ci"] ?? "";
  const called = new Set(
    [...ci.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]!),
  );
  const carriesFiles = Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith("test:") && name !== "test:ci")
    .filter(([, command]) => command.split(/\s+/).some((t) => t.endsWith(".test.ts")));

  const unreached = carriesFiles
    .map(([name]) => name)
    .filter((name) => !called.has(name))
    // `test:bridge` delegates to test:unit; the release validators and the
    // live-provider suite are deliberately manual.
    .filter((name) => !["test:bridge", "test:live"].includes(name))
    .sort();

  assert.deepEqual(
    unreached,
    [],
    `these scripts name test files but test:ci never calls them:\n${unreached.join("\n")}`,
  );
});
