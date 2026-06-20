/** OpenRouter model listing — https://openrouter.ai/api/v1/models (public, but
 *  we send the key so private/enabled models resolve too). */
interface NormalizedModel {
  id: string;
  display_name: string;
}

interface OpenRouterModel {
  id: string;
  name?: string;
}

export async function listOpenRouterModels(
  apiKey: string,
): Promise<NormalizedModel[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://aichart.lork.cloud",
      "X-Title": "AiChart",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `تعذّر جلب نماذج OpenRouter (${res.status}). تأكّد من صحة المفتاح.`,
    );
  }
  const data = (await res.json()) as { data?: OpenRouterModel[] };
  const rows = data.data ?? [];
  return rows
    .map((m) => ({ id: m.id, display_name: m.name ?? m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
