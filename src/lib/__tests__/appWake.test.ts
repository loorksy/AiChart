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
    assert.doesNotMatch(
      src,
      /source\.onerror = \(\) => \{\s*streamAlive = false;\s*source\.close\(\);\s*sub\.source = undefined;\s*\}/,
    );
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
