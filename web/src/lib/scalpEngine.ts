/**
 * Autonomous Scalp Session Engine.
 *
 * One cron tick = `runScalpCycle()`. For every ACTIVE scalp session it runs:
 *   guards (auto-stop) → manage → scan → decide → size/stops → execute → log.
 * Execution ALWAYS flows through `executeIntent` → Risk Guard. The session is
 * the standing approval (no per-trade confirmation), but no safety is bypassed.
 *
 * Live execution is gated behind SCALP_LIVE_ENABLED (default off) until the
 * paper loop is verified end-to-end (plan phase S6). Until then every entry runs
 * in practiceMode regardless of the session's chosen mode.
 */
import { executeIntent } from "./execution";
import {
  countOpenTrades,
  createIntent,
  getLimits,
  getSettings,
  incrementScalpExecuted,
  isMasterKillOn,
  listActiveScalpSessions,
  logAudit,
  stopScalpSession,
  todayRealizedPnlPct,
} from "./store";
import { getEaConnection, isHeartbeatFresh } from "./eaStore";
import { resolveScanAssetsForMarket } from "./allowedAssets";
import { scanForexSymbol, scanSymbol, type OpportunityCandidate } from "./monitor";
import type { MarketType } from "./markets/types";
import type { ScalpSession, TradingSettings } from "./types";

/** Live scalp execution stays OFF until the paper loop is verified (phase S6). */
export function scalpLiveEnabled(): boolean {
  return process.env.SCALP_LIVE_ENABLED === "1";
}

export interface ScalpCycleEvent {
  userId: number;
  action: "scanned" | "executed" | "skipped" | "stopped";
  detail: string;
}

export interface ScalpCycleResult {
  sessions: number;
  events: ScalpCycleEvent[];
  errors: string[];
}

/** Minimum opportunity score to act — quality over count. */
function scalpScoreThreshold(settings: TradingSettings): number {
  if (settings.style === "conservative") return 4;
  if (settings.style === "balanced") return 3;
  return 2;
}

/** Direction from snapshot trend; null when no clear bias (→ keep scanning). */
function sideFromSnapshot(snap: OpportunityCandidate["snapshot"]): "buy" | "sell" | null {
  const trend = snap.trend;
  if (trend === "uptrend") return "buy";
  if (trend === "downtrend") return "sell";
  return null;
}

/**
 * PURE auto-stop decision (unit-tested). Returns a stop reason or null.
 * Order = priority: kill switch > cap > daily loss > broker.
 */
export function evalScalpStop(inputs: {
  masterKill: boolean;
  executedCount: number;
  maxTrades: number;
  dailyLossLimitPct: number;
  todayPnlPct: number;
  market: MarketType;
  brokerConnected: boolean;
}): string | null {
  if (inputs.masterKill) return "master_kill";
  if (inputs.executedCount >= inputs.maxTrades) return "max_trades_reached";
  if (
    inputs.dailyLossLimitPct > 0 &&
    inputs.todayPnlPct <= -Math.abs(inputs.dailyLossLimitPct)
  ) {
    return "daily_loss_limit";
  }
  if (inputs.market === "forex" && !inputs.brokerConnected) {
    return "broker_disconnected";
  }
  return null;
}

/** Gathers live inputs and runs the pure auto-stop decision. */
async function sessionStopReason(
  session: ScalpSession,
  settings: TradingSettings,
): Promise<string | null> {
  const market = (session.market ?? settings.active_market ?? "crypto") as MarketType;

  const limitPct = settings.daily_loss_limit_pct ?? 0;
  let todayPnlPct = 0;
  if (limitPct > 0) {
    const limits = await getLimits(session.user_id);
    const effectiveCapital =
      limits.max_capital_cap > 0
        ? Math.min(settings.max_capital, limits.max_capital_cap)
        : settings.max_capital;
    todayPnlPct = await todayRealizedPnlPct(session.user_id, effectiveCapital);
  }

  let brokerConnected = true;
  if (market === "forex") {
    const conn = await getEaConnection(session.user_id);
    brokerConnected = Boolean(conn && isHeartbeatFresh(conn.last_heartbeat_at));
  }

  return evalScalpStop({
    masterKill: await isMasterKillOn(),
    executedCount: session.executed_count,
    maxTrades: session.max_trades,
    dailyLossLimitPct: limitPct,
    todayPnlPct,
    market,
    brokerConnected,
  });
}

