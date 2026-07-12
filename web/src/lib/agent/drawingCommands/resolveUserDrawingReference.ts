/**
 * Deterministic resolution of "which user drawing did they mean?" — no LLM.
 * Signals, in priority: explicit id → price/type/ordinal filters → selection
 * hint ("this line") → single drawing → (non-destructive only) most recent.
 * Destructive commands (delete) pass `requireStrong` so an unsignaled, ambiguous
 * reference NEVER resolves — it asks for clarification instead.
 */
import { userDrawings } from "@/lib/chart/drawings/drawingOwnership";
import { drawingPriceLevels } from "@/lib/chart/drawings/serializeUserDrawings";
import type { SerializedChartDrawing } from "@/lib/chart/drawings/types";

export type DrawingReferenceResolution =
  | { kind: "resolved"; drawing: SerializedChartDrawing }
  | { kind: "ambiguous"; candidates: SerializedChartDrawing[] }
  | { kind: "none" };

export interface ResolveDrawingInput {
  message: string;
  drawings: SerializedChartDrawing[];
  selectedDrawingId?: string;
  /** Delete/modify pass true: never fall back to a weak "most recent" guess. */
  requireStrong?: boolean;
  /** Move/modify pass true: a mentioned price is the TARGET, not a selector, so
   *  it must not be used to filter which drawing was meant. */
  ignorePriceSignal?: boolean;
}

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

function asciiDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] ?? d);
}

/** Numbers in the message that look like price levels (>= 1, allow decimals). */
function mentionedPrices(text: string): number[] {
  const matches = asciiDigits(text).match(/\d+(?:\.\d+)?/g) ?? [];
  return matches
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1);
}

function priceMatches(d: SerializedChartDrawing, price: number): boolean {
  const tol = Math.max(price * 0.0015, 0.02);
  return drawingPriceLevels(d).some((lvl) => Math.abs(lvl - price) <= tol);
}

const TYPE_KEYWORDS: Array<{ words: string[]; match: (d: SerializedChartDrawing) => boolean }> = [
  {
    words: ["trend", "trendline", "ترند", "الاتجاه", "خط الاتجاه"],
    match: (d) => /trend|ray|line/i.test(d.type) && !/horizontal/i.test(d.type),
  },
  {
    words: ["support", "دعم"],
    match: (d) => /support|دعم/i.test(d.label ?? "") || /horizontal|hline|price_line/i.test(d.type),
  },
  {
    words: ["resistance", "مقاومة"],
    match: (d) => /resist|مقاوم/i.test(d.label ?? "") || /horizontal|hline|price_line/i.test(d.type),
  },
  {
    words: ["zone", "rectangle", "منطقة", "المنطقة", "مستطيل"],
    match: (d) => /zone|rect|box|range/i.test(d.type),
  },
  {
    words: ["line", "خط"],
    match: (d) => /line|hline|ray/i.test(d.type),
  },
];

function ordinalIndex(text: string, count: number): number | null {
  const t = text.toLowerCase();
  if (/\blast\b|الأخير|الاخير|الأخيرة|الاخيرة/.test(t)) return count - 1;
  if (/\bfirst\b|الأول|الاول|الأولى|الاولى/.test(t)) return 0;
  if (/\bsecond\b|الثاني|الثانية/.test(t)) return 1;
  if (/\bthird\b|الثالث|الثالثة/.test(t)) return 2;
  return null;
}

function wantsThis(text: string): boolean {
  return /\bthis\b|هذا|هذه|هاذي|هاي|هالخط|هالمنطقة/.test(text.toLowerCase());
}

function mostRecent(list: SerializedChartDrawing[]): SerializedChartDrawing {
  return [...list].sort(
    (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
  )[0]!;
}

export function resolveUserDrawingReference(
  input: ResolveDrawingInput,
): DrawingReferenceResolution {
  const users = userDrawings(input.drawings);
  if (users.length === 0) return { kind: "none" };

  const text = input.message;

  // 1. Explicit id in the message.
  const byId = users.find((d) => text.includes(d.id));
  if (byId) return { kind: "resolved", drawing: byId };

  // 2. Signal-based narrowing.
  const prices = input.ignorePriceSignal ? [] : mentionedPrices(text);
  const priceSignal = prices.length > 0;
  const typeMatchers = TYPE_KEYWORDS.filter((k) =>
    k.words.some((w) => text.toLowerCase().includes(w)),
  );
  const typeSignal = typeMatchers.length > 0;

  let candidates = users;
  if (priceSignal) {
    candidates = candidates.filter((d) => prices.some((p) => priceMatches(d, p)));
  }
  if (typeSignal) {
    candidates = candidates.filter((d) => typeMatchers.some((k) => k.match(d)));
  }

  const ord = ordinalIndex(text, candidates.length);
  if (ord != null) {
    const sorted = [...candidates].sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );
    const pick = sorted[ord];
    candidates = pick ? [pick] : [];
  }

  const hasSignal = priceSignal || typeSignal || ord != null;

  // 3. Selection hint for "this line"/"هذا الخط".
  const selected =
    input.selectedDrawingId != null
      ? users.find((d) => d.id === input.selectedDrawingId)
      : undefined;
  if (wantsThis(text) && selected) {
    if (!hasSignal || candidates.some((d) => d.id === selected.id)) {
      return { kind: "resolved", drawing: selected };
    }
  }

  // 4. Decide from the narrowed candidates when a signal was given.
  if (hasSignal) {
    if (candidates.length === 1) return { kind: "resolved", drawing: candidates[0]! };
    if (candidates.length > 1) return { kind: "ambiguous", candidates };
    return { kind: "none" };
  }

  // 5. No explicit signal.
  if (selected) return { kind: "resolved", drawing: selected };
  if (users.length === 1) return { kind: "resolved", drawing: users[0]! };
  if (input.requireStrong) return { kind: "ambiguous", candidates: users };
  return { kind: "resolved", drawing: mostRecent(users) };
}
