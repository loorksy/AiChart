/**
 * Guard against the doctrine eroding back into the codebase.
 *
 * The old behaviour did not live in one switch statement — it lived in prompt
 * lines, user-facing strings, and comments that quietly taught the next reader
 * that "no opinion" was a legitimate answer. Wording is the interface here, so
 * these phrases are checked the same way any other contract is.
 *
 * The doctrine narrowed rather than loosened when the G1–G7 gate chain landed.
 * What it always forbade was EVASION: an absent opinion dressed as analysis,
 * and an operational fault dressed as a market decision. Both are still
 * forbidden. What is now permitted is one specific, attributable thing — the
 * platform refusing to ISSUE a plan the model already decided, and saying which
 * check refused and what the operator is waiting for.
 *
 * So the line these tests hold is: **the model may not wait; the gates may
 * refuse.** The decision contract still offers only buy or sell, the external
 * write path still rejects `action: "wait"`, and the single place a visible
 * WAIT may be produced is the orchestrator's gate-refusal block.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const WEB_SRC = resolve(process.cwd(), "src");
// `agent/` was a sibling of the app back when the app lived in `web/`. It is
// now a sibling of `src/` inside the repository, so both shapes are tried —
// resolving only the old one made this guard scan a directory that is not
// there and fail on ENOENT instead of on a doctrine violation.
const AGENT_WORKSPACE =
  [resolve(process.cwd(), "agent"), resolve(process.cwd(), "..", "agent")].find(
    existsSync,
  ) ?? resolve(process.cwd(), "agent");

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

describe("the write path cannot record a WAIT", () => {
  /**
   * The gap this guard was added for.
   *
   * The doctrine held inside the platform's own decision engine — its Zod
   * contract has no `wait` — while `POST /api/agent/recommendation`, the one
   * externally reachable write path, still accepted `action: "wait"` and stored
   * it. That preserved the exact asymmetry the whole doctrine removes: the
   * platform engine could not express a wait and an MCP-hosted model still
   * could. Reading legacy `wait` rows stays untouched; writing a new one does
   * not.
   */
  it("refuses a new wait recommendation at the API boundary", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/agent/recommendation/route.ts"),
      "utf8",
    );
    // An early `return` for wait means it is validated as acceptable and stored.
    assert.ok(
      !/if\s*\(\s*body\.action\s*===\s*"wait"\s*\)\s*return\s*;/.test(route),
      "the write route silently accepts a wait recommendation",
    );
    assert.ok(
      /WAIT is not an analytical outcome/.test(route),
      "the write route must refuse a wait and say what to return instead",
    );
  });

  it("keeps the decision engine's own contract free of wait", () => {
    const synth = readFileSync(
      resolve(process.cwd(), "src/lib/agent/agents/finalDecisionSynthesizer.ts"),
      "utf8",
    );
    assert.ok(
      /direction:\s*z\.enum\(\["buy",\s*"sell"\]\)/.test(synth),
      "the decision contract must offer only buy or sell",
    );
  });
});

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
    // The model's own outcome is still a side, never a wait.
    assert.match(system, /it is BUY or SELL; you may not answer WAIT/);
    assert.match(system, /immediate, anticipatory, or conditional/);
    assert.match(system, /operational blocker/);
    // Direction is mandatory, an entry at the current price is not.
    assert.match(system, /A direction is always required; an immediate entry is not/);
    // The refusal that IS permitted must be attributable and actionable.
    assert.match(system, /which check refused/);
    assert.match(system, /never the model's/);
  });

  it("the constitution names the platform as recommendations-only", () => {
    const system = readFileSync(join(AGENT_WORKSPACE, "workspace", "SYSTEM.md"), "utf8");
    assert.match(system, /never places, modifies, or closes a trade/);
    assert.match(system, /gold \(XAUUSD\) only/i);
    // The data source is internal provenance: the constitution must state the
    // platform-feed framing and must NOT name the vendor anywhere.
    assert.match(system, /platform's own market feed/);
    assert.match(system, /never name it to users/i);
    assert.doesNotMatch(system, /OANDA/i);
  });

  /**
   * The one place a visible WAIT may be born.
   *
   * A wait produced anywhere else is the old failure wearing a new name: an
   * unattributed refusal the operator cannot act on. Tying it to the gate block
   * means every wait the platform emits carries a gate id and a reason.
   */
  it("only the gate chain can turn a decision into a WAIT", () => {
    const files = walk(WEB_SRC).filter((file) => !/__tests__/.test(file));
    const offenders = files.filter(
      (file) =>
        /\bdecision\s*=\s*"wait"/.test(readFileSync(file, "utf8")) &&
        !file.endsWith("orchestrator.ts"),
    );
    assert.deepEqual(
      offenders.map((file) => file.replace(process.cwd(), ".")),
      [],
      "a WAIT produced outside the gate chain is a refusal with no gate to name",
    );

    const orchestrator = readFileSync(join(WEB_SRC, "lib/agent/orchestrator.ts"), "utf8");
    const guard = orchestrator.indexOf("if (!gateChain.allowed)");
    const assignment = orchestrator.indexOf('finalDecision.decision = "wait"');
    assert.ok(guard > 0, "the gate refusal branch must exist");
    assert.ok(
      assignment > guard,
      "the WAIT assignment must sit inside the gate-refusal branch, not before it",
    );
  });
});
