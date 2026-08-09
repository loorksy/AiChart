import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sessionOf,
  summarizeJournal,
  type JournalEntry,
} from "@/lib/recommendations/performanceJournal";

function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    recommendationId: "rec-1",
    symbol: "XAUUSD",
    direction: "buy",
    planType: "immediate",
    outcome: "win_tp1",
    followState: "followed_manual",
    entryDeviation: 0,
    stopMatchedPlan: true,
    createdAt: Date.now(),
    ...over,
  };
}

describe("performance journal", () => {
  it("separates what was followed from what was skipped", () => {
    const summary = summarizeJournal([
      entry({ recommendationId: "a", outcome: "win_tp1" }),
      entry({ recommendationId: "b", outcome: "loss" }),
      entry({ recommendationId: "c", outcome: "win_tp2", followState: "ignored" }),
      entry({ recommendationId: "d", outcome: "win_tp1", followState: "ignored" }),
    ]);
    assert.equal(summary.followed.count, 2);
    assert.equal(summary.followed.wins, 1);
    // The skipped ones still have outcomes — that comparison is the point.
    assert.equal(summary.ignored.count, 2);
    assert.equal(summary.ignored.wins, 2);
  });

  it("ignores plans that have not resolved yet", () => {
    const summary = summarizeJournal([
      entry({ outcome: "pending" }),
      entry({ recommendationId: "b", outcome: "pending", followState: "ignored" }),
    ]);
    assert.equal(summary.followed.count, 0);
    assert.equal(summary.ignored.count, 0);
    assert.deepEqual(summary.notes, []);
  });

  it("tells automatic execution apart from manual", () => {
    const summary = summarizeJournal([
      entry({ recommendationId: "a", followState: "followed_auto", outcome: "win_tp1" }),
      entry({ recommendationId: "b", followState: "followed_auto", outcome: "loss" }),
      entry({ recommendationId: "c", followState: "followed_manual", outcome: "loss" }),
    ]);
    assert.equal(summary.auto.count, 2);
    assert.equal(summary.auto.wins, 1);
    assert.equal(summary.manual.count, 1);
    assert.equal(summary.manual.wins, 0);
  });

  it("measures how often the executed stop matched the plan", () => {
    const summary = summarizeJournal([
      entry({ recommendationId: "a", stopMatchedPlan: true }),
      entry({ recommendationId: "b", stopMatchedPlan: false }),
      entry({ recommendationId: "c", stopMatchedPlan: false }),
      entry({ recommendationId: "d", stopMatchedPlan: false }),
    ]);
    assert.equal(summary.stopAdherence, 0.25);
    assert.ok(summary.notes.some((note) => note.includes("وقف الخسارة")));
  });

  it("says nothing about a sample too small to support it", () => {
    const summary = summarizeJournal([
      entry({ recommendationId: "a", outcome: "win_tp1" }),
      entry({ recommendationId: "b", outcome: "loss", followState: "ignored" }),
    ]);
    // Two data points cannot support "you do better when you skip".
    assert.ok(!summary.notes.some((note) => note.includes("تجاهلته")));
  });

  it("reports the followed-vs-ignored gap once the sample supports it", () => {
    const followed = Array.from({ length: 6 }, (_, i) =>
      entry({ recommendationId: `f${i}`, outcome: i < 1 ? "win_tp1" : "loss" }),
    );
    const ignored = Array.from({ length: 6 }, (_, i) =>
      entry({
        recommendationId: `i${i}`,
        followState: "ignored",
        outcome: i < 5 ? "win_tp1" : "loss",
      }),
    );
    const summary = summarizeJournal([...followed, ...ignored]);
    const note = summary.notes.find((n) => n.includes("تجاهلتها"));
    assert.ok(note, `expected a followed-vs-ignored note, got ${JSON.stringify(summary.notes)}`);
  });

  it("maps a timestamp to the session it traded in", () => {
    assert.equal(sessionOf(Date.parse("2026-07-27T09:00:00Z")), "london");
    assert.equal(sessionOf(Date.parse("2026-07-27T15:00:00Z")), "newyork");
    assert.equal(sessionOf(Date.parse("2026-07-27T02:00:00Z")), "asia");
  });
});
