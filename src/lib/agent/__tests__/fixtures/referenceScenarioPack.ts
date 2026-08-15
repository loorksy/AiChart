/**
 * Reference scenario registry (plan §16).
 *
 * Each row names the market situation, the fixture inputs that make it
 * deterministic, the allowed result, the forbidden result, and the DB /
 * lifecycle expectations. Tests consume this registry; they do not invent
 * per-case constants of their own.
 *
 * Network and live models are forbidden here. A controlled model adapter may
 * read the same Evidence Bundle the production brain would see and emit the
 * real decision contract — it must never write a recommendation itself.
 */

import {
  FIXTURE_PNG_CONTEXT_B64,
  FIXTURE_PNG_MISSING,
  FIXTURE_PNG_PRIMARY_B64,
} from "./tinyPng";

export type PlanType = "immediate" | "anticipatory" | "conditional";
export type Direction = "buy" | "sell";
export type ParityClass = "identical" | "explained" | "unexplained" | "n/a";

export interface ReferenceScenario {
  id: string;
  title: string;
  /** Stable candle / cost / calendar / image bundle key. */
  fixture: {
    symbol: string;
    interval: string;
    shape: "trend_up" | "range" | "mid_range" | "forming" | "conflict" | "thin" | "corrupt";
    images: Array<{
      timeframe: string;
      imageBase64: string;
      numericContext: { price: number; rsi?: number; atr?: number };
    }>;
    costProfile: {
      source: "live_samples" | "static_model" | "absent";
      spreadPips: number | null;
      session: "asia" | "london" | "newyork";
    };
    calendar: {
      state: "event_imminent" | "provider_absent" | "quiet";
      title?: string;
      minutesUntil?: number;
    };
    historicalCases: "sufficient" | "insufficient" | "absent";
    statisticalSupport: "strong" | "moderate" | "weak" | "unavailable";
  };
  expected: {
    direction?: Direction;
    planType?: PlanType;
    statisticalSupport?: "strong" | "moderate" | "weak" | "unavailable";
    executionState?: string;
    revisionCount?: number;
    transition?: string | null;
    notificationCount?: number;
    notificationEvent?: string | null;
    parityClassification?: ParityClass;
    operationalBlock?: boolean;
  };
  forbidden: string[];
  expectedDbRows?: {
    recommendation?: boolean;
    revision1?: boolean;
    evidenceSnapshot?: boolean;
    decisionTrace?: boolean;
    alertDedupe?: boolean;
  };
}

/** Session cost samples — enough for a live median without a live EA. */
export const FIXTURE_COST_SAMPLES = [
  { symbol: "EURUSD", session: "london", spreadPips: 0.8 },
  { symbol: "EURUSD", session: "london", spreadPips: 0.9 },
  { symbol: "EURUSD", session: "london", spreadPips: 1.0 },
  { symbol: "EURUSD", session: "london", spreadPips: 1.1 },
  { symbol: "EURUSD", session: "london", spreadPips: 0.85 },
  { symbol: "XAUUSD", session: "newyork", spreadPips: 18 },
  { symbol: "XAUUSD", session: "newyork", spreadPips: 22 },
  { symbol: "XAUUSD", session: "newyork", spreadPips: 20 },
  { symbol: "XAUUSD", session: "newyork", spreadPips: 19 },
  { symbol: "XAUUSD", session: "newyork", spreadPips: 21 },
] as const;

/** High-impact calendar event fixture (no network). */
export const FIXTURE_CALENDAR_EVENT = {
  title: "US CPI",
  currency: "USD",
  impact: "high" as const,
  minutesUntil: 7,
};

const baseImages = (price: number) => [
  {
    timeframe: "15m",
    imageBase64: FIXTURE_PNG_PRIMARY_B64,
    numericContext: { price, rsi: 54, atr: price * 0.001 },
  },
  {
    timeframe: "1h",
    imageBase64: FIXTURE_PNG_CONTEXT_B64,
    numericContext: { price: price * 1.0001, rsi: 48, atr: price * 0.002 },
  },
  {
    timeframe: "4h",
    imageBase64: FIXTURE_PNG_MISSING,
    numericContext: { price: price * 0.999, rsi: 45 },
  },
];

