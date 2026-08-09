import { sanitizeContextText } from "../context/contextSafety";

export function redactedPreview(value: unknown, maxChars = 800): string {
  let serialized: string;
  try { serialized = typeof value === "string" ? value : JSON.stringify(value); }
  catch { serialized = "[unserializable]"; }
  const sanitized = sanitizeContextText(serialized, { maxChars, untrusted: true });
  return sanitized.rejected ? "[rejected sensitive content]" : sanitized.text;
}
