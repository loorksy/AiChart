import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, it } from "node:test";

/**
 * The architectural guard for "one brain"
 * (docs/UNIFIED_AGENT_IMPLEMENTATION_PLAN.md §4-ب rules 3, 9 and §20 criteria
 * 1, 4, 6).
 *
 * The constitution says a recommendation may be created at exactly one point
 * and changed through exactly one function. That is easy to state and easy to
 * erode: the next component that wants to "just adjust the stop" writes its own
 * UPDATE, and the single decision point quietly becomes two. Nothing in a review
 * catches that reliably, so it is checked here.
 *
 * These allowlists are the record of what is permitted. Adding to one is a
 * deliberate architectural decision — if you are here because this test failed,
 * the question to answer is not "how do I make it pass" but "should this
 * component be deciding anything at all, or should it be producing evidence and
 * letting the brain decide".
 */

const SRC = join(process.cwd(), "src");

/** Modules allowed to call the canonical creator. Both are thin adapters. */
const CREATION_CALLERS = new Set([
  "lib/recommendations/canonical/repository.ts", // the creator itself
  "lib/recommendations/canonical/index.ts", // re-export
  "lib/store.ts", // legacy recommendation adapter
  "lib/recommendations/recommendationStore.ts", // tracked-recommendation adapter
]);

/**
 * Modules allowed to change an existing recommendation's plan.
 *
 * Deep research is on this list because it produces a verdict and hands it to
 * the revision mechanism — it does not write levels itself. Any new entry here
 * must be able to say the same.
 */
const REVISION_CALLERS = new Set([
  "lib/recommendations/canonical/revisions.ts", // the mechanism itself
  "lib/recommendations/canonical/index.ts", // re-export
  "lib/recommendations/canonical/repository.ts", // seeds revision 1 at creation
  "lib/agent/deepAnalysis/completion.ts", // verdict → revision
]);

/**
 * Modules allowed to write recommendation plan columns with raw SQL.
 *
 * Everything else must go through the revision mechanism, so the change lands in
 * the append-only history with a reason attached.
 */
