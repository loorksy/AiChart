import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAsyncContext,
  buildDisagreementReport,
  collectReviewerOpinions,
  MIN_REVIEWERS,
  type ReviewerOpinion,
} from "@/lib/agent/deepAnalysis/adversarialReview";

const advocate: ReviewerOpinion = {
  role: "advocate",
  stance: "supports",
  points: ["الاتجاه صاعد على الفريم الأعلى", "الحجم يدعم الاختراق"],
};
const challenger: ReviewerOpinion = {
  role: "challenger",
  stance: "opposes",
  points: ["السعر ملاصق لمقاومة أسبوعية", "الحجم يدعم الاختراق"],
};
const risk: ReviewerOpinion = {
  role: "risk",
  stance: "conditional",
  points: ["نسبة العائد للمخاطرة أقل من المعتاد"],
};

const deep = { context: "deep_research" as const, thesis: "شراء الذهب" };

describe("adversarial review runs ONLY in async deep research (item 12)", () => {
  it("throws loudly if invoked from the direct request path", () => {
    assert.throws(
      () => assertAsyncContext("direct_request"),
      /asynchronous deep research only/,
      "a debate in the live path would add tens of seconds to a trading answer",
    );
    assert.doesNotThrow(() => assertAsyncContext("deep_research"));
  });

  it("refuses to build a report from the direct path", () => {
    assert.throws(() =>
      buildDisagreementReport({
        thesis: "x",
        opinions: [advocate],
        context: "direct_request",
      }),
    );
  });
});

describe("the report is evidence, never authority", () => {
  it("never grants execution authority", () => {
    const report = buildDisagreementReport({ ...deep, opinions: [advocate, challenger, risk] });
    assert.equal(report.grantsExecutionAuthority, false);
    // The type is literal `false`, so no caller can ever set it true.
    assert.equal(typeof report.grantsExecutionAuthority, "boolean");
  });

  it("carries no decision field at all", () => {
    const report = buildDisagreementReport({ ...deep, opinions: [advocate, challenger] });
    assert.equal("decision" in report, false, "a debate must not emit a verdict");
    assert.equal("recommendation" in report, false);
  });
});

describe("disagreement detection", () => {
  it("reports the points the panel genuinely conflicts on", () => {
    const report = buildDisagreementReport({ ...deep, opinions: [advocate, challenger, risk] });
    assert.ok(
      report.conflicts.some((c) => c.includes("مقاومة أسبوعية")),
      "the challenger's unique objection is the useful output",
    );
    assert.ok(
      !report.conflicts.some((c) => c.includes("الحجم يدعم الاختراق")),
      "a point BOTH sides raise is agreement, not conflict",
    );
  });

  it("surfaces points raised independently by more than one reviewer", () => {
    const report = buildDisagreementReport({ ...deep, opinions: [advocate, challenger] });
    assert.ok(report.agreements.some((a) => a.includes("الحجم يدعم الاختراق")));
  });

  it("scores a split panel higher than a unanimous one", () => {
    const split = buildDisagreementReport({ ...deep, opinions: [advocate, challenger] });
    const unanimous = buildDisagreementReport({
      ...deep,
      opinions: [advocate, { ...challenger, stance: "supports" }],
    });
    assert.ok(split.disagreementScore > unanimous.disagreementScore);
    assert.equal(unanimous.disagreementScore, 0);
  });
});

describe("one failed reviewer does not void the report", () => {
  it("records the gap and still produces a usable report", () => {
    const report = buildDisagreementReport({
      ...deep,
      opinions: [advocate, challenger, { role: "risk", stance: "unavailable", points: [], failureReason: "timeout" }],
    });
    assert.deepEqual(report.missingRoles, ["risk"]);
    assert.equal(report.insufficient, false, "two reviewers still make a report");
    assert.match(report.summary, /غياب/, "the gap must be stated, not hidden");
  });

  it("marks a report insufficient when too few reviewers ran", () => {
    const report = buildDisagreementReport({ ...deep, opinions: [advocate] });
    assert.equal(report.insufficient, true);
    assert.ok(MIN_REVIEWERS >= 2);
    assert.match(report.summary, /لا تُبنى عليها نتيجة/);
  });

  it("collects opinions defensively — a thrown reviewer becomes unavailable", async () => {
    const opinions = await collectReviewerOpinions([
      { role: "advocate", run: async () => advocate },
      { role: "challenger", run: async () => { throw new Error("provider 503"); } },
      { role: "risk", run: async () => risk },
    ]);
    assert.equal(opinions.length, 3);
    const failed = opinions.find((o) => o.role === "challenger")!;
    assert.equal(failed.stance, "unavailable");
    assert.match(failed.failureReason ?? "", /provider 503/);
    // …and the surviving reviewers still form a report.
    const report = buildDisagreementReport({ ...deep, opinions });
    assert.equal(report.insufficient, false);
  });
});
