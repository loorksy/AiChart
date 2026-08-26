import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginLiveRun,
  endLiveRun,
  getLiveRun,
  subscribeLiveRun,
  updateLiveRun,
} from "@/lib/agent/liveRunStore";
import type { AgentFinalResult } from "@/lib/agent/types";

const FINAL = {
  result: { summary: "ok" } as unknown as AgentFinalResult,
  content: "ok",
  activityEvents: [],
  options: [],
};

describe("live run store", () => {
  it("tracks a run's live state and retains the final until claimed", () => {
    beginLiveRun({ chatId: "c1", pendingId: "p1", userMessage: "حلل الذهب" });
    updateLiveRun("c1", "p1", {
      addStageEvent: { stage: "market_data", status: "running", timestamp: 1 },
    });
    updateLiveRun("c1", "p1", { streamText: "جارٍ..." });

    const live = getLiveRun("c1")!;
    assert.equal(live.running, true);
    assert.equal(live.stageEvents.length, 1);
    assert.equal(live.streamText, "جارٍ...");

    updateLiveRun("c1", "p1", { running: false, final: FINAL });
    const ended = getLiveRun("c1")!;
    assert.equal(ended.running, false);
    assert.equal(ended.final?.content, "ok");

    endLiveRun("c1", "p1");
    assert.equal(getLiveRun("c1"), null);
  });

  it("drops late events from a superseded run", () => {
    beginLiveRun({ chatId: "c2", pendingId: "old", userMessage: "a" });
    beginLiveRun({ chatId: "c2", pendingId: "new", userMessage: "b" });
    updateLiveRun("c2", "old", { streamText: "stale" });
    assert.equal(getLiveRun("c2")!.streamText, null);
    // And an old run's end cannot kill the new run.
    endLiveRun("c2", "old");
    assert.ok(getLiveRun("c2"));
    endLiveRun("c2");
  });

  it("accumulates thinking lines (deduped) so a remounted chat rebuilds the trace", () => {
    beginLiveRun({ chatId: "c4", pendingId: "p", userMessage: "حلل" });
    updateLiveRun("c4", "p", { addThought: "قرأت 240 شمعة" });
    updateLiveRun("c4", "p", { addThought: "قرأت 240 شمعة" }); // replayed frame
    updateLiveRun("c4", "p", { addThought: "الاتجاه صاعد" });
    updateLiveRun("c4", "p", { addThought: "  " }); // blank — ignored
    assert.deepEqual(getLiveRun("c4")!.thinking, ["قرأت 240 شمعة", "الاتجاه صاعد"]);
    // A superseded run's late thought is dropped like every other patch.
    updateLiveRun("c4", "stale-pending", { addThought: "متأخر" });
    assert.equal(getLiveRun("c4")!.thinking.length, 2);
    endLiveRun("c4");
  });

  it("notifies subscribers on every change and supports unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeLiveRun("c3", () => {
      calls += 1;
    });
    beginLiveRun({ chatId: "c3", pendingId: "p", userMessage: "x" });
    updateLiveRun("c3", "p", { streamText: "y" });
    assert.equal(calls, 2);
    unsubscribe();
    updateLiveRun("c3", "p", { streamText: "z" });
    assert.equal(calls, 2);
    endLiveRun("c3");
  });
});
