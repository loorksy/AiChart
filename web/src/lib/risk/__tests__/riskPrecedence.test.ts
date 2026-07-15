import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectRiskIncreases,
  PLATFORM_IMMUTABLE_LIMITS,
  resolveRiskLimits,
  RISK_PRECEDENCE_VERSION,
  SAFE_RISK_DEFAULTS,
} from "@/lib/risk/riskPrecedence";
import type { AdminLimits, TradingSettings } from "@/lib/types";

function settings(over: Partial<TradingSettings> = {}): TradingSettings {
  return {
    user_id: 1,
    mode: "approval",
    approval: "manual",
    experience: "expert",
    style: "balanced",
    max_capital: 10_000,
    per_trade_pct: 1,
    max_open_trades: 3,
    daily_profit_target_pct: 0,
    daily_profit_target_usd: 0,
    daily_loss_limit_pct: 3,
    monthly_loss_limit_pct: 8,
    auto_take_profit_usd: 0,
    allowed_assets: "[]",
    active_market: "forex",
    forex_backend: null,
    send_screenshot: 0,
    telegram_chat_id: null,
    risk_guard_enabled: 1,
    alerts_enabled: 1,
    alert_trades: 1,
    alert_signals: 1,
    alert_min_confidence: 0,
    min_confidence: 80,
    min_rr: 1.5,
    scan_poll_minutes: 0,
    analysis_interval: "1h",
    execution_env_preference: "demo",
    futures_enabled: 0,
    default_leverage: 3,
    trading_style: "day",
    scalp_max_trades: 0,
    scalp_enabled: 0,
    scalp_execution_mode: "paper",
    onboarding_done: 1,
    last_manual_scan_at: null,
    ...over,
  } as TradingSettings;
}

function limits(over: Partial<AdminLimits> = {}): AdminLimits {
  return {
    user_id: 1,
    max_capital_cap: 50_000,
    max_open_trades_cap: 5,
    can_execute: 0,
    max_leverage_cap: 10,
    ...over,
  } as AdminLimits;
}

describe("riskPrecedence", () => {
  it("records a stable precedence version", () => {
    assert.equal(RISK_PRECEDENCE_VERSION, "1.0.0");
    assert.equal(PLATFORM_IMMUTABLE_LIMITS.mandatoryStopLoss, true);
  });

  it("clamps user capital and open trades to admin ceilings", () => {
    const resolved = resolveRiskLimits(
      settings({ max_capital: 100_000, max_open_trades: 20, per_trade_pct: 2 }),
      limits({ max_capital_cap: 25_000, max_open_trades_cap: 4 }),
    );
    assert.equal(resolved.effectiveCapital, 25_000);
    assert.equal(resolved.maxOpenTrades, 4);
    assert.equal(resolved.perTradePct, 2);
    assert.ok(resolved.perTradeMaxUsd <= 500);
  });

  it("caps per-trade pct by immutable platform ceiling", () => {
    const resolved = resolveRiskLimits(
      settings({ per_trade_pct: 50 }),
      limits({ max_capital_cap: 0 }),
    );
    assert.equal(
      resolved.perTradePct,
      PLATFORM_IMMUTABLE_LIMITS.maxPerTradePctCeiling,
    );
  });

  it("detects risk increases and ignores risk decreases", () => {
    const before = settings({ per_trade_pct: 1, min_rr: 1.5, mode: "approval" });
    assert.deepEqual(detectRiskIncreases(before, { per_trade_pct: 2 }), [
      "per_trade_pct",
    ]);
    assert.deepEqual(detectRiskIncreases(before, { per_trade_pct: 0.5 }), []);
    assert.deepEqual(detectRiskIncreases(before, { min_rr: 1 }), [
      "min_rr_lowered",
    ]);
    assert.ok(detectRiskIncreases(before, { mode: "auto" }).includes("mode_auto"));
  });

  it("exposes safe defaults for reset", () => {
    assert.equal(SAFE_RISK_DEFAULTS.mode, "approval");
    assert.equal(SAFE_RISK_DEFAULTS.per_trade_pct, 1);
    assert.ok((SAFE_RISK_DEFAULTS.min_rr ?? 0) >= 1.5);
  });
});
