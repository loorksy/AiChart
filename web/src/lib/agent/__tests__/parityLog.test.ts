import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-parity-"));
process.env.DB_PATH = join(dir, "parity.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "parity-test-secret";
delete process.env.DATABASE_URL;

/**
 * Platform-vs-MCP parity, against a real database.
 *
 * Completion criterion 2 is that UNEXPLAINED differences are zero — not that the
 * surfaces never differ. They will differ constantly for legitimate reasons, and
 * a log that cannot tell those apart from real divergence is worse than none: it
 * would either cry wolf on every read-time gap or hide the one difference that
 * means the surfaces are running different decision paths.
 */

let parity: typeof import("@/lib/agent/parityLog");

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  parity = await import("@/lib/agent/parityLog");
});

function decision(
  over: Partial<import("@/lib/agent/parityLog").ParityDecision> = {},
): import("@/lib/agent/parityLog").ParityDecision {
  return {
    direction: "buy",
    planType: "conditional",
    entryLow: 3998,
    entryHigh: 4002,
    stopLoss: 3980,
    targets: [4040],
    executionState: "awaiting_activation",
    imagesFor: ["15m", "1h"],
    providers: ["geometry", "structure"],
    ...over,
  };
}

function observation(
  surface: "platform" | "mcp",
  over: Partial<import("@/lib/agent/parityLog").ParityObservation> = {},
): import("@/lib/agent/parityLog").ParityObservation {
  return {
    evidenceHash: "hash-a",
    symbol: "XAUUSD",
    timeframeSet: ["15m", "1h"],
    marketTimestamp: 1_700_000_000_000,
    surface,
    decision: decision(),
    ...over,
  };
}

describe("comparability comes before comparison", () => {
  /**
   * The rule the plan calls out explicitly. Two decisions made on different
   * evidence are not comparable: "identical" would be coincidence and "divergent"
   * would be a misattribution. So it is neither, and it never counts as
   * unexplained.
   */
  it("refuses to call two decisions identical when the evidence hash differs", () => {
    const result = parity.compareDecisions({
      platform: observation("platform", { evidenceHash: "hash-a" }),
      // Byte-identical decision, different inputs.
      mcp: observation("mcp", { evidenceHash: "hash-b" }),
    });
    assert.equal(result.identical, false, "same output on different inputs is not parity");
    assert.equal(result.classification, "different_evidence_hash");
    assert.equal(result.explained, true, "not comparable is not a finding");
  });

  it("calls them identical only on the same evidence", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp"),
    });
    assert.equal(result.identical, true);
    assert.equal(result.classification, null);
  });
});

describe("classifying a real difference", () => {
  it("explains a difference by the read-time gap", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp", {
        marketTimestamp: 1_700_000_000_000 + 5 * 60_000,
        decision: decision({ entryLow: 3990, entryHigh: 3994 }),
      }),
    });
    assert.equal(result.classification, "different_market_timestamp");
    assert.equal(result.explained, true);
  });

  it("explains a difference by a chart one surface could not capture", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp", {
        decision: decision({ imagesFor: ["15m"], stopLoss: 3975 }),
      }),
    });
    assert.equal(result.classification, "missing_image");
    assert.equal(result.explained, true);
  });

  it("explains a difference by a provider configured on one side only", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp", {
        decision: decision({ providers: ["geometry"], stopLoss: 3975 }),
      }),
    });
    assert.equal(result.classification, "missing_provider");
    assert.equal(result.explained, true);
  });

  it("treats one drifting number as model nondeterminism", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp", { decision: decision({ stopLoss: 3979 }) }),
    });
    assert.equal(result.classification, "model_nondeterminism");
    assert.equal(result.explained, true);
  });

  it("reports a contract mismatch when one surface could not decide at all", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp", {
        decision: decision({ blocked: true, direction: null, targets: [] }),
      }),
    });
    // The surfaces should agree on whether a decision was POSSIBLE on this
    // evidence. Disagreeing about that is a defect, not an opinion.
    assert.equal(result.classification, "contract_mismatch");
    assert.equal(result.explained, false);
  });

  it("reports UNEXPLAINED when the direction differs on identical evidence", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp", {
        decision: decision({ direction: "sell", stopLoss: 4020, targets: [3960] }),
      }),
    });
    // Same evidence, same moment, same providers, opposite side. This is the one
    // finding the log exists to surface.
    assert.equal(result.classification, "unexplained");
    assert.equal(result.explained, false);
    assert.ok(result.differingFields.includes("direction"));
  });

  it("does not excuse a direction flip as nondeterminism", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      // ONLY the direction differs — a single field, but the one that matters.
      mcp: observation("mcp", { decision: decision({ direction: "sell" }) }),
    });
    assert.notEqual(result.classification, "model_nondeterminism");
    assert.equal(result.classification, "unexplained");
  });

  it("ignores float artefacts", () => {
    const result = parity.compareDecisions({
      platform: observation("platform"),
      mcp: observation("mcp", { decision: decision({ stopLoss: 3980.0000001 }) }),
    });
    assert.equal(result.identical, true);
  });
});

