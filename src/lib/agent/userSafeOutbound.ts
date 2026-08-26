/**
 * User-safe outbound pipeline for research-influenced agent replies.
 *
 * Primary path (required):
 *   internal evidence → user-safe semantic projection → model composition → leakage scan
 *
 * Banlist is defense-in-depth only. Never generate technical text then delete words.
 */
import type { ResearchEvidenceBundle } from "./researchEvidence";
import type { AgentFinalResult } from "./types";

export const USER_SAFE_PROJECTION_VERSION = "1.0.0";

export type HistoricalAgreement =
  | "supports"
  | "conflicts"
  | "mixed"
  | "insufficient"
  | "none";

export type HistoricalStability =
  | "stable"
  | "unstable"
  | "unknown"
  | "not_evaluated";

export type SampleSizeBand = "none" | "small" | "moderate" | "large";

export type DeeperVerificationState =
  | "not_started"
  | "started"
  | "running"
  | "completed"
  | "failed"
  | "skipped_not_generalizable";

export interface UserSafeResearchProjection {
  version: string;
  historicalAgreement: HistoricalAgreement;
  sampleSizeBand: SampleSizeBand;
  historicalStability: HistoricalStability;
  /** Direction of historical context — never an instruction to change the live decision. */
  evidenceDirection: "supports" | "weakens" | "neutral";
  deeperVerification: DeeperVerificationState;
  /** Short semantic notes for the model — never module names or job IDs. */
  notes: string[];
}

/** Internal terminology that must never reach the operator in normal chat. */
export const INTERNAL_TERM_PATTERNS: RegExp[] = [
  /\bTrading\s*DNA\b/i,
  /\bShadow\s*Trader\b/i,
  /\bBacktest\b/i,
  /\bValidation\b/i,
  /\bResearch\s*Swarm\b/i,
  /\bSwarm\b/i,
  /\bfeature\s*flag\b/i,
  /\bSkipped\b/,
  /\bjob_[A-Za-z0-9._:-]+\b/i,
  /\bverifying_history\b/i,
  /\balmost_ready\b/i,
  /\bjob_created\b/i,
  /\bpolling\b/i,
  /\bvalidation_running\b/i,
  /\bresearchEvidence\b/i,
  /\bevidenceTimeline\b/i,
  /\bsetup_not_generalizable\b/i,
  /\bpolicyVersion\b/i,
  /\btrading_dna\b/i,
  /\bshadow_trader\b/i,
  /\bresearch_swarm\b/i,
];

export function scanForInternalLeakage(text: string): string[] {
  const hits: string[] = [];
  for (const re of INTERNAL_TERM_PATTERNS) {
    const m = text.match(re);
    if (m?.[0]) hits.push(m[0]);
  }
  return hits;
}

/**
 * System-identifier scrub for CONVERSATIONAL surfaces (general answers and
 * the live thinking trace) — the leakage policy's outbound layer.
 *
 * The prompt layer (systemPrompt.ts "Privacy and internals") tells the model
 * to decline internals questions; this is the defense-in-depth behind it:
 * anything that still looks like an env var, an API key, a provider host, a
 * model slug, or a stack frame is removed before the text leaves the process.
 * Patterns are deliberately shaped so market vocabulary survives — XAUUSD,
 * TP1/SL, and price numbers carry no underscores, no scheme, and no key
 * prefix, so none of them match. The market-data VENDOR name is scrubbed to
 * the neutral "platform feed" phrase (operator instruction: the data source
 * never appears in user-facing output; provenance lives in logs only).
 *
 * NOT applied to analysis summaries: those already pass the semantic
 * scanForInternalLeakage → compositionFallback path, and an aggressive regex
 * scrub could silently mangle a plan's wording.
 */
const SYSTEM_IDENTIFIER_PATTERNS: RegExp[] = [
  // Secret-shaped tokens (sk-…, key=…): remove before anything else so a key
  // never survives inside a larger match.
  /\b(?:sk|rk|pk|xoxb|ghp)[-_][A-Za-z0-9_-]{10,}\b/g,
  // SCREAMING_SNAKE env-var names (OPENAI_API_KEY, REDIS_URL, MT5_BRIDGE_URL).
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
  // Provider/API hostnames and URLs.
  /\bhttps?:\/\/[^\s)]+/gi,
  /\b(?:[a-z0-9-]+\.)*(?:openai|anthropic|openrouter|googleapis|google|anthropic|deepseek|mistral|together|groq|oanda|telegram|redis|upstash)\.(?:com|ai|org|io|dev|cloud)\b/gi,
  // Model slugs — the provider identity the agent must not name.
  /\bgpt[-_][a-z0-9._-]+\b/gi,
  /\bclaude[-_][a-z0-9._-]+\b/gi,
  /\bgemini[-_][a-z0-9._-]+\b/gi,
  /\bdeepseek[-_][a-z0-9._-]+\b/gi,
  /\bllama[-_][a-z0-9._-]+\b/gi,
  /\bgrok[-_][a-z0-9._-]+\b/gi,
  /\bo[134](?:-mini|-preview|-pro)\b/gi,
  // Stack frames and repo file paths.
  /^\s*at .+?(?::\d+:\d+|\))\s*$/gm,
  /(?:\/[\w.-]+)*\/node_modules\/[^\s]+/g,
  /\b(?:src|dist|\.next)\/[\w./-]+\.(?:tsx?|m?js|json)\b/g,
];

