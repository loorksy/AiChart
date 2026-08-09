import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePendingTask,
  coerceQuantAgentPendingTask,
  isQuantAgentCancelMessage,
  startPendingTask,
  type QuantAgentPendingTask,
} from "@/lib/agent/quantAgentChat/pendingTask";

test("isQuantAgentCancelMessage: exact, trimmed, case-insensitive match only — never a substring match", () => {
  assert.equal(isQuantAgentCancelMessage("cancel"), true);
  assert.equal(isQuantAgentCancelMessage("Cancel"), true);
  assert.equal(isQuantAgentCancelMessage("  CANCEL  "), true);
  assert.equal(isQuantAgentCancelMessage("إلغاء"), true);
  assert.equal(isQuantAgentCancelMessage("  إلغاء  "), true);
  assert.equal(isQuantAgentCancelMessage("الغاء"), true);
  assert.equal(
    isQuantAgentCancelMessage("please cancel my order at breakeven"),
    false,
    "a substring occurrence must not trigger cancellation",
  );
  assert.equal(isQuantAgentCancelMessage("generate"), false);
});

test("startPendingTask: fresh wizard begins at step 1 with 3 direction suggestions, not ready", () => {
  const { task, reply, composerCoach } = startPendingTask("en");
  assert.equal(task.step, 1);
  assert.deepEqual(task.collected, {});
  assert.ok(reply.length > 0);
  assert.equal(composerCoach.ready, false);
  assert.equal(composerCoach.suggestions.length, 3);
});

test("advancePendingTask: step 1 -> 2 classifies direction bias from free text (English + Arabic)", () => {
  const step1: QuantAgentPendingTask = { type: "generate_strategy_guided", step: 1, collected: {} };

  const buy = advancePendingTask(step1, "Buy only", "en");
  assert.equal(buy.task?.step, 2);
  assert.equal(buy.task?.collected.directionBias, "buy");
  assert.equal(buy.readyToGenerate, false);
  assert.equal(buy.composerCoach?.suggestions.length, 4);

  const sell = advancePendingTask(step1, "بيع فقط", "ar");
  assert.equal(sell.task?.collected.directionBias, "sell");

  const either = advancePendingTask(step1, "doesn't matter, either way", "en");
  assert.equal(either.task?.collected.directionBias, "either");
});

test("advancePendingTask: step 2 -> 3 classifies regime affinity", () => {
  const step2: QuantAgentPendingTask = {
    type: "generate_strategy_guided",
    step: 2,
    collected: { directionBias: "buy" },
  };
  const trending = advancePendingTask(step2, "Trending", "en");
  assert.equal(trending.task?.step, 3);
  assert.equal(trending.task?.collected.regimeAffinity, "trend");
  assert.equal(trending.composerCoach?.suggestions.length, 0, "step 3 has no clickable chips");

  const ranging = advancePendingTask(step2, "sideways / ranging", "en");
  assert.equal(ranging.task?.collected.regimeAffinity, "range");

  const volatile = advancePendingTask(step2, "متقلب جدًا", "ar");
  assert.equal(volatile.task?.collected.regimeAffinity, "volatile");

  const anyRegime = advancePendingTask(step2, "no preference", "en");
  assert.equal(anyRegime.task?.collected.regimeAffinity, "any");
});

test("advancePendingTask: step 3 -> 4 stores the free-text entry/exit description verbatim (trimmed)", () => {
  const step3: QuantAgentPendingTask = {
    type: "generate_strategy_guided",
    step: 3,
    collected: { directionBias: "buy", regimeAffinity: "trend" },
  };
  const result = advancePendingTask(step3, "  Enter on a golden cross.  ", "en");
  assert.equal(result.task?.step, 4);
  assert.equal(result.task?.collected.entryExitDescription, "Enter on a golden cross.");
  assert.equal(result.composerCoach?.ready, true);
  assert.equal(result.readyToGenerate, false);
});

test("advancePendingTask: step 3 re-asks (does not advance) on an empty/whitespace-only answer", () => {
  const step3: QuantAgentPendingTask = { type: "generate_strategy_guided", step: 3, collected: {} };
  const result = advancePendingTask(step3, "   ", "en");
  assert.equal(result.task?.step, 3, "still parked at step 3");
  assert.equal(result.task?.collected.entryExitDescription, undefined);
});

test("advancePendingTask: step 4 confirm ('generate' / 'يولّد') synthesizes one description and ends the task", () => {
  const step4: QuantAgentPendingTask = {
    type: "generate_strategy_guided",
    step: 4,
    collected: { directionBias: "sell", regimeAffinity: "range", entryExitDescription: "Fade the range extremes." },
  };
  const result = advancePendingTask(step4, "generate", "en");
  assert.equal(result.task, null, "the wizard ends once confirmed");
  assert.equal(result.readyToGenerate, true);
  assert.equal(
    result.syntheticDescription,
    "A sell-only strategy suited for ranging markets. Entry/exit logic: Fade the range extremes.",
  );

  const arabicConfirm = advancePendingTask(step4, "يولّد", "ar");
  assert.equal(arabicConfirm.readyToGenerate, true);
});

test("advancePendingTask: step 4 re-prompts (never advances by free-text field edits) on anything other than confirm", () => {
  const step4: QuantAgentPendingTask = {
    type: "generate_strategy_guided",
    step: 4,
    collected: { directionBias: "buy", regimeAffinity: "any", entryExitDescription: "x" },
  };
  const result = advancePendingTask(step4, "actually change the direction to sell", "en");
  assert.equal(result.task?.step, 4, "field editing by free text is out of scope — stays parked at step 4");
  assert.equal(result.readyToGenerate, false);
  assert.equal(result.task?.collected.directionBias, "buy", "the originally collected field is untouched");
});

test("coerceQuantAgentPendingTask: defensively parses (or rejects) an unknown stored value", () => {
  assert.equal(coerceQuantAgentPendingTask(null), null);
  assert.equal(coerceQuantAgentPendingTask(undefined), null);
  assert.equal(coerceQuantAgentPendingTask("not an object"), null);
  assert.equal(coerceQuantAgentPendingTask({ type: "something_else", step: 1 }), null);
  assert.equal(coerceQuantAgentPendingTask({ type: "generate_strategy_guided", step: 9 }), null);

  const parsed = coerceQuantAgentPendingTask({
    type: "generate_strategy_guided",
    step: 3,
    collected: { directionBias: "buy", regimeAffinity: "trend", entryExitDescription: "x", extraJunk: "ignored" },
  });
  assert.deepEqual(parsed, {
    type: "generate_strategy_guided",
    step: 3,
    collected: { directionBias: "buy", regimeAffinity: "trend", entryExitDescription: "x" },
  });

  // Garbage enum values inside `collected` are dropped, not trusted.
  const withGarbage = coerceQuantAgentPendingTask({
    type: "generate_strategy_guided",
    step: 1,
    collected: { directionBias: "north", regimeAffinity: "sideways-ish" },
  });
  assert.deepEqual(withGarbage?.collected, {
    directionBias: undefined,
    regimeAffinity: undefined,
    entryExitDescription: undefined,
  });
});
