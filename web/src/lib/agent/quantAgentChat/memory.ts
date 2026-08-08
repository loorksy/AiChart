/**
 * Quant Agent Chat memory (plan §6). No new table: this reuses
 * `semantic_memories` under a dedicated category/source, the same pattern
 * `@/lib/agent/memory/scenarioMemory.ts` documents for Lonora's scenario
 * blocks — but scoped entirely to Quant Agent Chat's own category so the two
 * agents' memories never mix in a recall query.
 *
 * `draftMemoryCandidate` only SUGGESTS a candidate for the turn's response —
 * it never writes anything. `confirmQuantAgentMemory` is the only write path,
 * and it is only ever called from the explicit confirm endpoint
 * (`/api/quant-agent/chat/memory/confirm`) after the user presses "Remember
 * this" in `QuantAgentMemorySaveBanner`.
 */
import { insertSemanticMemory } from "@/lib/semanticMemory";
import type { SemanticMemory } from "@/lib/types";
import type { QuantAgentMemoryCandidate } from "./types";

export const QUANT_AGENT_MEMORY_CATEGORY = "quant_agent_note";
export const QUANT_AGENT_MEMORY_SOURCE = "quant_agent_chat";

export type { QuantAgentMemoryCandidate };

/**
 * Cheap heuristic: note-worthy phrasing (an explicit ask to remember, or a
 * stated preference) surfaces a candidate. Anything else returns null — no
 * candidate is shown, nothing is drafted "just in case".
 */
const NOTE_WORTHY_PATTERNS: RegExp[] = [
  /\bremember\b/i,
  /\bdon'?t forget\b/i,
  /\bnote that\b/i,
  /\bkeep in mind\b/i,
  /\bi (?:always|usually|never|prefer|like|want)\b/i,
  /\bfrom now on\b/i,
  /تذكر/,
  /احفظ/,
  /لا تنس/,
  /لا تنسى/,
  /خذ بعين الاعتبار/,
  /دايما|دائما|دائماً/,
  /أفضل|افضل|أفضّل/,
];

const MAX_CANDIDATE_LEN = 400;

/** Suggests a memory candidate from the user's own turn text. Never writes. */
export function draftMemoryCandidate(turnText: string): QuantAgentMemoryCandidate | null {
  const trimmed = turnText.trim();
  if (!trimmed) return null;
  if (!NOTE_WORTHY_PATTERNS.some((re) => re.test(trimmed))) return null;
  const content =
    trimmed.length <= MAX_CANDIDATE_LEN ? trimmed : `${trimmed.slice(0, MAX_CANDIDATE_LEN - 1).trim()}…`;
  return { content };
}

export interface ConfirmQuantAgentMemoryOptions {
  chatId?: string;
  locale?: "ar" | "en";
  confidence?: number;
}

/** The ONLY write path for Quant Agent Chat memory. Explicit-confirm only. */
export async function confirmQuantAgentMemory(
  userId: number,
  content: string,
  opts: ConfirmQuantAgentMemoryOptions = {},
): Promise<SemanticMemory> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Memory content is empty");
  }
  return insertSemanticMemory({
    userId,
    category: QUANT_AGENT_MEMORY_CATEGORY,
    content: trimmed.slice(0, 2000),
    source: QUANT_AGENT_MEMORY_SOURCE,
    memoryType: "user_preference",
    confidence: Math.max(0, Math.min(opts.confidence ?? 0.75, 1)),
    safetyClassification: "untrusted_content",
    sourceChatId: opts.chatId ?? null,
    locale: opts.locale ?? null,
  });
}
