import type { ResearchJsonObject, ResearchTimeframe } from "@/lib/research";
import { GENERATED_CATALOG, GENERATED_CATALOG_BY_ID } from "./catalogGen";
import { riskPolicyFor } from "./riskPolicy";

/**
 * Legacy hand-written ids. They MUST remain valid forever: deployed evidence
 * rows, recommendations, and the deep-analysis strategy mapper reference them.
 */
export const LEGACY_STRATEGY_IDS = [
  "ema_trend_follow_v1",
  "rsi_mean_reversion_v1",
  "range_breakout_v1",
] as const;

/** Full catalog: legacy trio + the generative families (~60 ids). */
export const BACKTEST_STRATEGY_IDS: readonly string[] = [
  ...LEGACY_STRATEGY_IDS,
  ...GENERATED_CATALOG.map((entry) => entry.id),
];

export type BacktestStrategyId = string;

const STRATEGY_ID_SET = new Set(BACKTEST_STRATEGY_IDS);

/**
 * Catalog revision for research specs. Bump when entry/exit/risk policy changes
 * so idempotent backtest jobs do not reuse stale one-trade results after engine
 * or catalog fixes. Displayed as `${strategyId}.${CATALOG_SPEC_REVISION}`.
 * Revision 3: the generative catalog wave (families × parameter grids).
 * Revision 4: scalp re-prioritisation — timeframe-aware risk geometry (stop,
 * targets, holding time, trade limit) plus the scalp-native families. Every
 * revision-3 result was produced under swing geometry and must NOT be reused.
 * Revision 5: MACD and Bollinger became usable CONDITION LEAVES in the closed
 * DSL (RELIABILITY_PLAN item 17, stage A). The engine already computed both,
 * but the language could not express them, so no strategy could use them.
 * Specs may now differ in their condition trees; revision-4 results were
 * produced without these leaves and must NOT be reused.
 */
export const CATALOG_SPEC_REVISION = "5";

export interface StrategyCostProfile {
  spreadPips: number;
  slippagePips: number;
  commissionPerLotSideUsd: number;
}

export function isBacktestStrategyId(value: string): value is BacktestStrategyId {
  return STRATEGY_ID_SET.has(value);
}

function conditionTrees(strategyId: BacktestStrategyId, timeframe: ResearchTimeframe) {
  // Generated families own their condition trees; legacy ids keep the
  // hand-written trees below verbatim (deployed evidence depends on them).
  const generated = GENERATED_CATALOG_BY_ID.get(strategyId);
  if (generated) return generated.buildConditions(timeframe);
  if (strategyId === "ema_trend_follow_v1") {
    // Pure EMA cross — RSI confirmation previously discarded many valid crosses
    // and kept year-long XAUUSD/1h samples just under the 100-trade evidence gate.
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
  const legacyLabels: Record<string, string> = {
    ema_trend_follow_v1: "EMA trend follow",
    rsi_mean_reversion_v1: "RSI mean reversion",
    range_breakout_v1: "Range breakout",
  };
  const label =
    GENERATED_CATALOG_BY_ID.get(strategyId)?.label ??
    legacyLabels[strategyId] ??
    strategyId;
  const risk = riskPolicyFor(timeframe);
  return {
    strategy_id: strategyId,
    version_id: `${strategyId}.${CATALOG_SPEC_REVISION}`,
    name: label,
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
      cooldown_bars: risk.cooldownBars,
    },
    // Risk geometry is TIMEFRAME-AWARE: a 1m scalp cannot share the stop
    // width, target distance, or holding time of a 4h swing (see riskPolicy).
    stop_loss: {
      type: "atr_multiple",
      value: risk.stopAtrMultiple,
      period: 14,
      timeframe,
    },
    targets: [
      { type: "risk_reward", size_percent: 50, value: risk.targetR[0] },
      { type: "risk_reward", size_percent: 50, value: risk.targetR[1] },
    ],
    position_sizing: {
      type: "risk_percent",
      risk_percent: 1,
      account_currency: "USD",
    },
    management: {
      move_to_break_even: {
        trigger_type: "r_multiple",
        trigger_value: risk.breakEvenAtR,
        new_stop_offset_pips: 0,
        apply_after_target: null,
      },
      trailing_stop: null,
      maximum_holding_bars: risk.maximumHoldingBars,
      close_on_opposite_signal: true,
      session_close_exit: false,
    },
    risk_controls: {
      max_open_positions: 1,
      max_positions_per_symbol: 1,
      // Research samples need enough closed trades for statistical gates; the engine
      // treats this as a pause/reset circuit breaker (never a permanent halt).
      max_consecutive_losses: 25,
      consecutive_loss_pause_bars: 4,
      cooldown_after_loss_bars: 1,
      max_daily_loss_percent: 15,
      // Scalping fires far more often than swing — a 30/day cap would silently
      // truncate the sample and starve the 100-trade evidence gate.
      daily_trade_limit: risk.dailyTradeLimit,
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
