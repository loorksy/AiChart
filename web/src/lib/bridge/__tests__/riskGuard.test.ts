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
