import { sanitizeContextText } from "./context/contextSafety";
import type { SafeMemoryContext, SafeTradeLessonContext } from "./context/types";
import {
  insertSemanticMemory,
  markSemanticMemoriesUsed,
  searchSemanticMemories,
  type SearchSemanticMemoryMatch,
} from "@/lib/semanticMemory";
import { searchSimilarLessons } from "@/lib/tradeMemory";
import type { TradeLessonMatch } from "@/lib/types";

export const AGENT_MEMORY_TYPES = [
  "user_preference",
  "trading_preference",
  "risk_preference",
  "strategy_preference",
  "feedback",
  "trade_lesson",
  "recommendation_outcome",
  "research_finding",
  "chart_preference",
  "platform_preference",
] as const;
export type AgentMemoryType = (typeof AGENT_MEMORY_TYPES)[number];

export interface SafeAgentMemory extends SafeMemoryContext {
  type: AgentMemoryType;
  title?: string;
  confidence: number;
  source: string;
  safetyClassification: string[];
  createdAt: number;
  symbol?: string;
  timeframe?: string;
  locale?: "ar" | "en";
}

export interface AgentMemoryRecallResult {
  memories: SafeAgentMemory[];
  tradeLessons: SafeTradeLessonContext[];
  warnings: Array<"semantic_recall_failed" | "trade_lesson_recall_failed">;
}

interface RecallDependencies {
  searchMemories: typeof searchSemanticMemories;
  searchLessons: typeof searchSimilarLessons;
  markUsed: typeof markSemanticMemoriesUsed;
}

const DEFAULT_DEPS: RecallDependencies = {
  searchMemories: searchSemanticMemories,
  searchLessons: searchSimilarLessons,
  markUsed: markSemanticMemoriesUsed,
};

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function memoryType(value: string | null | undefined): AgentMemoryType {
  return AGENT_MEMORY_TYPES.includes(value as AgentMemoryType)
    ? (value as AgentMemoryType)
    : "user_preference";
}

const PREFERENCE_TYPES: ReadonlySet<AgentMemoryType> = new Set([
  "user_preference",
  "trading_preference",
  "risk_preference",
  "strategy_preference",
  "chart_preference",
  "platform_preference",
]);

