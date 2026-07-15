import assert from "node:assert/strict";
import test from "node:test";
import { resolveTradingMode, tradingModeModelContext } from "@/lib/agent/tradingMode";
import type { AgentSessionMemory } from "@/lib/agent/types";
import type { UserTradingProfile } from "@/lib/agent/risk/userTradingProfile";

function profileWith(style: UserTradingProfile["tradingStyle"], minRR = 1): UserTradingProfile {
  return {
    userId: 1,
    tradingStyle: style,
    riskLevel: "medium",
    minRR,
    riskPerTradePct: 1,
    maxRiskPerTradePct: 1,
    maxDailyLossPct: 5,
    maxOpenTrades: 3,
    maxOpenTradesPerSymbol: 0,
    allowedSymbols: [],
    allowedDirections: ["buy", "sell"],
    tradingMode: "manual",
    accountMode: "demo",
    executionMode: "simulation",
    preferMinimalDrawings: false,
    educationalOnly: false,
  };
}

function sessionWith(
  style: AgentSessionMemory["preferences"]["tradingStyle"],
): AgentSessionMemory {
  return {
    sessionId: "s1",
    preferences: { tradingStyle: style },
    updatedAt: Date.now(),
  };
}

test("explicit scalp intent wins over every other signal", () => {
  const mode = resolveTradingMode({
    interval: "4h",
    scalpIntent: true,
    session: sessionWith("swing"),
    profile: profileWith("position"),
  });
  assert.equal(mode.style, "scalp");
  assert.equal(mode.source, "explicit_intent");
  assert.equal(mode.requiresFreshCurrentTf, true);
  assert.equal(mode.requiresLiveSession, true);
  assert.equal(mode.confirmationStrictness, "strict");
  assert.equal(mode.holdingHorizon, "minutes");
});

test("in-session correction outranks the chart interval and old settings", () => {
  const mode = resolveTradingMode({
    interval: "1m",
    session: sessionWith("swing"),
    profile: profileWith("day"),
  });
  assert.equal(mode.style, "swing");
  assert.equal(mode.source, "session_correction");
  assert.equal(mode.requiresLiveSession, false);
});

test("chart interval drives the mode when no explicit signal exists", () => {
  assert.equal(resolveTradingMode({ interval: "1m" }).style, "scalp");
  assert.equal(resolveTradingMode({ interval: "15m" }).style, "day");
  assert.equal(resolveTradingMode({ interval: "4h" }).style, "swing");
  assert.equal(resolveTradingMode({ interval: "1w" }).style, "position");
  assert.equal(resolveTradingMode({ interval: "15m" }).source, "chart_interval");
});

test("persisted user selection applies when no chart interval is present", () => {
  const mode = resolveTradingMode({ profile: profileWith("swing") });
  assert.equal(mode.style, "swing");
  assert.equal(mode.source, "user_settings");
  assert.equal(mode.holdingHorizon, "days");
});

test("scalp and day modes enforce the disciplined RR floor", () => {
  assert.ok(resolveTradingMode({ interval: "1m", profile: profileWith("scalp", 1) }).minRr >= 1.8);
  assert.ok(resolveTradingMode({ interval: "15m", profile: profileWith("day", 1) }).minRr >= 1.8);
  // Swing keeps the user's configured floor (never below 1).
  assert.equal(resolveTradingMode({ interval: "4h", profile: profileWith("swing", 1.2) }).minRr, 1.2);
});

test("mode can only tighten discipline — no mode disables freshness or session gates for scalp", () => {
  // Even a scalp coming purely from the timeframe keeps strict gates.
  const fromInterval = resolveTradingMode({ interval: "5m" });
  assert.equal(fromInterval.style, "scalp");
  assert.equal(fromInterval.requiresFreshCurrentTf, true);
  assert.equal(fromInterval.requiresLiveSession, true);
});

test("model context is structured facts only — no canned response text", () => {
  const ctx = tradingModeModelContext(resolveTradingMode({ interval: "15m" }));
  for (const value of Object.values(ctx)) {
    assert.ok(
      typeof value === "string" || typeof value === "number",
      "mode context must be enum/number facts",
    );
    if (typeof value === "string") {
      assert.ok(value.length < 40, "mode facts must be identifiers, not sentences");
      assert.doesNotMatch(value, /\s{2,}|[.!؟?]$/, "no prose in mode context");
    }
  }
});

test("default resolves to day trading when no signals exist", () => {
  const mode = resolveTradingMode({});
  assert.equal(mode.style, "day");
  assert.equal(mode.source, "default");
});
