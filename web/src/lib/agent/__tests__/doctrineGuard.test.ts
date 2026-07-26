/**
 * Guard against the doctrine eroding back into the codebase.
 *
 * The old behaviour did not live in one switch statement — it lived in prompt
 * lines, user-facing strings, and comments that quietly taught the next reader
 * that "no opinion" was a legitimate answer. Wording is the interface here, so
 * these phrases are checked the same way any other contract is.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const WEB_SRC = resolve(process.cwd(), "src");
const AGENT_WORKSPACE = resolve(process.cwd(), "..", "agent");

/** Phrases that reintroduce WAIT as an analytical outcome or a fallback. */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /defaulting to WAIT/i,
    why: "a stage fault is an operational blocker, never a decision to wait",
  },
  {
    pattern: /القرار انتظار احترازي/,
    why: "a technical failure must not be presented to the operator as a market decision",
  },
  {
    pattern: /BUY,? SELL,? or WAIT/i,
    why: "the analytical outcome is buy or sell; WAIT is not one of the options",
  },
  {
    pattern: /BUY\/SELL\/WAIT/i,
    why: "the analytical outcome is buy or sell; WAIT is not one of the options",
  },
  {
    pattern: /mid-range[^.\n]{0,40}=\s*WAIT/i,
    why: "mid-range is a poor immediate entry, not an absent opportunity",
  },
  {
    pattern: /number of matching confluences|count(?:ing)? confluences to/i,
    why: "confidence is never derived from how many factors line up",
  },
];

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|md)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("doctrine guard", () => {
  it("no source or prompt file reintroduces WAIT as an outcome", () => {
    const files = [...walk(WEB_SRC), ...walk(AGENT_WORKSPACE)].filter(
      // This file quotes the phrases in order to ban them.
      (file) => !file.endsWith("doctrineGuard.test.ts"),
    );
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        const match = pattern.exec(text);
        if (match) {
          const line = text.slice(0, match.index).split("\n").length;
          violations.push(
            `${file.replace(process.cwd(), ".")}:${line} — "${match[0]}" (${why})`,
          );
        }
      }
    }
    assert.deepEqual(violations, [], `\n${violations.join("\n")}\n`);
  });

  it("the constitution still states the three layers", () => {
    const system = readFileSync(join(AGENT_WORKSPACE, "workspace", "SYSTEM.md"), "utf8");
    assert.match(system, /WAIT is not an analytical outcome/);
    assert.match(system, /immediate, anticipatory, or conditional/);
    assert.match(system, /operational blocker/);
    // Direction is mandatory, an entry at the current price is not.
    assert.match(system, /A direction is always required; an immediate entry is not/);
  });
});