export function scrubInternalIdentifiers(text: string): string {
  let out = String(text ?? "");
  // The data vendor first, as a REPLACEMENT rather than a removal: deleting
  // it mid-sentence leaves broken prose, while the neutral phrase keeps the
  // sentence readable in either language. Exchange prefixes just drop.
  out = out.replace(/\bOANDA:\s*/g, "");
  out = out.replace(/\bOANDA\b|أواندا|آواندا|اواندا/g, () => (/[\u0600-\u06FF]/.test(out) ? "تغذية المنصة" : "the platform feed"));
  for (const re of SYSTEM_IDENTIFIER_PATTERNS) {
    out = out.replace(re, "");
  }
  // Collapse the holes the removals leave behind, without eating newlines.
  // \u060C / \u061B are the Arabic comma and semicolon.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,\u060C:\u061B)])/g, "$1")
    .trim();
}

function sampleBand(n: number): SampleSizeBand {
  if (n <= 0) return "none";
  if (n < 20) return "small";
  if (n < 80) return "moderate";
  return "large";
}

/**
 * Project internal research evidence into anonymous semantic facts for the model.
 */
export function toUserSafeResearchProjection(
  bundle: ResearchEvidenceBundle,
  opts?: {
    deeperVerification?: DeeperVerificationState;
    sampleSizeHint?: number;
    /**
     * Actual confidence delta applied after research (post-clamp). When set,
     * "nudged confidence" notes must match this number — never claim a nudge
     * that did not change the returned confidence.
     */
    confidenceNudgeApplied?: number;
  },
): UserSafeResearchProjection {
  const used = bundle.contributions.filter((c) => c.status === "used");
  const delta = bundle.historicalEvidenceTendency;
  const evidenceDirection: UserSafeResearchProjection["evidenceDirection"] =
    delta > 0.005 ? "supports" : delta < -0.005 ? "weakens" : "neutral";

  let agreement: HistoricalAgreement = "none";
  const reasons = used.map((c) => c.reason);
  const supports = reasons.some((r) =>
    /agree|support|strength|completed_jobs/i.test(r),
  );
  const conflicts = reasons.some((r) =>
    /disagree|conflict|weakness|instab/i.test(r),
  );
  if (used.length === 0) {
    agreement =
      bundle.skippedSystems.some((s) =>
        /insufficient|no_completed|justified_but/i.test(s.reason),
      )
        ? "insufficient"
        : "none";
  } else if (supports && conflicts) agreement = "mixed";
  else if (conflicts) agreement = "conflicts";
  else if (supports) agreement = "supports";
  else agreement = "mixed";

  const sampleHint =
    opts?.sampleSizeHint ??
    used.reduce((acc, c) => {
      const m = c.reasonDetail.match(/\bn=(\d+)/i);
      return Math.max(acc, m ? Number(m[1]) : 0);
    }, 0);

  let historicalStability: HistoricalStability = "not_evaluated";
  if (used.some((c) => /instab|unstable|drawdown/i.test(c.reasonDetail))) {
    historicalStability = "unstable";
  } else if (used.length > 0 && evidenceDirection !== "weakens") {
    historicalStability = "stable";
  } else if (used.length > 0) {
    historicalStability = "unknown";
  }

  const notes: string[] = [];
  if (agreement === "supports") {
    notes.push("Similar past setups leaned in favor of this thesis.");
  } else if (agreement === "conflicts") {
    notes.push("Similar past setups conflicted with this thesis.");
  } else if (agreement === "insufficient") {
    notes.push("Live analysis alone is not enough; deeper historical verification may help.");
  } else if (agreement === "mixed") {
    notes.push("Historical signals were mixed for this kind of setup.");
  }
  // Only claim a confidence nudge when one was actually applied (or, when the
  // caller did not report the applied delta, fall back to tendency direction).
  const applied = opts?.confidenceNudgeApplied;
  if (typeof applied === "number") {
    if (applied > 1e-9) {
      notes.push("Historical reliability nudged confidence slightly higher.");
    } else if (applied < -1e-9) {
      notes.push("Historical reliability nudged confidence slightly lower.");
    }
  } else if (evidenceDirection === "supports") {
    notes.push("Historical reliability nudged confidence slightly higher.");
  } else if (evidenceDirection === "weakens") {
    notes.push("Historical reliability nudged confidence slightly lower.");
  }

  return {
    version: USER_SAFE_PROJECTION_VERSION,
    historicalAgreement: agreement,
    sampleSizeBand: sampleBand(sampleHint),
    historicalStability,
    evidenceDirection,
    deeperVerification: opts?.deeperVerification ?? "not_started",
    notes,
  };
}

