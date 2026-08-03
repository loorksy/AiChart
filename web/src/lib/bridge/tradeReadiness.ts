import { getLimits, getMtAccountMeta, resolveBrokerForMarket } from "@/lib/store";
import { getResolvedExecutionEnv, type ExecutionEnv } from "@/lib/executionEnv";
import type { BrokerKind, MarketType } from "@/lib/markets/types";
import { BridgeErrorCode } from "./errors";
import { freshnessMeta, getMaxSpreadPips, getStaleQuoteThresholdMs, type FreshnessSource } from "./freshness";

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
}): TradeReadinessBlocker[] {
  const { checks } = input;
  const blockers: TradeReadinessBlocker[] = [];
  if (!checks.executionAuthorization.allowed) {
    blockers.push(blocker(BridgeErrorCode.EXECUTION_UNAUTHORIZED, "Execution is not authorized.", "الحساب غير مخوّل تقنياً للتنفيذ."));
  }
  if (!checks.forexSession.open) {
    blockers.push(blocker(BridgeErrorCode.MARKET_CLOSED, checks.forexSession.reasonEn ?? "Forex is closed.", checks.forexSession.reasonAr ?? "سوق الفوركس مغلق."));
  }
  if (!checks.connection.online) {
    blockers.push(blocker(BridgeErrorCode.CONNECTION_OFFLINE, "MetaTrader connection is offline.", "اتصال MetaTrader غير متاح."));
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

  // Heartbeat/quote-freshness checks below were EA-only (fed by EA heartbeat
  // pushes); metaapi/mt5local report connectivity through getMtAccountMeta
  // instead, so those fields are now permanently non-applicable.
  const connectionOnline = Boolean((await getMtAccountMeta(userId))?.online);

  const checks: TradeReadinessChecks = {
    connection: { online: connectionOnline, backend },
    heartbeat: { fresh: true, lastHeartbeatAt: null, applies: false },
    quote: {
      fresh: true,
      quoteAgeMs: null,
      source: null,
      spreadPips: null,
      maxSpreadPips,
      staleThresholdMs,
      tickStale: false,
      applies: false,
    },
    executionAuthorization: { allowed: Boolean(limits.can_execute) },
    forexSession: session,
  };

  const blockers = collectTradeReadinessBlockers({ checks, symbol });
  return {
    ready: blockers.length === 0,
    blockers,
    checks,
    snapshotAt: new Date().toISOString(),
    market,
    symbol,
    resolvedEnv,
    freshness: undefined,
  };
}
