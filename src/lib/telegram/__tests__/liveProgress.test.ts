/**
 * The progress reporter's contract: honest, throttled, and impossible to
 * fail a run with.
 *
 * Telegram allows ~1 edit/sec/chat and the engine emits stage transitions in
 * bursts, so the load-bearing properties are the THROTTLE (bursts coalesce,
 * the trailing edit carries the newest state) and the FINISH barrier (no
 * edit can land after the answer replaces the bubble).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EDIT_GAP_MS,
  renderProgress,
  stageLabel,
  TelegramProgressReporter,
} from "@/lib/telegram/liveProgress";

function harness(startMs = 100_000) {
  let nowMs = startMs;
  const shows: string[] = [];
  let typings = 0;
  const reporter = new TelegramProgressReporter(
    {
      show: async (text) => {
        shows.push(text);
      },
      typing: async () => {
        typings += 1;
      },
    },
    "ar",
    () => nowMs,
  );
  return {
    reporter,
    shows,
    typings: () => typings,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("renderProgress", () => {
  it("labels known stages in Arabic and shows the honest mark per status", () => {
    const text = renderProgress(
      [
        { stage: "market_data", status: "done" },
        { stage: "structure", status: "running" },
        { stage: "news", status: "failed" },
      ],
      "ar",
    );
    assert.ok(text.includes("✓ بيانات السوق"));
    assert.ok(text.includes("⏳ البنية السعرية"));
    assert.ok(text.includes("✗ الأخبار"));
  });

  it("shows the specialist's own sentence under the checklist", () => {
    const text = renderProgress(
      [{ stage: "structure", status: "done" }],
      "ar",
      "حدّدت بنية السوق: اتجاه صاعد فوق 4010",
    );
    assert.ok(text.includes("«حدّدت بنية السوق: اتجاه صاعد فوق 4010»"));
  });

  it("renders NOTHING when the engine has said nothing — no invented line", () => {
    // The empty state used to be "⌛ أفكّر…", a pre-printed thought. An empty
    // string here is what keeps the bubble from existing before real work.
    assert.equal(renderProgress([], "ar"), "");
    assert.equal(renderProgress([], "ar", "   "), "");
  });

  it("renders an unknown stage as its raw name instead of hiding it", () => {
    assert.equal(stageLabel("mystery_stage", "ar"), "mystery_stage");
  });
});

describe("TelegramProgressReporter", () => {
  it("coalesces a burst into one immediate edit plus one trailing edit", async () => {
    const h = harness();
    // First event flushes immediately (nothing sent for EDIT_GAP_MS before it).
    h.reporter.onStage({ stage: "market_data", status: "running" });
    // Burst within the gap: schedules ONE trailing flush.
    h.reporter.onStage({ stage: "market_data", status: "done" });
    h.reporter.onStage({ stage: "structure", status: "running" });
    h.reporter.onStage({ stage: "structure", status: "done" });
    assert.equal(h.shows.length, 1, "the burst must not fan out into edits");
    h.advance(EDIT_GAP_MS + 1);
    await sleep(EDIT_GAP_MS + 50);
    assert.equal(h.shows.length, 2, "exactly one trailing edit");
    // The trailing edit carries the NEWEST state, not the state at schedule time.
    assert.ok(h.shows[1]!.includes("✓ البنية السعرية"));
  });

  it("never regresses a finished stage back to running", () => {
    const h = harness();
    h.reporter.onStage({ stage: "structure", status: "done" });
    h.reporter.onStage({ stage: "structure", status: "running" });
    assert.deepEqual(h.reporter.snapshot(), [{ stage: "structure", status: "done" }]);
  });

  it("finish() suppresses the queued trailing edit — the answer wins", async () => {
    const h = harness();
    h.reporter.onStage({ stage: "market_data", status: "running" });
    h.reporter.onStage({ stage: "market_data", status: "done" }); // queued
    h.reporter.finish();
    await sleep(EDIT_GAP_MS + 50);
    assert.equal(h.shows.length, 1, "a late edit would overwrite the final answer");
  });

  it("creates no bubble until the engine's first event", async () => {
    const h = harness();
    await h.reporter.start();
    assert.equal(h.shows.length, 0, "no pre-printed bubble — typing only");
    assert.ok(h.typings() >= 1, "the native typing indicator carries the signal");
    h.reporter.onStage({ stage: "market_data", status: "running" });
    assert.equal(h.shows.length, 1, "the first REAL event creates the bubble");
    h.reporter.finish();
  });

  it("ignores events after finish and survives a throwing transport", async () => {
    const shows: string[] = [];
    const reporter = new TelegramProgressReporter(
      {
        show: async (text) => {
          shows.push(text);
          throw new Error("telegram down");
        },
        typing: async () => {
          throw new Error("telegram down");
        },
      },
      "ar",
      () => 0,
    );
    await reporter.start(); // must not throw
    reporter.finish();
    reporter.onStage({ stage: "news", status: "done" });
    await sleep(20);
    assert.equal(shows.length, 0, "nothing was ever attempted after finish");
  });
});
