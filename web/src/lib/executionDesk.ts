/**
 * Execution Desk — deterministic, auditable committee scoring.
 *
 * Four "agents" (Trend, Breakout, Mean-Reversion, Risk) each score a candidate
 * setup 0–100 from REAL market inputs (multi-timeframe indicators, levels,
 * spread/quote/drawdown). The weighted `finalScore` is **advisory** — it is a
 * diagnostic the LLM reads, never a gate. The objective `flags` (mandatory
 * stop, R:R, spread, quote freshness, drawdown) are what Risk Guard enforces.
 *
 * Pure + unit-tested. No I/O, no side effects.
 */
import { computeRewardRisk } from "./riskGuard";

export type Side = "buy" | "sell";

export interface TimeframeRead {
  /** Label e.g. "5m", "1h" — informational. */
  tf: string;
  /** Relative Strength Index (0–100). */
  rsi?: number | null;
  /** MACD histogram (sign = momentum direction, magnitude = strength). */
  macdHist?: number | null;
  /** Last price on this timeframe. */
  price?: number | null;
  /** Trend reference (e.g. SMA/EMA). price>sma = bullish structure. */
  sma?: number | null;
}

export interface DeskInput {
  /** Proposed direction. When omitted, scores measure raw setup strength. */
  side?: Side;
  timeframes: TimeframeRead[];
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Volatility (ATR) — informs breakout/expansion. */
  atr?: number | null;
  /** Spread as a fraction of price (0.001 = 0.1%). */
  spreadPct?: number | null;
  /** Spread ceiling (fraction). Default 0.005 (0.5%). */
  maxSpreadPct?: number | null;
  /** Age of the latest quote in ms. */
  quoteAgeMs?: number | null;
  /** Stale-quote threshold in ms. Default 5000. */
  staleQuoteMs?: number | null;
  /** Today's realized PnL as % of capital (negative = loss). */
  drawdownPct?: number | null;
  /** Daily loss limit % (positive number). */
  dailyLossLimitPct?: number | null;
  /** Minimum acceptable reward:risk. Default 1. */
  minRr?: number;
}

export interface AgentScore {
  /** 0–100. */
  score: number;
  rationale: string;
}

export interface DeskFlags {
  hasStop: boolean;
  rr: number | null;
  rrOk: boolean;
  spreadOk: boolean;
  quoteFresh: boolean;
  drawdownOk: boolean;
}

export interface DeskAssessment {
  trend: AgentScore;
  breakout: AgentScore;
  meanReversion: AgentScore;
  risk: AgentScore;
  /** Weighted advisory score (Trend 30 · Breakout 30 · MeanRev 20 · Risk 20). */
  finalScore: number;
  flags: DeskFlags;
}

export const DESK_WEIGHTS = {
  trend: 0.3,
  breakout: 0.3,
  meanReversion: 0.2,
  risk: 0.2,
} as const;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const isNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/** Net directional structure bias in [-1, 1] from price-vs-SMA and MACD sign. */
function directionalBias(tfs: TimeframeRead[]): number {
  const votes: number[] = [];
  for (const t of tfs) {
    if (isNum(t.price) && isNum(t.sma) && t.sma !== 0) {
      votes.push(Math.sign(t.price - t.sma));
    }
    if (isNum(t.macdHist)) votes.push(Math.sign(t.macdHist));
  }
  if (votes.length === 0) return 0;
  const sum = votes.reduce((a, b) => a + b, 0);
  return Math.max(-1, Math.min(1, sum / votes.length));
}

