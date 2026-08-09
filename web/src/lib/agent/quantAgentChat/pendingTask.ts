/**
 * Composer Coach (plan Feature B) — the guided `generate_strategy` wizard's
 * pure step machine. Deliberately pure: no DB/LLM imports, so every function
 * here is independently unit-testable and safe to call from any layer.
 * `orchestrator.ts` is the only caller that touches persistence (via
 * `chatStore.setPendingTask`) or the LLM pipeline.
 *
 * Design (plan §B2): a fixed 4-step sequence — direction bias → regime
 * affinity → free-text entry/exit logic → confirm — that ends by handing a
 * single synthesized description sentence to the EXISTING, unmodified
 * `generateQuantStrategyCodeFromDescription` pipeline. This is an honest,
 * simpler stand-in for QuantDinger's free-form NLP composer coach, not a
 * byte-for-byte port of it (see the plan's own rationale).
 */
import { DEFAULT_LOCALE, t, type AppLocale } from "@/lib/i18n";
import type { ComposerCoach } from "./types";

export interface QuantAgentPendingTask {
  type: "generate_strategy_guided";
  step: 1 | 2 | 3 | 4;
  collected: {
    directionBias?: "buy" | "sell" | "either";
    regimeAffinity?: "trend" | "range" | "volatile" | "any";
    entryExitDescription?: string;
  };
}

/**
 * The standard cancel keyword, mirroring the exact matching style of the
 * button-driven cancel labels already used elsewhere (`agent.cancel` /
 * `rec.page.cancel`) applied to free-typed text: case-insensitive, trimmed,
 * exact match — not a substring match, so normal strategy descriptions that
 * happen to mention cancellation logic are never misfired on.
 */
const CANCEL_WORDS = ["cancel", "إلغاء", "الغاء"];

export function isQuantAgentCancelMessage(message: string): boolean {
  return CANCEL_WORDS.includes(message.trim().toLowerCase());
}

const CONFIRM_WORDS_EN = ["generate"];
const CONFIRM_WORDS_AR = ["يولّد", "يولد"];

function isConfirmMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return CONFIRM_WORDS_EN.some((w) => normalized.includes(w)) || CONFIRM_WORDS_AR.some((w) => message.includes(w));
}

function classifyDirectionBias(message: string): "buy" | "sell" | "either" {
  const lower = message.toLowerCase();
  const hasBuy = lower.includes("buy") || message.includes("شراء");
  const hasSell = lower.includes("sell") || message.includes("بيع");
  if (hasBuy && !hasSell) return "buy";
  if (hasSell && !hasBuy) return "sell";
  return "either";
}

function classifyRegimeAffinity(message: string): "trend" | "range" | "volatile" | "any" {
  const lower = message.toLowerCase();
  if (lower.includes("trend") || message.includes("اتجاهي") || message.includes("متجه")) return "trend";
  if (
    lower.includes("range") ||
    lower.includes("sideways") ||
    message.includes("عرضي") ||
    message.includes("نطاق")
  )
    return "range";
  if (lower.includes("volatil") || message.includes("متقلب") || message.includes("تقلب")) return "volatile";
  return "any";
}

const DIRECTION_LABEL_KEY: Record<NonNullable<QuantAgentPendingTask["collected"]["directionBias"]>, string> = {
  buy: "qa.chat.coach.step1.buy",
  sell: "qa.chat.coach.step1.sell",
  either: "qa.chat.coach.step1.either",
};

const REGIME_LABEL_KEY: Record<NonNullable<QuantAgentPendingTask["collected"]["regimeAffinity"]>, string> = {
  trend: "qa.chat.coach.step2.trend",
  range: "qa.chat.coach.step2.range",
  volatile: "qa.chat.coach.step2.volatile",
  any: "qa.chat.coach.step2.any",
};

// English tokens used to build the synthesized description handed to the
// (unmodified) generation pipeline — kept separate from the localized UI
// labels above so the LLM always receives a consistent, testable sentence
// regardless of the user's locale.
const DIRECTION_DESCRIPTION_PHRASE: Record<
  NonNullable<QuantAgentPendingTask["collected"]["directionBias"]>,
  string
> = {
  buy: "buy-only",
  sell: "sell-only",
  either: "either-direction",
};

