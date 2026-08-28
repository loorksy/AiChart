/**
 * Shareable recommendation-card projection.
 *
 * This is the plan the agent issued — pair, side, timeframe, entry, stop,
 * every TP and which ones hit — not the Bybit-style PnL receipt. The React
 * card and the PNG capture both read this model so the report share image
 * cannot disagree with the in-app report about R or levels.
 *
 * Unlike the profit card (always English LTR), this image follows the current
 * app locale so an Arabic report shares in Arabic.
 */
import { BRAND_DOMAIN } from "@/lib/brand";
import { t, dirForLocale, type AppLocale, type Direction } from "@/lib/i18n";
import { computeTradeMetricsSummary, displayROf } from "./tradeMetricsSummary";
import { smartTipKey } from "./smartTip";
import {
  highestTpReached,
  type TrackedDirection,
  type TrackedRecommendation,
  type TrackedRecommendationOutcome,
  type TrackedRecommendationStatus,
} from "./types";
import {
  PROFIT_CARD_GAIN_COLOR,
  PROFIT_CARD_LOSS_COLOR,
  PROFIT_CARD_LOGO_SRC,
  PROFIT_CARD_SHARE_URL,
  PROFIT_CARD_TIME_ZONE,
  formatCardPrice,
  formatSignedR,
  isRealizedOutcome,
  sideOf,
  type ProfitCardMarkKind,
  type ProfitCardSide,
  type ProfitCardSource,
} from "./profitCard";

export { formatSignedR, formatCardPrice, PROFIT_CARD_LOGO_SRC };

/** Compact share card — taller than the 360×400 PnL receipt, not a 9:16 poster. */
export const REC_CARD_WIDTH = 360;
export const REC_CARD_HEIGHT = 520;

export const REC_CARD_BG = "#101114";
export const REC_CARD_GAIN_COLOR = PROFIT_CARD_GAIN_COLOR;
export const REC_CARD_LOSS_COLOR = PROFIT_CARD_LOSS_COLOR;
export const REC_CARD_SELL_HERO = "#2a1618";
export const REC_CARD_BUY_HERO = "#15261c";

export const REC_CARD_SHARE_URL = PROFIT_CARD_SHARE_URL;
export const REC_CARD_LOGO_SRC = PROFIT_CARD_LOGO_SRC;

const KNOWN_SETUP_TYPES = new Set([
  "scalp",
  "trend_continuation",
  "reversal_after_sweep",
  "range_boundary",
  "breakout_retest",
]);

export type RecCardDisplayState =
  | "valid_now"
  | "awaiting_activation"
  | "expired"
  | "invalidated"
  | "blocked"
  | "cancelled";

export type RecommendationCardSource = ProfitCardSource &
  Pick<
    TrackedRecommendation,
    | "interval"
    | "setupType"
    | "planType"
    | "executionState"
    | "entryLow"
    | "entryHigh"
    | "validityCandles"
    | "revisionNo"
    | "status"
    | "triggerCondition"
    | "entryType"
    | "activationClass"
  >;

export interface RecCardTarget {
  index: 1 | 2 | 3;
  price: number;
  hit: boolean;
}

export interface RecommendationCardModel {
  symbol: string;
  interval: string;
  direction: TrackedDirection;
  side: ProfitCardSide;
  rMultiple: number | null;
  isLoss: boolean;
  markPrice: number | null;
  markKind: ProfitCardMarkKind;
  entry: number;
  stopLoss: number;
  stopHit: boolean;
  targets: RecCardTarget[];
  entryZone: { low: number; high: number } | null;
  validityCandles: number | null;
  revisionNo: number | null;
  setupType: string | null;
  planType: NonNullable<TrackedRecommendation["planType"]> | null;
  displayState: RecCardDisplayState;
  outcome: TrackedRecommendationOutcome;
  status: TrackedRecommendationStatus;
  won: boolean;
  lost: boolean;
  highestTp: 0 | 1 | 2 | 3;
  closedAt: number | null;
  dateMs: number;
  dir: Direction;
  locale: AppLocale;
  shareUrl: string;
  filename: string;
  tipKey: string;
}

