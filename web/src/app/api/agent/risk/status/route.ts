import { withBridge } from "@/lib/bridge";
import { resolveMaxOpenTrades } from "@/lib/riskLimits";
import { buildAccountProfile } from "@/lib/accountProfile";
import { getExecutionEnvSnapshot } from "@/lib/executionEnv";
import {
  countOpenTrades,
  countPendingIntents,
  getLimits,
  getSettings,
  isMasterKillOn,
  monthRealizedPnlPct,
  todayRealizedPnlPct,
  todayRealizedPnlUsd,
} from "@/lib/store";

/**
 * Bridge: the agent's "pre-flight" view — trading mode, kill switches,
 * capital limits, and realized PnL. The agent must respect these; the Risk
 * Guard enforces them in code anyway.
 *
 * Pilot route for the canonical bridge envelope ({ ok, data, meta }).
 */
export const GET = withBridge(async ({ userId }) => {
  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;

  return {
    mode: settings.mode,
    style: settings.style,
    activeMarket: settings.active_market ?? "crypto",
    // 1 = riskGuard enforced (safe default); 0 = full-autonomous (agent decides).
    riskGuardEnabled: settings.risk_guard_enabled !== 0,
    killSwitch: {
      master: await isMasterKillOn(),
      user: settings.kill_switch === 1,
    },
    capital: {
      effectiveCapital,
      perTradeMaxUsd: (effectiveCapital * settings.per_trade_pct) / 100,
      maxOpenTrades: resolveMaxOpenTrades(
        settings.max_open_trades,
        limits.max_open_trades_cap,
      ),
      dailyLossLimitPct: settings.daily_loss_limit_pct,
      monthlyLossLimitPct: settings.monthly_loss_limit_pct,
      dailyProfitTargetPct: settings.daily_profit_target_pct,
    },
    state: {
      openTrades: await countOpenTrades(userId),
      pendingIntents: await countPendingIntents(userId),
      todayRealizedPnlPct: await todayRealizedPnlPct(userId, effectiveCapital),
      todayRealizedPnlUsd: await todayRealizedPnlUsd(userId),
      monthRealizedPnlPct: await monthRealizedPnlPct(userId, effectiveCapital),
    },
    futures: {
      enabled: Boolean(settings.futures_enabled),
      defaultLeverage: settings.default_leverage ?? 3,
      maxLeverageCap:
        limits.max_leverage_cap && limits.max_leverage_cap > 0
          ? limits.max_leverage_cap
          : 10,
    },
    allowedAssets: settings.allowed_assets,
    executionEnv: await getExecutionEnvSnapshot(userId),
    accountProfile: await buildAccountProfile(userId),
  };
}, { routeKey: "/api/agent/risk/status" });
