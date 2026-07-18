import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { voiceBridgeInstructions } from "@/lib/agent/voice/voiceBridgeInstructions";

describe("voiceBridgeInstructions", () => {
  it("keeps the realtime model as a speech bridge only", () => {
    const ar = voiceBridgeInstructions("ar");
    const en = voiceBridgeInstructions("en");
    assert.match(ar, /ask_aichart/);
    assert.match(en, /ask_aichart/);
    assert.match(en, /Never invent BUY/);
    assert.match(ar, /العربي/);
  });
});
