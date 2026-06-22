/**
 * Autonomous Scalp Session Engine — an AI AGENT RUNTIME, not a rule bot.
 *
 * cron only TRIGGERS a tick. For each active session the engine:
 *   1. enforces SAFETY guards (auto-stop) — limits, never trade decisions;
 *   2. hands the tick to the AGENT (runAgent) which OBSERVES the market with its
 *      tools, reasons over advisory lenses, and submits ONE decision;
 *   3. carries the agent's decision through executeIntent → Risk Guard.
 *
 * Infrastructure never generates buy/sell. The agent is the decision-maker.
 * Live execution is gated behind SCALP_LIVE_ENABLED (default off) → paper-forced.
 */
import { runAgent } from "./agent";
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
import { deriveDynamicStops } from "./dynamicStops";
import { deriveDynamicNotional } from "./dynamicSizing";
import { evalScalpStop, resolvePracticeMode } from "./scalpGuards";
import type { MarketType } from "./markets/types";
import type { ScalpSession, TradingSettings } from "./types";

export { evalScalpStop } from "./scalpGuards";

/** Live scalp execution stays OFF until the paper loop is verified (phase S6). */
export function scalpLiveEnabled(): boolean {
  return process.env.SCALP_LIVE_ENABLED === "1";
}

export interface ScalpCycleEvent {
  userId: number;
  action: "observed" | "executed" | "skipped" | "stopped";
  detail: string;
}

export interface ScalpCycleResult {
  sessions: number;
  events: ScalpCycleEvent[];
  errors: string[];
}

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

/** The market-context prompt that wakes the agent for one autonomous tick. */
function scalpTickPrompt(session: ScalpSession, settings: TradingSettings): string {
  const market = session.market ?? settings.active_market ?? "crypto";
  const scope = session.symbol
    ? `الرمز المستهدف: ${session.symbol}`
    : `كل أزواج الحساب المسموحة (استخدم get_account_symbols/scan_market لاستكشافها)`;
  return [
    "نبضة جلسة سكالب ذاتية — راقب السوق وقرّر.",
    `السوق: ${market} · الإطار: ${session.interval} · الأسلوب: ${settings.style}`,
    scope,
    `صفقات الجلسة: ${session.executed_count}/${session.max_trades} · الوضع: ${session.execution_mode}`,
    "لاحظ بأدواتك، فكّر عبر زوايا المستشارين، وقرّر: ادخل بأفضل فرصة عالية الاحتمال (submit_scalp_decision action=enter) أو انتظر (action=wait). الجودة قبل الكمّية.",
  ].join("\n");
}

/** Run one autonomous scalp tick for every active session. */
export async function runScalpCycle(): Promise<ScalpCycleResult> {
  const result: ScalpCycleResult = { sessions: 0, events: [], errors: [] };
  const sessions = await listActiveScalpSessions();
  result.sessions = sessions.length;

  for (const session of sessions) {
    const userId = session.user_id;
    try {
      const settings = await getSettings(userId);

      // 1) SAFETY guards — auto-stop (not a trade decision).
      const stop = await sessionStopReason(session, settings);
      if (stop) {
        await stopScalpSession(userId, stop);
        await logAudit(userId, "scalp_auto_stop", stop);
        result.events.push({ userId, action: "stopped", detail: stop });
        continue;
      }
      if ((await countOpenTrades(userId)) >= settings.max_open_trades) {
        result.events.push({
          userId,
          action: "skipped",
          detail: "بلغ سقف الصفقات المفتوحة — انتظار إغلاق",
        });
        continue;
      }

      // 2) AGENT RUNTIME — the agent observes + reasons + decides.
      const agentRes = await runAgent(
        { userId, settings },
        [{ role: "user", content: scalpTickPrompt(session, settings) }],
        { scalpMode: true },
      );
      const decision = agentRes.scalpDecision;

      if (
        !decision ||
        decision.action !== "enter" ||
        !decision.symbol ||
        (decision.side !== "buy" && decision.side !== "sell")
      ) {
        result.events.push({
          userId,
          action: "observed",
          detail: `قرار الوكيل: انتظار — ${decision?.rationale_ar ?? agentRes.reply.slice(0, 80)}`,
        });
        continue;
      }

      // 3) Carry the AGENT's decision to Risk Guard. SL/TP/size come from the
      // agent's reasoning; fall back to adaptive derivation only if it omitted.
      const market = (session.market ?? settings.active_market ?? "crypto") as MarketType;
      const side = decision.side;
      const confidence = Math.max(0, Math.min(100, decision.confidence ?? 60));
      const practiceMode = resolvePracticeMode(
        session.execution_mode,
        scalpLiveEnabled(),
      );
      const entry = decision.entry && decision.entry > 0 ? decision.entry : 0;

      let stopLoss = decision.stop_loss ?? null;
      let takeProfit = decision.take_profit ?? null;
      let riskFraction = 0.01;
      if ((stopLoss == null || takeProfit == null) && entry > 0) {
        const d = deriveDynamicStops({
          entry,
          side,
          style: settings.style,
          confidence,
          atr: null,
        });
        if (d) {
          stopLoss = stopLoss ?? d.stopLoss;
          takeProfit = takeProfit ?? d.takeProfit;
          riskFraction = d.riskFraction;
        }
      }

      const notional =
        decision.notional && decision.notional > 0
          ? Math.min(decision.notional, session.notional * 1.5)
          : deriveDynamicNotional({
              baseNotional: session.notional,
              confidence,
              riskFraction,
              maxNotional: session.notional * 1.5,
            });

      const intent = await createIntent(userId, {
        symbol: decision.symbol,
        side,
        notional,
        market,
        entry: entry > 0 ? entry : null,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        confidence,
        rationale: `سكالب ذاتي (قرار الوكيل، ثقة ${confidence}%): ${decision.rationale_ar ?? ""}`,
        status: "approved",
        practice: practiceMode,
      });

      const exec = await executeIntent(userId, intent.id, {
        explicitApproval: true,
        practiceMode,
      });

      if (exec.ok) {
        await incrementScalpExecuted(userId);
        await logAudit(
          userId,
          "scalp_execute",
          `${decision.symbol} ${side} ${practiceMode ? "paper" : "live"} conf=${confidence}`,
        );
        result.events.push({
          userId,
          action: "executed",
          detail: `${decision.symbol} ${side} (${practiceMode ? "paper" : "live"})`,
        });
      } else {
        await logAudit(
          userId,
          "scalp_execute_denied",
          `${decision.symbol} ${side}: ${exec.reason}`,
        );
        result.events.push({
          userId,
          action: "skipped",
          detail: `${decision.symbol}: مرفوض من Risk Guard (${exec.reason})`,
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
