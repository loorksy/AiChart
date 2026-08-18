import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";

describe("candle-count rule is unchanged", () => {
  it("capture tools introduce no candle-count threshold", () => {
    const live = readFileSync(
      path.join(import.meta.dirname, "..", "liveCapture.ts"),
      "utf8",
    );
    const snapshot = readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "app",
        "api",
        "agent",
        "chart",
        "snapshot",
        "route.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(live, /candles\.length\s*[<>=]/);
    assert.doesNotMatch(snapshot, /candles\.length\s*[<>=]/);
    assert.doesNotMatch(snapshot, /MIN_CANDLES|candleCount|candle_count/);
  });

  it("QuickChart still refuses to render fewer than 10 candles", () => {
    const src = readFileSync(
      path.join(import.meta.dirname, "..", "..", "chartSnapshot.ts"),
      "utf8",
    );
    assert.match(src, /candles\.length >= 10/);
    assert.match(src, /candles\.length < 10/);
  });
});
