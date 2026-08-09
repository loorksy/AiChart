import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, it } from "node:test";

/**
 * The provider a price came from is an implementation detail, and the product
 * promise is that a user never encounters one other than their own broker's.
 *
 * That promise is easy to state and easy to erode, in two different ways, and
 * a code review reliably catches neither:
 *
 *   1. A vendor name reaches a user-facing surface — a label, a warning, an
 *      error message relayed into an API body.
 *   2. A vendor or book identifier reaches the LLM. This one is worse, because
 *      no string search of the UI will find it: the model reads
 *      `ohlcSource: "reference_feed"` in its context and paraphrases it into
 *      prose in its own words. Nothing downstream can un-say that.
 *
 * So the check is structural, like `analysisIsolation.test.ts`: the analysis
 * engine's own modules must not contain a provider identity at all, and the
 * prompt builder must carry the instruction that forbids the model from
 * inventing one.
 *
 * If you are here because this failed: the question is not "how do I make it
 * pass" but "why does a provider name exist on a path a user or a model can
 * read". Server-side logging is fine. Anything the user or the model sees is
 * not.
 */

const SRC = join(process.cwd(), "src");

/**
 * Modules that build, run, or render an analysis. Everything a user reads
 * about an analysis, and everything the model is told, comes from these.
 */
const ANALYSIS_SURFACE = [
  "lib/quantAgent/analysis/collect.ts",
  "lib/quantAgent/analysis/prompt.ts",
  "lib/quantAgent/analysis/runAnalysis.ts",
  "lib/quantAgent/analysisStore.ts",
  "app/quant-agent/analysis/page.tsx",
  "app/quant-agent/analysis/history/page.tsx",
  "components/quantAgent/analysis/AccuracyStrip.tsx",
  "components/quantAgent/analysis/QuantAnalysisCard.tsx",
  "components/quantAgent/analysis/QuantAnalysisReport.tsx",
  "components/quantAgent/analysis/QuantAnalysisHistoryList.tsx",
];

/**
 * Vendor and book identifiers. `reference_feed` is deliberately on this list
 * even though it names no vendor: a reader who sees "reference feed" next to
 * their broker's name has still learned there is a second source, which is the
 * thing the promise is about.
 */
const PROVIDER_TOKENS = [/\boanda\b/i, /reference_feed/i, /\bmetaapi\b/i];

function read(rel: string): string {
  const path = join(SRC, rel.split("/").join(sep));
  return readFileSync(path, "utf8");
}

/** Comments explain the boundary; only executable text can leak through it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the analysis surface names no data provider", () => {
  for (const rel of ANALYSIS_SURFACE) {
    it(`${rel} carries no provider identity in executable code`, () => {
      const code = stripComments(read(rel));
      for (const token of PROVIDER_TOKENS) {
        assert.ok(
          !token.test(code),
          `${rel} mentions ${token} outside a comment. A provider identity on ` +
            "this path reaches either the reader or the model.",
        );
      }
    });
  }
});

describe("the model is told not to name a source it was never given", () => {
  // Comments here explain WHY the old label was wrong, and quote it.
  const prompt = stripComments(read("lib/quantAgent/analysis/prompt.ts"));

  it("forbids naming or alluding to a provider", () => {
    assert.ok(
      /Never name, guess at, or allude to which data provider/.test(prompt),
      "the system prompt must forbid the model from naming a feed — it will " +
        "otherwise fill the gap with a guess, and a guess is still a claim",
    );
  });

  it("does not present closed bars as a live quote", () => {
    assert.ok(
      !/REAL-TIME DATA/.test(prompt),
      'the market block must not be labelled "REAL-TIME DATA": it is the last ' +
        "closed bar, and on a 1h frame that can be an hour old",
    );
    assert.ok(
      /LAST CLOSED BAR, not a live quote/.test(prompt),
      "the model must be told the prices are a closed bar, or it will narrate " +
        'them as where price "is now" to a reader holding a live chart',
    );
  });
});

describe("an analysis records when it was priced", () => {
  it("collect reports the primary frame's as-of time", () => {
    assert.ok(
      /primaryAsOfMs/.test(read("lib/quantAgent/analysis/collect.ts")),
      "without an as-of time a price implies 'now' and any gap reads as an error",
    );
  });

  it("runAnalysis carries the as-of time and the feed's staleness onto the row", () => {
    const run = read("lib/quantAgent/analysis/runAnalysis.ts");
    assert.ok(/asOfMs:\s*collection\.primaryAsOfMs/.test(run), "as-of time must reach the row");
    assert.ok(
      /collection\.warnings\.length > 0/.test(run),
      "the feed's staleness warning must affect the row — it was computed and " +
        "dropped once, and a three-day-old series reported as fully healthy",
    );
  });
});

/**
 * A file added to the analysis surface later gets no protection unless it is
 * listed above, and nobody remembers to come back here. So the list has to
 * defend its own completeness.
 */
describe("the protected list stays complete", () => {
  it("covers every module under components/quantAgent/analysis", () => {
    const dir = join(SRC, "components", "quantAgent", "analysis");
    const present = readdirSync(dir)
      .filter((entry) => {
        if (entry === "__tests__") return false;
        return statSync(join(dir, entry)).isFile() && entry.endsWith(".tsx");
      })
      .map((entry) => `components/quantAgent/analysis/${entry}`);
    const unguarded = present.filter((rel) => !ANALYSIS_SURFACE.includes(rel));
    // ConfidenceGauge renders a number and no text, so it is exempt by shape
    // rather than by oversight — name it here so the exemption is deliberate.
    const exempt = ["components/quantAgent/analysis/ConfidenceGauge.tsx"];
    assert.deepEqual(
      unguarded.filter((rel) => !exempt.includes(rel)),
      [],
      "new analysis components must be added to ANALYSIS_SURFACE",
    );
  });
});
