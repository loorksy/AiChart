import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tickReconnectDelayMs } from "@/lib/appWake";

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
    const src = read("app/api/agent/chat/stream/route.ts");
    assert.match(src, /persistStreamAssistant/);
    assert.match(src, /appendMessage/);
  });

  it("platinum remounts when the tab wakes or WebGL dies", () => {
    const src = read("components/ui/liquid-metal-button.tsx");
    assert.match(src, /APP_WAKE_EVENT/);
    assert.match(src, /webglcontextlost/);
    assert.match(src, /shaderEpoch/);
  });
});
