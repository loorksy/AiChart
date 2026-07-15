/**
 * Natural status replies for normal-flow orchestrator outcomes (cancelled
 * recommendation, nothing stored, re-drawn recommendation, cleared drawings…).
 *
 * These used to be fixed Arabic sentences. Now the model composes the reply
 * from structured facts in the operator's language, matching the canonical
 * identity. The deterministic fallback below is used ONLY when the LLM is
 * unavailable or fails (protocol-failure case) — it is minimal, bilingual,
 * and never the primary path.
 */
import { callLLM, isLLMConfigured } from "@/lib/llm";
import type { AppLocale } from "@/lib/i18n";
import { canonicalIdentityCore } from "./canonicalIdentity";
import { sanitizePublicText } from "./activity";

export interface StatusReplyInput {
  /** What just happened / what the user asked, as structured facts. */
  facts: Record<string, unknown>;
  /** Short English description of the situation for the model (not shown). */
  situation: string;
  /** Operator locale for the fallback; the model mirrors the user message. */
  locale: AppLocale;
  /** The user's message, when available, so tone/language mirror it. */
  userMessage?: string;
  /** Deterministic fallback when the LLM is unavailable (per locale). */
  fallback: string;
  maxTokens?: number;
}

export async function composeStatusReply(input: StatusReplyInput): Promise<string> {
  if (!isLLMConfigured()) return input.fallback;
  try {
    const res = await callLLM({
      system: [
        canonicalIdentityCore(),
        "",
        "Compose ONE short, natural reply for the situation described below, grounded ONLY in the provided facts.",
        "Reply in the same language as the operator's message (fall back to the given locale when no message is present).",
        "Do not invent prices, levels, news, or state not present in the facts. Do not add greetings, introductions, or capability lists. Do not reveal internal reasoning.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            situation: input.situation,
            locale: input.locale,
            operatorMessage: input.userMessage?.slice(0, 400) ?? null,
            facts: input.facts,
          }),
        },
      ],
      maxTokens: input.maxTokens ?? 400,
    });
    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return sanitizePublicText(text) || input.fallback;
  } catch {
    return input.fallback;
  }
}

/** Minimal bilingual fallback helper (LLM-failure path only). */
export function bilingual(locale: AppLocale, ar: string, en: string): string {
  return locale === "en" ? en : ar;
}
