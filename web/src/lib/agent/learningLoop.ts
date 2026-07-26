/**
 * Learning loop from realised trade outcomes (RELIABILITY_PLAN.md item 14).
 *
 * The infrastructure to record lessons already exists (`get_trade_lessons`,
 * `record_exit_decision`), but nothing fed those outcomes back into new
 * decisions — the agent re-made the same mistake on the same symbol with no
 * memory of it.
 *
 * Hard rule, stated in the plan and enforced by the shape of this module:
 * **lessons are EVIDENCE, never a veto.** This produces a compact, factual
 * summary for the decision model to weigh. It returns no decision, no score,
 * and no gate — the model keeps sole authority over BUY/SELL/WAIT, and the
 * statistical gates are untouched.
 */

export interface TradeOutcomeRecord {
  symbol: string;
  direction: "buy" | "sell";
  /** true = target reached, false = stopped out. Unresolved trades excluded. */
  won: boolean;
  /** Realised R multiple, when known. */
  rMultiple?: number | null;
  /** Trading session the entry occurred in, when known. */
  session?: "asia" | "london" | "newyork" | null;
  /** Strategy behind the entry, when it came from one. */
  strategyId?: string | null;
  closedAt: number;
}

export interface LessonSummary {
  symbol: string;
  sampleSize: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averageR: number | null;
  /** Sessions where losses clearly concentrate (>=60% of losses, min 3). */
  weakSessions: string[];
  /** Direction that clearly underperforms, when one does. */
  weakDirection: "buy" | "sell" | null;
  /** Short factual lines for the model. Never instructions. */
  notes: string[];
  /** True when the sample is too small to say anything at all. */
  insufficient: boolean;
}

/** Minimum resolved outcomes before any pattern is worth mentioning. */
export const MIN_LESSON_SAMPLE = 5;

/**
 * Summarize recent realised outcomes for one symbol.
 *
 * Every claim is quantified. The notes deliberately read as observations
 * ("3 of the last 5 losses were in the Asia session") rather than directives
 * ("do not trade Asia") — the difference between evidence and a veto.
 */
export function summarizeTradeLessons(input: {
  symbol: string;
  outcomes: readonly TradeOutcomeRecord[];
  /** Only consider the most recent N resolved outcomes. */
  limit?: number;
}): LessonSummary {
  const limit = Math.max(1, input.limit ?? 20);
  const recent = [...input.outcomes]
    .filter((o) => o.symbol.toUpperCase() === input.symbol.toUpperCase())
    .sort((a, b) => b.closedAt - a.closedAt)
    .slice(0, limit);

  const base: LessonSummary = {
    symbol: input.symbol.toUpperCase(),
    sampleSize: recent.length,
    wins: 0,
    losses: 0,
    winRate: null,
    averageR: null,
    weakSessions: [],
    weakDirection: null,
    notes: [],
    insufficient: recent.length < MIN_LESSON_SAMPLE,
  };

  if (recent.length === 0) return base;

  const wins = recent.filter((o) => o.won).length;
  const losses = recent.length - wins;
  const rValues = recent
    .map((o) => o.rMultiple)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));

  const summary: LessonSummary = {
    ...base,
    wins,
    losses,
    winRate: recent.length > 0 ? wins / recent.length : null,
    averageR:
      rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null,
  };

  // Below the minimum sample we report the counts but claim NO pattern.
  if (summary.insufficient) return summary;

  // Session concentration among losses.
  const lossRecords = recent.filter((o) => !o.won && o.session);
  if (lossRecords.length >= 3) {
    const bySession = new Map<string, number>();
    for (const o of lossRecords) {
      bySession.set(o.session!, (bySession.get(o.session!) ?? 0) + 1);
    }
    for (const [session, count] of bySession) {
      if (count / lossRecords.length >= 0.6) {
        summary.weakSessions.push(session);
        summary.notes.push(
          `${count} من آخر ${lossRecords.length} صفقات خاسرة على ${summary.symbol} كانت في جلسة ${session}.`,
        );
      }
    }
  }

  // Direction underperformance — only when both directions have a real sample.
  const buys = recent.filter((o) => o.direction === "buy");
  const sells = recent.filter((o) => o.direction === "sell");
  if (buys.length >= 3 && sells.length >= 3) {
    const buyWr = buys.filter((o) => o.won).length / buys.length;
    const sellWr = sells.filter((o) => o.won).length / sells.length;
    if (buyWr + 0.3 <= sellWr) {
      summary.weakDirection = "buy";
      summary.notes.push(
        `صفقات الشراء الأخيرة على ${summary.symbol} أضعف من صفقات البيع (${buys.filter((o) => o.won).length}/${buys.length} مقابل ${sells.filter((o) => o.won).length}/${sells.length}).`,
      );
    } else if (sellWr + 0.3 <= buyWr) {
      summary.weakDirection = "sell";
      summary.notes.push(
        `صفقات البيع الأخيرة على ${summary.symbol} أضعف من صفقات الشراء (${sells.filter((o) => o.won).length}/${sells.length} مقابل ${buys.filter((o) => o.won).length}/${buys.length}).`,
      );
    }
  }

  if (summary.winRate != null && summary.notes.length === 0) {
    summary.notes.push(
      `آخر ${recent.length} نتيجة على ${summary.symbol}: ${wins} رابحة و${losses} خاسرة.`,
    );
  }

  return summary;
}

/**
 * Render the summary as a compact evidence block for the decision prompt.
 * Explicitly labelled as context to weigh — the wording itself reinforces that
 * the model decides, and that these lines never override live analysis.
 */
export function renderLessonsForPrompt(summary: LessonSummary): string | null {
  if (summary.sampleSize === 0) return null;
  if (summary.insufficient) {
    return `سجل النتائج على ${summary.symbol}: ${summary.sampleSize} نتيجة فقط — عينة أصغر من أن تُبنى عليها ملاحظة.`;
  }
  const lines = [
    `سجل النتائج المتحققة على ${summary.symbol} (سياق تزنه، لا قاعدة تُلزمك ولا بديل عن قراءة السوق الحالية):`,
    ...summary.notes.map((n) => `- ${n}`),
  ];
  if (summary.averageR != null) {
    lines.push(`- متوسط العائد المتحقق: ${summary.averageR.toFixed(2)}R.`);
  }
  return lines.join("\n");
}
