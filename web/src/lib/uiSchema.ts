export function extractUISchema(text: string): { cleanText: string; uiSchema: any | null } {
  const regex = /```(?:json|ui-schema)?\s*(\{\s*"layout"[\s\S]*?\})\s*```/i;
  const match = text.match(regex);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.layout)) {
        const cleanText = text.replace(regex, "").trim();
        return { cleanText, uiSchema: parsed };
      }
    } catch (e) {
      console.warn("Failed to parse extracted UI schema:", e);
    }
  }
  return { cleanText: text, uiSchema: null };
}
