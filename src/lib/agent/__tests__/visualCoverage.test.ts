/**
 * What the agent is told about its own eyes.
 *
 * The failure this pins is quiet and hard to notice in production: a prompt
 * carrying two chart images cannot tell the model whether a third was never
 * requested or was requested and failed. Absence is not self-describing. So a
 * blind run and a fully-covered run looked identical from inside the model —
 * and the module's own doc comment claimed "the model is told which view it did
 * not get", which was not true of any code path.
 *
 * These tests hold the two halves of that contract: the collector reports the
 * denominator (what was asked for) alongside the numerator, and the note it
 * produces distinguishes partial sight from blindness in words the model can
 * act on.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  visualCoverageNote,
  visualTimeframesFor,
  type VisualEvidenceResult,
} from "@/lib/agent/visualEvidence";
import { TIMEFRAMES } from "@/lib/gold";

const result = (over: Partial<VisualEvidenceResult> = {}): VisualEvidenceResult => ({
  snapshots: [],
  requested: [],
  missing: [],
  elapsedMs: 0,
  ...over,
});

describe("visual timeframe ladders stay inside the analysed frames", () => {
  it("never asks for a frame the platform does not analyse", () => {
    // 1m/30m/1w ladders were left over from a multi-instrument product. Gold is
    // analysed on 5m/15m/1h/4h; 1d is context above the top frame.
    const allowed = new Set<string>([...TIMEFRAMES, "1d"]);
    for (const interval of TIMEFRAMES) {
      for (const frame of visualTimeframesFor(interval)) {
        assert.ok(allowed.has(frame), `${interval} → asked for ${frame}`);
      }
    }
  });

  it("always includes the frame being analysed", () => {
    for (const interval of TIMEFRAMES) {
      assert.ok(
        visualTimeframesFor(interval).includes(interval),
        `${interval} must see its own chart`,
      );
    }
  });

  it("falls back to intraday context for an unknown frame", () => {
    assert.deepEqual(visualTimeframesFor("3w"), ["15m", "1h", "4h"]);
  });
});

describe("the coverage note the model reads", () => {
  it("says nothing when nothing was requested", () => {
    // An unscoped run never opened its eyes; reporting a failure would be a lie
    // in the other direction.
    assert.equal(visualCoverageNote(result()), null);
  });

  it("confirms full coverage explicitly rather than by silence", () => {
    const note = visualCoverageNote(
      result({
        requested: ["15m", "1h"],
        snapshots: [
          { timeframe: "15m", imageBase64: "x" },
          { timeframe: "1h", imageBase64: "y" },
        ] as VisualEvidenceResult["snapshots"],
      }),
    );
    assert.match(note ?? "", /15m, 1h/);
    assert.match(note ?? "", /No requested view is missing/);
  });

  it("names the frames that did not arrive, and why", () => {
    const note = visualCoverageNote(
      result({
        requested: ["15m", "1h", "4h"],
        snapshots: [{ timeframe: "15m", imageBase64: "x" }] as VisualEvidenceResult["snapshots"],
        missing: [
          { timeframe: "1h", reason: "capture_timeout" },
          { timeframe: "4h", reason: "capture_failed" },
        ],
      }),
    );
    assert.match(note ?? "", /1h \(capture_timeout\)/);
    assert.match(note ?? "", /4h \(capture_failed\)/);
    assert.match(note ?? "", /Do not describe price action on a view you were not shown/);
  });

  it("distinguishes total blindness from partial sight", () => {
    const blind = visualCoverageNote(
      result({
        requested: ["15m", "1h"],
        missing: [
          { timeframe: "15m", reason: "capture_failed" },
          { timeframe: "1h", reason: "capture_failed" },
        ],
      }),
    );
    // The instruction differs because the honest answer differs: a partially
    // sighted run still describes what it saw, a blind one must say it read
    // numbers alone rather than narrate candles it never looked at.
    assert.match(blind ?? "", /NO chart was available/);
    assert.match(blind ?? "", /reading numbers alone/);
    assert.doesNotMatch(blind ?? "", /Charts reviewed/);
  });
});