/** Minimal bilingual fallback — only when model composition fails. */
export function compositionFallback(input: {
  locale: "ar" | "en";
  decision: string;
  projection?: UserSafeResearchProjection | null;
}): { text: string; markedFallback: true } {
  const dec = input.decision.toLowerCase();
  if (input.locale === "ar") {
    if (dec === "buy") {
      return {
        text: "اكتمل التحليل. نرى فرصة شراء مشروطة وفق الأدلة المتاحة، مع إدارة واضحة للمخاطر.",
        markedFallback: true,
      };
    }
    if (dec === "sell") {
      return {
        text: "اكتمل التحليل. نرى فرصة بيع مشروطة وفق الأدلة المتاحة، مع إدارة واضحة للمخاطر.",
        markedFallback: true,
      };
    }
    if (input.projection?.deeperVerification === "started") {
      return {
        text: "أكملنا القراءة السريعة، ونراجع الآن كيف تصرف هذا النوع من الإعدادات في ظروف مشابهة.",
        markedFallback: true,
      };
    }
    return {
      text: "اكتمل التحليل. لا توجد صفقة واضحة الآن — ننتظر تأكيدًا أقوى من السوق.",
      markedFallback: true,
    };
  }
  if (dec === "buy") {
    return {
      text: "Analysis complete. We see a conditional buy opportunity from the available evidence, with clear risk management.",
      markedFallback: true,
    };
  }
  if (dec === "sell") {
    return {
      text: "Analysis complete. We see a conditional sell opportunity from the available evidence, with clear risk management.",
      markedFallback: true,
    };
  }
  if (input.projection?.deeperVerification === "started") {
    return {
      text: "Quick read is done. We are now checking how this kind of setup behaved in similar conditions.",
      markedFallback: true,
    };
  }
  return {
    text: "Analysis complete. No clear trade right now — we wait for stronger market confirmation.",
    markedFallback: true,
  };
}

export function stripInternalFieldsFromClientResult(
  result: AgentFinalResult,
): AgentFinalResult {
  const {
    researchEvidence: _re,
    evidenceTimeline: _et,
    selectedSkills: _sk,
    skillLoadFailures: _sf,
    debugDecisionFlow: _dbg,
    // Raw provider/stage cause — audit + logs only, never the browser.
    operatorFailureDetail: _ofd,
    // The frozen bundle the brain decided on: model context, the numeric level
    // menu, and up to three full base64 chart PNGs. It exists for audit and
    // re-evaluation on the server; the browser gets the public projection.
    evidenceSnapshot: _snap,
    ...safe
  } = result;
  const factors = safe.confidenceSemantics?.factors;
  if (factors?.length) {
    safe.confidenceSemantics = {
      ...safe.confidenceSemantics!,
      factors: factors
        .filter((f) => !INTERNAL_TERM_PATTERNS.some((re) => re.test(f.factor)))
        .map((f) => ({
          factor: sanitizeFactorName(f.factor),
          status: "considered",
          effect: sanitizeEffect(f.effect),
        })),
    };
  }
  return safe;
}

function sanitizeFactorName(name: string): string {
  const map: Record<string, string> = {
    trading_dna: "historical_similarity",
    shadow_trader: "historical_agreement",
    backtest: "historical_performance",
    validation: "historical_stability",
    research_swarm: "deep_comparison",
  };
  return map[name] ?? name.replace(/_/g, " ");
}

function sanitizeEffect(effect: string): string {
  let out = effect;
  for (const re of INTERNAL_TERM_PATTERNS) {
    out = out.replace(re, "historical evidence");
  }
  return out.slice(0, 160);
}

/** Persistable subset — no research transparency blobs. */
export function toPersistableAgentResult(
  result: AgentFinalResult,
): AgentFinalResult {
  return stripInternalFieldsFromClientResult(result);
}