const REGIME_DESCRIPTION_PHRASE: Record<NonNullable<QuantAgentPendingTask["collected"]["regimeAffinity"]>, string> = {
  trend: "trending",
  range: "ranging",
  volatile: "volatile",
  any: "any",
};

function badgeTitle(locale: AppLocale, step: 1 | 2 | 3 | 4): string {
  return t(locale, "qa.chat.coach.title", { step: String(step) });
}

function step1Coach(locale: AppLocale): { reply: string; composerCoach: ComposerCoach } {
  const reply = t(locale, "qa.chat.coach.step1.question");
  return {
    reply,
    composerCoach: {
      title: badgeTitle(locale, 1),
      description: reply,
      ready: false,
      suggestions: [
        { label: t(locale, "qa.chat.coach.step1.buy"), value: t(locale, "qa.chat.coach.step1.buy") },
        { label: t(locale, "qa.chat.coach.step1.sell"), value: t(locale, "qa.chat.coach.step1.sell") },
        { label: t(locale, "qa.chat.coach.step1.either"), value: t(locale, "qa.chat.coach.step1.either") },
      ],
    },
  };
}

function step2Coach(locale: AppLocale): { reply: string; composerCoach: ComposerCoach } {
  const reply = t(locale, "qa.chat.coach.step2.question");
  return {
    reply,
    composerCoach: {
      title: badgeTitle(locale, 2),
      description: reply,
      ready: false,
      suggestions: [
        { label: t(locale, "qa.chat.coach.step2.trend"), value: t(locale, "qa.chat.coach.step2.trend") },
        { label: t(locale, "qa.chat.coach.step2.range"), value: t(locale, "qa.chat.coach.step2.range") },
        { label: t(locale, "qa.chat.coach.step2.volatile"), value: t(locale, "qa.chat.coach.step2.volatile") },
        { label: t(locale, "qa.chat.coach.step2.any"), value: t(locale, "qa.chat.coach.step2.any") },
      ],
    },
  };
}

function step3Coach(locale: AppLocale): { reply: string; composerCoach: ComposerCoach } {
  const question = t(locale, "qa.chat.coach.step3.question");
  const example = t(locale, "qa.chat.coach.step3.example");
  return {
    reply: `${question}\n\n${example}`,
    composerCoach: {
      title: badgeTitle(locale, 3),
      description: `${question}\n\n${example}`,
      ready: false,
      // No clickable chips at this step by design (plan §B2) — free text only.
      suggestions: [],
    },
  };
}

function step4Coach(
  locale: AppLocale,
  collected: QuantAgentPendingTask["collected"],
): { reply: string; composerCoach: ComposerCoach } {
  const direction = collected.directionBias ? t(locale, DIRECTION_LABEL_KEY[collected.directionBias]) : "";
  const regime = collected.regimeAffinity ? t(locale, REGIME_LABEL_KEY[collected.regimeAffinity]) : "";
  const entryExit = collected.entryExitDescription ?? "";
  const confirmHint = t(locale, "qa.chat.coach.step4.confirm_hint");
  const reply = t(locale, "qa.chat.coach.step4.summary", { direction, regime, entryExit, confirmHint });
  return {
    reply,
    composerCoach: {
      title: badgeTitle(locale, 4),
      description: reply,
      ready: true,
      suggestions: [
        {
          label: t(locale, "qa.chat.coach.step4.confirm_button"),
          value: locale === "en" ? "generate" : "يولّد",
        },
      ],
    },
  };
}

/** Builds a fresh step-1 wizard. Called when `generate_strategy` is freshly detected. */
export function startPendingTask(locale: AppLocale = DEFAULT_LOCALE): {
  task: QuantAgentPendingTask;
  reply: string;
  composerCoach: ComposerCoach;
} {
  const task: QuantAgentPendingTask = { type: "generate_strategy_guided", step: 1, collected: {} };
  const { reply, composerCoach } = step1Coach(locale);
  return { task, reply, composerCoach };
}

export interface AdvancePendingTaskResult {
  /** The next persisted task state, or `null` once the wizard is done (confirmed). */
  task: QuantAgentPendingTask | null;
  reply: string;
  composerCoach: ComposerCoach | null;
  /** True only when step 4 was just confirmed — the caller should now run generation. */
  readyToGenerate: boolean;
  /** Only set when `readyToGenerate` is true. */
  syntheticDescription?: string;
}

