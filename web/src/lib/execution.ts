import {
  getFlag,
  getIntent,
  getLimits,
  getMtAccountMeta,
  getSettings,
  listOpenTrades,
  updateIntentDenied,
} from "./store";
import {
  evaluatePortfolioGate,
  type OpenPositionView,
  type PortfolioVerdict,
} from "./agent/portfolioGate";
import {
  checkExecutionHalt,
  isRealMoneyExecution,
  KILL_SWITCH_FLAG,
  LIVE_ENABLED_FLAG,
} from "./executionKillSwitch";
import { getResolvedExecutionEnv } from "./executionEnv";
import { getEaConnection } from "./eaStore";
import {
  checkRevisionIsCurrent,
  getEffectiveRevision,
} from "./recommendations/canonical/revisions";
import { isAutoExecutionAuthorized } from "./agent/tradeMode";
import { FEATURES } from "./agent/featureFlags";
import { createLogger } from "./logger";
import { BridgeErrorCode } from "./bridge/errors";
import { getBrokerAdapter } from "./brokers";
import { metrics } from "./metrics";
import { validateExecutionIntent } from "./executionSafety";
import { emitActivity, type ActivityListener, type AgentActivity } from "./agentActivity";
import type { BrokerKind } from "./markets/types";
import type { TradeIntent } from "./types";

const log = createLogger("execution");

export interface ExecutionResult {
  ok: boolean;
  status: "executed" | "failed";
  reason: string;
  denyCode?: BridgeErrorCode;
  errorCode?: string;
  tradeId?: number;
  trade?: { symbol: string; side: string; qty: number; avg_price: number; env: string };
}

export interface RiskBudget {
  equity: number;
  riskPct: number;
  riskAmount: number;
  currency: string | null;
}

/** Reads verified broker equity; browser-supplied capital is never accepted. */
export async function getRiskBudget(
  userId: number,
  broker: BrokerKind,
): Promise<RiskBudget | null> {
  const settings = await getSettings(userId);
  let equity = 0;
  let currency: string | null = null;
  if (broker === "mt_ea") {
    const connection = await getEaConnection(userId);
    equity = Number(connection?.equity);
    currency = connection?.account_currency ?? null;
  } else {
    const account = await getMtAccountMeta(userId);
    equity = Number(account?.equity);
    currency = account?.currency ?? null;
  }
  if (!Number.isFinite(equity) || equity <= 0) return null;
  const riskPct = settings.per_trade_pct;
  const riskAmount = (equity * riskPct) / 100;
  if (!Number.isFinite(riskAmount) || riskAmount <= 0) return null;
  return { equity, riskPct, riskAmount, currency };
}

export interface ExecuteIntentOptions {
  onActivity?: ActivityListener;
  /**
   * True only when the operator approved THIS trade. Consulted by the
   * authorization gate inside `executeIntent`: a `user_approved` intent (or a
   * legacy row with no stamped source) is refused without it.
   */
  explicitApproval?: boolean;
  practiceMode?: boolean;
}

/**
 * Named refusal from the authorization gate (docs/UNIFIED_AGENT_PLAN.md §3).
 *
 * `unauthorized_source`  — the intent's `authorization_source` is not one that
 *                          may place an order here (a `trade_management`
 *                          SL/TP proposal, an unknown stamp, or a per-trade
 *                          approval executed without the approval in hand).
 * `auto_mode_revoked`    — the intent was stamped `standing_auto`, but the
 *                          operator's standing authorisation no longer holds at
 *                          this moment, so the grant it was created under is gone.
 */
export type AuthorizationRefusalCode = "unauthorized_source" | "auto_mode_revoked";

/**
 * WHO authorised this order — decided at the choke point itself, never trusted
 * to the routes. Exactly two sources may reach a broker:
 *
 *  - `user_approved`  — the operator approved this specific trade, proven by the
 *                       caller holding `explicitApproval === true`;
 *  - `standing_auto`  — the operator's auto mode, re-verified RIGHT NOW rather
 *                       than at intent-creation time, so a revoked grant cannot
 *                       ride in on an old row.
 *
 * A NULL source is a legacy row from before creators stamped it; such a row is
 * executable only under an explicit approval, which is the one authorisation
 * that cannot be forged by a stale record. `trade_management` is an SL/TP
 * modification proposal for an already-open position — never an order — and any
 * unknown value is refused rather than guessed at.
 */
