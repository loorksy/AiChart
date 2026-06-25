/**
 * Card Policy — contextual selection and deduplication for interactive cards.
 * Ensures "one card at the right time" even when the model or composer over-emits.
 */

import type { ComposedUISchema, UIElement } from "./cardComposer";

export interface CardContext {
  hasRecommendation: boolean;
  hasActionableRecommendation: boolean;
  hasPendingIntent: boolean;
  toolNames: string[];
  executionMode?: "auto" | "approval" | "direct";
}

/** Components redundant when a recommendation card is already shown. */
const RECOMMENDATION_DUPLICATES = new Set([
  "analysis",
  "rsi_gauge",
  "sr_ladder",
  "macd_meter",
  "trend_meter",
  "order_ticket",
  "risk_reward",
  "trade_confirm",
  "quick_trade",
  "chart",
  "image",
  "pattern_card",
  "confidence_meter",
  "signal_strength",
]);

/** Components not shown in direct execution mode. */
const DIRECT_MODE_BLOCKED = new Set([
  "trade_confirm",
  "order_ticket",
]);

/** Components redundant when a pending trade intent exists. */
const INTENT_DUPLICATES = new Set(["order_ticket", "trade_confirm", "quick_trade"]);

/** Secondary analysis widgets — prefer embedding in analysis props. */
const ANALYSIS_EXTRAS = new Set([
  "rsi_gauge",
  "sr_ladder",
  "macd_meter",
  "trend_meter",
  "pattern_card",
  "confidence_meter",
  "signal_strength",
]);

/** Trade-only widgets — not for pure analysis turns. */
const TRADE_COMPONENTS = new Set([
  "order_ticket",
  "risk_reward",
  "trade_confirm",
  "quick_trade",
  "bracket_order",
  "position_sizer",
  "modify_sltp",
  "close_position",
]);

const SNAPSHOT_TOOLS = new Set([
  "get_market_snapshot",
  "get_multi_timeframe_snapshot",
]);

const MAX_CARDS_DEFAULT = 2;
const MAX_CARDS_TRADE = 1;
const MAX_CARDS_ANALYSIS = 1;

function isAnalysisOnly(ctx: CardContext): boolean {
  const hasSnapshot = ctx.toolNames.some((t) => SNAPSHOT_TOOLS.has(t));
  const hasTradeTool = ctx.toolNames.some(
    (t) =>
      t === "record_recommendation" ||
      t === "open_trade" ||
      t === "request_approval",
  );
  return hasSnapshot && !hasTradeTool && !ctx.hasRecommendation;
}

function isTradeProposal(ctx: CardContext): boolean {
  return (
    ctx.hasActionableRecommendation ||
    ctx.toolNames.includes("record_recommendation") ||
    ctx.toolNames.includes("open_trade") ||
    ctx.toolNames.includes("request_approval")
  );
}

function priorityFor(component: string, ctx: CardContext): number {
  if (ctx.executionMode === "direct" && DIRECT_MODE_BLOCKED.has(component)) {
    return -1;
  }
  if (ctx.executionMode === "direct" && component === "risk_reward") {
    return -1;
  }
  if (ctx.hasActionableRecommendation && RECOMMENDATION_DUPLICATES.has(component)) {
    return -1;
  }
  if (ctx.hasPendingIntent && INTENT_DUPLICATES.has(component)) {
    return -1;
  }
  if (isAnalysisOnly(ctx)) {
    if (TRADE_COMPONENTS.has(component)) return -1;
    if (component === "analysis") return 100;
    if (component === "mtf_grid") return 80;
    if (ANALYSIS_EXTRAS.has(component)) return 10;
  }
  if (isTradeProposal(ctx)) {
    if (ANALYSIS_EXTRAS.has(component)) return -1;
    if (component === "analysis") return -1;
    if (component === "order_ticket") return 100;
    if (component === "risk_reward") return 90;
    if (component === "trade_confirm") return 85;
  }
  if (component === "account_overview") return 70;
  if (component === "positions_table") return 65;
  if (component === "pair_browser") return 60;
  if (component === "alert_banner") return 55;
  return 40;
}

function maxCardsFor(ctx: CardContext): number {
  if (ctx.hasActionableRecommendation) return 0;
  if (isTradeProposal(ctx)) return MAX_CARDS_TRADE;
  if (isAnalysisOnly(ctx)) return MAX_CARDS_ANALYSIS;
  return MAX_CARDS_DEFAULT;
}

function filterLayout(layout: UIElement[], ctx: CardContext): UIElement[] {
  const max = maxCardsFor(ctx);
  if (max === 0) return [];

  const scored = layout
    .map((el) => ({ el, score: priorityFor(el.component, ctx) }))
    .filter((x) => x.score >= 0);

  // De-dupe by component — keep highest priority instance.
  const byComponent = new Map<string, { el: UIElement; score: number }>();
  for (const item of scored) {
    const prev = byComponent.get(item.el.component);
    if (!prev || item.score > prev.score) {
      byComponent.set(item.el.component, item);
    }
  }

  const sorted = [...byComponent.values()].sort((a, b) => b.score - a.score);

  // Analysis-only: prefer analysis alone; allow mtf_grid if explicitly present and no analysis.
  if (isAnalysisOnly(ctx)) {
    const analysis = sorted.find((x) => x.el.component === "analysis");
    if (analysis) return [analysis.el];
    const mtf = sorted.find((x) => x.el.component === "mtf_grid");
    if (mtf) return [mtf.el];
  }

  return sorted.slice(0, max).map((x) => x.el);
}

/**
 * Apply contextual card policy to a composed or model-emitted ui_schema.
 */
export function applyCardPolicy(
  schema: ComposedUISchema | null | undefined,
  ctx: CardContext,
): ComposedUISchema | null {
  if (!schema?.layout?.length) return null;

  const layout = filterLayout(schema.layout, ctx);
  if (!layout.length) return null;

  return { version: "1.0", layout };
}

/** Build CardContext from agent run outputs. */
export function buildCardContext(
  toolNames: string[],
  recommendations: { action?: string }[],
  hasPendingIntent = false,
  executionMode?: "auto" | "approval" | "direct",
): CardContext {
  const actionable = recommendations.some(
    (r) => r.action === "buy" || r.action === "sell",
  );
  return {
    hasRecommendation: recommendations.length > 0,
    hasActionableRecommendation: actionable,
    hasPendingIntent,
    toolNames,
    executionMode,
  };
}

/**
 * Client-side filter for message display — strips duplicates when recommendation/intent already shown.
 */
export function filterMessageCards(
  schema: ComposedUISchema | null | undefined,
  opts: {
    hasActionableRecommendation?: boolean;
    hasPendingIntent?: boolean;
    executionMode?: "auto" | "approval" | "direct";
  },
): ComposedUISchema | null {
  if (!schema?.layout?.length) return null;

  const ctx: CardContext = {
    hasRecommendation: Boolean(opts.hasActionableRecommendation),
    hasActionableRecommendation: Boolean(opts.hasActionableRecommendation),
    hasPendingIntent: Boolean(opts.hasPendingIntent),
    toolNames: [],
    executionMode: opts.executionMode,
  };

  return applyCardPolicy(schema, ctx);
}

/** Whether auto-compose should be skipped for this turn. */
export function shouldSkipAutoCompose(
  ctx: CardContext,
  hasModelSchema: boolean,
): boolean {
  if (hasModelSchema) return true;
  if (ctx.hasActionableRecommendation) return true;
  if (ctx.toolNames.includes("record_recommendation")) return true;
  return false;
}
