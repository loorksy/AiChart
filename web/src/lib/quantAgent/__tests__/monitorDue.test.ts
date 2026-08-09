import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMonitorDue,
  recommendationBarTime,
  recommendationConfidencePercent,
  shouldFireForRecommendation,
} from "@/lib/quantAgent/monitorDue";

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

// --- The cron -> signal-event seam ------------------------------------------
// Both helpers exist because the sweep and the signal-event row disagree about
// units and about which clock counts. Getting either wrong writes a wrong
// number onto a permanent record, so they are pinned here rather than trusted.

test("recommendationBarTime: the ENGINE's bar, not the sweep's clock", () => {
  assert.equal(
    recommendationBarTime("2026-01-02T10:00:00.000Z"),
    Date.UTC(2026, 0, 2, 10, 0, 0),
  );
  // Absent or unparseable falls back to null, which lets
  // dispatchMonitorNotification bucket "now". A bucketed bar is a guess; an
  // invented one would be a fabrication.
  assert.equal(recommendationBarTime(null), null);
  assert.equal(recommendationBarTime(undefined), null);
  assert.equal(recommendationBarTime(""), null);
  assert.equal(recommendationBarTime("not a date"), null);
});

test("recommendationConfidencePercent: 0-1 fraction becomes a 0-100 percentage", () => {
  // The service declares confidence as Field(ge=0.0, le=1.0); the signal event
  // column and every renderer treat it as a percentage. Passing 0.72 straight
  // through would record "1%" for a high-confidence call.
  assert.equal(recommendationConfidencePercent(0.72), 72);
  assert.equal(recommendationConfidencePercent(0), 0);
  assert.equal(recommendationConfidencePercent(1), 100);
  assert.equal(recommendationConfidencePercent(0.005), 1, "rounds, never truncates to 0");
  // Out-of-contract input is clamped, not propagated.
  assert.equal(recommendationConfidencePercent(1.4), 100);
  assert.equal(recommendationConfidencePercent(-0.2), 0);
  // Missing is null, never 0: "we do not have it" is not "we are not confident".
  assert.equal(recommendationConfidencePercent(null), null);
  assert.equal(recommendationConfidencePercent(undefined), null);
  assert.equal(recommendationConfidencePercent(Number.NaN), null);
});
