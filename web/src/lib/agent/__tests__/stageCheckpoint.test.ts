import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  CHECKPOINT_TTL_MS,
  clearStageCheckpoint,
  loadStageCheckpoint,
  saveStageCheckpoint,
  stageCheckpointKey,
  stageCheckpointSize,
  type CheckpointStages,
} from "@/lib/agent/stageCheckpoint";

// Minimal shapes — the checkpoint stores results opaquely.
const stages = {
  structure: { trend: "uptrend" },
  liquidity: {},
  supplyDemand: {},
  mtf: {},
  news: null,
} as unknown as CheckpointStages;

beforeEach(() => clearStageCheckpoint());

describe("stage checkpoint (item 2: resume instead of re-earning evidence)", () => {
  it("resumes only for the SAME market snapshot", () => {
    const key = stageCheckpointKey({ userId: 1, symbol: "XAUUSD", interval: "5m" });
    saveStageCheckpoint(key, "hash-a", stages);
    assert.equal(loadStageCheckpoint(key, "hash-a"), stages, "same snapshot resumes");
    assert.equal(
      loadStageCheckpoint(key, "hash-b"),
      null,
      "a moved market (new hash) must re-run the fleet, never reuse",
    );
  });

  it("scopes checkpoints per user, symbol and timeframe", () => {
    const a = stageCheckpointKey({ userId: 1, symbol: "XAUUSD", interval: "5m" });
    assert.notEqual(a, stageCheckpointKey({ userId: 2, symbol: "XAUUSD", interval: "5m" }));
    assert.notEqual(a, stageCheckpointKey({ userId: 1, symbol: "EURUSD", interval: "5m" }));
    assert.notEqual(a, stageCheckpointKey({ userId: 1, symbol: "XAUUSD", interval: "15m" }));
  });

  it("expires after the TTL", () => {
    const key = stageCheckpointKey({ userId: 1, symbol: "XAUUSD", interval: "5m" });
    const t0 = 1_000_000;
    saveStageCheckpoint(key, "h", stages, t0);
    assert.equal(loadStageCheckpoint(key, "h", t0 + CHECKPOINT_TTL_MS - 1), stages);
    assert.equal(
      loadStageCheckpoint(key, "h", t0 + CHECKPOINT_TTL_MS + 1),
      null,
      "an expired checkpoint must not resume",
    );
  });

  it("returns null for an unknown key", () => {
    assert.equal(loadStageCheckpoint("nobody", "h"), null);
  });

  it("bounds memory by evicting the oldest entry", () => {
    for (let i = 0; i < 250; i++) {
      saveStageCheckpoint(`k${i}`, "h", stages, 1_000 + i);
    }
    assert.ok(stageCheckpointSize() <= 200, `size ${stageCheckpointSize()} must stay capped`);
    // The oldest keys were evicted; the newest survive.
    assert.equal(loadStageCheckpoint("k0", "h", 1_100), null);
    assert.equal(loadStageCheckpoint("k249", "h", 1_300), stages);
  });
});
