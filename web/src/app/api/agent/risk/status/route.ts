import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
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
 */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();

    const settings = await getSettings(userId);
    const limits = await getLimits(userId);
    const effectiveCapital =
      limits.max_capital_cap > 0
        ? Math.min(settings.max_capital, limits.max_capital_cap)
        : settings.max_capital;

    return NextResponse.json({
      mode: settings.mode,
      style: settings.style,
      activeMarket: settings.active_market ?? "crypto",
      killSwitch: {
        master: await isMasterKillOn(),
        user: settings.kill_switch === 1,
      },
      capital: {
        effectiveCapital,
        perTradeMaxUsd: (effectiveCapital * settings.per_trade_pct) / 100,
        maxOpenTrades: Math.min(
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
        todayRealizedPnlPct: await todayRealizedPnlPct(
          userId,
          effectiveCapital,
        ),
        todayRealizedPnlUsd: await todayRealizedPnlUsd(userId),
        monthRealizedPnlPct: await monthRealizedPnlPct(
          userId,
          effectiveCapital,
        ),
      },
      allowedAssets: settings.allowed_assets,
      executionEnv: await getExecutionEnvSnapshot(userId),
    });
  } catch (e) {
    return handleError(e);
  }
}
