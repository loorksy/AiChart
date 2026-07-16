/**
 * Canonical risk precedence model.
 *
 * immutable platform safety limits
 *   → admin/account limits
 *   → user risk preferences
 *   → resolved trading mode
 *   → per-request stricter instruction
 *
 * Lower levels may tighten risk but may never weaken a higher-level safety limit.
 * Used by web analysis, recommendations, execution, voice, MCP, account overview,
 * and the Risk Settings UI — one resolver, no parallel authority.
 */
import type { AdminLimits, TradingSettings } from "@/lib/types";
import { getEffectiveMinRr } from "@/lib/riskGuard";
import { resolveMaxOpenTrades } from "@/lib/riskLimits";

export const RISK_PRECEDENCE_VERSION = "1.0.0";

export const PLATFORM_IMMUTABLE_LIMITS = {
  mandatoryStopLoss: true,
  stalePriceRejection: true,
  idempotentOrders: true,
  liveDemoEnvMatch: true,
  explicitConfirmationForLive: true,
  /** Hard floor — users may raise min_rr but server never disables stop-loss. */
  stopLossRequired: true,
  /** Absolute ceiling on per-trade risk % even if admin is misconfigured. */
  maxPerTradePctCeiling: 10,
  /** Absolute ceiling on daily loss % even if admin is misconfigured. */
  maxDailyLossPctCeiling: 20,
} as const;

export interface ResolvedRiskLimits {
  precedenceVersion: string;
  effectiveCapital: number;
  perTradePct: number;
  perTradeMaxUsd: number;
  maxOpenTrades: number;
  dailyLossLimitPct: number;
  monthlyLossLimitPct: number;
  minRr: number;
  minConfidence: number;
  canAutoExecute: boolean;
  executionEnvPreference: "demo" | "live";
  mode: TradingSettings["mode"];
  immutable: typeof PLATFORM_IMMUTABLE_LIMITS;
  sources: {
    capital: "user_capped_by_admin" | "user" | "admin";
    maxOpen: "user_capped_by_admin" | "user";
    perTradePct: "user_capped_by_platform";
    dailyLoss: "user_capped_by_platform";
  };
}

/**
 * Resolve effective risk limits. Never weakens admin/platform ceilings.
 */
export function resolveRiskLimits(
  settings: TradingSettings,
  limits: AdminLimits,
): ResolvedRiskLimits {
  const capitalCap = limits.max_capital_cap > 0 ? limits.max_capital_cap : Infinity;
  const effectiveCapital = Math.min(settings.max_capital, capitalCap);
  const perTradePct = Math.min(
    settings.per_trade_pct,
    PLATFORM_IMMUTABLE_LIMITS.maxPerTradePctCeiling,
  );
  const dailyLossLimitPct = Math.min(
    settings.daily_loss_limit_pct,
    PLATFORM_IMMUTABLE_LIMITS.maxDailyLossPctCeiling,
  );
  const maxOpenTrades = resolveMaxOpenTrades(
    settings.max_open_trades,
    limits.max_open_trades_cap,
  );
  const canAutoExecute = limits.can_execute === 1;
  const mode: TradingSettings["mode"] =
    settings.mode === "auto" && !canAutoExecute ? "approval" : settings.mode;

  return {
    precedenceVersion: RISK_PRECEDENCE_VERSION,
    effectiveCapital: Number.isFinite(effectiveCapital)
      ? effectiveCapital
      : settings.max_capital,
    perTradePct,
    perTradeMaxUsd: (effectiveCapital * perTradePct) / 100,
    maxOpenTrades,
    dailyLossLimitPct,
    monthlyLossLimitPct: settings.monthly_loss_limit_pct,
    minRr: getEffectiveMinRr(settings),
    minConfidence: settings.min_confidence ?? 80,
    canAutoExecute,
    executionEnvPreference:
      settings.execution_env_preference === "live" ? "live" : "demo",
    mode,
    immutable: PLATFORM_IMMUTABLE_LIMITS,
    sources: {
      capital:
        limits.max_capital_cap > 0 ? "user_capped_by_admin" : "user",
      maxOpen:
        limits.max_open_trades_cap > 0 ? "user_capped_by_admin" : "user",
      perTradePct: "user_capped_by_platform",
      dailyLoss: "user_capped_by_platform",
    },
  };
}

/** Numeric fields that increase risk when their value is raised. */
export const RISK_INCREASE_FIELDS = [
  "per_trade_pct",
  "max_open_trades",
  "max_capital",
  "daily_loss_limit_pct",
  "monthly_loss_limit_pct",
  "default_leverage",
] as const;

export type RiskIncreaseReason =
  | (typeof RISK_INCREASE_FIELDS)[number]
  | "min_rr_lowered"
  | "mode_auto";

export function detectRiskIncreases(
  before: TradingSettings,
  patch: Record<string, unknown>,
): RiskIncreaseReason[] {
  const increased: RiskIncreaseReason[] = [];
  for (const field of RISK_INCREASE_FIELDS) {
    if (!(field in patch)) continue;
    const next = Number(patch[field]);
    const prev = Number(before[field as keyof TradingSettings]);
    if (!Number.isFinite(next) || !Number.isFinite(prev)) continue;
    if (next > prev) increased.push(field);
  }
  // Lowering min_rr weakens trade-quality gate — treat as risk increase.
  if ("min_rr" in patch) {
    const next = Number(patch.min_rr);
    const prev = Number(before.min_rr ?? 1);
    if (Number.isFinite(next) && Number.isFinite(prev) && next < prev) {
      increased.push("min_rr_lowered");
    }
  }
  if (patch.mode === "auto" && before.mode !== "auto") {
    increased.push("mode_auto");
  }
  return [...new Set(increased)];
}

export const SAFE_RISK_DEFAULTS: Partial<TradingSettings> = {
  style: "conservative",
  mode: "approval",
  per_trade_pct: 1,
  max_open_trades: 3,
  daily_loss_limit_pct: 3,
  monthly_loss_limit_pct: 8,
  min_rr: 1.5,
  min_confidence: 80,
  execution_env_preference: "demo",
  default_leverage: 3,
};
