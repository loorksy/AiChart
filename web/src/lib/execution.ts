import {
  getSettings,
  getLimits,
  getIntent,
  updateIntentStatus,
  countOpenTrades,
  todayRealizedPnlPct,
  todayRealizedPnlUsd,
  monthRealizedPnlPct,
  isMasterKillOn,
} from "./store";
import { getResolvedExecutionEnv } from "./executionEnv";
import {
  BridgeErrorCode,
  lowConfidenceFailure,
  type BridgeFailure,
} from "./bridge/errors";
import { evaluateTrade } from "./riskGuard";
import { brokerForMarket } from "./markets/types";
import { getBrokerAdapter } from "./brokers";
import {
  emitActivity,
  type ActivityListener,
  type AgentActivity,
} from "./agentActivity";

export interface ExecutionResult {
  ok: boolean;
  status: "executed" | "failed";
  reason: string;
  denyCode?: BridgeErrorCode;
  denyDetails?: Record<string, unknown>;
  errorCode?: string;
  tradeId?: number;
  trade?: {
    symbol: string;
    side: string;
    qty: number;
    avg_price: number;
    env: string;
  };
}

/** Map a Risk Guard LOW_CONFIDENCE denial to the bridge envelope (no broker call). */
export function bridgeEnvelopeForExecutionDenial(
  result: Pick<ExecutionResult, "ok" | "denyCode" | "denyDetails">,
): BridgeFailure | null {
  if (result.ok || result.denyCode !== BridgeErrorCode.LOW_CONFIDENCE) {
    return null;
  }
  const details = result.denyDetails as
    | { confidence: number; minConfidence: number }
    | undefined;
  if (!details) return null;
  return lowConfidenceFailure(details.confidence, details.minConfidence);
}

/**
 * Executes a pending/approved trade intent. The Risk Guard is the gate: no
 * order is sent unless every hard cap passes. Order placement is delegated to
 * the broker adapter selected by the intent's market (Binance for crypto,
 * the MetaTrader EA bridge for forex).
 */
export interface ExecuteIntentOptions {
  onActivity?: ActivityListener;
  /** The human operator explicitly ordered/approved this trade (agent bridge). */
  explicitApproval?: boolean;
  practiceMode?: boolean;
}

export async function executeIntent(
  userId: number,
  intentId: number,
  options?: ExecuteIntentOptions,
): Promise<ExecutionResult & { activities: AgentActivity[] }> {
  const onActivity = options?.onActivity;
  const activities: AgentActivity[] = [];
  const push = (activity: AgentActivity) => {
    const idx = activities.findIndex((a) => a.id === activity.id);
    if (idx >= 0) activities[idx] = activity;
    else activities.push(activity);
    emitActivity(onActivity, activity);
  };

  const intent = await getIntent(intentId);
  if (!intent || intent.user_id !== userId) {
    return { ok: false, status: "failed", reason: "الطلب غير موجود.", activities };
  }
  if (intent.status === "executed") {
    return { ok: false, status: "failed", reason: "سبق تنفيذ هذا الطلب.", activities };
  }

  push({
    id: "risk",
    label: `فحص حدود المخاطر · ${intent.symbol}`,
    status: "running",
  });

  const settings = await getSettings(userId);
  const limits = await getLimits(userId);

  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;

  // 1) Risk Guard — the authority. Nothing executes if this denies.
  // In approval/direct modes an "approved" intent means a human said yes.
  const explicitApproval =
    Boolean(options?.explicitApproval) ||
    (settings.mode !== "auto" && intent.status === "approved");

  const practiceMode =
    Boolean(options?.practiceMode) || intent.practice === 1;
  const resolvedEnv = await getResolvedExecutionEnv(userId, intent.market);
  const envPreference =
    settings.execution_env_preference === "live" ? "live" : "demo";

  const marketType = intent.market_type === "futures" ? "futures" : "spot";
  const decision = evaluateTrade(
    settings,
    limits,
    {
      symbol: intent.symbol,
      side: intent.side,
      notional: intent.notional,
      market: intent.market,
      marketType,
      leverage: intent.leverage ?? 1,
      stopLoss: intent.stop_loss,
      confidence: intent.confidence ?? 0,
    },
    {
      masterKill: await isMasterKillOn(),
      openTradesCount: await countOpenTrades(userId),
      todayRealizedPnlPct: await todayRealizedPnlPct(userId, effectiveCapital),
      todayRealizedPnlUsd: await todayRealizedPnlUsd(userId),
      monthRealizedPnlPct: await monthRealizedPnlPct(userId, effectiveCapital),
      explicitApproval,
      practiceMode,
      resolvedEnv,
      envPreference,
    },
  );

  if (!decision.ok) {
    push({
      id: "risk",
      label: `فحص حدود المخاطر · ${intent.symbol}`,
      status: "error",
      detail: decision.reason,
    });
    await updateIntentStatus(intentId, "failed", decision.reason);
    return {
      ok: false,
      status: "failed",
      reason: decision.reason,
      denyCode: decision.denyCode,
      denyDetails: decision.denyDetails,
      activities,
    };
  }
  push({
    id: "risk",
    label: `فحص حدود المخاطر · ${intent.symbol}`,
    status: "done",
    detail:
      marketType === "futures"
        ? `Futures · رافعة ${intent.leverage ?? 1}x · هامش معزول`
        : undefined,
  });

  // 2) Delegate placement to the broker that owns this market.
  const broker = intent.broker ?? brokerForMarket(intent.market);
  const adapter = getBrokerAdapter(broker, marketType);
  const result = await adapter.placeOrder(userId, {
    intent,
    settings,
    limits,
    effectiveCapital,
    push,
  });

  return { ...result, activities };
}
