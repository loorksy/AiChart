/**
 * Pull a JSON object out of a model reply that may wrap it in fences,
 * <think> tags, or prose. Prefers a parseable object; if the reply was
 * truncated mid-object (reasoning models often spend the completion budget
 * on thinking), returns the last complete `{...}` found.
 */

function stripThinkTags(raw: string): string {
  return raw
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<thinking\b[^>]*>[\s\S]*$/gi, "");
}

function readBalancedObject(
  text: string,
  start: number,
): { value: string; end: number } | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value: text.slice(start, i + 1), end: i + 1 };
      }
    }
  }
  return null;
}

function completeJsonObjects(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    const slice = readBalancedObject(text, i);
    if (slice) {
      out.push(slice.value);
      i = slice.end;
    } else {
      i += 1;
    }
  }
  return out;
}

export function extractJson(raw: string): string {
  const text = stripThinkTags(raw).trim();
  if (!text) return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const objects = completeJsonObjects(body);
  if (objects.length > 0) {
    const start = body.indexOf("{");
    const fromStart = start >= 0 ? objects.find((o) => body.indexOf(o) === start) : undefined;
    if (fromStart) return fromStart;
    return objects[objects.length - 1]!;
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body;
}
