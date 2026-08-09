import { fetchWithTimeout, httpTimeoutMs } from "./externalFetch";
import { getPlatformValue, getPlatformValueAsync } from "./platformConfig";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
const DEFAULT_TTS_MODEL = "tts-1";

async function openAiKey(): Promise<string | null> {
  return (await getPlatformValueAsync("OPENAI_API_KEY")) ?? null;
}

/** Creates a 1536-dim embedding vector via OpenAI (pgvector-compatible). */
export async function createEmbedding(text: string): Promise<number[]> {
  const key = await openAiKey();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY غير مُعدّ — أضِفه من لوحة المفاتيح لتفعيل ذاكرة الصفقات.",
    );
  }

  const res = await fetchWithTimeout(
    `${OPENAI_API}/embeddings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_EMBED_MODEL,
        input: text.slice(0, 8000),
      }),
      cache: "no-store",
    },
    { timeoutMs: httpTimeoutMs(), label: "OpenAI embeddings" },
  );

  const body = (await res.json().catch(() => ({}))) as {
    data?: { embedding?: number[] }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      body.error?.message || `فشل embedding (HTTP ${res.status}).`,
    );
  }
  const vec = body.data?.[0]?.embedding;
  if (!vec?.length) throw new Error("embedding فارغ من OpenAI.");
  return vec;
}

/** Synthesizes OGG speech bytes for Telegram sendVoice. */
export async function synthesizeSpeech(
  text: string,
  voice = "alloy",
): Promise<Buffer> {
  const key = await openAiKey();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY غير مُعدّ — أضِفه لتفعيل الردود الصوتية.",
    );
  }

  const res = await fetchWithTimeout(
    `${OPENAI_API}/audio/speech`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_TTS_MODEL,
        input: text.slice(0, 4000),
        voice,
        response_format: "opus",
      }),
      cache: "no-store",
    },
    { timeoutMs: httpTimeoutMs(), label: "OpenAI TTS" },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      errBody.slice(0, 200) || `فشل TTS (HTTP ${res.status}).`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export function isEmbeddingConfigured(): boolean {
  return Boolean(getPlatformValue("OPENAI_API_KEY"));
}
