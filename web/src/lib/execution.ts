import { getIntent, getLimits, getMtAccountMeta, getSettings, updateIntentDenied } from "./store";
import { getEaConnection } from "./eaStore";
import { BridgeErrorCode } from "./bridge/errors";
import { getBrokerAdapter } from "./brokers";
import { metrics } from "./metrics";
import { validateExecutionIntent } from "./executionSafety";
import { emitActivity, type ActivityListener, type AgentActivity } from "./agentActivity";
import type { BrokerKind } from "./markets/types";

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
  explicitApproval?: boolean;
  practiceMode?: boolean;
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

  const adapter = getBrokerAdapter(broker, "spot");
  const result = await adapter.placeOrder(userId, { intent, riskAmount: budget.riskAmount, push });
  if (result.ok) metrics.tradesExecuted.inc({ broker, market: intent.market });
  return { ...result, activities };
}
