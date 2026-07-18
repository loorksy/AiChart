/**
 * CLIENT-SAFE builders for realtime session control messages.
 *
 * Shapes follow OpenAI Realtime GA (`session.type`, `audio.input` /
 * `audio.output`, `output_modalities`). The agent identity lives server-side
 * (voiceIdentity.ts) at client-secret mint time — the browser must not
 * overwrite `instructions`.
 *
 * `create_response: false` keeps the model from answering on its own; the
 * platform agent drives every substantive turn, then `buildSpeakResponse`
 * delivers that answer as audio.
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
  const language = input.locale === "ar" ? "ar" : "en";
  return {
    type: "session.update",
    session: {
      type: "realtime",
      output_modalities: ["audio"],
      audio: {
        input: {
          // Required for conversation.item.input_audio_transcription.* events.
          // Without this, VAD can fire while create_response:false yields silence.
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language,
          },
          turn_detection: {
            type: "server_vad",
            // Route final transcript through the unified agent; do not let the
            // realtime model invent its own trading answer.
            create_response: false,
            interrupt_response: true,
          },
        },
        output: {
          voice: input.voice,
        },
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
      output_modalities: ["audio"],
      instructions: `${preface}\n\n${text}`,
    },
  };
}
