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
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxOpenTrades: number;
  allowedSymbols: string[];
  executionMode: "demo" | "live" | "simulation";
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

  return {
    userId: settings.user_id,
    tradingStyle: settings.trading_style ?? "day",
    riskLevel: riskLevelFromStyle(settings.style),
    minRR: getEffectiveMinRr(settings),
    maxRiskPerTradePct: settings.per_trade_pct,
    maxDailyLossPct: settings.daily_loss_limit_pct,
    maxOpenTrades: settings.max_open_trades,
    allowedSymbols,
    // scalp_execution_mode "paper" maps to simulation; live is live.
    executionMode:
      settings.scalp_execution_mode === "live" ? "live" : "simulation",
  };
}

/** Minimum RR the agent enforces given the profile + session preference. */
export function effectiveMinRr(
  profile: UserTradingProfile | null,
  style?: TradingStyle,
): number {
  const base = profile?.minRR ?? 1;
  // Scalp/day discipline: never below 1.5 unless explicitly educational.
  if (style === "scalp" || style === "day") return Math.max(base, 1.5);
  return Math.max(base, 1);
}
