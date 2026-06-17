import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMissedHeartbeats,
  EA_HEARTBEAT_DEBOUNCE_MISSES,
  EA_HEARTBEAT_INTERVAL_MS,
  getEaOnlineState,
  isEaOnlineDebounced,
  resetEaHeartbeatDebounce,
} from "@/lib/eaStore";

function isoSecondsAgo(sec: number): string {
  return new Date(Date.now() - sec * 1000).toISOString();
}

describe("EA heartbeat debounce", () => {
  const userId = 42_001;

  it("counts zero misses within first interval", () => {
    assert.equal(computeMissedHeartbeats(isoSecondsAgo(15)), 0);
  });

  it("counts one miss after one interval elapses", () => {
    assert.equal(
      computeMissedHeartbeats(isoSecondsAgo(35), EA_HEARTBEAT_INTERVAL_MS),
      1,
    );
  });

  it("marks offline after 3 consecutive missed intervals", () => {
    assert.equal(
      computeMissedHeartbeats(isoSecondsAgo(95), EA_HEARTBEAT_INTERVAL_MS),
      EA_HEARTBEAT_DEBOUNCE_MISSES,
    );
    const state = getEaOnlineState(userId, isoSecondsAgo(95));
    assert.equal(state.online, false);
    assert.equal(state.missedHeartbeats, 3);
  });

  it("stays online with 1-2 missed intervals", () => {
    assert.equal(isEaOnlineDebounced(userId, isoSecondsAgo(65)), true);
    const state = getEaOnlineState(userId, isoSecondsAgo(65));
    assert.equal(state.missedHeartbeats, 2);
    assert.equal(state.online, true);
  });

  it("resets debounce on heartbeat received", () => {
    resetEaHeartbeatDebounce(userId);
    const state = getEaOnlineState(userId, isoSecondsAgo(5));
    assert.equal(state.online, true);
    assert.equal(state.missedHeartbeats, 0);
    assert.ok(state.settledOnlineSeconds >= 0);
  });
});
