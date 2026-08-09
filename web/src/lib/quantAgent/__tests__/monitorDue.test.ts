import assert from "node:assert/strict";
import { test } from "node:test";
import { isMonitorDue, shouldFireForRecommendation } from "@/lib/quantAgent/monitorDue";

test("isMonitorDue: a never-checked monitor is always due", () => {
  assert.equal(isMonitorDue(null, "15m", Date.now()), true);
});

test("isMonitorDue: respects the monitor's own interval as its re-check cadence", () => {
  const now = 1_000_000_000;
  // 15m interval = 900_000ms cadence.
  assert.equal(isMonitorDue(now - 900_000, "15m", now), true, "exactly one interval elapsed is due");
  assert.equal(isMonitorDue(now - 899_999, "15m", now), false, "one ms short is not due");
  assert.equal(isMonitorDue(now - 100, "15m", now), false, "just checked is not due");
});

test("isMonitorDue: a slower interval (1h) waits longer than a faster one (15m)", () => {
  const now = 1_000_000_000;
  const lastChecked = now - 20 * 60 * 1000; // 20 minutes ago
  assert.equal(isMonitorDue(lastChecked, "15m", now), true, "20min >= 15min cadence");
  assert.equal(isMonitorDue(lastChecked, "1h", now), false, "20min < 1h cadence");
});

test("shouldFireForRecommendation: dedupes on an unchanged recommendation id", () => {
  assert.equal(shouldFireForRecommendation(null, "rec-1"), true, "first-ever fire always notifies");
  assert.equal(shouldFireForRecommendation("rec-1", "rec-1"), false, "same id — nothing changed");
  assert.equal(shouldFireForRecommendation("rec-1", "rec-2"), true, "new id — notify again");
});
