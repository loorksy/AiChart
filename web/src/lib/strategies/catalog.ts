import type { ResearchJsonObject, ResearchTimeframe } from "@/lib/research";

export const BACKTEST_STRATEGY_IDS = [
  "ema_trend_follow_v1",
  "rsi_mean_reversion_v1",
  "range_breakout_v1",
] as const;

export type BacktestStrategyId = (typeof BACKTEST_STRATEGY_IDS)[number];

export interface StrategyCostProfile {
  spreadPips: number;
  slippagePips: number;
  commissionPerLotSideUsd: number;
}

export function isBacktestStrategyId(value: string): value is BacktestStrategyId {
  return (BACKTEST_STRATEGY_IDS as readonly string[]).includes(value);
}

function conditionTrees(strategyId: BacktestStrategyId, timeframe: ResearchTimeframe) {
  if (strategyId === "ema_trend_follow_v1") {
    return {
      long_entry_conditions: {
        all: [
          {
            type: "ema_relation",
            timeframe,
            fast_period: 20,
            slow_period: 50,
            operator: "crosses_above",
          },
          {
            type: "rsi_threshold",
            timeframe,
            period: 14,
            operator: "above",
            value: 50,
          },
        ],
      },
      short_entry_conditions: {
        all: [
          {
            type: "ema_relation",
            timeframe,
            fast_period: 20,
            slow_period: 50,
            operator: "crosses_below",
          },
          {
            type: "rsi_threshold",
            timeframe,
            period: 14,
            operator: "below",
            value: 50,
          },
        ],
      },
    };
  }
  if (strategyId === "rsi_mean_reversion_v1") {
    return {
      long_entry_conditions: {
        all: [
          {
            type: "rsi_threshold",
            timeframe,
            period: 14,
            operator: "crosses_below",
            value: 30,
          },
        ],
      },
      short_entry_conditions: {
        all: [
          {
            type: "rsi_threshold",
            timeframe,
            period: 14,
            operator: "crosses_above",
            value: 70,
          },
        ],
      },
    };
  }
  return {
    long_entry_conditions: {
      all: [
        {
          type: "range_breakout",
          timeframe,
          lookback_bars: 20,
          direction: "above_high",
          confirmation: "close",
          offset_pips: 0,
        },
      ],
    },
    short_entry_conditions: {
      all: [
        {
          type: "range_breakout",
          timeframe,
          lookback_bars: 20,
          direction: "below_low",
          confirmation: "close",
          offset_pips: 0,
        },
      ],
    },
  };
}

/** Build a strict, declarative Research Service strategy specification. */
export function buildBacktestStrategySpec(input: {
  strategyId: BacktestStrategyId;
  symbol: string;
  timeframe: ResearchTimeframe;
  costs: StrategyCostProfile;
}): ResearchJsonObject {
  const { strategyId, symbol, timeframe, costs } = input;
  const labels: Record<BacktestStrategyId, string> = {
    ema_trend_follow_v1: "EMA trend follow",
    rsi_mean_reversion_v1: "RSI mean reversion",
    range_breakout_v1: "Range breakout",
  };
  return {
    strategy_id: strategyId,
    version_id: `${strategyId}.1`,
    name: labels[strategyId],
    description:
      "AiChart deterministic candidate with broker-observed execution costs; research-only until statistical and shadow gates pass.",
    market: "forex",
    symbols: [symbol],
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    spec_version: "1.0.0",
    timeframes: { entry: timeframe, higher: [] },
    direction: "both",
    ...conditionTrees(strategyId, timeframe),
    entry: {
      order_type: "market",
      price_reference: "next_bar_open",
      offset_type: "none",
      offset_value: 0,
      valid_for_bars: 1,
      cancel_on_opposite_signal: true,
      // One open position at a time is enforced by risk_controls.max_open_positions.
      // allow_reentry must stay true so closed trades can be followed by later signals
      // across a multi-month/year sample (false previously capped the whole run at 1 trade).
      allow_reentry: true,
      cooldown_bars: 2,
    },
    stop_loss: {
      type: "atr_multiple",
      value: 1.5,
      period: 14,
      timeframe,
    },
    targets: [
      { type: "risk_reward", size_percent: 50, value: 1.5 },
      { type: "risk_reward", size_percent: 50, value: 2.5 },
    ],
    position_sizing: {
      type: "risk_percent",
      risk_percent: 1,
      account_currency: "USD",
    },
    management: {
      move_to_break_even: {
        trigger_type: "r_multiple",
        trigger_value: 1,
        new_stop_offset_pips: 0,
        apply_after_target: null,
      },
      trailing_stop: null,
      maximum_holding_bars: 40,
      close_on_opposite_signal: true,
      session_close_exit: false,
    },
    risk_controls: {
      max_open_positions: 1,
      max_positions_per_symbol: 1,
      max_daily_loss_percent: 5,
      // Circuit-breaker threshold: engine pauses then resumes (never permanently disables).
      max_consecutive_losses: 8,
      consecutive_loss_pause_bars: 24,
      cooldown_after_loss_bars: 2,
      daily_trade_limit: 20,
      minimum_reward_risk: 1,
    },
    costs: {
      spread: { type: "fixed_pips", value: Math.max(0, costs.spreadPips) },
      slippage: {
        type: "fixed_pips",
        value: Math.max(0, costs.slippagePips),
      },
      commission:
        costs.commissionPerLotSideUsd > 0
          ? {
              type: "per_lot_per_side",
              value: costs.commissionPerLotSideUsd,
              currency: "USD",
            }
          : { type: "none" },
      swap_or_carry: { type: "none", require_accurate: false },
    },
  };
}
