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
  MAX_FINAL_TRACE_NOTES,
  MAX_NOTES_PER_STAGE,
  renderProgress,
  renderToolsTrace,
  SPINNER_FRAMES,
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

const row = (
  stage: string,
  status: "running" | "done" | "failed",
  notes: string[] = [],
) => ({ stage, status, notes });

describe("renderProgress", () => {
  it("labels known stages in Arabic as an ordered ✅ checklist, spinner on current", () => {
    const text = renderProgress(
      [
        row("market_data", "done"),
        row("structure", "running"),
        row("news", "failed"),
      ],
      "ar",
    );
    assert.ok(text.includes("1. ✅ بيانات السوق"));
    assert.ok(text.includes(`2. ${SPINNER_FRAMES[0]} البنية السعرية`));
    assert.ok(text.includes("3. ❌ الأخبار"));
  });

  it("nests a thinking line as muted italics under its stage", () => {
    const text = renderProgress(
      [row("structure", "done", ["حدّدت بنية السوق: اتجاه صاعد فوق 4010"])],
      "ar",
    );
    assert.ok(text.includes("1. ✅ البنية السعرية"));
    assert.ok(text.includes("<i>حدّدت بنية السوق: اتجاه صاعد فوق 4010</i>"));
    assert.ok(!text.includes("«"), "the old quotation wrapper is gone");
  });

  it("escapes HTML in thinking notes so a '<' cannot 400 the edit", () => {
    const text = renderProgress(
      [row("structure", "done", ["السعر < 4010"])],
      "ar",
    );
    assert.ok(text.includes("<i>السعر &lt; 4010</i>"));
    assert.ok(!text.includes("<i>السعر < 4010</i>"));
  });

  it("renders NOTHING when the engine has said nothing — no invented line", () => {
    // The empty state used to be "⌛ أفكّر…", a pre-printed thought. An empty
    // string here is what keeps the bubble from existing before real work.
    assert.equal(renderProgress([], "ar"), "");
    assert.equal(renderProgress([], "ar", 0, ["   "]), "");
  });

  it("renders an unknown stage as its raw name instead of hiding it", () => {
    assert.equal(stageLabel("mystery_stage", "ar"), "mystery_stage");
  });

  it("heads the bubble with a live count of the checklist", () => {
    const text = renderProgress(
      [row("market_data", "done"), row("structure", "running")],
      "ar",
    );
    assert.ok(text.includes("جارٍ التحليل"), "the header names the work");
    assert.ok(text.includes("(1/2)"), "…and says how far along it is");
  });

  it("turns the header clock one frame per edit — animation without premium", () => {
    const rows = [row("structure", "running")];
    const first = renderProgress(rows, "ar", 0);
    const second = renderProgress(rows, "ar", 1);
    assert.ok(first.startsWith(SPINNER_FRAMES[0]!));
    assert.ok(second.startsWith(SPINNER_FRAMES[1]!));
    assert.notEqual(first.split("\n")[0], second.split("\n")[0], "the clock must turn");
    // Wraps rather than running off the end of the dial.
    assert.ok(
      renderProgress(rows, "ar", SPINNER_FRAMES.length).startsWith(SPINNER_FRAMES[0]!),
    );
  });
});

describe("renderToolsTrace", () => {
  it("collapses to an expandable blockquote titled with the real tool count", () => {
    const block = renderToolsTrace(
      [
        row("market_data", "done", ["قرأت 240 شمعة على فريم 1h"]),
        row("structure", "done"),
        row("news", "running"),
      ],
      "ar",
    );
    assert.ok(block.startsWith("<blockquote expandable>"));
    assert.ok(block.endsWith("</blockquote>"));
    assert.ok(block.includes("🛠 نُفِّذت 2 أدوات"), "the title carries the finished count");
    assert.ok(block.includes("1. ✅ بيانات السوق"));
    assert.ok(block.includes("<i>قرأت 240 شمعة على فريم 1h</i>"));
    assert.ok(block.includes("2. ✅ البنية السعرية"));
    assert.ok(!block.includes("الأخبار"), "a still-running stage is not a finished tool");
  });

  it("caps interleaved thinking notes in the final trace", () => {
    const stages = Array.from({ length: 8 }, (_, i) =>
      row("market_data", "done", [`ملاحظة ${i}-أ`, `ملاحظة ${i}-ب`]),
    );
    // Same stage name reuses the label; what matters is the note cap.
    const block = renderToolsTrace(stages, "ar");
    const notes = block.match(/<i>/g)?.length ?? 0;
    assert.ok(notes <= MAX_FINAL_TRACE_NOTES, `kept ${notes} notes, cap is ${MAX_FINAL_TRACE_NOTES}`);
  });

  it("returns empty when nothing finished", () => {
    assert.equal(renderToolsTrace([row("structure", "running")], "ar"), "");
    assert.equal(renderToolsTrace([], "en"), "");
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
    assert.ok(h.shows[1]!.includes("✅ البنية السعرية"));
    // …and the header clock turned between the two edits.
    assert.notEqual(
      h.shows[0]!.split("\n")[0],
      h.shows[1]!.split("\n")[0],
      "consecutive edits must advance the spinner frame",
    );
  });

  it("never regresses a finished stage back to running", () => {
    const h = harness();
    h.reporter.onStage({ stage: "structure", status: "done" });
    h.reporter.onStage({ stage: "structure", status: "running" });
    assert.deepEqual(h.reporter.snapshot(), [
      { stage: "structure", status: "done", notes: [] },
    ]);
  });

  it("nests thinking under the last completed stage and scrubs internals", async () => {
    const h = harness();
    h.reporter.onStage({ stage: "market_data", status: "done" });
    h.reporter.onThinking("قرأت 240 شمعة — OPENAI_API_KEY و chain of thought: سر");
    h.advance(EDIT_GAP_MS + 1);
    await sleep(EDIT_GAP_MS + 50);
    const latest = h.shows[h.shows.length - 1]!;
    assert.ok(latest.includes("1. ✅ بيانات السوق"));
    assert.ok(latest.includes("<i>"), "the thinking line is muted italics");
    assert.doesNotMatch(latest, /OPENAI_API_KEY/);
    assert.doesNotMatch(latest, /chain of thought/i);
    assert.ok(latest.includes("قرأت 240 شمعة"));
    assert.equal(h.reporter.snapshot()[0]!.notes.length, 1);
  });

  it(`keeps at most ${MAX_NOTES_PER_STAGE} notes per stage`, () => {
    const h = harness();
    h.reporter.onStage({ stage: "news", status: "done" });
    h.reporter.onThinking("الأولى");
    h.reporter.onThinking("الثانية");
    h.reporter.onThinking("الثالثة");
    assert.deepEqual(h.reporter.snapshot()[0]!.notes, ["الأولى", "الثانية"]);
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
    reporter.onThinking("should never render");
    await sleep(20);
    assert.equal(shows.length, 0, "nothing was ever attempted after finish");
  });
});