const RAW_PLAN_WRITERS = new Set([
  "lib/recommendations/canonical/repository.ts",
  "lib/recommendations/canonical/revisions.ts",
  "lib/db/sqlite.ts", // schema
  "lib/db/pg.ts", // schema
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Paths are normalized to forward slashes because the allowlists above are
 * written that way. Without this the guard fails on Windows for every file at
 * once — a loud failure, but a useless one that says nothing about the code.
 */
const files = walk(SRC).map((path) => ({
  rel: path.slice(SRC.length + 1).split(sep).join("/"),
  text: readFileSync(path, "utf8"),
}));

function callersOf(symbol: string): string[] {
  return files
    .filter((file) => new RegExp(`\\b${symbol}\\s*\\(`).test(file.text))
    .map((file) => file.rel);
}

describe("single brain — one place decides, one path changes", () => {
  it("creates recommendations only through the canonical creator", () => {
    const unexpected = callersOf("createCanonicalRecommendation").filter(
      (rel) => !CREATION_CALLERS.has(rel),
    );
    assert.deepEqual(
      unexpected,
      [],
      `New callers of createCanonicalRecommendation: ${unexpected.join(", ")}. ` +
        "A recommendation is created at one point only — route this through an " +
        "existing adapter, or add it to CREATION_CALLERS deliberately.",
    );
  });

  it("changes a recommendation's plan only through applyRecommendationRevision", () => {
    const unexpected = callersOf("applyRecommendationRevision").filter(
      (rel) => !REVISION_CALLERS.has(rel),
    );
    assert.deepEqual(
      unexpected,
      [],
      `New callers of applyRecommendationRevision: ${unexpected.join(", ")}. ` +
        "Components detect and propose; the brain decides; this function applies. " +
        "Add to REVISION_CALLERS only when that ordering genuinely holds.",
    );
  });

  it("never writes a plan column with raw SQL outside the canonical modules", () => {
    // UPDATE ... SET on a plan-defining column is the exact shape of a component
    // quietly editing a decision it does not own.
    const pattern =
      /UPDATE\s+recommendations[\s\S]{0,400}?SET[\s\S]{0,200}?\b(entry|stop_loss|take_profit|targets_json|plan_type|direction|activation_condition|invalidation_rule)\b\s*=/i;
    const offenders = files
      .filter((file) => pattern.test(file.text))
      .map((file) => file.rel)
      .filter((rel) => !RAW_PLAN_WRITERS.has(rel));
    assert.deepEqual(
      offenders,
      [],
      `Raw plan writes outside the canonical modules: ${offenders.join(", ")}. ` +
        "Use applyRecommendationRevision so the change lands in the append-only history.",
    );
  });

  it("keeps the tracker out of the decision business", () => {
    // The tracker evaluates and reports. It may raise a re-evaluation trigger;
    // it may not decide, and it may not rewrite a plan.
    const tracker = files.find(
      (file) => file.rel === "lib/recommendations/recommendationTracker.ts",
    );
    assert.ok(tracker, "the tracker moved — update this guard");
    assert.ok(
      !/applyRecommendationRevision\s*\(/.test(tracker.text),
      "the tracker is revising recommendations directly; it must raise a trigger instead",
    );
    assert.ok(
      !/runFinalDecisionSynthesizer\s*\(/.test(tracker.text),
      "the tracker is calling the decision engine inline; a trigger belongs in the analysis path",
    );
  });

  it("lets no evidence producer decide a direction", () => {
    // An evidence module that returns a buy/sell of its own has become a second
    // brain. They may describe, score, and warn — never conclude.
    const evidenceModules = [
      "lib/marketMemory/caseQuery.ts",
      "lib/marketMemory/caseIndexer.ts",
      "lib/strategies/supportSummary.ts",
      "lib/chart/geometry/patternStage.ts",
      "lib/agent/evidenceDimensions.ts",
    ];
    for (const rel of evidenceModules) {
      const file = files.find((candidate) => candidate.rel === rel);
      assert.ok(file, `${rel} moved — update this guard`);
      assert.ok(
        !/\bdecision\s*[:=]\s*["'](buy|sell)["']/.test(file.text),
        `${rel} is emitting a decision; evidence modules must not conclude a direction`,
      );
    }
  });
});

describe("explainability is a validity condition", () => {
  it("requires a decision trace on every model decision", () => {
    const synth = files.find(
      (file) => file.rel === "lib/agent/agents/finalDecisionSynthesizer.ts",
    );
    assert.ok(synth);
    // Required, not optional: a decision that cannot explain itself is not a
    // decision the operator can act on or the learning loop can use.
    assert.ok(
      /decisionTrace:\s*DecisionTraceSchema\b/.test(synth.text),
      "decisionTrace must be a required field of the decision contract",
    );
    assert.ok(
      !/decisionTrace:\s*DecisionTraceSchema\.(optional|nullable)/.test(synth.text),
      "decisionTrace must not be optional",
    );
  });

  /**
   * The gap this guard originally missed.
   *
   * It checked that the decision contract REQUIRED a trace, and it did — while
   * the orchestrator built its result field by field and copied neither the
   * trace nor the evidence card onto it. Both were computed correctly and thrown
   * away, and every schema-shaped assertion passed. So the check has to be that
   * the value is carried, not merely produced.
   */
  it("carries the trace and the evidence card out to the caller", () => {
    const types = files.find((file) => file.rel === "lib/agent/types.ts");
    assert.ok(types);
    assert.ok(
      /decisionTrace\?:\s*DecisionTrace/.test(types.text),
      "AgentFinalResult must expose decisionTrace, or the trace cannot reach any surface",
    );
    assert.ok(
      /evidenceDimensions\?:/.test(types.text),
      "AgentFinalResult must expose evidenceDimensions, or the evidence card is unreachable",
    );

    const orchestrator = files.find((file) => file.rel === "lib/agent/orchestrator.ts");
    assert.ok(orchestrator);
    for (const field of ["decisionTrace", "evidenceDimensions"]) {
      assert.ok(
        new RegExp(`${field}:\\s*finalDecision\\.${field}`).test(orchestrator.text),
        `the orchestrator must copy ${field} from the decision onto its result`,
      );
    }
  });

  it("persists the plan layers rather than keeping them in memory", () => {
    const repository = files.find(
      (file) => file.rel === "lib/recommendations/canonical/repository.ts",
    );
    const revisions = files.find(
      (file) => file.rel === "lib/recommendations/canonical/revisions.ts",
    );
    assert.ok(repository && revisions);

    // Every recommendation needs an effective revision from birth: without one
    // nothing can revise it and the compare-and-swap on execution has no number
    // to compare. Seeding it is also what writes plan_type and execution_state,
    // since the pointer move owns those columns.
    assert.ok(
      /applyRecommendationRevision\s*\(/.test(repository.text),
      "creation must seed revision 1",
    );
    const canonical = `${repository.text}\n${revisions.text}`;
    for (const column of ["plan_type", "execution_state", "statistical_support"]) {
      assert.ok(
        canonical.includes(column),
        `${column} must be written by the canonical modules; an in-memory-only layer is invisible to the tracker`,
      );
    }
  });

  it("stores the evidence a revision was decided on", () => {
    const revisions = files.find(
      (file) => file.rel === "lib/recommendations/canonical/revisions.ts",
    );
    assert.ok(revisions);
    for (const column of ["evidence_hash", "evidence_json", "decision_trace_json"]) {
      assert.ok(
        revisions.text.includes(column),
        `a revision must carry ${column} so its decision stays explainable later`,
      );
    }
  });
});
