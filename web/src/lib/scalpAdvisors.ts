/**
 * Scalp multi-agent advisory model. Five specialist analysts produce opinions in
 * ONE structured LLM call; the Scalping Orchestrator weighs them into a final
 * decision + confidence. Advisors only advise — the orchestrator decides, and
 * execution still passes through executeIntent → Risk Guard.
 */
import { callLLM } from "./llm";
import type { OpportunityCandidate } from "./monitor";
import type { TradingSettings } from "./types";

export interface AdvisorOpinion {
  opinion: "enter" | "skip" | "caution";
  confidence: number; // 0-100
  rationale_ar: string;
}

export interface ScalpAdvisoryResult {
  momentum: AdvisorOpinion;
  structure: AdvisorOpinion;
  volatility: AdvisorOpinion;
  risk: AdvisorOpinion;
  strategy: AdvisorOpinion;
  /** Scalping Orchestrator final call. */
  decision: "enter" | "skip";
  confidence: number; // 0-100
  rationale_ar: string;
}

function extractText(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n")
    .trim();
}

function defOpinion(op: AdvisorOpinion["opinion"]): AdvisorOpinion {
  return { opinion: op, confidence: 50, rationale_ar: "تقييم افتراضي." };
}

/** Pure confidence gate (unit-tested). */
export function shouldEnter(
  result: Pick<ScalpAdvisoryResult, "decision" | "confidence">,
  threshold: number,
): boolean {
  return result.decision === "enter" && result.confidence >= threshold;
}

/** Minimum orchestrator confidence to act, by trading style. */
export function scalpConfidenceThreshold(style: TradingSettings["style"]): number {
  if (style === "conservative") return 75;
  if (style === "balanced") return 65;
  return 55;
}

function parse(raw: string): ScalpAdvisoryResult {
  const m = raw.match(/\{[\s\S]*\}/);
  const p = JSON.parse(m ? m[0]! : raw) as Partial<ScalpAdvisoryResult>;
  const op = (o?: AdvisorOpinion, d: AdvisorOpinion["opinion"] = "skip") =>
    o && typeof o.confidence === "number" ? o : defOpinion(d);
  const decision = p.decision === "enter" ? "enter" : "skip";
  return {
    momentum: op(p.momentum),
    structure: op(p.structure),
    volatility: op(p.volatility),
    risk: op(p.risk),
    strategy: op(p.strategy),
    decision,
    confidence:
      typeof p.confidence === "number"
        ? Math.max(0, Math.min(100, p.confidence))
        : 0,
    rationale_ar: p.rationale_ar ?? "لم يُولَّد ملخّص.",
  };
}

/**
 * Run the five analysts + orchestrator in one LLM call. On any failure returns a
 * safe skip (no trade) — the loop simply keeps scanning.
 */
export async function evaluateScalpAdvisors(
  candidate: OpportunityCandidate,
  side: "buy" | "sell",
  settings: TradingSettings,
  historyNote = "",
): Promise<ScalpAdvisoryResult> {
  const snap = candidate.snapshot as unknown as Record<string, unknown>;
  const system = [
    "أنت 5 محلّلي سكالب + منسّق (Scalping Orchestrator)، تُعيد JSON واحداً فقط.",
    "المحلّلون: momentum (الزخم)، structure (بنية السوق/الدعم والمقاومة)، volatility (التقلّب)، risk (المخاطر)، strategy (توافق الاستراتيجية).",
    "كل محلّل: { opinion: enter|skip|caution, confidence: 0-100, rationale_ar: جملة }.",
    "المنسّق يوازن الآراء ويُخرج: decision: enter|skip, confidence: 0-100, rationale_ar.",
    "الجودة قبل الكمّية — لا تدخل إلا عند تلاقٍ واضح. أعد JSON فقط بالمفاتيح: momentum, structure, volatility, risk, strategy, decision, confidence, rationale_ar.",
  ].join("\n");

  const userMsg = [
    `الفرصة: ${candidate.symbol} اتجاه ${side} · إطار ${candidate.interval}`,
    `الأسلوب: ${settings.style} · السوق: ${settings.active_market}`,
    `نقاط المسح: ${candidate.score} · إشارات: ${candidate.signals.join("، ")}`,
    `السعر: ${snap.price ?? "—"} · RSI: ${snap.rsi14 ?? "—"} · MACD: ${snap.macd ?? "—"} · الاتجاه: ${snap.trend ?? "—"}`,
    `قمة/قاع 24س: ${snap.high24h ?? "—"} / ${snap.low24h ?? "—"} · تغيّر: ${snap.change24hPct ?? "—"}%`,
    snap.summary ? `ملخّص: ${snap.summary}` : "",
    historyNote ? `أداء تاريخي: ${historyNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await callLLM({
      system,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 1024,
    });
    return parse(extractText(res.content));
  } catch (e) {
    console.error("[scalpAdvisors] failed", e);
    return {
      momentum: defOpinion("skip"),
      structure: defOpinion("skip"),
      volatility: defOpinion("skip"),
      risk: defOpinion("skip"),
      strategy: defOpinion("skip"),
      decision: "skip",
      confidence: 0,
      rationale_ar: "تعذّر تشغيل المستشارين — تخطّي الفرصة.",
    };
  }
}
