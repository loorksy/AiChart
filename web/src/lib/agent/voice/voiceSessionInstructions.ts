/**
 * Pure builders for the realtime session configuration. The realtime model is a
 * SPEECH INTERFACE only: it transcribes the user and vocalizes text we give it.
 * It must NOT invent prices, candles, spreads, news, account data,
 * recommendations, or execution status — the Lonora Unified Chart Agent remains
 * the sole authority. Automatic response creation is disabled so every turn is
 * driven by us (final transcript → Lonora agent → spoken final answer).
 */
import type { AppLocale } from "@/lib/i18n";

export function voiceSystemInstructions(locale: AppLocale): string {
  if (locale === "en") {
    return [
      "You are the voice interface for Lonora, a trading chart assistant.",
      "You only convert speech to text and speak text back. You never analyze",
      "the market yourself and never invent prices, candles, spreads, news,",
      "account balances, recommendations, or execution status.",
      "Speak naturally in English. When asked to speak a provided answer, read it",
      "clearly and verbatim without adding analysis or numbers of your own.",
      "Preserve trading symbols exactly (XAUUSD, EURUSD, TP1, SL, 15m).",
    ].join(" ");
  }
  return [
    "أنت الواجهة الصوتية لـ Lonora، مساعد شارت التداول.",
    "مهمتك فقط تحويل الكلام إلى نص ونطق النص المعطى لك. لا تحلّل السوق بنفسك",
    "ولا تخترع أسعارًا أو شموعًا أو سبريد أو أخبارًا أو بيانات حساب أو توصيات",
    "أو حالة تنفيذ. تحدّث بالعربية بشكل طبيعي، وعند نطق إجابة معطاة لك اقرأها",
    "بوضوح وحرفيًا دون إضافة أرقام أو تحليل من عندك.",
    "حافظ على رموز التداول كما هي (XAUUSD, EURUSD, TP1, SL, 15m).",
  ].join(" ");
}

/**
 * The `session.update` payload sent over the data channel once connected.
 * `create_response: false` keeps the model from answering on its own — Lonora
 * drives every response. Input transcription is enabled so we get user text.
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
        // We route the final transcript through Lonora and speak the result —
        // the model must not auto-generate its own answer.
        create_response: false,
        interrupt_response: true,
      },
    },
  };
}

/**
 * A `response.create` payload that makes the model speak an exact answer we
 * already computed with Lonora. The text is the public final answer only —
 * never activity, debug, reasoning, JSON, or mutation objects.
 */
export function buildSpeakResponse(text: string, locale: AppLocale): Record<string, unknown> {
  const preface =
    locale === "en"
      ? "Say the following answer to the user, verbatim, without adding anything:"
      : "انطق الإجابة التالية للمستخدم حرفيًا دون إضافة أي شيء:";
  return {
    type: "response.create",
    response: {
      modalities: ["audio", "text"],
      instructions: `${preface}\n\n${text}`,
    },
  };
}
