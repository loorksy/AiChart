import { newId } from "../activity";
import type { AgentSuggestion } from "./types";

const MAX_LABEL = 60;
const MAX_PROMPT = 240;

/** A raw suggestion candidate as it may arrive from the model. */
export interface RawSuggestion {
  id?: unknown;
  label?: unknown;
  prompt?: unknown;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Sanitize model-produced suggestions: drop entries with an empty label or
 * prompt, trim + cap lengths, de-duplicate by label, assign ids, and cap the
 * list to `maxSuggestions` (default 4). Never invents entries — an empty or
 * invalid input yields an empty list.
 */
export function sanitizeAgentSuggestions(
  raw: unknown,
  maxSuggestions = 4,
): AgentSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const cap = Math.max(0, Math.min(maxSuggestions, 4));
  const seen = new Set<string>();
  const out: AgentSuggestion[] = [];

  for (const item of raw as RawSuggestion[]) {
    if (out.length >= cap) break;
    const label = asText(item?.label).slice(0, MAX_LABEL);
    const prompt = asText(item?.prompt).slice(0, MAX_PROMPT);
    if (!label || !prompt) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const id = asText(item?.id) || newId();
    out.push({ id, label, prompt });
  }

  return out;
}