/** Normalized token set for near-duplicate / contradiction comparison. */
function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function safeMemoryMatches(input: {
  matches: readonly SearchSemanticMemoryMatch[];
  symbol?: string;
  timeframe?: string;
  locale?: "ar" | "en";
  now?: number;
  limit?: number;
}): SafeAgentMemory[] {
  const now = input.now ?? Date.now();
  const symbol = input.symbol?.toUpperCase();
  const timeframe = input.timeframe?.toLowerCase();
  const ranked = input.matches
    .flatMap((match) => {
      const expiresAt = timestamp(match.expires_at);
      if (expiresAt && expiresAt <= now) return [];
      const sanitized = sanitizeContextText(match.content, {
        messageId: String(match.id), maxChars: 1_600, untrusted: true,
      });
      if (sanitized.rejected || !sanitized.text) return [];
      const confidence = Math.max(0, Math.min(Number(match.confidence ?? 0.8), 1));
      const createdAt = timestamp(match.created_at);
      const ageDays = createdAt ? Math.max(0, (now - createdAt) / 86_400_000) : 365;
      const recency = Math.max(0, 1 - ageDays / 180);
      const symbolBoost = symbol && match.symbol?.toUpperCase() === symbol ? 0.08 : 0;
      const timeframeBoost = timeframe && match.timeframe?.toLowerCase() === timeframe ? 0.04 : 0;
      const localeBoost = input.locale && match.locale === input.locale ? 0.02 : 0;
      // Explicit user statements and corrections outrank inferred memories.
      const type = memoryType(match.memory_type ?? match.category);
      const provenanceBoost =
        match.source === "explicit_user_preference" ? 0.08 : type === "feedback" ? 0.05 : 0;
      const rank =
        match.score * 0.55 + confidence * 0.25 + recency * 0.1 +
        symbolBoost + timeframeBoost + localeBoost + provenanceBoost;
      const locale: "ar" | "en" | undefined =
        match.locale === "ar" || match.locale === "en" ? match.locale : undefined;
      return [{
        id: String(match.id),
        type,
        content: sanitized.text,
        confidence,
        source: match.source ?? "agent",
        safetyClassification: sanitized.classifications,
        createdAt,
        expiresAt: expiresAt || undefined,
        symbol: match.symbol ?? undefined,
        timeframe: match.timeframe ?? undefined,
        locale,
        rank,
        tokens: tokenSet(sanitized.text),
      }];
    })
    .sort((a, b) => b.rank - a.rank || b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  // Deduplicate near-identical memories and resolve contradictions: for two
  // overlapping preference memories of the same type and symbol scope, the
  // NEWER one wins (a user correction supersedes the older inferred value)
  // even when the older one ranked higher on similarity alone.
  const kept: typeof ranked = [];
  for (const entry of ranked) {
    let superseded = false;
    for (let i = 0; i < kept.length; i += 1) {
      const existing = kept[i]!;
      const overlap = jaccard(entry.tokens, existing.tokens);
      const sameScope =
        entry.type === existing.type &&
        (entry.symbol ?? "") === (existing.symbol ?? "");
      const nearDuplicate = overlap >= 0.85;
      const contradictionCandidate =
        sameScope && PREFERENCE_TYPES.has(entry.type) && overlap >= 0.5;
      if (nearDuplicate || contradictionCandidate) {
        if (entry.createdAt > existing.createdAt) kept[i] = entry;
        superseded = true;
        break;
      }
    }
    if (!superseded) kept.push(entry);
  }

  return kept
    .slice(0, Math.max(0, Math.min(input.limit ?? 5, 5)))
    .map((entry) => {
      const memory = { ...entry } as SafeAgentMemory & { rank?: number; tokens?: Set<string> };
      delete memory.rank;
      delete memory.tokens;
      return memory;
    });
}

function safeLessons(matches: readonly TradeLessonMatch[], limit: number): SafeTradeLessonContext[] {
  return matches.flatMap((lesson) => {
    const sanitized = sanitizeContextText(lesson.lesson_ar, {
      messageId: `trade-lesson:${lesson.id}`, maxChars: 1_200, untrusted: true,
    });
    if (sanitized.rejected || !sanitized.text) return [];
    return [{
      id: String(lesson.id),
      content: sanitized.text,
      symbol: lesson.symbol,
      timeframe: lesson.timeframe ?? undefined,
      createdAt: timestamp(lesson.created_at),
    }];
  }).slice(0, Math.max(0, Math.min(limit, 3)));
}

export async function recallAgentMemoryForContext(
  input: {
    userId: number;
    query: string;
    symbol?: string;
    timeframe?: string;
    locale?: "ar" | "en";
    memoryLimit?: number;
    lessonLimit?: number;
    now?: number;
  },
  dependencies: RecallDependencies = DEFAULT_DEPS,
): Promise<AgentMemoryRecallResult> {
  const warnings: AgentMemoryRecallResult["warnings"] = [];
  const semanticMatches = await dependencies.searchMemories(
    input.userId, input.query, undefined, Math.min(input.memoryLimit ?? 5, 5), 0.1,
  ).catch(() => {
    warnings.push("semantic_recall_failed");
    return [];
  });
  const memories = safeMemoryMatches({
    matches: semanticMatches,
    symbol: input.symbol,
    timeframe: input.timeframe,
    locale: input.locale,
    now: input.now,
    limit: input.memoryLimit,
  });
  const lessons = input.symbol
    ? await dependencies.searchLessons(input.userId, {
        symbol: input.symbol,
        snapshot: { timeframe: input.timeframe, query: input.query.slice(0, 300) },
        limit: Math.min(input.lessonLimit ?? 3, 3),
        minScore: 0.1,
      }).catch(() => {
        warnings.push("trade_lesson_recall_failed");
        return [];
      })
    : [];
  void dependencies.markUsed(input.userId, memories.map((memory) => Number(memory.id))).catch(() => {});
  return { memories, tradeLessons: safeLessons(lessons, input.lessonLimit ?? 3), warnings };
}

export interface AgentMemoryCandidate {
  type: AgentMemoryType;
  content: string;
  confidence: number;
}

export function classifyAgentMemoryCandidate(text: string): AgentMemoryCandidate | null {
  const sanitized = sanitizeContextText(text, { maxChars: 1_200, untrusted: true });
  if (sanitized.rejected || sanitized.classifications.includes("secret_detected")) return null;
  if (/^(?:hi|hello|thanks|مرحبا|مرحباً|شكرا|شكراً)[!.\s]*$/iu.test(sanitized.text)) return null;
  if (/\b(?:price|سعر)\b.{0,20}\d+(?:\.\d+)?/iu.test(sanitized.text)) return null;
  const rules: Array<[AgentMemoryType, RegExp]> = [
    ["risk_preference", /(?:أفضل|افضل|prefer|always|دائماً|دائما).{0,50}(?:مخاطر|risk|وقف|stop)/iu],
    ["trading_preference", /(?:أفضل|افضل|prefer|أتداول|اتداول).{0,60}(?:scalp|swing|intraday|سكالب|ذهب|forex)/iu],
    ["chart_preference", /(?:أفضل|افضل|prefer).{0,60}(?:رسم|drawing|chart|ألوان|colors)/iu],
    ["feedback", /(?:صحح|correction|wrong|خطأ|feedback)/iu],
    ["strategy_preference", /(?:استراتيجية|strategy).{0,80}(?:أفضل|افضل|prefer|استخدم|use)/iu],
  ];
  const match = rules.find(([, pattern]) => pattern.test(sanitized.text));
  return match ? { type: match[0], content: sanitized.text, confidence: 0.85 } : null;
}

export async function saveAgentMemoryCandidate(input: {
  userId: number;
  candidate: AgentMemoryCandidate;
  sourceChatId?: string;
  sourceMessageId?: string;
  locale?: "ar" | "en";
  symbol?: string;
  timeframe?: string;
}): Promise<SafeAgentMemory> {
  const stored = await insertSemanticMemory({
    userId: input.userId,
    category: input.candidate.type,
    memoryType: input.candidate.type,
    content: input.candidate.content,
    confidence: input.candidate.confidence,
    source: "explicit_user_preference",
    safetyClassification: "untrusted_content",
    sourceChatId: input.sourceChatId,
    sourceMessageId: input.sourceMessageId,
    locale: input.locale,
    symbol: input.symbol,
    timeframe: input.timeframe,
  });
  return safeMemoryMatches({ matches: [{ ...stored, score: 1 }], limit: 1 })[0]!;
}
