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
  return input.matches
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
      const rank = match.score * 0.55 + confidence * 0.25 + recency * 0.1 + symbolBoost + timeframeBoost + localeBoost;
      const locale: "ar" | "en" | undefined =
        match.locale === "ar" || match.locale === "en" ? match.locale : undefined;
      return [{
        id: String(match.id),
        type: memoryType(match.memory_type ?? match.category),
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
      }];
    })
    .sort((a, b) => b.rank - a.rank || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(input.limit ?? 5, 5)))
    .map((entry) => {
      const memory = { ...entry } as SafeAgentMemory & { rank?: number };
      delete memory.rank;
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