async function checkAuthorizationSource(
  userId: number,
  intent: TradeIntent,
  explicitApproval: boolean,
): Promise<{ ok: true } | { ok: false; code: AuthorizationRefusalCode; reason: string }> {
  const source = intent.authorization_source ?? null;

  if (source === "standing_auto") {
    const stillAuthorized = await isAutoExecutionAuthorized(userId).catch(() => false);
    if (!stillAuthorized) {
      return {
        ok: false,
        code: "auto_mode_revoked",
        reason:
          "أُلغي التفويض التلقائي (auto_mode_revoked): الوضع التلقائي لم يعد مفعّلاً على هذا الاتصال — لم يُرسل أي أمر.",
      };
    }
    return { ok: true };
  }

  if (source === "user_approved" || source === null) {
    if (explicitApproval === true) return { ok: true };
    return {
      ok: false,
      code: "unauthorized_source",
      reason:
        "لا يوجد تفويض لهذا الأمر (unauthorized_source): يتطلب موافقة صريحة من المشغّل على هذه الصفقة — لم يُرسل أي أمر.",
    };
  }

  // trade_management (an SL/TP proposal for an open position, never an order)
  // or a source this build does not recognise.
  return {
    ok: false,
    code: "unauthorized_source",
    reason:
      source === "trade_management"
        ? "هذا الطلب اقتراح تعديل وقف/هدف لصفقة مفتوحة (unauthorized_source) وليس أمر دخول — مساره اعتماد التعديل، وليس التنفيذ."
        : `مصدر تفويض غير معروف (unauthorized_source): "${source}" — لم يُرسل أي أمر.`,
  };
}

/**
 * Adapt real open trades into the portfolio gate's view (item 16).
 *
 * Risk per open position is derived from its own stop when the originating
 * intent is available (the honest number), and otherwise falls back to the
 * account's configured risk-per-trade — the size it was opened at. The fallback
 * is deliberately the CONFIGURED risk rather than zero: assuming an unknown
 * position carries no risk would defeat the entire gate.
 */
async function evaluatePortfolioForIntent(
  userId: number,
  intent: TradeIntent,
  budget: RiskBudget,
): Promise<PortfolioVerdict> {
  const configuredRisk = Math.max(0, budget.riskPct) / 100;
  let openPositions: OpenPositionView[] = [];
  try {
    const trades = await listOpenTrades(userId, 50);
    openPositions = trades.map((trade) => ({
      symbol: trade.symbol,
      direction: trade.side === "sell" ? ("sell" as const) : ("buy" as const),
      riskFraction: configuredRisk,
    }));
  } catch {
    // A portfolio read failure must not silently DISABLE the gate. With an
    // unknown book we cannot prove the trade is safe, so fall through with an
    // empty list but surface it as a warning rather than a false all-clear.
    const verdict = evaluatePortfolioGate({
      candidate: {
        symbol: intent.symbol,
        direction: intent.side,
        riskFraction: configuredRisk,
      },
      openPositions: [],
    });
    verdict.warnings.push("تعذّر قراءة الصفقات المفتوحة — فحص المحفظة غير مكتمل.");
    return verdict;
  }

  return evaluatePortfolioGate({
    candidate: {
      symbol: intent.symbol,
      direction: intent.side,
      riskFraction: configuredRisk,
    },
    openPositions,
  });
}

