/**
 * Deep Analysis trigger matrix.
 * Historical research may improve evidence; it cannot override hard safety failures.
 */
export type DeepAnalysisAllowReason =
  | "provisional_actionable"
  | "insufficient_historical_confirmation"
  | "explicit_deep_intent"
  | "conflicting_evidence"
  | "novel_or_weak_setup";

export type DeepAnalysisBlockReason =
  | "stale_price"
  | "excessive_spread"
  | "missing_sync"
  | "unrecoverable_candle_insufficiency"
  | "account_or_ea_mismatch"
  | "execution_guard_rejection"
  | "missing_approval"
  | "unavailable_required_news"
  | "safety_or_live_data_failure"
  | "not_justified"
  | "feature_disabled"
  | "setup_not_generalizable";

export interface DeepAnalysisTriggerInput {
  decision: "buy" | "sell" | "wait" | "informational" | "action_required" | string;
  confidence: number;
  userMessage?: string;
  /** True when WAIT (or block) is due to hard live-data / safety gates. */
  hardSafetyOrLiveDataFailure: boolean;
  hardFailureCode?: DeepAnalysisBlockReason | string;
  /** Backtest/historical confirmation was justified but no completed artifact yet. */
  historicalConfirmationInsufficient: boolean;
  conflictingEvidence?: boolean;
  /** Weak / novel setup (low confidence or sparse specialist agreement). */
  novelOrWeakSetup?: boolean;
  researchServiceEnabled?: boolean;
  researchBacktestEnabled?: boolean;
}

export interface DeepAnalysisTriggerDecision {
  run: boolean;
  allowReason?: DeepAnalysisAllowReason;
  blockReason?: DeepAnalysisBlockReason | string;
  reasons: string[];
}

function detectDeepIntent(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return /\bbacktest\b|اختبار\s*تاريخ|باك\s*تست|historical\s*confirm|deep\s*analys|تحليل\s*معمق|تحقق\s*تاريخ|walk[\s-]?forward|swarm|بحث\s*عميق/i.test(
    m,
  );
}

/**
 * Decide whether asynchronous Deep Analysis may start.
 */
export function decideDeepAnalysisTrigger(
  input: DeepAnalysisTriggerInput,
): DeepAnalysisTriggerDecision {
  const reasons: string[] = [];

  if (input.researchServiceEnabled === false || input.researchBacktestEnabled === false) {
    return {
      run: false,
      blockReason: "feature_disabled",
      reasons: ["research_backtest_disabled"],
    };
  }

  if (input.hardSafetyOrLiveDataFailure) {
    const code = (input.hardFailureCode as DeepAnalysisBlockReason) ||
      "safety_or_live_data_failure";
    return {
      run: false,
      blockReason: code,
      reasons: [
        "historical_research_cannot_override_safety_or_live_data_failure",
        code,
      ],
    };
  }

  if (detectDeepIntent(input.userMessage)) {
    reasons.push("explicit_deep_intent");
    return { run: true, allowReason: "explicit_deep_intent", reasons };
  }

  if (input.conflictingEvidence) {
    reasons.push("conflicting_analytical_evidence");
    return { run: true, allowReason: "conflicting_evidence", reasons };
  }

  const actionable =
    input.decision === "buy" || input.decision === "sell";
  const mid = input.confidence >= 0.45 && input.confidence <= 0.78;
  const weak =
    input.novelOrWeakSetup === true ||
    (actionable && input.confidence < 0.55);

  if (actionable && mid) {
    reasons.push("provisional_actionable_candidate");
    return { run: true, allowReason: "provisional_actionable", reasons };
  }

  if (actionable && weak) {
    reasons.push("novel_or_weak_setup");
    return { run: true, allowReason: "novel_or_weak_setup", reasons };
  }

  // A plan with no statistical history behind it is exactly the case deep
  // research can improve. It fires on the missing evidence itself — the old
  // trigger keyed on a WAIT decision, which no longer exists, so this path had
  // become unreachable for the plans that most need it.
  if (input.historicalConfirmationInsufficient) {
    reasons.push("insufficient_historical_confirmation");
    return {
      run: true,
      allowReason: "insufficient_historical_confirmation",
      reasons,
    };
  }

  return {
    run: false,
    blockReason: "not_justified",
    reasons: ["deep_analysis_not_justified_for_this_request"],
  };
}

/** Map orchestrator early-exit WAIT causes to hard block codes. */
export function classifyHardSafetyFailure(input: {
  syncOk?: boolean;
  stalePrice?: boolean;
  excessiveSpread?: boolean;
  candleInsufficientUnrecoverable?: boolean;
  executionGuardRejected?: boolean;
  accountOrEaMismatch?: boolean;
  missingApproval?: boolean;
  newsUnavailableHardGate?: boolean;
}): { blocked: boolean; code?: DeepAnalysisBlockReason } {
  if (input.stalePrice) return { blocked: true, code: "stale_price" };
  if (input.excessiveSpread) return { blocked: true, code: "excessive_spread" };
  if (input.syncOk === false) return { blocked: true, code: "missing_sync" };
  if (input.candleInsufficientUnrecoverable) {
    return { blocked: true, code: "unrecoverable_candle_insufficiency" };
  }
  if (input.accountOrEaMismatch) {
    return { blocked: true, code: "account_or_ea_mismatch" };
  }
  if (input.executionGuardRejected) {
    return { blocked: true, code: "execution_guard_rejection" };
  }
  if (input.missingApproval) return { blocked: true, code: "missing_approval" };
  if (input.newsUnavailableHardGate) {
    return { blocked: true, code: "unavailable_required_news" };
  }
  return { blocked: false };
}
