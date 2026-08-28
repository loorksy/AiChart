/**
 * Thinking narration — the agent's live reasoning trace, derived from
 * EVIDENCE, never scripted.
 *
 * The request, paraphrased: show part of the agent's OWN thinking, not a
 * fixed string. Raw model chain-of-thought is doctrine-forbidden on every surface
 * (systemPrompt.ts, activity.ts), so the honest middle is THIS: one short
 * sentence per real pipeline step, composed at the moment the step's actual
 * values exist — the candle count that was read, the trend that was detected,
 * the news window that was checked, the gate that refused. Every function
 * here demands the real value as an argument; there is nothing to emit
 * without one, which is what keeps this from ever regressing into the
 * scripted ticker that staticPhrases.test.ts bans.
 *
 * Canned interpolation lives here as FALLBACK only — used when the
 * provider produced zero thinking/reasoning for the run. The live path is
 * `liveThinking.ts` sinking Anthropic thinking blocks / OpenAI reasoning.
 */
import { t, type AppLocale } from "@/lib/i18n";
import { sanitizeActivityMessage } from "./activity";
import { scrubInternalIdentifiers } from "./userSafeOutbound";
import type { Bias, TrendLabel } from "./marketContext/detectors";
import type { GateVerdict } from "./gates/types";

/**
 * The leakage guard every thinking line passes before it leaves the process:
 * chain-of-thought phrasing is stripped (same sanitizer as activity events)
 * and system identifiers are scrubbed. Both the web SSE transport and the
 * Telegram progress bubble call this; a surface that skips it is a leak.
 */
export function sanitizeThinkingLine(text: string): string {
  return scrubInternalIdentifiers(sanitizeActivityMessage(text));
}

const price = (value: number): string => value.toFixed(2);

export function narrateMarketRead(input: {
  locale: AppLocale;
  interval: string;
  candleCount: number;
  currentPrice: number;
}): string | null {
  if (!Number.isFinite(input.currentPrice) || input.candleCount <= 0) return null;
  return t(input.locale, "agent.think.market_read", {
    count: String(input.candleCount),
    interval: input.interval,
    price: price(input.currentPrice),
  });
}

export function narrateStructure(input: {
  locale: AppLocale;
  interval: string;
  trend: TrendLabel;
  nearestSupport?: number | null;
  nearestResistance?: number | null;
}): string {
  const trend = t(input.locale, `agent.think.trend.${input.trend}`);
  const hasLevels =
    typeof input.nearestSupport === "number" &&
    Number.isFinite(input.nearestSupport) &&
    typeof input.nearestResistance === "number" &&
    Number.isFinite(input.nearestResistance);
  if (hasLevels) {
    return t(input.locale, "agent.think.structure_levels", {
      interval: input.interval,
      trend,
      support: price(input.nearestSupport!),
      resistance: price(input.nearestResistance!),
    });
  }
  return t(input.locale, "agent.think.structure", {
    interval: input.interval,
    trend,
  });
}

export function narrateHigherTimeframe(input: {
  locale: AppLocale;
  higherInterval: string;
  higherBias: Bias;
}): string {
  return t(input.locale, "agent.think.htf", {
    interval: input.higherInterval,
    bias: t(input.locale, `agent.think.bias.${input.higherBias}`),
  });
}

export function narrateNews(input: {
  locale: AppLocale;
  level: "low" | "medium" | "high" | "unknown";
}): string {
  return t(input.locale, `agent.think.news_${input.level}`);
}

export function narrateWeighing(input: {
  locale: AppLocale;
  candidateCount: number;
}): string {
  return input.candidateCount > 0
    ? t(input.locale, "agent.think.weighing", {
        count: String(input.candidateCount),
      })
    : t(input.locale, "agent.think.weighing_none");
}

export function narrateGateOutcome(input: {
  locale: AppLocale;
  verdicts: readonly GateVerdict[];
  allowed: boolean;
  vetoedBy?: GateVerdict | null;
}): string {
  if (!input.allowed && input.vetoedBy) {
    // The localized checklist label (the "news window" wording the gate card
    // uses), never the internal id or the snake_case gate name — the trace
    // obeys the same leakage policy as the reply.
    return t(input.locale, "agent.think.gate_veto", {
      gate: t(input.locale, `gate.label.${input.vetoedBy.id}`),
      reason: input.vetoedBy.reasonAr ?? "",
    });
  }
  return t(input.locale, "agent.think.gates_passed", {
    count: String(input.verdicts.length),
  });
}

export function narrateFollowupCheck(input: {
  locale: AppLocale;
  direction: "buy" | "sell";
  entry: number;
}): string {
  return t(input.locale, "agent.think.followup", {
    direction: t(input.locale, `decision.${input.direction}`),
    entry: price(input.entry),
  });
}
