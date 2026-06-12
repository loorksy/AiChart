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
