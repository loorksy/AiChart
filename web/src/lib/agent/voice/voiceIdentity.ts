/**
 * SERVER-ONLY voice identity. The realtime model IS the AiChart trading agent
 * speaking — the same canonical identity as text chat (agent/workspace/
 * SYSTEM.md core). Voice is only the transport: market analysis, account
 * state, recommendations, and execution all come from the platform agent turn
 * (final transcript → unified chart agent → spoken final answer), never from
 * the realtime model's own knowledge.
 *
 * These instructions are set ONCE at client-secret mint time on the server
 * (realtimeClientSecret.ts) and persist for the session — the browser never
 * receives or re-sends the prompt text.
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
