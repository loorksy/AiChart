import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { CHART_CAPTURE_CANDLES } from "@/lib/chart/captureWindow";

describe("chart image candle window", () => {
  it("asks both capture paths for 350 candles", () => {
    assert.equal(CHART_CAPTURE_CANDLES, 350);
    const snapshot = readFileSync(
      path.join(import.meta.dirname, "..", "..", "chartSnapshot.ts"),
      "utf8",
    );
    const tv = readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "components",
        "chart",
        "TvChart.tsx",
      ),
      "utf8",
    );
    const feed = readFileSync(
      path.join(import.meta.dirname, "..", "tv", "tvDatafeed.ts"),
      "utf8",
    );
    assert.match(snapshot, /CHART_CAPTURE_CANDLES/);
    assert.match(tv, /setVisibleRange/);
    assert.match(tv, /CHART_CAPTURE_CANDLES/);
    assert.match(feed, /CHART_CAPTURE_CANDLES/);
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