/**
 * Advances the wizard by one user message. Cancellation is intentionally NOT
 * handled here — `orchestrator.ts` checks `isQuantAgentCancelMessage` BEFORE
 * calling this, at every step, and short-circuits without ever reaching this
 * function (plan §B3).
 */
export function advancePendingTask(
  task: QuantAgentPendingTask,
  message: string,
  locale: AppLocale = DEFAULT_LOCALE,
): AdvancePendingTaskResult {
  if (task.step === 1) {
    const directionBias = classifyDirectionBias(message);
    const nextTask: QuantAgentPendingTask = {
      type: "generate_strategy_guided",
      step: 2,
      collected: { ...task.collected, directionBias },
    };
    const { reply, composerCoach } = step2Coach(locale);
    return { task: nextTask, reply, composerCoach, readyToGenerate: false };
  }

  if (task.step === 2) {
    const regimeAffinity = classifyRegimeAffinity(message);
    const nextTask: QuantAgentPendingTask = {
      type: "generate_strategy_guided",
      step: 3,
      collected: { ...task.collected, regimeAffinity },
    };
    const { reply, composerCoach } = step3Coach(locale);
    return { task: nextTask, reply, composerCoach, readyToGenerate: false };
  }

  if (task.step === 3) {
    const trimmed = message.trim();
    if (!trimmed) {
      // Defensive: an empty free-text answer re-asks the same step instead
      // of silently advancing with nothing collected.
      const { reply, composerCoach } = step3Coach(locale);
      return { task, reply, composerCoach, readyToGenerate: false };
    }
    const nextTask: QuantAgentPendingTask = {
      type: "generate_strategy_guided",
      step: 4,
      collected: { ...task.collected, entryExitDescription: trimmed },
    };
    const { reply, composerCoach } = step4Coach(locale, nextTask.collected);
    return { task: nextTask, reply, composerCoach, readyToGenerate: false };
  }

  // task.step === 4 — confirm or re-prompt (field editing by free text is
  // explicitly out of scope this round, plan §B2/§20).
  if (isConfirmMessage(message)) {
    const { collected } = task;
    const directionBias = collected.directionBias ?? "either";
    const regimeAffinity = collected.regimeAffinity ?? "any";
    const entryExit = collected.entryExitDescription ?? "";
    const syntheticDescription = `A ${DIRECTION_DESCRIPTION_PHRASE[directionBias]} strategy suited for ${REGIME_DESCRIPTION_PHRASE[regimeAffinity]} markets. Entry/exit logic: ${entryExit}`;
    return { task: null, reply: "", composerCoach: null, readyToGenerate: true, syntheticDescription };
  }
  const { reply, composerCoach } = step4Coach(locale, task.collected);
  return { task, reply, composerCoach, readyToGenerate: false };
}

/**
 * Defensive parse of the `pending_task_json`-derived `unknown` value read off
 * `AgentChatSession.pendingTask` — mirrors the same "never trust stored JSON
 * shape blindly" discipline used elsewhere for `result_json`.
 */
export function coerceQuantAgentPendingTask(value: unknown): QuantAgentPendingTask | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.type !== "generate_strategy_guided") return null;
  if (v.step !== 1 && v.step !== 2 && v.step !== 3 && v.step !== 4) return null;
  const rawCollected = v.collected && typeof v.collected === "object" ? (v.collected as Record<string, unknown>) : {};
  const directionBias =
    rawCollected.directionBias === "buy" || rawCollected.directionBias === "sell" || rawCollected.directionBias === "either"
      ? rawCollected.directionBias
      : undefined;
  const regimeAffinity =
    rawCollected.regimeAffinity === "trend" ||
    rawCollected.regimeAffinity === "range" ||
    rawCollected.regimeAffinity === "volatile" ||
    rawCollected.regimeAffinity === "any"
      ? rawCollected.regimeAffinity
      : undefined;
  const entryExitDescription =
    typeof rawCollected.entryExitDescription === "string" ? rawCollected.entryExitDescription : undefined;
  return {
    type: "generate_strategy_guided",
    step: v.step,
    collected: { directionBias, regimeAffinity, entryExitDescription },
  };
}
