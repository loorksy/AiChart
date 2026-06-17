import { getPrice } from "./binance";
import { getEaConnection, isHeartbeatFresh, parseEaSymbolSpecs } from "./eaStore";
import { getResolvedExecutionEnv } from "./executionEnv";
import { validateOpportunity } from "./opportunityCheck";
import { scanForexSymbol, scanSymbol } from "./monitor";
import { evaluateTrade } from "./riskGuard";
import {
  countOpenTrades,
  getIntent,
  getLimits,
  getRecommendation,
  getSettings,
  isMasterKillOn,
  todayRealizedPnlPct,
} from "./store";
import type { TradeIntent } from "./types";

export const APPROVAL_REVALIDATE_AFTER_SEC = 60;
export const APPROVAL_EXPIRE_AFTER_SEC = 30 * 60;

export interface RevalidateSnapshot {
  livePrice: number;
  verdict: string;
  scanScore: number | null;
  scanSignals: string[];
}

export interface RevalidateResult {
  valid: boolean;
  reasonAr: string;
  snapshot: RevalidateSnapshot;
}

function intentAgeSec(createdAt: string): number {
  const t = new Date(createdAt.includes("T") ? createdAt : `${createdAt}Z`);
  return (Date.now() - t.getTime()) / 1000;
}

async function forexLivePrice(
  userId: number,
  symbol: string,
): Promise<number> {
  const conn = await getEaConnection(userId);
  if (!conn || !isHeartbeatFresh(conn.last_heartbeat_at)) return 0;
  const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
    (s) => s.symbol?.toUpperCase() === symbol.toUpperCase(),
  );
  if (!spec) return 0;
  const bid = Number(spec.bid) || 0;
  const ask = Number(spec.ask) || 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return bid || ask || 0;
}

function signalMatchesSide(
  side: "buy" | "sell",
  signals: string[],
): boolean {
  const joined = signals.join(" ");
  const bullish =
    joined.includes("صعود") ||
    joined.includes("بيعي") ||
    joined.includes("صاعد");
  const bearish =
    joined.includes("هبوط") ||
    joined.includes("شرائي") ||
    joined.includes("هابط");
  if (side === "buy") return bullish && !bearish;
  return bearish && !bullish;
}

/** Re-checks a pending intent before late approval (≥60s). */
export async function revalidatePendingIntent(
  userId: number,
  intentId: number,
): Promise<RevalidateResult> {
  const intent = await getIntent(intentId);
  if (!intent || intent.user_id !== userId) {
    return {
      valid: false,
      reasonAr: "الطلب غير موجود.",
      snapshot: { livePrice: 0, verdict: "missing", scanScore: null, scanSignals: [] },
    };
  }

  const ageSec = intentAgeSec(intent.created_at);
  if (ageSec > APPROVAL_EXPIRE_AFTER_SEC) {
    return {
      valid: false,
      reasonAr: "انتهت صلاحية الطلب (أكثر من 30 دقيقة).",
      snapshot: { livePrice: 0, verdict: "expired", scanScore: null, scanSignals: [] },
    };
  }

  let rec = null;
  if (intent.recommendation_id) {
    rec = await getRecommendation(intent.recommendation_id);
  }

  const market = intent.market ?? "crypto";
  let oppCheck = await validateOpportunity({
    symbol: intent.symbol,
    side: intent.side,
    entry: intent.entry,
    stop_loss: intent.stop_loss,
    take_profit: intent.take_profit,
    timeframe: rec?.timeframe ?? "1h",
    created_at: intent.created_at,
    chart_drawings_json: rec?.chart_drawings_json ?? null,
  });

  if (market === "forex") {
    const live = await forexLivePrice(userId, intent.symbol);
    if (live > 0 && intent.entry != null && intent.entry > 0) {
      const slip = 0.001;
      if (
        (intent.side === "buy" && live > intent.entry * (1 + slip)) ||
        (intent.side === "sell" && live < intent.entry * (1 - slip))
      ) {
        oppCheck = {
          verdict: "late_entry",
          livePrice: live,
          messageAr: `السعر ${live} تجاوز نقطة الدخول ${intent.entry}.`,
          canExecute: false,
        };
      } else if (!oppCheck.canExecute && oppCheck.livePrice <= 0) {
        oppCheck = { ...oppCheck, livePrice: live, canExecute: true };
      }
    }
  }

  if (!oppCheck.canExecute) {
    return {
      valid: false,
      reasonAr: oppCheck.messageAr,
      snapshot: {
        livePrice: oppCheck.livePrice,
        verdict: oppCheck.verdict,
        scanScore: null,
        scanSignals: [],
      },
    };
  }

  const settings = await getSettings(userId);
  const interval = settings.analysis_interval ?? "1h";
  const candidate =
    market === "forex"
      ? await scanForexSymbol(userId, intent.symbol, settings.style, interval)
      : await scanSymbol(intent.symbol, settings.style, interval);

  if (candidate && !signalMatchesSide(intent.side, candidate.signals)) {
    return {
      valid: false,
      reasonAr: `انقلبت الإشارات: ${candidate.signals.join(" · ")}`,
      snapshot: {
        livePrice: oppCheck.livePrice,
        verdict: "signals_flipped",
        scanScore: candidate.score,
        scanSignals: candidate.signals,
      },
    };
  }

  const limits = await getLimits(userId);
  const resolvedEnv = await getResolvedExecutionEnv(userId, market);
  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;
  const risk = evaluateTrade(
    settings,
    limits,
    {
      symbol: intent.symbol,
      side: intent.side,
      notional: intent.notional,
      market,
      marketType: intent.market_type,
      leverage: intent.leverage,
      stopLoss: intent.stop_loss,
      confidence: intent.confidence ?? 0,
    },
    {
      masterKill: await isMasterKillOn(),
      openTradesCount: await countOpenTrades(userId),
      todayRealizedPnlPct: await todayRealizedPnlPct(userId, effectiveCapital),
      todayRealizedPnlUsd: 0,
      monthRealizedPnlPct: 0,
      explicitApproval: true,
      practiceMode: intent.practice === 1,
      resolvedEnv,
      envPreference: settings.execution_env_preference === "live" ? "live" : "demo",
    },
  );

  if (!risk.ok) {
    return {
      valid: false,
      reasonAr: risk.reason,
      snapshot: {
        livePrice: oppCheck.livePrice,
        verdict: "risk_denied",
        scanScore: candidate?.score ?? null,
        scanSignals: candidate?.signals ?? [],
      },
    };
  }

  return {
    valid: true,
    reasonAr: "الفرصة ما زالت صالحة.",
    snapshot: {
      livePrice: oppCheck.livePrice,
      verdict: "valid",
      scanScore: candidate?.score ?? null,
      scanSignals: candidate?.signals ?? [],
    },
  };
}

export function shouldRevalidateBeforeApprove(intent: TradeIntent): boolean {
  return intentAgeSec(intent.created_at) >= APPROVAL_REVALIDATE_AFTER_SEC;
}
