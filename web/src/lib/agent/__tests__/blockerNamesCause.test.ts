import assert from "node:assert/strict";
import test from "node:test";

import { userMessageForFailure } from "@/lib/agent/errorTaxonomy";
import { unfinishedStages } from "@/lib/agent/stageEvents";

/**
 * The doctrine asks a blocked run to name the operational blocker AND its
 * cause. What operators actually got was "استغرقت العملية وقتاً أطول من
 * المسموح" plus a request id — which names neither, and left even the person
 * debugging it guessing at which stage stalled.
 *
 * The run already emits a stage event per step, so the cause was known all
 * along; it just never reached the sentence.
 */

test("a timeout names the stages that stalled, in the operator's language", () => {
  const ar = userMessageForFailure("timeout", "ar", {
    stages: ["market_data", "final_decision"],
  });
  assert.match(ar, /بيانات السوق/);
  assert.match(ar, /لم يكتمل التحليل/);
  // The old generic sentence must not be what a diagnosable failure says.
  assert.doesNotMatch(ar, /استغرقت العملية وقتاً أطول من المسموح/);

  const en = userMessageForFailure("timeout", "en", { stages: ["market_data"] });
  assert.match(en, /did not complete/);
});

test("stage ids are translated, never printed raw", () => {
  const ar = userMessageForFailure("timeout", "ar", { stages: ["market_data"] });
  assert.doesNotMatch(ar, /market_data/);
});

test("with no stage information it falls back to the generic sentence", () => {
  const withoutCause = userMessageForFailure("timeout", "ar");
  const emptyCause = userMessageForFailure("timeout", "ar", { stages: [] });
  assert.match(withoutCause, /استغرقت العملية وقتاً أطول من المسموح/);
  assert.equal(emptyCause, withoutCause);
});

test("codes that are already specific are left alone", () => {
  // market_closed already states its own cause; naming stages would only add
  // noise to a message that is not about a stalled pipeline.
  const closed = userMessageForFailure("market_closed", "ar", {
    stages: ["market_data"],
  });
  assert.match(closed, /سوق هذا الزوج مغلق/);
});

test("insufficient_data with stages is not phrased as a timeout", () => {
  // Coverage/gap blockers used to reuse the timeout sentence, so thin
  // warehouse looked identical to a MetaApi deadline miss.
  const ar = userMessageForFailure("insufficient_data", "ar", {
    stages: ["market_data"],
  });
  assert.match(ar, /بيانات السوق/);
  assert.match(ar, /غير كافية/);
  assert.doesNotMatch(ar, /ضمن المهلة المسموحة/);

  const en = userMessageForFailure("insufficient_data", "en", {
    stages: ["market_data"],
  });
  assert.match(en, /enough historical coverage/i);
  assert.doesNotMatch(en, /within the allowed time/i);
});

test("unfinished stages are the failed ones and the ones still running", () => {
  const stages = unfinishedStages([
    { stage: "market_data", status: "done", timestamp: 1 },
    { stage: "structure", status: "running", timestamp: 2 },
    { stage: "final_decision", status: "failed", timestamp: 3 },
  ]);
  assert.deepEqual(stages, ["structure", "final_decision"]);
});

test("a run where everything finished reports no cause", () => {
  const stages = unfinishedStages([
    { stage: "market_data", status: "done", timestamp: 1 },
    { stage: "final_decision", status: "done", timestamp: 2 },
  ]);
  assert.deepEqual(stages, []);
});

test("a stage that recovered is not reported as a cause", () => {
  // running → done must not leave the stage looking stalled.
  const stages = unfinishedStages([
    { stage: "news", status: "running", timestamp: 1 },
    { stage: "news", status: "done", timestamp: 2 },
  ]);
  assert.deepEqual(stages, []);
});
