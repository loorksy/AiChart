/**
 * Extracts a UI-schema block from an assistant reply. The agent appends a fenced
 * ```ui-schema (or ```json) block whose JSON has a `layout` array. We parse the
 * WHOLE fenced body (so nested objects work) and accept any key order — the
 * presence of a `layout` array is what identifies it as a schema.
 */
export function extractUISchema(text: string): {
  cleanText: string;
  uiSchema: unknown | null;
} {
  if (!text) return { cleanText: text, uiSchema: null };

  const fence = /```(?:json|ui-schema)?[ \t]*\r?\n?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const body = match[1].trim();
    if (!body.includes('"layout"')) continue;
    try {
      const parsed = JSON.parse(body) as { layout?: unknown };
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.layout)) {
        const cleanText = (
          text.slice(0, match.index) + text.slice(match.index + match[0].length)
        ).trim();
        return { cleanText, uiSchema: parsed };
      }
    } catch {
      // Not valid JSON — keep scanning for another block.
    }
  }
  return { cleanText: text, uiSchema: null };
}
