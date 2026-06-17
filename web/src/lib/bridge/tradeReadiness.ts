import {
  getEffectiveMinConfidence,
  type RiskContext,
} from "@/lib/riskGuard";
import {
  countOpenTrades,
  getLimits,
  getSettings,
  isMasterKillOn,
  monthRealizedPnlPct,
  todayRealizedPnlPct,
} from "@/lib/store";
import {
  getEaConnection,
  getEaOnlineState,
  isEaOnlineDebounced,
} from "@/lib/eaStore";
import {
  getResolvedExecutionEnv,
  type ExecutionEnv,
} from "@/lib/executionEnv";
import { spreadFromBidAsk } from "@/lib/spread";
import type { MarketType } from "@/lib/markets/types";
import type { TradingSettings } from "@/lib/types";
import { BridgeErrorCode } from "./errors";
import {
  freshnessMeta,
  getMaxSpreadPips,
  getStaleQuoteThresholdMs,
  isQuoteFresh,
  type FreshnessSource,
} from "./freshness";
import {
  evaluateForexQuoteGate,
  resolveForexQuoteSnapshot,
} from "./forexPreflight";

export interface ConfidenceGateCheck {
  minConfidence: number;
  tradeConfidence?: number;
  passes: boolean;
}

/** Phase 3 helper — pre-flight confidence gate for get_trade_readiness. */
export function confidenceGateCheck(
  settings: TradingSettings,
  ctx: Pick<RiskContext, "practiceMode" | "resolvedEnv">,
  tradeConfidence?: number,
): ConfidenceGateCheck {
  const minConfidence = getEffectiveMinConfidence(settings, ctx);
  if (tradeConfidence === undefined) {
    return { minConfidence, passes: true };
  }
  return {
    minConfidence,
    tradeConfidence,
    passes: tradeConfidence >= minConfidence,
  };
}

export const DEFAULT_MIN_CONFIDENCE = 80;

export interface TradeReadinessBlocker {
  code: BridgeErrorCode;
  message: string;
  message_ar: string;
}

export interface TradeReadinessChecks {
  eaOnline: {
    online: boolean;
    missedHeartbeats: number;
    settledOnlineSeconds: number;
    applies: boolean;
  };
  heartbeat: {
    fresh: boolean;
    lastHeartbeatAt: string | null;
    applies: boolean;
  };
  quote: {
    fresh: boolean;
    quoteAgeMs: number | null;
    source: FreshnessSource | null;
    spreadPips: number | null;
    maxSpreadPips: number;
    staleThresholdMs: number;
    applies: boolean;
  };
  killSwitch: {
    master: boolean;
    user: boolean;
    passes: boolean;
  };
  canExecute: {
    allowed: boolean;
  };
  openTrades: {
    count: number;
    max: number;
    passes: boolean;
  };
  dailyLoss: {
    todayPnlPct: number;
    limitPct: number;
    passes: boolean;
  };
  monthlyLoss: {
    monthPnlPct: number;
    limitPct: number;
    passes: boolean;
  };
  forexSession: {
    open: boolean;
    applies: boolean;
    reasonEn?: string;
    reasonAr?: string;
  };
  confidenceGate: ConfidenceGateCheck;
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
  confidence?: number;
  practiceMode?: boolean;
}

function blocker(
  code: BridgeErrorCode,
  message: string,
  message_ar: string,
): TradeReadinessBlocker {
  return { code, message, message_ar };
}

/** Approximate FX session: closed Sat UTC; Sun before 22:00 UTC; Fri after 22:00 UTC. */
export function isForexSessionOpen(now = new Date()): {
  open: boolean;
  reasonEn?: string;
  reasonAr?: string;
} {
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();

  if (utcDay === 6) {
    return {
      open: false,
      reasonEn: "Forex weekend (Saturday UTC).",
      reasonAr: "سوق الفوركس مغلق (السبت).",
    };
  }
  if (utcDay === 0 && utcHour < 22) {
    return {
      open: false,
      reasonEn: "Forex opens ~22:00 UTC Sunday.",
      reasonAr: "سوق الفوركس يفتح ~22:00 UTC يوم الأحد.",
    };
  }
  if (utcDay === 5 && utcHour >= 22) {
    return {
      open: false,
      reasonEn: "Forex closed after ~22:00 UTC Friday.",
      reasonAr: "سوق الفوركس مغلق بعد ~22:00 UTC يوم الجمعة.",
    };
  }
  return { open: true };
}

export interface CollectBlockersInput {
  checks: TradeReadinessChecks;
  forexApplies: boolean;
  symbol: string | null;
  heartbeatFresh: boolean;
  eaOnline: boolean;
  forexQuoteGateFailure: ReturnType<typeof evaluateForexQuoteGate>;
  openCount: number;
  maxOpen: number;
  dailyLossLimitPct: number;
  monthlyLossLimitPct: number;
}

