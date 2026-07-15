/**
 * CLIENT-SAFE builders for realtime session control messages.
 *
 * The agent identity itself lives server-side (voiceIdentity.ts) and is set
 * once when the client secret is minted — the browser never carries or
 * re-sends the prompt. These builders only manage transport behaviour:
 * `create_response: false` keeps the model from answering on its own (the
 * platform agent drives every substantive turn), and `buildSpeakResponse`
 * makes the model deliver an answer the unified agent already computed.
 */
import type { AppLocale } from "@/lib/i18n";

/**
 * The `session.update` payload sent over the data channel once connected.
 * Deliberately does NOT include `instructions` — the canonical identity was
 * applied server-side at mint time and must not be overwritten by the client.
 */
export function buildRealtimeSessionUpdate(input: {
  locale: AppLocale;
  voice: string;
}): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
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
