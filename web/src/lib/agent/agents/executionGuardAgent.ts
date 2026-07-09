import type { AgentRunContext, AgentConfirmationPayload } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { FinalDecisionResult } from "./finalDecisionAgent";
import type { RiskAgentResult } from "./riskAgent";
import type { NewsMacroResult } from "./newsMacroAgent";
import type { UserTradingProfile } from "../risk/userTradingProfile";
import { getForexSessionStatus } from "../marketSession";
import { isSpreadTooHigh, slippageRisk } from "../risk/spreadCheck";

export interface ExecutionGuardResult {
  allowed: false;
  requiresConfirmation: boolean;
  message: string;
  reasons: string[];
  warnings: string[];
  confirmationPayload?: AgentConfirmationPayload;
}

export interface ExecutionGuardInput {
  market: AgentMarketContext;
  finalDecision: FinalDecisionResult | null;
  risk: RiskAgentResult | null;
  news: NewsMacroResult | null;
  profile?: UserTradingProfile | null;
  /** Whether the user has permission to execute trades at all. */
  canExecute: boolean;
}

/**
 * The Execution Guard NEVER executes — it prepares an explicit confirmation and
 * always returns allowed:false. It blocks when the market is closed, risk vetoed,
 * permission is missing, or slippage risk is extreme; otherwise it emits a
 * confirmation payload (symbol, direction, levels, RR, mode, warnings) for the
 * user to approve before anything reaches MT5/EA.
 */
export async function runExecutionGuardAgent(
  ctx: AgentRunContext,
  input: ExecutionGuardInput,
): Promise<ExecutionGuardResult> {
  ctx.emitActivity({
    type: "execution",
    status: "started",
    message: "أتحقق من شروط التنفيذ والتأكيد المطلوب.",
  });

  // Permission gate.
  if (!input.canExecute) {
    return block(ctx, "لا تملك صلاحية تنفيذ الصفقات على هذا الحساب.", [
      "Execution permission missing.",
    ]);
  }

  // Session preference: monitor-only.
  if (ctx.session?.preferences.allowExecution === false) {
    return block(ctx, "الوضع الحالي: مراقبة فقط دون تنفيذ (بحسب تفضيلك).", [
      "Session set to monitor-only.",
    ]);
  }

  // Risk veto.
  if (input.risk?.veto) {
    return block(
      ctx,
      "لا يمكن تنفيذ الصفقة لأن وكيل المخاطر رفض الإعداد.",
      input.risk.validation.reasons,
      input.risk.validation.warnings,
    );
  }

  const rec = input.finalDecision?.recommendation;
  if (!rec || rec.action === "wait") {
    return block(ctx, "لا توجد صفقة صالحة للتنفيذ حالياً.", [
      "Final decision is WAIT.",
    ]);
  }

  // Market session.
  const session = getForexSessionStatus();
  if (!session.isOpen) {
    return block(ctx, `تعذّر التنفيذ: ${session.reason}`, [session.reason]);
  }

  // Spread / slippage.
  const warnings: string[] = [];
  const stopDistance =
    rec.entry != null && rec.stop_loss != null
      ? Math.abs(rec.entry - rec.stop_loss)
      : 0;
  const spreadHigh =
    input.market.spread != null &&
    isSpreadTooHigh({
      spread: input.market.spread,
      atr: input.market.atr ?? 0,
      stopDistance,
    });
  if (spreadHigh) warnings.push("السبريد مرتفع نسبياً مقابل المخاطرة.");

  const slip = slippageRisk({
    newsRisk: input.news?.newsRisk ?? "unknown",
    spreadTooHigh: Boolean(spreadHigh),
    marketJustOpened: false,
  });
  if (slip === "block") {
    return block(
      ctx,
      "تم إيقاف التنفيذ: خطر انزلاق سعري مرتفع (أخبار + سبريد).",
      ["Extreme slippage risk."],
      warnings,
    );
  }
  if (slip === "warn") warnings.push("احتمال انزلاق سعري — راقب التنفيذ.");

  const executionMode = input.profile?.executionMode ?? "simulation";
  const newsWarning =
    input.news && input.news.newsRisk !== "low" && input.news.newsRisk !== "unknown"
      ? `خطر إخباري: ${input.news.newsRisk}`
      : undefined;

  const confirmationPayload: AgentConfirmationPayload = {
    symbol: input.market.symbol,
    direction: rec.action,
    entry: rec.entry,
    stop_loss: rec.stop_loss,
    targets: rec.targets,
    estimatedRR: rec.rr,
    executionMode,
    newsWarning,
    spreadWarning: spreadHigh ? "السبريد مرتفع" : undefined,
  };

  const modeWarn =
    executionMode === "live"
      ? "تنبيه: هذا تنفيذ على حساب LIVE وليس Demo."
      : undefined;
  if (modeWarn) warnings.unshift(modeWarn);

  ctx.emitActivity({
    type: "execution",
    status: "warning",
    message: "التنفيذ يحتاج تأكيداً صريحاً منك قبل الإرسال إلى MT5.",
    metadata: { direction: rec.action, executionMode },
  });

  return {
    allowed: false,
    requiresConfirmation: true,
    message: "هذه الصفقة تحتاج تأكيدك قبل التنفيذ.",
    reasons: ["Explicit user confirmation is required."],
    warnings,
    confirmationPayload,
  };
}

function block(
  ctx: AgentRunContext,
  message: string,
  reasons: string[],
  warnings: string[] = [],
): ExecutionGuardResult {
  ctx.emitActivity({
    type: "execution",
    status: "warning",
    message,
  });
  return {
    allowed: false,
    requiresConfirmation: false,
    message,
    reasons,
    warnings,
  };
}