export interface RecommendationCardLabels {
  badge: string;
  side: string;
  signal: string;
  setup: string;
  planType: string;
  status: string;
  goalStatus: string;
  currentPrice: string;
  entry: string;
  stop: string;
  target1: string;
  target2: string;
  target3: string;
  reached: string;
  footer: string;
  tip: string;
  entryZone: string;
  validity: string;
  revision: string;
  domain: string;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function deriveRecDisplayState(rec: RecommendationCardSource): RecCardDisplayState {
  if (rec.status === "cancelled" || rec.outcome === "cancelled") return "cancelled";
  if (rec.executionState) return rec.executionState;
  if (rec.status === "expired") return "expired";
  if (rec.status === "invalidated") return "invalidated";
  const waiting =
    rec.activationClass === "conditional" ||
    (rec.status === "pending_entry" && rec.entryType !== "market");
  return waiting ? "awaiting_activation" : "valid_now";
}

function hitAtOf(rec: RecommendationCardSource, index: 1 | 2 | 3): number | null {
  return index === 1
    ? finite(rec.tp1HitAt)
    : index === 2
      ? finite(rec.tp2HitAt)
      : finite(rec.tp3HitAt);
}

function resolveMark(
  rec: RecommendationCardSource,
  livePrice: number | null | undefined,
): { price: number | null; kind: ProfitCardMarkKind } {
  if (isRealizedOutcome(rec.outcome)) {
    const n = rec.outcome === "win_tp3" ? 3 : rec.outcome === "win_tp2" ? 2 : rec.outcome === "win_tp1" ? 1 : 0;
    if (n === 1 || n === 2 || n === 3) {
      const labeled = finite(rec.targets[n - 1]);
      const honest =
        n === 1 ? finite(rec.tp1HitPrice) : n === 2 ? finite(rec.tp2HitPrice) : finite(rec.tp3HitPrice);
      return { price: honest ?? labeled ?? finite(rec.exitPrice), kind: "hit" };
    }
    if (rec.outcome === "loss") {
      return { price: finite(rec.exitPrice) ?? finite(rec.stopLoss), kind: "hit" };
    }
    const last = finite(rec.exitPrice) ?? finite(rec.priceAtCreation);
    return { price: last, kind: last != null ? "hit" : "last" };
  }
  const live = finite(livePrice);
  if (live != null) return { price: live, kind: "current" };
  const last = finite(rec.priceAtCreation);
  return { price: last, kind: "last" };
}

function resolveClosedAt(rec: RecommendationCardSource): number | null {
  const won = rec.outcome.startsWith("win_");
  const lost = rec.outcome === "loss";
  if (won) return finite(rec.tp3HitAt) ?? finite(rec.tp2HitAt) ?? finite(rec.tp1HitAt);
  if (lost) return finite(rec.slHitAt);
  return (
    finite(rec.exitAt) ??
    finite(rec.expiredAt) ??
    finite(rec.invalidatedAt) ??
    finite(rec.cancelledAt)
  );
}

function resolveDateMs(rec: RecommendationCardSource, terminal: boolean, now: number): number {
  if (terminal) {
    return (
      resolveClosedAt(rec) ??
      finite(rec.exitAt) ??
      rec.createdAt
    );
  }
  return now;
}

function sanitizeSymbol(symbol: string): string {
  const cleaned = symbol.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return cleaned || "xauusd";
}

export function recommendationCardFilename(input: {
  symbol: string;
  side: ProfitCardSide;
  dateMs: number;
}): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROFIT_CARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number.isFinite(input.dateMs) ? input.dateMs : Date.now()));
  return `lonora-${sanitizeSymbol(input.symbol)}-${input.side}-rec-${day}.png`;
}