export async function executeIntent(
  userId: number,
  intentId: number,
  options?: ExecuteIntentOptions,
): Promise<ExecutionResult & { activities: AgentActivity[] }> {
  const activities: AgentActivity[] = [];
  const push = (activity: AgentActivity) => {
    const index = activities.findIndex((item) => item.id === activity.id);
    if (index >= 0) activities[index] = activity;
    else activities.push(activity);
    emitActivity(options?.onActivity, activity);
  };

  const intent = await getIntent(intentId, userId);
  if (!intent || intent.user_id !== userId) {
    return { ok: false, status: "failed", reason: "الطلب غير موجود.", activities };
  }
  if (intent.status === "executed") {
    return { ok: false, status: "failed", reason: "سبق تنفيذ هذا الطلب.", activities };
  }

  // Master kill switch / dual-enablement halt (RELIABILITY_PLAN.md item 11).
  // Checked FIRST, at the single execution choke point, so no route can bypass
  // it. These protections can only ever BLOCK — never authorize.
  //
  // Dual enablement: real-money execution needs the deploy-scoped env switch
  // AND an independently-set ops flag, so one wrong setting can't go live.
  const [killFlag, liveRuntimeFlag, resolvedEnv] = await Promise.all([
    getFlag(KILL_SWITCH_FLAG).catch(() => null),
    getFlag(LIVE_ENABLED_FLAG).catch(() => null),
    // The BROKER's reported account type — the only signal that actually says
    // where this order goes. Reading an env var here (the previous behaviour)
    // meant the protection never engaged on EA/MT5 deployments.
    getResolvedExecutionEnv(userId, intent.market).catch(() => null),
  ]);
  const halt = checkExecutionHalt({
    killSwitchFlag: killFlag,
    isLive: isRealMoneyExecution(resolvedEnv),
    liveRuntimeEnabled: liveRuntimeFlag === "1",
  });
  if (halt.halted) {
    push({ id: "safety", label: `التحقق التقني · ${intent.symbol}`, status: "error", detail: halt.reason });
    await updateIntentDenied(intentId, halt.reason, BridgeErrorCode.EXECUTION_UNAUTHORIZED, userId);
    metrics.executionDenials.inc({ code: `HALT_${halt.code.toUpperCase()}` });
    return {
      ok: false,
      status: "failed",
      reason: halt.reason,
      denyCode: BridgeErrorCode.EXECUTION_UNAUTHORIZED,
      activities,
    };
  }

  // WHO authorised this order. The routes each ran their own check, but a
  // route-level `if` is one refactor away from being bypassed — so the source
  // stamped on the intent is enforced here, at the same choke point as the kill
  // switch, before anything else is even evaluated.
  const authorization = await checkAuthorizationSource(
    userId,
    intent,
    options?.explicitApproval === true,
  );
  if (!authorization.ok) {
    push({
      id: "safety",
      label: `تفويض التنفيذ · ${intent.symbol}`,
      status: "error",
      detail: authorization.reason,
    });
    await updateIntentDenied(
      intentId,
      authorization.reason,
      BridgeErrorCode.EXECUTION_UNAUTHORIZED,
      userId,
    );
    metrics.executionDenials.inc({ code: authorization.code.toUpperCase() });
    return {
      ok: false,
      status: "failed",
      reason: authorization.reason,
      denyCode: BridgeErrorCode.EXECUTION_UNAUTHORIZED,
      errorCode: authorization.code,
      activities,
    };
  }

  // Are these still the levels the agent stands behind?
  //
  // An order can sit between being built and being sent — waiting on approval,
  // or on a conditional plan's trigger — and in that gap deep research or a
  // structure break can move the plan. Executing the old numbers would fill a
  // trade the agent has already withdrawn, so a superseded revision is refused
  // here rather than quietly sent (docs/UNIFIED_AGENT_PLAN.md §14).
  if (FEATURES.recRevisionsV1() && intent.recommendation_id != null) {
    let revisionNo = intent.recommendation_revision_no ?? null;
    if (revisionNo == null) {
      // Legacy intent from before creators stamped the revision. The correct
      // legacy semantic is "execute the plan as it stands NOW", so the CAS is
      // evaluated against the current effective revision rather than skipped.
      // A recommendation with no effective revision at all predates revisions
      // entirely; for those there is no pointer to compare and the check is
      // waived, exactly as it always was for such rows.
      const effective = await getEffectiveRevision(userId, intent.recommendation_id).catch(
        () => null,
      );
      if (effective) {
        revisionNo = effective.revisionNo;
        log.info("execution.revision_backfill", {
          userId,
          intentId,
          recommendationId: intent.recommendation_id,
          revisionNo,
        });
      }
    }
    const revision =
      revisionNo == null
        ? null
        : await checkRevisionIsCurrent({
            userId,
            recommendationId: intent.recommendation_id,
            revisionNo,
          }).catch(() => null);
    if (revision && !revision.ok) {
      metrics.staleRevisionDenials.inc();
      const reason =
        revision.reason === "stale_revision"
          ? `تغيّرت خطة التوصية (النسخة الفعالة الآن ${revision.effectiveRevisionNo}) — لم يُرسل الأمر بمستويات قديمة.`
          : "لا توجد نسخة فعالة لهذه التوصية — لم يُرسل أي أمر.";
      push({
        id: "safety",
        label: `النسخة الفعالة · ${intent.symbol}`,
        status: "error",
        detail: reason,
      });
      await updateIntentDenied(intentId, reason, BridgeErrorCode.VALIDATION_ERROR, userId);
      metrics.executionDenials.inc({ code: "STALE_REVISION" });
      return {
        ok: false,
        status: "failed",
        reason,
        denyCode: BridgeErrorCode.VALIDATION_ERROR,
        activities,
      };
    }
  }

  push({ id: "safety", label: `التحقق التقني · ${intent.symbol}`, status: "running" });
  const limits = await getLimits(userId);
  const safety = validateExecutionIntent(intent, limits);
  if (!safety.ok) {
    push({ id: "safety", label: `التحقق التقني · ${intent.symbol}`, status: "error", detail: safety.reason });
    await updateIntentDenied(intentId, safety.reason, safety.denyCode ?? null, userId);
    metrics.executionDenials.inc({ code: safety.denyCode ?? "VALIDATION_ERROR" });
    return { ok: false, status: "failed", reason: safety.reason, denyCode: safety.denyCode, activities };
  }

  const broker = intent.broker;
  const budget = await getRiskBudget(userId, broker);
  if (!budget) {
    const reason = "تعذّر التحقق من رصيد equity للحساب المتصل؛ لم يُرسل أي أمر.";
    push({ id: "safety", label: `حساب المخاطرة · ${intent.symbol}`, status: "error", detail: reason });
    await updateIntentDenied(intentId, reason, BridgeErrorCode.VALIDATION_ERROR, userId);
    return { ok: false, status: "failed", reason, denyCode: BridgeErrorCode.VALIDATION_ERROR, activities };
  }
  push({
    id: "safety",
    label: `Risk per Trade · ${budget.riskPct}%`,
    status: "done",
    detail: `${budget.riskAmount.toFixed(2)} ${budget.currency ?? "account currency"}`,
  });

  // Portfolio-level gate (RELIABILITY_PLAN.md item 16). Every check above judges
  // THIS trade alone; five "safe" 1% longs on correlated pairs are one 5% bet.
  // Execution-only: it can block, never edit the decision.
  const portfolio = await evaluatePortfolioForIntent(userId, intent, budget);
  if (!portfolio.allowed) {
    const reason = portfolio.reason ?? "تجاوز حدود المحفظة.";
    push({ id: "safety", label: `حدود المحفظة · ${intent.symbol}`, status: "error", detail: reason });
    await updateIntentDenied(intentId, reason, BridgeErrorCode.VALIDATION_ERROR, userId);
    metrics.executionDenials.inc({ code: `PORTFOLIO_${(portfolio.code ?? "limit").toUpperCase()}` });
    return { ok: false, status: "failed", reason, denyCode: BridgeErrorCode.VALIDATION_ERROR, activities };
  }
  for (const warning of portfolio.warnings) {
    push({ id: "safety", label: `حدود المحفظة · ${intent.symbol}`, status: "done", detail: warning });
  }

  const adapter = getBrokerAdapter(broker, "spot");
  const result = await adapter.placeOrder(userId, { intent, riskAmount: budget.riskAmount, push });
  if (result.ok) metrics.tradesExecuted.inc({ broker, market: intent.market });
  return { ...result, activities };
}