/** Pure blocker aggregation — unit-testable without DB mocks. */
export function collectTradeReadinessBlockers(
  input: CollectBlockersInput,
): TradeReadinessBlocker[] {
  const {
    checks,
    forexApplies,
    symbol,
    heartbeatFresh,
    eaOnline,
    forexQuoteGateFailure,
    openCount,
    maxOpen,
    dailyLossLimitPct,
    monthlyLossLimitPct,
  } = input;
  const blockers: TradeReadinessBlocker[] = [];

  if (checks.killSwitch.master) {
    blockers.push(
      blocker(
        BridgeErrorCode.RISK_LIMIT_EXCEEDED,
        "Platform master kill switch is active.",
        "التداول موقوف على مستوى المنصة (إيقاف طارئ).",
      ),
    );
  }
  if (checks.killSwitch.user) {
    blockers.push(
      blocker(
        BridgeErrorCode.RISK_LIMIT_EXCEEDED,
        "Account kill switch is enabled.",
        "الإيقاف الطارئ مفعّل في حسابك.",
      ),
    );
  }
  if (!checks.canExecute.allowed) {
    blockers.push(
      blocker(
        BridgeErrorCode.RISK_LIMIT_EXCEEDED,
        "Auto execution is disabled by admin.",
        "التنفيذ التلقائي غير مصرّح به من الإدارة.",
      ),
    );
  }
  if (!checks.openTrades.passes) {
    blockers.push(
      blocker(
        BridgeErrorCode.RISK_LIMIT_EXCEEDED,
        `Open trades (${openCount}) at max (${maxOpen}).`,
        `بلغت الحد الأقصى للصفقات المفتوحة (${maxOpen}).`,
      ),
    );
  }
  if (!checks.dailyLoss.passes) {
    blockers.push(
      blocker(
        BridgeErrorCode.RISK_LIMIT_EXCEEDED,
        `Daily loss limit reached (${dailyLossLimitPct}%).`,
        `بلغت حد الخسارة اليومي (−${dailyLossLimitPct}%).`,
      ),
    );
  }
  if (!checks.monthlyLoss.passes) {
    blockers.push(
      blocker(
        BridgeErrorCode.RISK_LIMIT_EXCEEDED,
        `Monthly loss limit reached (${monthlyLossLimitPct}%).`,
        `بلغت حد الخسارة الشهري (−${monthlyLossLimitPct}%).`,
      ),
    );
  }

  const { confidenceGate } = checks;
  if (!confidenceGate.passes && confidenceGate.tradeConfidence !== undefined) {
    blockers.push(
      blocker(
        BridgeErrorCode.LOW_CONFIDENCE,
        `Trade confidence ${confidenceGate.tradeConfidence}% below minimum ${confidenceGate.minConfidence}%.`,
        `الثقة ${confidenceGate.tradeConfidence}% أقل من الحد ${confidenceGate.minConfidence}% — انتظر فرصة أوضح.`,
      ),
    );
  }

  if (forexApplies) {
    if (!checks.forexSession.open) {
      blockers.push(
        blocker(
          BridgeErrorCode.MARKET_CLOSED,
          checks.forexSession.reasonEn ?? "Forex market is closed.",
          checks.forexSession.reasonAr ?? "سوق الفوركس مغلق.",
        ),
      );
    }

    if (!eaOnline) {
      blockers.push(
        blocker(
          BridgeErrorCode.EA_OFFLINE,
          "MetaTrader EA is offline (debounced).",
          "MetaTrader EA غير متصل — لا ننفّذ.",
        ),
      );
    }

    if (!heartbeatFresh) {
      blockers.push(
        blocker(
          BridgeErrorCode.EA_OFFLINE,
          "EA heartbeat is not fresh.",
          "نبض EA غير حديث — تحقق من الاتصال.",
        ),
      );
    }

    if (symbol && heartbeatFresh && forexQuoteGateFailure) {
      blockers.push(
        blocker(
          forexQuoteGateFailure.error.code as BridgeErrorCode,
          forexQuoteGateFailure.error.message,
          forexQuoteGateFailure.error.message_ar ?? forexQuoteGateFailure.error.message,
        ),
      );
    }
  }

  return blockers;
}

