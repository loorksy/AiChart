import {
  getEaConnection,
  isEaOnlineDebounced,
  parseEaSymbolSpecs,
} from "@/lib/eaStore";
import { getEaLiveQuote } from "@/lib/eaLiveState";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";
import { spreadFromBidAsk } from "@/lib/spread";
import {
  bridgeError,
  BridgeErrorCode,
  type BridgeFailure,
} from "./errors";
import {
  getMaxSpreadPips,
  getStaleQuoteThresholdMs,
  isQuoteFresh,
  type FreshnessSource,
} from "./freshness";

export interface ForexQuoteSnapshot {
  bid: number;
  ask: number;
  quoteAgeMs: number;
  source: FreshnessSource;
}

function heartbeatQuoteAgeMs(lastHeartbeatAt: string | null): number {
  if (!lastHeartbeatAt) return 60_000;
  const iso = lastHeartbeatAt.includes("T")
    ? lastHeartbeatAt
    : `${lastHeartbeatAt.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Date.now() - ms : 60_000;
}

/** Resolves the best available bid/ask for a forex symbol (live push preferred). */
export async function resolveForexQuoteSnapshot(
  userId: number,
  symbol: string,
): Promise<ForexQuoteSnapshot | null> {
  const mt5Symbol = await resolveMt5Symbol(userId, symbol);
  if (!mt5Symbol) return null;

  const live = getEaLiveQuote(userId, mt5Symbol);
  if (live && live.bid > 0 && live.ask > 0) {
    const fresh = isQuoteFresh(live.quoteAgeMs);
    return {
      bid: live.bid,
      ask: live.ask,
      quoteAgeMs: live.quoteAgeMs,
      source: fresh ? "live" : "stale",
    };
  }

  const conn = await getEaConnection(userId);
  if (!conn) return null;
  const target = mt5Symbol.toUpperCase();
  const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
    (s) => s.symbol?.toUpperCase() === target,
  );
  if (!spec) return null;

  const bid = Number(spec.bid) || 0;
  const ask = Number(spec.ask) || 0;
  if (bid <= 0 || ask <= 0) return null;

  return {
    bid,
    ask,
    quoteAgeMs: heartbeatQuoteAgeMs(conn.last_heartbeat_at),
    source: "heartbeat",
  };
}

/** Pure pre-flight evaluation — used by checkForexTradePreflight and tests. */
export function evaluateForexQuoteGate(
  heartbeatFresh: boolean,
  quote: ForexQuoteSnapshot | null,
  symbol: string,
  thresholdMs = getStaleQuoteThresholdMs(),
  maxSpreadPips = getMaxSpreadPips(),
): BridgeFailure | null {
  if (!heartbeatFresh) {
    return bridgeError(
      BridgeErrorCode.EA_OFFLINE,
      "MetaTrader EA is offline or heartbeat expired.",
      "MetaTrader EA غير متصل — لا ننفّذ.",
      { symbol },
    );
  }

  if (!quote) {
    return bridgeError(
      BridgeErrorCode.STALE_QUOTE,
      "No live quote available for symbol.",
      "لا يوجد سعر حي للرمز — لا ننفّذ.",
      { symbol },
    );
  }

  if (!isQuoteFresh(quote.quoteAgeMs, thresholdMs)) {
    return bridgeError(
      BridgeErrorCode.STALE_QUOTE,
      `Quote age ${quote.quoteAgeMs}ms exceeds threshold ${thresholdMs}ms.`,
      `السعر قديم (${quote.quoteAgeMs}ms) — انتظر تحديث الأسعار.`,
      {
        symbol,
        quoteAgeMs: quote.quoteAgeMs,
        staleThresholdMs: thresholdMs,
        source: quote.source,
      },
      { retryAfterMs: 2000 },
    );
  }

  const spread = spreadFromBidAsk(quote.bid, quote.ask, symbol);
  if (spread && spread.spreadPips > maxSpreadPips) {
    return bridgeError(
      BridgeErrorCode.SPREAD_TOO_WIDE,
      `Spread ${spread.spreadPips.toFixed(1)} pips exceeds max ${maxSpreadPips}.`,
      `السبريد واسع (${spread.spreadPips.toFixed(1)} نقطة) — لا ننفّذ.`,
      {
        symbol,
        spreadPips: spread.spreadPips,
        maxSpreadPips,
      },
    );
  }

  return null;
}

/** Pre-flight gate for forex open_trade — rejects before broker execution. */
export async function checkForexTradePreflight(
  userId: number,
  symbol: string,
): Promise<BridgeFailure | null> {
  const conn = await getEaConnection(userId);
  const heartbeatFresh = Boolean(
    conn &&
      conn.status !== "revoked" &&
      isEaOnlineDebounced(userId, conn.last_heartbeat_at),
  );
  const quote = heartbeatFresh
    ? await resolveForexQuoteSnapshot(userId, symbol)
    : null;
  return evaluateForexQuoteGate(heartbeatFresh, quote, symbol);
}