/** Locale-aware stamp for the rec card (Riyadh clock). Prices stay Western. */
export function formatRecCardDate(ms: number, locale: AppLocale): string {
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    timeZone: PROFIT_CARD_TIME_ZONE,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

export function buildRecommendationCardModel(
  rec: RecommendationCardSource,
  options: {
    locale: AppLocale;
    livePrice?: number | null;
    now?: number;
  },
): RecommendationCardModel {
  const now = options.now ?? Date.now();
  const locale = options.locale;
  const summary = computeTradeMetricsSummary(rec, now);
  const entry = finite(rec.effectiveEntry) ?? rec.entry;
  const mark = resolveMark(rec, options.livePrice);
  const rMultiple = displayROf(rec, mark.price);
  const side = sideOf(rec.direction);
  const dateMs = resolveDateMs(rec, summary.terminal, now);
  const won = rec.outcome.startsWith("win_");
  const lost = rec.outcome === "loss";
  const targets: RecCardTarget[] = rec.targets.slice(0, 3).map((price, i) => {
    const index = (i + 1) as 1 | 2 | 3;
    return { index, price, hit: Boolean(hitAtOf(rec, index)) };
  });
  const entryLow = finite(rec.entryLow);
  const entryHigh = finite(rec.entryHigh);

  return {
    symbol: rec.symbol || "XAUUSD",
    interval: rec.interval || "",
    direction: rec.direction,
    side,
    rMultiple,
    isLoss: rMultiple != null ? rMultiple < 0 : false,
    markPrice: mark.price,
    markKind: mark.kind,
    entry,
    stopLoss: rec.stopLoss,
    stopHit: Boolean(finite(rec.slHitAt)),
    targets,
    entryZone:
      entryLow != null && entryHigh != null ? { low: entryLow, high: entryHigh } : null,
    validityCandles: finite(rec.validityCandles),
    revisionNo: finite(rec.revisionNo),
    setupType: rec.setupType ?? null,
    planType: rec.planType ?? null,
    displayState: deriveRecDisplayState(rec),
    outcome: rec.outcome,
    status: rec.status,
    won,
    lost,
    highestTp: highestTpReached(rec),
    closedAt: resolveClosedAt(rec),
    dateMs,
    dir: dirForLocale(locale),
    locale,
    shareUrl: REC_CARD_SHARE_URL || `https://${BRAND_DOMAIN}`,
    filename: recommendationCardFilename({ symbol: rec.symbol, side, dateMs }),
    tipKey: smartTipKey(rec),
  };
}

export function recommendationCardLabels(model: RecommendationCardModel): RecommendationCardLabels {
  const locale = model.locale;
  const tx = (key: string, replacements?: Record<string, string>) => t(locale, key, replacements);
  const setup =
    model.setupType && KNOWN_SETUP_TYPES.has(model.setupType)
      ? tx(`rec.setup_type.${model.setupType}`)
      : (model.setupType ?? "");
  const planType = model.planType
    ? `${tx("rec.detail.plan_type")}: ${tx(`rec.plan_type.${model.planType}`)}`
    : "";
  const status = model.won
    ? tx(`rec.status.${model.status}`)
    : model.lost
      ? tx("rec.status.sl_hit")
      : model.displayState === "cancelled"
        ? tx("rec.status.cancelled")
        : tx(`rec.exec_state.${model.displayState}`);
  const footer = model.won
    ? tx("rec.footer.closed_win")
    : model.lost
      ? tx("rec.footer.closed_loss")
      : tx(`rec.footer.${model.displayState}`);
  const goalStatus =
    model.highestTp === 3
      ? tx("rec.status.tp3_hit")
      : model.highestTp === 2
        ? tx("rec.status.tp2_hit")
        : model.highestTp === 1
          ? tx("rec.status.tp1_hit")
          : model.lost
            ? tx("rec.status.sl_hit")
            : "";
  const validity =
    model.validityCandles != null
      ? tx("rec.detail.max_candles", { n: String(model.validityCandles) })
      : "";
  const revision =
    model.revisionNo != null ? `${tx("rec.detail.revision")} #${model.revisionNo}` : "";

  return {
    badge: tx("rec_card.badge"),
    side: model.direction === "sell" ? tx("decision.sell") : tx("decision.buy"),
    signal: model.direction === "sell" ? tx("rec.card.sell") : tx("rec.card.buy"),
    setup,
    planType,
    status,
    goalStatus,
    currentPrice: tx("rec.row.current_price"),
    entry: tx("rec.row.entry"),
    stop: tx("rec.row.stop_loss"),
    target1: tx("rec.row.target1"),
    target2: tx("rec.row.target2"),
    target3: tx("rec.row.target3"),
    reached: tx("rec.badge.hit"),
    footer,
    tip: tx(model.tipKey),
    entryZone: tx("rec.detail.entry_zone"),
    validity,
    revision,
    domain: BRAND_DOMAIN,
  };
}

export function recCardHeroFill(direction: TrackedDirection): string {
  return direction === "sell" ? REC_CARD_SELL_HERO : REC_CARD_BUY_HERO;
}

export function recCardSideColor(direction: TrackedDirection): string {
  return direction === "sell" ? REC_CARD_LOSS_COLOR : REC_CARD_GAIN_COLOR;
}
