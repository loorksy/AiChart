import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tickReconnectDelayMs } from "@/lib/appWake";
import { barEmittable, BACKFILL_AFTER_MS, TICK_STALE_MS } from "@/lib/chart/tv/tvDatafeed";

const root = join(import.meta.dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("app wake + live reconnect", () => {
  it("backs off the tick socket without waiting forever", () => {
    assert.equal(tickReconnectDelayMs(0), 400);
    assert.equal(tickReconnectDelayMs(1), 800);
    assert.equal(tickReconnectDelayMs(2), 1600);
    assert.equal(tickReconnectDelayMs(10), 8_000);
    assert.equal(tickReconnectDelayMs(-3), 400);
  });

  it("the root layout mounts the wake bridge", () => {
    const src = read("app/layout.tsx");
    assert.match(src, /AppWakeBridge/);
  });

  it("chart ticks reopen on error, online, and app-wake", () => {
    const src = read("lib/chart/tv/tvDatafeed.ts");
    assert.match(src, /scheduleReconnect/);
    assert.match(src, /tickReconnectDelayMs/);
    assert.match(src, /APP_WAKE_EVENT/);
    assert.match(src, /addEventListener\("online"/);
    assert.match(src, /openStream\(true\)/);
    assert.match(src, /TICK_STALE_MS = 12_000/);
    assert.match(src, /fetchWithTimeout/);
    assert.doesNotMatch(
      src,
      /source\.onerror = \(\) => \{\s*streamAlive = false;\s*source\.close\(\);\s*sub\.source = undefined;\s*\}/,
    );
  });

  it("probes the origin on a timer and times out hung fetches", () => {
    const watch = read("lib/connectionWatchdog.ts");
    const fetchSrc = read("lib/fetchWithTimeout.ts");
    const bridge = read("components/AppWakeBridge.tsx");
    const oanda = read("lib/markets/oandaStream.ts");
    assert.match(watch, /startConnectionWatchdog/);
    assert.match(watch, /\/api\/healthz/);
    assert.match(fetchSrc, /controller.abort/);
    assert.match(bridge, /startConnectionWatchdog/);
    assert.match(oanda, /controller.abort/);
    assert.match(oanda, /20_000/);
  });

  it("a failed /api/me no longer wipes the signed-in session", () => {
    const src = read("hooks/useMe.ts");
    assert.match(src, /APP_WAKE_EVENT/);
    assert.match(src, /Keep the last good session/);
    assert.doesNotMatch(src, /catch \{\s*setData\(null\);/);
  });

  it("the agent stream persists the assistant so a dropped client can recover", () => {
    // The turn body moved into webTurn.ts (Work ب) so the worker runs it
    // too; the pinned property is unchanged: the assistant is persisted
    // even when the browser dropped.
    const src = read("lib/agent/webTurn.ts");
    assert.match(src, /persistStreamAssistant/);
    assert.match(src, /appendMessage/);
  });

  it("platinum remounts when the tab wakes or WebGL dies", () => {
    const src = read("components/ui/liquid-metal-button.tsx");
    assert.match(src, /APP_WAKE_EVENT/);
    assert.match(src, /webglcontextlost/);
    assert.match(src, /shaderEpoch/);
  });

  it("a bar can never step TradingView's series backwards", () => {
    // TV treats a backwards bar time as a violation and stops accepting
    // updates — the chart freezes until a full reload. The losing order is
    // the wake race: the fresh-candle poll resolves with the PREVIOUS bar
    // after a reconnected tick already opened the next one.
    assert.equal(barEmittable(undefined, 1_000), true, "first bar always lands");
    assert.equal(barEmittable(1_000, 2_000), true, "newer bar appends");
    assert.equal(barEmittable(1_000, 1_000), true, "same bar updates in place");
    assert.equal(barEmittable(2_000, 1_000), false, "older bar is dropped");
    assert.equal(barEmittable(1_000, Number.NaN), false, "junk time is dropped");
  });

  it("both realtime paths are guarded by the monotonic rule", () => {
    const src = read("lib/chart/tv/tvDatafeed.ts");
    // The poll fallback and the live tick stream each go through the guard —
    // one unguarded emitter is all a time violation needs.
    const guarded = src.match(/barEmittable\(forming\?\.time/g) ?? [];
    assert.equal(guarded.length, 2, "poll AND applyTickPrice check the rule");
  });

  it("a long-hidden tab backfills missed candles instead of repainting one bar", () => {
    const feed = read("lib/chart/tv/tvDatafeed.ts");
    // Wake after real absence → drop TV's bar cache and ask the widget owner
    // to re-request history, so the hole fills without a manual reload.
    assert.match(feed, /onResetCacheNeeded\?: \(\) => void/);
    assert.match(feed, /BACKFILL_AFTER_MS/);
    assert.match(feed, /onBarsStale\?\.\(\)/);
    assert.ok(
      BACKFILL_AFTER_MS > TICK_STALE_MS,
      "backfill threshold must outlast an ordinary tick gap, or every quiet market re-requests history",
    );
    const chart = read("components/chart/TvChart.tsx");
    assert.match(chart, /onBarsStale/);
    assert.match(chart, /resetData\(\)/);
  });
});