export const REFERENCE_SCENARIOS: ReferenceScenario[] = [
  {
    id: "clear_trend",
    title: "اتجاه واضح",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: {
      direction: "buy",
      planType: "immediate",
      revisionCount: 1,
      notificationCount: 1,
      notificationEvent: "opportunity_created",
      parityClassification: "identical",
    },
    forbidden: ["WAIT", "missing plan layer"],
    expectedDbRows: {
      recommendation: true,
      revision1: true,
      evidenceSnapshot: true,
      decisionTrace: true,
      alertDedupe: true,
    },
  },
  {
    id: "volatile_range",
    title: "سوق متذبذب",
    fixture: {
      symbol: "XAUUSD",
      interval: "5m",
      shape: "range",
      images: baseImages(2400),
      costProfile: { source: "live_samples", spreadPips: 20, session: "newyork" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "weak",
    },
    expected: { planType: "conditional", revisionCount: 1, notificationCount: 1 },
    forbidden: ["متذبذب، لا فرصة", "WAIT"],
  },
  {
    id: "mid_range_tight",
    title: "منتصف نطاق ضيق",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "mid_range",
      images: baseImages(1.0845),
      costProfile: { source: "static_model", spreadPips: 1.2, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "absent",
      statisticalSupport: "unavailable",
    },
    expected: { planType: "conditional", revisionCount: 1 },
    forbidden: ["WAIT", "invented mid-range market entry"],
  },
  {
    id: "forming_pattern",
    title: "نموذج قيد التكوين",
    fixture: {
      symbol: "GBPUSD",
      interval: "15m",
      shape: "forming",
      images: baseImages(1.27),
      costProfile: { source: "live_samples", spreadPips: 1.0, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { planType: "anticipatory", revisionCount: 1 },
    forbidden: ["ننتظر الاكتمال", "WAIT"],
  },
  {
    id: "unclassified_structure",
    title: "بنية غير مصنفة",
    fixture: {
      symbol: "USDJPY",
      interval: "1h",
      shape: "range",
      images: baseImages(150.2),
      costProfile: { source: "static_model", spreadPips: 1.4, session: "asia" },
      calendar: { state: "quiet" },
      historicalCases: "insufficient",
      statisticalSupport: "unavailable",
    },
    expected: { planType: "conditional", statisticalSupport: "unavailable" },
    forbidden: ["invented pattern name", "رفض التحليل"],
  },
  {
    id: "conflicting_timeframes",
    title: "فريمات متعارضة",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "conflict",
      images: baseImages(1.086),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "weak",
    },
    expected: { planType: "conditional" },
    forbidden: ["الفريمات متعارضة بلا ترجيح", "WAIT"],
  },
  {
    id: "no_matching_strategy",
    title: "لا استراتيجية مطابقة",
    fixture: {
      symbol: "AUDUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(0.66),
      costProfile: { source: "static_model", spreadPips: 1.1, session: "asia" },
      calendar: { state: "quiet" },
      historicalCases: "absent",
      statisticalSupport: "unavailable",
    },
    expected: { statisticalSupport: "unavailable", revisionCount: 1 },
    forbidden: ["409", "WAIT", "invented historical confidence"],
  },
  {
    id: "weak_backtest",
    title: "باكتيست ضعيف أو فاشل",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "weak",
    },
    expected: { statisticalSupport: "weak", revisionCount: 1 },
    forbidden: ["cancel recommendation", "hide weakness"],
  },
  {
    id: "no_similar_cases",
    title: "لا حالات تاريخية مشابهة",
    fixture: {
      symbol: "NZDUSD",
      interval: "1h",
      shape: "range",
      images: baseImages(0.61),
      costProfile: { source: "static_model", spreadPips: 1.5, session: "asia" },
      calendar: { state: "quiet" },
      historicalCases: "absent",
      statisticalSupport: "unavailable",
    },
    expected: { statisticalSupport: "unavailable" },
    forbidden: ["invented historical rates"],
  },
  {
    id: "cost_ruins_entry",
    title: "تكلفة تفسد الدخول الحالي",
    fixture: {
      symbol: "XAUUSD",
      interval: "5m",
      shape: "mid_range",
      images: baseImages(2405),
      costProfile: { source: "live_samples", spreadPips: 35, session: "newyork" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { planType: "conditional", revisionCount: 1 },
    forbidden: ["distorted SL/TP", "WAIT"],
  },
  {
    id: "economic_event_near",
    title: "حدث اقتصادي قريب",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "range",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 1.5, session: "london" },
      calendar: { state: "event_imminent", title: "US CPI", minutesUntil: 7 },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { planType: "conditional", notificationEvent: "economic_event_near" },
    forbidden: ["WAIT because of news", "ignore event"],
  },
  {
    id: "calendar_provider_absent",
    title: "غياب مزود التقويم",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "static_model", spreadPips: 1.0, session: "london" },
      calendar: { state: "provider_absent" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { revisionCount: 1 },
    forbidden: ["fabricated calendar events"],
  },
  {
    id: "corrupt_market_data",
    title: "بيانات سوق تالفة",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "corrupt",
      images: [],
      costProfile: { source: "absent", spreadPips: null, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "absent",
      statisticalSupport: "unavailable",
    },
    expected: { operationalBlock: true, revisionCount: 0, notificationCount: 0 },
    forbidden: ["invented prices", "WAIT as market opinion"],
  },
  {
    id: "condition_during_revision",
    title: "تحقق الشرط أثناء تحديث نسخة",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { revisionCount: 2, transition: "stale_revision" },
    forbidden: ["execute old revision"],
  },
  {
    id: "expired_or_invalidated",
    title: "توصية منتهية أو invalidated",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { transition: "execution_skipped", notificationCount: 1 },
    forbidden: ["execute terminal plan", "silent skip"],
  },
  {
    id: "platform_mcp_parity",
    title: "Platform/MCP parity",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { parityClassification: "identical" },
    forbidden: ["unexplained difference"],
  },
  {
    id: "hidden_wait_guard",
    title: "hidden WAIT guard",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "mid_range",
      images: baseImages(1.085),
      costProfile: { source: "static_model", spreadPips: 1.0, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "absent",
      statisticalSupport: "unavailable",
    },
    expected: { statisticalSupport: "unavailable" },
    // Avoid doctrineGuard ban phrases that treat wait as a fallback outcome.
    forbidden: [
      "stage fault presented as market wait",
      "mid-range treated as absent opportunity",
      "WAIT — as market opinion",
    ],
  },
  {
    id: "duplicate_notification_guard",
    title: "duplicate notification guard",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { notificationCount: 1, notificationEvent: "opportunity_created" },
    forbidden: ["second opportunity_created for same revision"],
  },
  {
    id: "opportunity_created_once",
    title: "opportunity_created exactly once",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { notificationCount: 1, notificationEvent: "opportunity_created", revisionCount: 1 },
    forbidden: ["duplicate birth alert on retry / Platform+MCP"],
  },
  {
    id: "retest_started",
    title: "retest_started",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { transition: "retest_started", notificationCount: 1 },
    forbidden: ["tracker decides direction"],
  },
  {
    id: "breakout_no_retest",
    title: "breakout_no_retest",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.086),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { transition: "breakout_no_retest", notificationCount: 1 },
    forbidden: ["tracker decides direction"],
  },
  {
    id: "extra_timeframe_round",
    title: "extra timeframe round",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "conflict",
      images: [
        ...baseImages(1.085),
        {
          timeframe: "5m",
          imageBase64: FIXTURE_PNG_PRIMARY_B64,
          numericContext: { price: 1.0852, rsi: 57 },
        },
      ],
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { revisionCount: 1 },
    forbidden: ["more than one extra-frame round", "abort on one failed image"],
  },
  {
    id: "live_cost_fallback",
    title: "live-cost fallback",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "trend_up",
      images: baseImages(1.085),
      costProfile: { source: "static_model", spreadPips: 1.2, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "sufficient",
      statisticalSupport: "moderate",
    },
    expected: { revisionCount: 1 },
    forbidden: ["unlabelled static cost presented as live"],
  },
  {
    id: "case_memory_insufficient",
    title: "case-memory insufficient sample",
    fixture: {
      symbol: "EURUSD",
      interval: "15m",
      shape: "range",
      images: baseImages(1.085),
      costProfile: { source: "live_samples", spreadPips: 0.9, session: "london" },
      calendar: { state: "quiet" },
      historicalCases: "insufficient",
      statisticalSupport: "unavailable",
    },
    expected: { statisticalSupport: "unavailable" },
    forbidden: ["percentages without sample floor"],
  },
];

export function scenarioById(id: string): ReferenceScenario {
  const found = REFERENCE_SCENARIOS.find((row) => row.id === id);
  if (!found) throw new Error(`unknown reference scenario: ${id}`);
  return found;
}

/** Weekday-safe synthetic bars — deterministic and offline. */
export function fixtureBars(input: {
  count: number;
  intervalMs: number;
  endAt: number;
  start: number;
  shape: ReferenceScenario["fixture"]["shape"];
}): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
}> {
  const times: number[] = [];
  let cursor = input.endAt;
  while (times.length < input.count) {
    const day = new Date(cursor).getUTCDay();
    if (times.length === 0 || (day !== 0 && day !== 6)) times.push(cursor);
    cursor -= input.intervalMs;
  }
  return times.reverse().map((time, index) => {
    if (input.shape === "corrupt") {
      // Genuinely malformed — high below low, the kind of impossible candle a
      // broken parser/feed can actually emit. Deliberately NOT run through the
      // isFinite fallback below (which would launder a NaN into an ordinary
      // finite candle): both numbers here are finite, just logically invalid,
      // so any pipeline stage that assumes high >= low must reject or flag it.
      return {
        time,
        open: input.start,
        high: input.start - 0.0006,
        low: input.start + 0.0006,
        close: input.start,
        volume: 100 + index,
        complete: true,
      };
    }
    let center = input.start;
    switch (input.shape) {
      case "trend_up":
        center = input.start + index * 0.00002;
        break;
      case "range":
      case "forming":
        center = input.start + Math.sin(index / 5) * 0.0004;
        break;
      case "mid_range":
        center = input.start + Math.sin(index / 8) * 0.00015;
        break;
      case "conflict":
        center = input.start + (index % 20 < 10 ? 0.0003 : -0.00025);
        break;
      case "thin":
        center = input.start;
        break;
    }
    const noise = 0.00005;
    const open = center - noise;
    const close = center + noise;
    return {
      time,
      open: Number.isFinite(open) ? open : input.start,
      high: Number.isFinite(center) ? center + 0.00025 : input.start,
      low: Number.isFinite(center) ? center - 0.00025 : input.start,
      close: Number.isFinite(close) ? close : input.start,
      volume: 100 + index,
      complete: true,
    };
  });
}
