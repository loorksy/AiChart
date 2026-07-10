/**
 * User trading profile — projected from the existing `trading_settings` +
 * `admin_limits` (no new table) so the Risk Agent and Execution Guard read
 * one coherent shape. This deliberately reuses persisted settings rather than
 * duplicating them.
 */
import type { TradingSettings, TradingStyle } from "@/lib/types";
import { getEffectiveMinRr } from "@/lib/riskGuard";

export interface UserTradingProfile {
  userId: number;
  tradingStyle: TradingStyle;
  riskLevel: "low" | "medium" | "high";
  minRR: number;
  /** % of capital risked per trade. */
  riskPerTradePct: number;
  /** @deprecated alias of riskPerTradePct, kept for existing readers. */
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxOpenTrades: number;
  /** Max concurrent trades on ONE symbol (0 = no per-symbol cap). */
  maxOpenTradesPerSymbol: number;
  allowedSymbols: string[];
  /** Directions the user allows (both by default). */
  allowedDirections: Array<"buy" | "sell">;
  /** Execution authority: manual approval, semi-auto, or full-auto. */
  tradingMode: "manual" | "semi_auto" | "full_auto";
  /** Live accounts get stricter gates than demo/simulation. */
  accountMode: "demo" | "live";
  executionMode: "demo" | "live" | "simulation";
  preferMinimalDrawings: boolean;
  educationalOnly: boolean;
}

function riskLevelFromStyle(
  style: TradingSettings["style"],
): "low" | "medium" | "high" {
  if (style === "aggressive") return "high";
  if (style === "balanced") return "medium";
  return "low";
}

export function buildUserTradingProfile(
  settings: TradingSettings,
): UserTradingProfile {
  let allowedSymbols: string[] = [];
  try {
    const parsed = JSON.parse(settings.allowed_assets || "[]");
    if (Array.isArray(parsed)) allowedSymbols = parsed.map(String);
  } catch {
    allowedSymbols = [];
  }

  const executionMode: UserTradingProfile["executionMode"] =
    settings.scalp_execution_mode === "live" ? "live" : "simulation";

  // Execution authority from `mode`: direct = full auto (requires platform
  // permission at execution time), approval = semi-auto, else manual.
  const tradingMode: UserTradingProfile["tradingMode"] =
    settings.mode === "auto" || settings.mode === "direct"
      ? "full_auto"
      : settings.mode === "approval"
        ? "semi_auto"
        : "manual";

  return {
    userId: settings.user_id,
    tradingStyle: settings.trading_style ?? "day",
    riskLevel: riskLevelFromStyle(settings.style),
    minRR: getEffectiveMinRr(settings),
    riskPerTradePct: settings.per_trade_pct,
    maxRiskPerTradePct: settings.per_trade_pct,
    maxDailyLossPct: settings.daily_loss_limit_pct,
    maxOpenTrades: settings.max_open_trades,
    maxOpenTradesPerSymbol: settings.scalp_max_trades || 0,
    allowedSymbols,
    allowedDirections: ["buy", "sell"],
    tradingMode,
    accountMode: executionMode === "live" ? "live" : "demo",
    executionMode,
    preferMinimalDrawings: false,
    educationalOnly: false,
  };
}

/** Live accounts are stricter: higher min RR floor + tighter caution. */
export function liveModeMinRrFloor(profile: UserTradingProfile | null): number {
  return profile?.accountMode === "live" ? 1.8 : 1.5;
}

/** Minimum RR the agent enforces given the profile + session preference. */
export function effectiveMinRr(
  profile: UserTradingProfile | null,
  style?: TradingStyle,
): number {
  const base = profile?.minRR ?? 1;
  // Scalp/day discipline: never below 1.8 for real recommendations.
  if (style === "scalp" || style === "day") return Math.max(base, 1.8);
  return Math.max(base, 1);
}