/** Average RSI across timeframes (null when none available). */
function avgRsi(tfs: TimeframeRead[]): number | null {
  const vals = tfs.map((t) => t.rsi).filter(isNum);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Project a directional metric onto the proposed side (or its strength). */
function projectToSide(bullishScore: number, side?: Side): number {
  if (side === "buy") return bullishScore;
  if (side === "sell") return 100 - bullishScore;
  // No side: reward conviction in either direction.
  return 50 + Math.abs(bullishScore - 50);
}

function scoreTrend(input: DeskInput): AgentScore {
  const bias = directionalBias(input.timeframes);
  const bullish = clamp((bias + 1) * 50); // -1→0, 0→50, 1→100
  const score = clamp(projectToSide(bullish, input.side));
  const dir = bias > 0.15 ? "صاعد" : bias < -0.15 ? "هابط" : "عرضي";
  return {
    score: Math.round(score),
    rationale: `هيكل الاتجاه ${dir} عبر الأطر (انحياز ${bias.toFixed(2)}).`,
  };
}

function scoreBreakout(input: DeskInput): AgentScore {
  const rsi = avgRsi(input.timeframes);
  const macd = input.timeframes.map((t) => t.macdHist).filter(isNum);
  const macdMag =
    macd.length > 0
      ? macd.reduce((a, b) => a + Math.abs(b), 0) / macd.length
      : 0;
  // Momentum extension: RSI distance from 50 + MACD magnitude (normalized).
  const rsiPush = rsi == null ? 0 : (rsi - 50) / 50; // [-1,1]
  const macdPush = Math.tanh(macdMag); // 0→0, large→~1
  const bullishMomentum = clamp(50 + rsiPush * 35 + Math.sign(rsiPush) * macdPush * 15);
  const score = clamp(projectToSide(bullishMomentum, input.side));
  return {
    score: Math.round(score),
    rationale:
      rsi == null
        ? "زخم غير محسوب (لا RSI)."
        : `زخم ${rsi >= 50 ? "صاعد" : "هابط"} (RSI ${rsi.toFixed(0)}، قوة ماكد ${macdMag.toFixed(3)}).`,
  };
}

function scoreMeanReversion(input: DeskInput): AgentScore {
  const rsi = avgRsi(input.timeframes);
  if (rsi == null) {
    return { score: 50, rationale: "ارتداد غير محسوب (لا RSI)." };
  }
  // Oversold (<30) favors a long reversion; overbought (>70) favors a short.
  // normalized: high when oversold (long revert), low when overbought.
  const normalized = clamp(50 + (50 - rsi)); // rsi 0→100 (max long revert), rsi 100→0
  const score = clamp(projectToSide(normalized, input.side));
  return {
    score: Math.round(score),
    rationale:
      rsi > 70
        ? `تشبّع شرائي (RSI ${rsi.toFixed(0)}) — يفضّل ارتداداً هابطاً.`
        : rsi < 30
          ? `تشبّع بيعي (RSI ${rsi.toFixed(0)}) — يفضّل ارتداداً صاعداً.`
          : `لا تطرّف واضح (RSI ${rsi.toFixed(0)}).`,
  };
}

function computeFlags(input: DeskInput): DeskFlags {
  const minRr = isNum(input.minRr) ? input.minRr : 1;
  const rr = computeRewardRisk(input.entry, input.stopLoss, input.takeProfit);
  const maxSpread = isNum(input.maxSpreadPct) ? input.maxSpreadPct : 0.005;
  const staleMs = isNum(input.staleQuoteMs) ? input.staleQuoteMs : 5000;
  return {
    hasStop: input.stopLoss != null,
    rr,
    rrOk: rr == null ? true : rr >= minRr,
    spreadOk: !isNum(input.spreadPct) || input.spreadPct <= maxSpread,
    quoteFresh: !isNum(input.quoteAgeMs) || input.quoteAgeMs <= staleMs,
    drawdownOk:
      !isNum(input.drawdownPct) ||
      !isNum(input.dailyLossLimitPct) ||
      input.dailyLossLimitPct <= 0 ||
      input.drawdownPct > -input.dailyLossLimitPct,
  };
}

function scoreRisk(input: DeskInput, flags: DeskFlags): AgentScore {
  let score = 100;
  const notes: string[] = [];
  if (!flags.hasStop) {
    score -= 40;
    notes.push("بلا وقف");
  }
  if (!flags.rrOk) {
    score -= 25;
    notes.push("عائد/مخاطرة ضعيف");
  }
  if (!flags.spreadOk) {
    score -= 20;
    notes.push("فارق سعر واسع");
  }
  if (!flags.quoteFresh) {
    score -= 30;
    notes.push("تسعيرة قديمة");
  }
  if (!flags.drawdownOk) {
    score -= 30;
    notes.push("قرب حد الخسارة");
  }
  return {
    score: Math.round(clamp(score)),
    rationale:
      notes.length === 0
        ? "ظروف التنفيذ آمنة (وقف محدّد، فارق وتسعيرة سليمة)."
        : `مخاطر تنفيذ: ${notes.join("، ")}.`,
  };
}

/**
 * Run the full committee. The `finalScore` is advisory; `flags` carry the
 * objective conditions Risk Guard enforces. The agent remains the decision
 * maker — it should read these numbers, not be vetoed by them in code.
 */
export function assessSetup(input: DeskInput): DeskAssessment {
  const trend = scoreTrend(input);
  const breakout = scoreBreakout(input);
  const meanReversion = scoreMeanReversion(input);
  const flags = computeFlags(input);
  const risk = scoreRisk(input, flags);
  const finalScore = Math.round(
    trend.score * DESK_WEIGHTS.trend +
      breakout.score * DESK_WEIGHTS.breakout +
      meanReversion.score * DESK_WEIGHTS.meanReversion +
      risk.score * DESK_WEIGHTS.risk,
  );
  return { trend, breakout, meanReversion, risk, finalScore, flags };
}
