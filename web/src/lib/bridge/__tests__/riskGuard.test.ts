import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BridgeErrorCode } from "@/lib/bridge/errors";
import { evaluateTrade } from "@/lib/riskGuard";
import type { AdminLimits, TradingSettings } from "@/lib/types";

function baseSettings(
  overrides: Partial<TradingSettings> = {},
): TradingSettings {
  return {
    user_id: 1,
    mode: "auto",
    approval: "manual",
    experience: "beginner",
    style: "conservative",
    max_capital: 1000,
    per_trade_pct: 10,
    max_open_trades: 3,
    daily_profit_target_pct: 0,
    daily_profit_target_usd: 0,
    daily_loss_limit_pct: 0,
    monthly_loss_limit_pct: 0,
    auto_take_profit_usd: 0,
    allowed_assets: '["BTCUSDT"]',
    active_market: "crypto",
    send_screenshot: 1,
    telegram_chat_id: null,
    kill_switch: 0,
    risk_guard_enabled: 1,
    onboarding_done: 1,
    alerts_enabled: 1,
    alert_trades: 1,
    alert_signals: 1,
    alert_min_confidence: 0,
    min_confidence: 80,
    trading_style: "day",
    scalp_max_trades: 0,
    scalp_enabled: 0,
    scalp_execution_mode: "paper",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const limits: AdminLimits = {
  user_id: 1,
  can_execute: 1,
  max_capital_cap: 0,
  max_open_trades_cap: 3,
  claude_quota: 1000,
  updated_at: new Date().toISOString(),
};

const openCtx = {
  masterKill: false,
  openTradesCount: 0,
  todayRealizedPnlPct: 0,
  todayRealizedPnlUsd: 0,
  monthRealizedPnlPct: 0,
  resolvedEnv: "live" as const,
  envPreference: "live" as const,
};

describe("riskGuard confidence gate", () => {
  it("allows confidence 79 when min_confidence=80 on live (confidence gate eliminated)", () => {
    const decision = evaluateTrade(
      baseSettings(),
      limits,
      {
        symbol: "BTCUSDT",
        side: "buy",
        notional: 50,
        confidence: 79,
      },
      openCtx,
    );
    assert.equal(decision.ok, true);
  });

  it("allows confidence 80 when min_confidence=80 on live", () => {
    const decision = evaluateTrade(
      baseSettings(),
      limits,
      {
        symbol: "BTCUSDT",
        side: "buy",
        notional: 50,
        confidence: 80,
      },
      openCtx,
    );
    assert.equal(decision.ok, true);
  });

  it("uses practice floor 50 on demo env", () => {
    const decision = evaluateTrade(
      baseSettings(),
      limits,
      {
        symbol: "BTCUSDT",
        side: "buy",
        notional: 50,
        confidence: 55,
      },
      { ...openCtx, resolvedEnv: "demo", envPreference: "demo" },
    );
    assert.equal(decision.ok, true);
  });
});

describe("riskGuard full-autonomous toggle (risk_guard_enabled=0)", () => {
  const buy = { symbol: "BTCUSDT", side: "buy" as const, notional: 50, confidence: 1 };

  it("ENFORCED: blocks at max open trades", () => {
    const d = evaluateTrade(
      baseSettings({ max_open_trades: 1 }),
      { ...limits, max_open_trades_cap: 0 },
      buy,
      { ...openCtx, openTradesCount: 1 },
    );
    assert.equal(d.ok, false);
  });

  it("AUTONOMOUS: skips max-open-trades, daily loss, per-trade cap, allowlist", () => {
    const d = evaluateTrade(
      baseSettings({
        risk_guard_enabled: 0,
        max_open_trades: 1,
        daily_loss_limit_pct: 5,
        per_trade_pct: 1, // perTradeMax = 10; notional 50 would breach when enforced
        allowed_assets: '["ETHUSDT"]', // BTCUSDT not in list
      }),
      { ...limits, max_open_trades_cap: 0, can_execute: 0 },
      buy,
      { ...openCtx, openTradesCount: 5, todayRealizedPnlPct: -50 },
    );
    assert.equal(d.ok, true);
  });

  it("AUTONOMOUS: platform emergency kill STILL blocks", () => {
    const d = evaluateTrade(
      baseSettings({ risk_guard_enabled: 0 }),
      limits,
      buy,
      { ...openCtx, masterKill: true },
    );
    assert.equal(d.ok, false);
  });

  it("AUTONOMOUS: user kill switch STILL blocks", () => {
    const d = evaluateTrade(
      baseSettings({ risk_guard_enabled: 0, kill_switch: 1 }),
      limits,
      buy,
      openCtx,
    );
    assert.equal(d.ok, false);
  });

  it("AUTONOMOUS: can't risk more than capital (broker reality) STILL blocks", () => {
    const d = evaluateTrade(
      baseSettings({ risk_guard_enabled: 0, max_capital: 100 }),
      limits,
      { ...buy, notional: 500 },
      openCtx,
    );
    assert.equal(d.ok, false);
  });

  it("AUTONOMOUS: futures mandatory SL (liquidation guard) STILL enforced", () => {
    const d = evaluateTrade(
      baseSettings({ risk_guard_enabled: 0, futures_enabled: 1 }),
      { ...limits, max_leverage_cap: 10 },
      {
        ...buy,
        marketType: "futures",
        market: "crypto",
        leverage: 5,
        stopLoss: null,
      },
      openCtx,
    );
    assert.equal(d.ok, false);
  });
});