describe("the report", () => {
  it("compares only paired moments and counts the rest as unpaired", async () => {
    await parity.recordDecisionForParity(
      observation("platform", { evidenceHash: "paired-1" }),
    );
    await parity.recordDecisionForParity(observation("mcp", { evidenceHash: "paired-1" }));
    // Only one surface saw this one.
    await parity.recordDecisionForParity(
      observation("platform", { evidenceHash: "lonely-1" }),
    );

    const report = await parity.buildParityReport();
    assert.ok(report.totals.compared >= 1);
    assert.ok(report.unpaired >= 1, "a moment one surface never saw is not agreement");
    assert.equal(report.totals.unexplained, 0);
  });

  it("surfaces an unexplained divergence in the totals", async () => {
    await parity.recordDecisionForParity(
      observation("platform", { evidenceHash: "diverge-1" }),
    );
    await parity.recordDecisionForParity(
      observation("mcp", {
        evidenceHash: "diverge-1",
        decision: decision({ direction: "sell", stopLoss: 4020, targets: [3960] }),
      }),
    );
    const report = await parity.buildParityReport();
    assert.ok(report.totals.unexplained >= 1);
    assert.ok((report.totals.byClassification.unexplained ?? 0) >= 1);
    const entry = report.entries.find((e) => e.evidenceHash === "diverge-1");
    assert.ok(entry, "the diverging moment must appear in the report");
    assert.equal(entry.comparison.classification, "unexplained");
    // Both decisions are kept, so the difference is inspectable rather than
    // reduced to a count.
    assert.equal(entry.platform.direction, "buy");
    assert.equal(entry.mcp.direction, "sell");
  });

  it("re-recording a surface updates rather than duplicating", async () => {
    await parity.recordDecisionForParity(
      observation("platform", { evidenceHash: "upsert-1" }),
    );
    await parity.recordDecisionForParity(
      observation("platform", {
        evidenceHash: "upsert-1",
        decision: decision({ stopLoss: 3970 }),
      }),
    );
    const db = await import("@/lib/db");
    const rows = await db.query<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM decision_parity WHERE evidence_hash = ?",
      ["upsert-1"],
    );
    assert.equal(Number(rows[0]!.count), 1);
  });
});

describe("both surfaces are labelled at their entry points", () => {
  /**
   * Both surfaces run the SAME engine: the MCP tool proxies to the bridge route,
   * which calls `runUnifiedChartAgent`. So the surface is a property of the entry
   * point, and labelling it is what lets the log DEMONSTRATE one engine rather
   * than assume it.
   *
   * A consequence worth stating: one run writes one row, so two rows sharing an
   * evidence hash only occur when the same bundle is decided twice. In production
   * that is rare and correctly classified as not-comparable; the reference fixture
   * harness is what deliberately produces comparable pairs.
   */
  it("records the platform decision from the orchestrator", () => {
    const orchestrator = readFileSync(
      resolve(process.cwd(), "src/lib/agent/orchestrator.ts"),
      "utf8",
    );
    assert.ok(
      /recordDecisionForParity\(/.test(orchestrator),
      "the decision path must record a parity observation",
    );
    assert.ok(
      /surface: input\.surface \?\? "platform"/.test(orchestrator),
      "the surface must come from the caller, defaulting to platform",
    );
    // Recorded from the frozen bundle, not re-derived afterwards — otherwise two
    // surfaces could never produce a matching hash.
    assert.ok(
      /evidenceHash: evidenceFingerprint\(parityBundle\)/.test(orchestrator),
      "the hash must be the fingerprint of the bundle the brain read",
    );
  });

  it("labels the bridge route as the MCP surface", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/agent/market/analyze/route.ts"),
      "utf8",
    );
    assert.ok(
      /surface: "mcp"/.test(route),
      "the route the MCP tool proxies to must identify itself as the MCP surface",
    );
  });
});