/** Best opportunity for a session across its symbol or allowed assets. */
async function bestOpportunity(
  session: ScalpSession,
  settings: TradingSettings,
): Promise<OpportunityCandidate | null> {
  const market = (session.market ?? settings.active_market ?? "crypto") as MarketType;
  const interval = session.interval || settings.analysis_interval || "1m";
  const symbols = session.symbol
    ? [session.symbol]
    : await resolveScanAssetsForMarket(settings.allowed_assets, market, 25);

  let best: OpportunityCandidate | null = null;
  for (const symbol of symbols) {
    try {
      const c =
        market === "forex"
          ? await scanForexSymbol(session.user_id, symbol, settings.style, interval)
          : await scanSymbol(symbol, settings.style, interval);
      if (c && (!best || c.score > best.score)) best = c;
    } catch {
      /* skip symbol */
    }
  }
  return best;
}

/** Run one autonomous scalp cycle for every active session. */
export async function runScalpCycle(): Promise<ScalpCycleResult> {
  const result: ScalpCycleResult = { sessions: 0, events: [], errors: [] };
  const sessions = await listActiveScalpSessions();
  result.sessions = sessions.length;

  for (const session of sessions) {
    const userId = session.user_id;
    try {
      const settings = await getSettings(userId);

      // 1) Guards — auto-stop on any violation.
      const stop = await sessionStopReason(session, settings);
      if (stop) {
        await stopScalpSession(userId, stop);
        await logAudit(userId, "scalp_auto_stop", stop);
        result.events.push({ userId, action: "stopped", detail: stop });
        continue;
      }

      // 2) Scan for the best opportunity (quality over count).
      const candidate = await bestOpportunity(session, settings);
      if (!candidate || candidate.score < scalpScoreThreshold(settings)) {
        result.events.push({
          userId,
          action: "scanned",
          detail: candidate
            ? `أفضل مرشّح ${candidate.symbol} نقاط ${candidate.score} — دون العتبة`
            : "لا فرصة مؤهّلة — استمرار المسح",
        });
        continue;
      }

      const side = sideFromSnapshot(candidate.snapshot);
      if (!side) {
        result.events.push({
          userId,
          action: "skipped",
          detail: `${candidate.symbol}: اتجاه غير واضح`,
        });
        continue;
      }

      // Avoid stacking beyond account open-trade capacity.
      if ((await countOpenTrades(userId)) >= settings.max_open_trades) {
        result.events.push({
          userId,
          action: "skipped",
          detail: "بلغ سقف الصفقات المفتوحة — انتظار إغلاق",
        });
        continue;
      }

      // 3) Build intent. (Dynamic sizing + adaptive SL/TP arrive in phase S4;
      // for now use the session notional and leave stops to the broker layer.)
      const market = (session.market ?? settings.active_market ?? "crypto") as MarketType;
      const confidence = Math.min(100, candidate.score * 20);
      const practiceMode =
        session.execution_mode !== "live" || !scalpLiveEnabled();

      const intent = await createIntent(userId, {
        symbol: candidate.symbol,
        side,
        notional: session.notional,
        market,
        confidence,
        rationale: `سكالب ذاتي: ${candidate.signals.join("، ")}`,
        status: "approved",
        practice: practiceMode,
      });

      // 4) Execute — Risk Guard is the authority; session = standing approval.
      const exec = await executeIntent(userId, intent.id, {
        explicitApproval: true,
        practiceMode,
      });

      if (exec.ok) {
        await incrementScalpExecuted(userId);
        await logAudit(
          userId,
          "scalp_execute",
          `${candidate.symbol} ${side} ${practiceMode ? "paper" : "live"} score=${candidate.score}`,
        );
        result.events.push({
          userId,
          action: "executed",
          detail: `${candidate.symbol} ${side} (${practiceMode ? "paper" : "live"})`,
        });
      } else {
        await logAudit(
          userId,
          "scalp_execute_denied",
          `${candidate.symbol} ${side}: ${exec.reason}`,
        );
        result.events.push({
          userId,
          action: "skipped",
          detail: `${candidate.symbol}: مرفوض (${exec.reason})`,
        });
      }
    } catch (e) {
      result.errors.push(
        `user ${userId}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  return result;
}
