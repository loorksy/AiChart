import type { AgentRunContext, AgentConfirmationPayload } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { FinalDecisionResult } from "./finalDecisionAgent";
import type { NewsMacroResult } from "./newsMacroAgent";
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
  news: NewsMacroResult | null;
  /** Whether the user has permission to execute trades at all. */
  canExecute: boolean;
}

/**
 * The Execution Guard NEVER executes — it prepares an explicit confirmation and
 * always returns allowed:false. It blocks only on technical execution conditions
 * (permission, market session, or extreme slippage); otherwise it emits a
 * confirmation payload (symbol, direction, levels, RR, warnings) for the
 * user to approve before anything reaches MT5.
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
    newsWarning,
    spreadWarning: spreadHigh ? "السبريد مرتفع" : undefined,
  };

  ctx.emitActivity({
    type: "execution",
    status: "warning",
    message: "التنفيذ يحتاج تأكيداً صريحاً منك قبل الإرسال إلى MT5.",
    metadata: { direction: rec.action },
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
