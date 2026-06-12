import type { CompatModelInfo } from "./openaiCompat";

/** Google Gemini OpenAI-compatible chat endpoint. */
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

/** Chat-capable Gemini model ids only (exclude TTS, embed, video, etc.). */
export function isGeminiChatModelId(id: string): boolean {
  const lower = id.trim().toLowerCase();
  if (!lower || !/gemini/i.test(lower)) return false;
  if (
    /-tts\b|tts-|embed|imagen|veo\b|aqa|robotics|learnlm|nano-banana/i.test(
      lower,
    )
  ) {
    return false;
  }
  return true;
}

/** Keys from Google AI Studio — not OAuth / Vertex access tokens (AQ.*). */
export function isGeminiStudioApiKey(key: string): boolean {
  return /^AIza[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

export function normalizeGeminiChatModel(id: string): string {
  const trimmed = id.trim();
  if (isGeminiChatModelId(trimmed)) return trimmed;
  return "gemini-2.5-flash";
}

export async function listGeminiChatModels(
  apiKey: string,
): Promise<CompatModelInfo[]> {
  if (!isGeminiStudioApiKey(apiKey)) {
    throw new Error(
      "مفتاح Gemini غير صالح — استخدم مفتاح AI Studio (يبدأ بـ AIza…) من aistudio.google.com/apikey",
    );
  }
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
  url.searchParams.set("key", apiKey);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      body.slice(0, 200) || `Gemini models HTTP ${res.status}`,
    );
  }
  const data = (await res.json()) as {
    models?: {
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }[];
  };
  return (data.models ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes("generateContent"),
    )
    .map((m) => {
      const id = (m.name ?? "").replace(/^models\//, "");
      return { id, display_name: m.displayName || id };
    })
    .filter((m) => isGeminiChatModelId(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const DEFAULT_TRANSCRIBE_MODEL = "gemini-2.5-flash";

function audioMimeFromFormat(format: string): string {
  switch (format) {
    case "ogg":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "mp4":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "webm":
      return "audio/webm";
    default:
      return "audio/ogg";
  }
}

function audioFormatFromMime(mime: string): string {
  const sub = mime.split("/")[1]?.toLowerCase() ?? "";
  if (sub.includes("ogg") || sub.includes("opus") || sub === "oga") return "ogg";
  if (sub.includes("mpeg") || sub === "mp3") return "mp3";
  if (sub.includes("wav")) return "wav";
  if (sub.includes("mp4") || sub === "m4a" || sub === "x-m4a") return "mp4";
  if (sub.includes("flac")) return "flac";
  if (sub.includes("webm")) return "webm";
  return sub || "ogg";
}

async function geminiApiKey(): Promise<string> {
  const { getPlatformValueAsync, refreshPlatformConfigCache } = await import(
    "./platformConfig"
  );
  await refreshPlatformConfigCache();
  const key = await getPlatformValueAsync("GEMINI_API_KEY");
  if (!key || !isGeminiStudioApiKey(key)) {
    throw new Error(
      "تفريغ الصوت غير مفعّل — أضِف GEMINI_API_KEY (AIza…) من لوحة المنصة.",
    );
  }
  return key;
}

/** Transcribes audio via Gemini multimodal generateContent. */
export async function transcribeAudio(
  data: Buffer,
  mime: string,
): Promise<string> {
  const key = await geminiApiKey();
  const model = DEFAULT_TRANSCRIBE_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: "فرّغ هذا التسجيل الصوتي حرفياً بلغته الأصلية. أعد النص فقط دون أي تعليق أو مقدمة.",
            },
            {
              inline_data: {
                mime_type: audioMimeFromFormat(audioFormatFromMime(mime)),
                data: data.toString("base64"),
              },
            },
          ],
        },
      ],
    }),
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      body.error?.message || `فشل تفريغ الصوت (HTTP ${res.status}).`,
    );
  }
  const text = body.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("لم يُرجِع Gemini أي نص.");
  return text;
}
