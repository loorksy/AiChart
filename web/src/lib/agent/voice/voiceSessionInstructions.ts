/**
 * Pure builders for the realtime session configuration.
 *
 * The realtime model IS the AiChart trading agent speaking — the same
 * canonical identity as text chat (agent/workspace/SYSTEM.md core). Voice is
 * only the transport: market analysis, account state, recommendations, and
 * execution all come from the platform agent turn (final transcript →
 * unified chart agent → spoken final answer), never from the realtime
 * model's own knowledge. Automatic response creation stays disabled so every
 * substantive turn is driven by the platform; the identity below governs how
 * the model behaves whenever it does speak (greetings, clarifications,
 * reading answers) so it never presents itself as a transcription tool.
 */
import type { AppLocale } from "@/lib/i18n";
import { canonicalIdentityCore } from "../canonicalIdentity";

export function voiceSystemInstructions(locale: AppLocale): string {
  const localeHint =
    locale === "en"
      ? "The operator's interface language is English."
      : "The operator's interface language is Arabic.";
  return [
    canonicalIdentityCore(),
    "",
    "# Voice transport rules",
    "You are speaking with the operator over live voice. You are the same AiChart trading agent as in text chat — never describe yourself as a transcription, dictation, or speech-to-text assistant; converting speech is an invisible transport function, not your identity or purpose.",
    "The platform computes every market answer: analyses, prices, candles, spreads, news, account balances, recommendations, and execution status arrive as prepared answers for you to deliver. Never invent or estimate any of those yourself, and never answer a market or account question from your own knowledge — the prepared answer is the only source.",
    "When given a prepared answer to speak, deliver it faithfully and completely without adding numbers, levels, or analysis of your own.",
    "Preserve trading symbols and trading shorthand exactly as written (XAUUSD, EURUSD, TP1, SL, 15m).",
    `Mirror the operator's spoken language naturally on every turn. ${localeHint}`,
  ].join("\n");
}

/**
 * The `session.update` payload sent over the data channel once connected.
 * `create_response: false` keeps the model from answering on its own — the
 * platform agent drives every response. Input transcription is enabled so we
 * get user text.
 */
export function buildRealtimeSessionUpdate(input: {
  locale: AppLocale;
  voice: string;
}): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      instructions: voiceSystemInstructions(input.locale),
      voice: input.voice,
      modalities: ["audio", "text"],
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        silence_duration_ms: 500,
        // We route the final transcript through the unified agent and speak
        // the result — the model must not auto-generate its own answer.
        create_response: false,
        interrupt_response: true,
      },
    },
  };
}

/**
 * A `response.create` payload that makes the model speak an exact answer the
 * unified agent already computed. The text is the public final answer only —
 * never activity, debug, reasoning, JSON, or mutation objects.
 */
export function buildSpeakResponse(text: string, locale: AppLocale): Record<string, unknown> {
  const preface =
    locale === "en"
      ? "Deliver the following prepared answer to the operator exactly as written, without adding anything:"
      : "انطق الإجابة الجاهزة التالية للمستخدم كما هي تمامًا دون إضافة أي شيء:";
  return {
    type: "response.create",
    response: {
      modalities: ["audio", "text"],
      instructions: `${preface}\n\n${text}`,
    },
  };
}
