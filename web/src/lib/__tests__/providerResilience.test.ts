import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  __resetResilience,
  breakerAllows,
  breakerOnFailure,
  breakerOnSuccess,
  breakerState,
  computeBackoffMs,
  parseRetryAfterMs,
  throttleDelayMs,
} from "@/lib/providerResilience";

beforeEach(() => __resetResilience());

describe("computeBackoffMs (exponential full jitter)", () => {
  it("grows exponentially and clamps to maxMs", () => {
    // rand=1 would exceed; use 0.999 to probe the top of the jitter window.
    const top = (exp: number) => Math.floor(0.999999 * exp);
    assert.equal(computeBackoffMs(0, { baseMs: 100, maxMs: 10_000 }, () => 0.999999), top(100));
    assert.equal(computeBackoffMs(3, { baseMs: 100, maxMs: 10_000 }, () => 0.999999), top(800));
    // attempt 10 → 100*2^10 = 102_400, clamped to 10_000.
    assert.equal(computeBackoffMs(10, { baseMs: 100, maxMs: 10_000 }, () => 0.999999), top(10_000));
  });

  it("is bounded in [0, exp] for any rand", () => {
    assert.equal(computeBackoffMs(2, { baseMs: 50, maxMs: 5_000 }, () => 0), 0);
    const mid = computeBackoffMs(2, { baseMs: 50, maxMs: 5_000 }, () => 0.5);
    assert.ok(mid >= 0 && mid <= 200); // exp = 50*4 = 200
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    assert.equal(parseRetryAfterMs("5", 0), 5_000);
    assert.equal(parseRetryAfterMs("0", 0), 0);
  });
  it("parses an HTTP date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now), 10_000);
    // A past date clamps to 0, never negative.
    assert.equal(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:00 GMT", now + 5_000), 0);
  });
  it("returns null for missing/garbage", () => {
    assert.equal(parseRetryAfterMs(null, 0), null);
    assert.equal(parseRetryAfterMs("later", 0), null);
  });
});

describe("circuit breaker", () => {
  const cfg = { failureThreshold: 3, cooldownMs: 1_000 };

  it("opens after the threshold and fails fast until cooldown", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(breakerAllows("p", 0, cfg), true);
      breakerOnFailure("p", 0, cfg);
    }
    assert.equal(breakerState("p"), "open");
    assert.equal(breakerAllows("p", 500, cfg), false, "still open before cooldown");
  });

  it("half-opens after cooldown, closes on a successful probe", () => {
    for (let i = 0; i < 3; i++) breakerOnFailure("p", 0, cfg);
    assert.equal(breakerAllows("p", 1_000, cfg), true, "one probe allowed after cooldown");
    assert.equal(breakerState("p"), "half_open");
    assert.equal(breakerAllows("p", 1_000, cfg), false, "no second concurrent probe");
    breakerOnSuccess("p");
    assert.equal(breakerState("p"), "closed");
    assert.equal(breakerAllows("p", 1_100, cfg), true);
  });

  it("re-opens immediately if the half-open probe fails", () => {
    for (let i = 0; i < 3; i++) breakerOnFailure("p", 0, cfg);
    assert.equal(breakerAllows("p", 1_000, cfg), true);
    breakerOnFailure("p", 1_000, cfg);
    assert.equal(breakerState("p"), "open");
    assert.equal(breakerAllows("p", 1_500, cfg), false);
  });

  it("a success resets the consecutive-failure count", () => {
    breakerOnFailure("p", 0, cfg);
    breakerOnFailure("p", 0, cfg);
    breakerOnSuccess("p");
    breakerOnFailure("p", 0, cfg);
    assert.equal(breakerState("p"), "closed", "2 failures after a reset must not open");
  });
});

describe("throttle spacing", () => {
  it("returns 0 for the first call then spaces subsequent calls", () => {
    assert.equal(throttleDelayMs("q", 200, 1_000), 0);
    // Immediately again → must wait the remaining interval.
    assert.equal(throttleDelayMs("q", 200, 1_000), 200);
    // A call that arrives after the window → no wait.
    assert.equal(throttleDelayMs("q", 200, 1_500), 0);
  });
  it("no spacing when interval is 0", () => {
    assert.equal(throttleDelayMs("r", 0, 0), 0);
    assert.equal(throttleDelayMs("r", 0, 0), 0);
  });
});
