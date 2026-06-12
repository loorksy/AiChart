import type { CompatModelInfo } from "./openaiCompat";

/** Google Gemini OpenAI-compatible chat endpoint. */
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

export async function listGeminiChatModels(
  apiKey: string,
): Promise<CompatModelInfo[]> {
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
    .filter((m) => m.id && /gemini/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