/** Aggregates pre-flight gates for MCP get_trade_readiness and agent pre-checks. */
export async function buildTradeReadiness(
  input: BuildTradeReadinessInput,
): Promise<TradeReadinessResult> {
  const userId = input.userId;
  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  const market = input.market ?? settings.active_market ?? "crypto";
  const symbol = input.symbol?.trim().toUpperCase() || null;
  const resolvedEnv = await getResolvedExecutionEnv(userId, market);
  const riskCtx: Pick<RiskContext, "practiceMode" | "resolvedEnv"> = {
    practiceMode: input.practiceMode === true,
    resolvedEnv,
  };

  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;
  const maxOpen = Math.min(settings.max_open_trades, limits.max_open_trades_cap);
  const openCount = await countOpenTrades(userId);
  const todayPnlPct = await todayRealizedPnlPct(userId, effectiveCapital);
  const monthPnlPct = await monthRealizedPnlPct(userId, effectiveCapital);

  const masterKill = await isMasterKillOn();
  const userKill = settings.kill_switch === 1;
  const killPasses = !masterKill && !userKill;

  const dailyLossPasses =
    settings.daily_loss_limit_pct <= 0 ||
    todayPnlPct > -settings.daily_loss_limit_pct;
  const monthlyLossPasses =
    settings.monthly_loss_limit_pct <= 0 ||
    monthPnlPct > -settings.monthly_loss_limit_pct;

  const openTradesPasses = openCount < maxOpen;
  const canExecuteAllowed = limits.can_execute === 1;

  const confidenceGate = confidenceGateCheck(
    settings,
    riskCtx,
    input.confidence,
  );

  const forexApplies = market === "forex";
  const session = isForexSessionOpen();

  let eaOnline = {
    online: false,
    missedHeartbeats: 0,
    settledOnlineSeconds: 0,
  };
  let heartbeatFresh = false;
  let lastHeartbeatAt: string | null = null;

  let quoteFresh = true;
  let quoteAgeMs: number | null = null;
  let quoteSource: FreshnessSource | null = null;
  let spreadPips: number | null = null;
  let forexQuote: Awaited<ReturnType<typeof resolveForexQuoteSnapshot>> = null;
  const staleThresholdMs = getStaleQuoteThresholdMs();
  const maxSpreadPips = getMaxSpreadPips();

  if (forexApplies) {
    const conn = await getEaConnection(userId);
    lastHeartbeatAt = conn?.last_heartbeat_at ?? null;
    eaOnline = getEaOnlineState(userId, lastHeartbeatAt);
    heartbeatFresh = Boolean(
      conn &&
        conn.status !== "revoked" &&
        isEaOnlineDebounced(userId, lastHeartbeatAt),
    );

    if (symbol && heartbeatFresh) {
      forexQuote = await resolveForexQuoteSnapshot(userId, symbol);
      if (forexQuote) {
        quoteAgeMs = forexQuote.quoteAgeMs;
        quoteSource = forexQuote.source;
        quoteFresh = isQuoteFresh(forexQuote.quoteAgeMs, staleThresholdMs);
        const spread = spreadFromBidAsk(
          forexQuote.bid,
          forexQuote.ask,
          symbol,
        );
        spreadPips = spread?.spreadPips ?? null;
      } else {
        quoteFresh = false;
        quoteSource = null;
      }
    } else if (symbol) {
      quoteFresh = false;
    }
  }

  const checks: TradeReadinessChecks = {
    eaOnline: {
      ...eaOnline,
      applies: forexApplies,
    },
    heartbeat: {
      fresh: heartbeatFresh,
      lastHeartbeatAt,
      applies: forexApplies,
    },
    quote: {
      fresh: quoteFresh,
      quoteAgeMs,
      source: quoteSource,
      spreadPips,
      maxSpreadPips,
      staleThresholdMs,
      applies: forexApplies && Boolean(symbol),
    },
    killSwitch: {
      master: masterKill,
      user: userKill,
      passes: killPasses,
    },
    canExecute: {
      allowed: canExecuteAllowed,
    },
    openTrades: {
      count: openCount,
      max: maxOpen,
      passes: openTradesPasses,
    },
    dailyLoss: {
      todayPnlPct,
      limitPct: settings.daily_loss_limit_pct,
      passes: dailyLossPasses,
    },
    monthlyLoss: {
      monthPnlPct,
      limitPct: settings.monthly_loss_limit_pct,
      passes: monthlyLossPasses,
    },
    forexSession: {
      open: session.open,
      applies: forexApplies,
      reasonEn: session.reasonEn,
      reasonAr: session.reasonAr,
    },
    confidenceGate,
  };

  const blockers = collectTradeReadinessBlockers({
    checks,
    forexApplies,
    symbol,
    heartbeatFresh,
    eaOnline: eaOnline.online,
    forexQuoteGateFailure:
      symbol && heartbeatFresh
        ? evaluateForexQuoteGate(
            heartbeatFresh,
            forexQuote,
            symbol,
            staleThresholdMs,
            maxSpreadPips,
          )
        : null,
    openCount,
    maxOpen,
    dailyLossLimitPct: settings.daily_loss_limit_pct,
    monthlyLossLimitPct: settings.monthly_loss_limit_pct,
  });

  const ready = blockers.length === 0;

  return {
    ready,
    blockers,
    checks,
    snapshotAt: new Date().toISOString(),
    market,
    symbol,
    resolvedEnv,
    freshness:
      symbol && forexApplies && quoteAgeMs !== null && quoteSource
        ? freshnessMeta(quoteSource, quoteAgeMs, staleThresholdMs)
        : undefined,
  };
}
