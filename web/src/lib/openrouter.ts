import {
  getPlatformValueAsync,
  refreshPlatformConfigCache,
} from "./platformConfig";

const API = "https://openrouter.ai/api/v1";
const DEFAULT_AUDIO_MODEL = "google/gemini-2.5-flash";

export interface OpenRouterAudioModel {
  id: string;
  name: string;
}

async function apiKey(): Promise<string | null> {
  await refreshPlatformConfigCache();
  return (await getPlatformValueAsync("OPENROUTER_API_KEY")) ?? null;
}

export async function getAudioModel(): Promise<string> {
  await refreshPlatformConfigCache();
  return (
    (await getPlatformValueAsync("OPENROUTER_AUDIO_MODEL")) ||
    DEFAULT_AUDIO_MODEL
  );
}

export async function isOpenRouterConfigured(): Promise<boolean> {
  return (await apiKey()) !== null;
}

/** Lists OpenRouter models that accept audio input (for the admin picker). */
export async function listOpenRouterAudioModels(
  keyOverride?: string,
): Promise<OpenRouterAudioModel[]> {
  const key = keyOverride ?? (await apiKey());
  if (!key) throw new Error("أضِف مفتاح OpenRouter أولاً.");

  const res = await fetch(`${API}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`تعذّر جلب النماذج من OpenRouter (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as {
    data?: {
      id: string;
      name?: string;
      architecture?: { input_modalities?: string[] };
    }[];
  };
  return (body.data ?? [])
    .filter((m) => m.architecture?.input_modalities?.includes("audio"))
    .map((m) => ({ id: m.id, name: m.name ?? m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
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

/**
 * Transcribes an audio clip via OpenRouter chat completions (audio-input
 * model picked in the admin panel). Returns the verbatim transcript.
 */
export async function transcribeAudio(
  data: Buffer,
  mime: string,
): Promise<string> {
  const key = await apiKey();
  if (!key) {
    throw new Error(
      "تفريغ الصوت غير مفعّل — أضِف OPENROUTER_API_KEY من لوحة الأدمن.",
    );
  }
  const model = await getAudioModel();

  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "فرّغ هذا التسجيل الصوتي حرفياً بلغته الأصلية. أعد النص فقط دون أي تعليق أو مقدمة.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: data.toString("base64"),
                format: audioFormatFromMime(mime),
              },
            },
          ],
        },
      ],
    }),
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      body.error?.message || `فشل تفريغ الصوت (HTTP ${res.status}).`,
    );
  }
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("لم يُرجِع النموذج أي نص.");
  return text;
}
