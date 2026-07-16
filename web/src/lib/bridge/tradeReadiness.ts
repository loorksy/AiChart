import { getLimits, getMtAccountMeta, resolveBrokerForMarket } from "@/lib/store";
import { getEaConnection, getEaOnlineState, isEaOnlineDebounced } from "@/lib/eaStore";
import { getEaQuoteTickMetrics } from "@/lib/eaQuoteMetrics";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";
import { getResolvedExecutionEnv, type ExecutionEnv } from "@/lib/executionEnv";
import { spreadFromBidAsk } from "@/lib/spread";
import type { BrokerKind, MarketType } from "@/lib/markets/types";
import { BridgeErrorCode } from "./errors";
import { freshnessMeta, getMaxSpreadPips, getStaleQuoteThresholdMs, isQuoteFresh, type FreshnessSource } from "./freshness";
import { evaluateForexQuoteGate, resolveForexQuoteSnapshot } from "./forexPreflight";
import { isForexSymbol } from "@/lib/eaLiveState";

export interface TradeReadinessBlocker {
  code: BridgeErrorCode;
  message: string;
  message_ar: string;
}

export interface TradeReadinessChecks {
  connection: { online: boolean; backend: BrokerKind };
  heartbeat: { fresh: boolean; lastHeartbeatAt: string | null; applies: boolean };
  quote: {
    fresh: boolean;
    quoteAgeMs: number | null;
    source: FreshnessSource | null;
    spreadPips: number | null;
    maxSpreadPips: number;
    staleThresholdMs: number;
    tickStale: boolean;
    applies: boolean;
  };
  executionAuthorization: { allowed: boolean };
  forexSession: { open: boolean; reasonEn?: string; reasonAr?: string };
}

export interface TradeReadinessResult {
  ready: boolean;
  blockers: TradeReadinessBlocker[];
  checks: TradeReadinessChecks;
  snapshotAt: string;
  market: MarketType;
  symbol: string | null;
  resolvedEnv: ExecutionEnv | null;
  freshness?: ReturnType<typeof freshnessMeta>;
}

export interface BuildTradeReadinessInput {
  userId: number;
  symbol?: string | null;
  market?: MarketType;
  practiceMode?: boolean;
}

function blocker(code: BridgeErrorCode, message: string, message_ar: string): TradeReadinessBlocker {
  return { code, message, message_ar };
}

export function isForexSessionOpen(now = new Date()) {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 6 || (day === 0 && hour < 22) || (day === 5 && hour >= 22)) {
    return {
      open: false,
      reasonEn: "Forex market is closed for the weekend.",
      reasonAr: "سوق الفوركس مغلق في عطلة نهاية الأسبوع.",
    };
  }
  return { open: true };
}

export function collectTradeReadinessBlockers(input: {
  checks: TradeReadinessChecks;
  symbol: string | null;
  forexQuoteGateFailure: ReturnType<typeof evaluateForexQuoteGate>;
}): TradeReadinessBlocker[] {
  const { checks, symbol, forexQuoteGateFailure } = input;
  const blockers: TradeReadinessBlocker[] = [];
  if (!checks.executionAuthorization.allowed) {
    blockers.push(blocker(BridgeErrorCode.EXECUTION_UNAUTHORIZED, "Execution is not authorized.", "الحساب غير مخوّل تقنياً للتنفيذ."));
  }
  if (!checks.forexSession.open) {
    blockers.push(blocker(BridgeErrorCode.MARKET_CLOSED, checks.forexSession.reasonEn ?? "Forex is closed.", checks.forexSession.reasonAr ?? "سوق الفوركس مغلق."));
  }
  if (!checks.connection.online) {
    blockers.push(blocker(BridgeErrorCode.EA_OFFLINE, "MetaTrader connection is offline.", "اتصال MetaTrader غير متاح."));
  }
  if (checks.heartbeat.applies && !checks.heartbeat.fresh) {
    blockers.push(blocker(BridgeErrorCode.EA_OFFLINE, "EA heartbeat is stale.", "نبض EA غير حديث."));
  }
  if (symbol && checks.quote.applies && checks.quote.tickStale) {
    blockers.push(blocker(BridgeErrorCode.MARKET_CLOSED, "The latest broker tick is stale.", "آخر tick من الوسيط قديم؛ لم يُرسل أي أمر."));
  }
  if (symbol && forexQuoteGateFailure) {
    blockers.push(blocker(
      forexQuoteGateFailure.error.code as BridgeErrorCode,
      forexQuoteGateFailure.error.message,
      forexQuoteGateFailure.error.message_ar ?? forexQuoteGateFailure.error.message,
    ));
  }
  return blockers;
}

/** Technical preflight only: auth, connectivity, session, quote freshness/spread. */
export async function buildTradeReadiness(input: BuildTradeReadinessInput): Promise<TradeReadinessResult> {
  const { userId } = input;
  const limits = await getLimits(userId);
  const market = input.market ?? "forex";
  const symbol = input.symbol?.trim().toUpperCase() || null;
  const backend = await resolveBrokerForMarket(userId, market);
  const resolvedEnv = await getResolvedExecutionEnv(userId, market);
  const session = isForexSessionOpen();
  const staleThresholdMs = getStaleQuoteThresholdMs();
  const maxSpreadPips = getMaxSpreadPips();

  let connectionOnline = false;
  let heartbeatFresh = true;
  let lastHeartbeatAt: string | null = null;
  let quoteFresh = true;
  let quoteAgeMs: number | null = null;
  let quoteSource: FreshnessSource | null = null;
  let spreadPips: number | null = null;
  let tickStale = false;
  let quoteSnapshot: Awaited<ReturnType<typeof resolveForexQuoteSnapshot>> = null;

  if (backend === "mt_ea") {
    const connection = await getEaConnection(userId);
    lastHeartbeatAt = connection?.last_heartbeat_at ?? null;
    const onlineState = getEaOnlineState(userId, lastHeartbeatAt);
    connectionOnline = onlineState.online;
    heartbeatFresh = Boolean(connection && connection.status !== "revoked" && isEaOnlineDebounced(userId, lastHeartbeatAt));
    if (symbol && heartbeatFresh) {
      quoteSnapshot = await resolveForexQuoteSnapshot(userId, symbol);
      if (quoteSnapshot) {
        quoteAgeMs = quoteSnapshot.quoteAgeMs;
        quoteSource = quoteSnapshot.source;
        quoteFresh = isQuoteFresh(quoteAgeMs, staleThresholdMs);
        spreadPips = spreadFromBidAsk(quoteSnapshot.bid, quoteSnapshot.ask, symbol)?.spreadPips ?? null;
        if (quoteSnapshot.tickTime && isForexSymbol(symbol)) {
          const threshold = Number(process.env.FOREX_TICK_STALE_MS) > 0 ? Number(process.env.FOREX_TICK_STALE_MS) : 120_000;
          tickStale = Date.now() - quoteSnapshot.tickTime * 1000 > threshold;
          if (tickStale) quoteFresh = false;
        }
      } else {
        quoteFresh = false;
      }
    } else if (symbol) {
      quoteFresh = false;
    }
  } else {
    connectionOnline = Boolean((await getMtAccountMeta(userId))?.online);
  }

  const checks: TradeReadinessChecks = {
    connection: { online: connectionOnline, backend },
    heartbeat: { fresh: heartbeatFresh, lastHeartbeatAt, applies: backend === "mt_ea" },
    quote: { fresh: quoteFresh, quoteAgeMs, source: quoteSource, spreadPips, maxSpreadPips, staleThresholdMs, tickStale, applies: backend === "mt_ea" && Boolean(symbol) },
    executionAuthorization: { allowed: Boolean(limits.can_execute) },
    forexSession: session,
  };

  let lastQuoteGapMs: number | null = null;
  if (symbol && backend === "mt_ea") {
    const mt5Symbol = await resolveMt5Symbol(userId, symbol);
    const metrics = mt5Symbol ? getEaQuoteTickMetrics(userId, mt5Symbol) : null;
    lastQuoteGapMs = metrics && !Array.isArray(metrics) ? metrics.lastTickGapMs : null;
  }
  const quoteFailure = symbol && heartbeatFresh && backend === "mt_ea"
    ? evaluateForexQuoteGate(heartbeatFresh, quoteSnapshot, symbol, staleThresholdMs, maxSpreadPips, lastQuoteGapMs)
    : null;
  const blockers = collectTradeReadinessBlockers({ checks, symbol, forexQuoteGateFailure: quoteFailure });
  return {
    ready: blockers.length === 0,
    blockers,
    checks,
    snapshotAt: new Date().toISOString(),
    market,
    symbol,
    resolvedEnv,
    freshness: symbol && quoteAgeMs !== null && quoteSource ? freshnessMeta(quoteSource, quoteAgeMs, staleThresholdMs) : undefined,
  };
}
