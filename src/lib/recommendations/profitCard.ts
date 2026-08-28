/**
 * Shareable profit-card projection.
 *
 * The React card and the PNG capture both read this model so a list row,
 * the report modal, and the detail page can never disagree about the R.
 * The hero number is the same signed R the recommendation report prints
 * (furthest TP actually hit, honest zone print, live R while open).
 * On-card copy is English only — the image people share is not localized.
 * Modal chrome (download / share / sheet title) stays in i18n.
 */
import { BRAND_DOMAIN, BRAND_URL } from "@/lib/brand";
import type { AppLocale } from "@/lib/i18n";
import { bankedTargetPriceOf } from "./tradeMetrics";
import { computeTradeMetricsSummary, displayROf } from "./tradeMetricsSummary";
import type { TrackedDirection, TrackedRecommendation } from "./types";

export { formatSignedR } from "./tradeMetrics";

/** Real Lonora face-mark (white on transparent) — dark-gold card, not a fake SVG. */
export const PROFIT_CARD_LOGO_SRC = "/brand/aichart-mark-dark.png";

/** Compact 4:5-ish share card — not a 9:16 phone strip. */
export const PROFIT_CARD_WIDTH = 360;
export const PROFIT_CARD_HEIGHT = 400;

export const PROFIT_CARD_BG = "#0e1013";
export const PROFIT_CARD_GAIN_COLOR = "#20d68a";
export const PROFIT_CARD_LOSS_COLOR = "#f2555d";
export const PROFIT_CARD_GAIN_GLOW = "rgba(32, 214, 138, 0.42)";
export const PROFIT_CARD_LOSS_GLOW = "rgba(242, 85, 93, 0.40)";

/** English face of the share image. Never Arabic, regardless of app locale. */
export const PROFIT_CARD_COPY = {
  badge: "Profit Card",
  unrealized: "Unrealized PnL",
  realized: "Realized PnL",
  long: "Long",
  short: "Short",
  lastPrice: "Last Price",
  hitPrice: "Hit Price",
  entry: "Entry Price",
  date: "Date",
  tagline: "Your Edge, Our Intelligence.",
} as const;

/** Product clock: Riyadh is UTC+3 year-round. */
export const PROFIT_CARD_TIME_ZONE = "Asia/Riyadh";

export const PROFIT_CARD_SHARE_URL = BRAND_URL.replace(/\/$/, "") || `https://${BRAND_DOMAIN}`;

export type ProfitCardSide = "long" | "short";
export type ProfitCardKind = "unrealized" | "realized";
export type ProfitCardMarkKind = "last" | "current" | "hit";

export type ProfitCardSource = Pick<
  TrackedRecommendation,
  | "symbol"
  | "direction"
  | "entry"
  | "effectiveEntry"
  | "stopLoss"
  | "targets"
  | "outcome"
  | "createdAt"
  | "expiresAt"
  | "triggeredAt"
  | "tp1HitAt"
  | "tp2HitAt"
  | "tp3HitAt"
  | "tp1HitPrice"
  | "tp2HitPrice"
  | "tp3HitPrice"
  | "slHitAt"
  | "invalidatedAt"
  | "cancelledAt"
  | "expiredAt"
  | "lastCheckedAt"
  | "priceAtCreation"
  | "realizedR"
  | "exitPrice"
  | "exitAt"
  | "exitReason"
  | "mfeR"
  | "maeR"
  | "timeInTradeMs"
  | "stopBreachSurvivedCount"
  | "missedWithoutFill"
  | "supersededAt"
>;

export interface ProfitCardModel {
  symbol: string;
  side: ProfitCardSide;
  kind: ProfitCardKind;
  /** Signed R the report prints. Hero number. Null only when unmeasurable. */
  rMultiple: number | null;
  isLoss: boolean;
  markPrice: number | null;
  markKind: ProfitCardMarkKind;
  entry: number;
  dateMs: number;
  shareUrl: string;
  filename: string;
  /** Share image is always English LTR, even when the app locale is Arabic. */
  dir: "ltr";
}

/** Copy that the React card and the canvas fallback both paint. */
export interface ProfitCardLabels {
  badge: string;
  pnlKind: string;
  side: string;
  mark: string;
  entry: string;
  date: string;
  tagline: string;
}

export function pnlAccentColor(isLoss: boolean): string {
  return isLoss ? PROFIT_CARD_LOSS_COLOR : PROFIT_CARD_GAIN_COLOR;
}

export function pnlAccentGlow(isLoss: boolean): string {
  return isLoss ? PROFIT_CARD_LOSS_GLOW : PROFIT_CARD_GAIN_GLOW;
}

/** English labels for the share image — independent of `t()` / locale. */
export function profitCardLabels(model: Pick<ProfitCardModel, "kind" | "side" | "markKind">): ProfitCardLabels {
  return {
    badge: PROFIT_CARD_COPY.badge,
    pnlKind: model.kind === "realized" ? PROFIT_CARD_COPY.realized : PROFIT_CARD_COPY.unrealized,
    side: model.side === "short" ? PROFIT_CARD_COPY.short : PROFIT_CARD_COPY.long,
    mark: model.markKind === "hit" ? PROFIT_CARD_COPY.hitPrice : PROFIT_CARD_COPY.lastPrice,
    entry: PROFIT_CARD_COPY.entry,
    date: PROFIT_CARD_COPY.date,
    tagline: PROFIT_CARD_COPY.tagline,
  };
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sideOf(direction: TrackedDirection): ProfitCardSide {
  return direction === "sell" ? "short" : "long";
}

export function isRealizedOutcome(outcome: TrackedRecommendation["outcome"]): boolean {
  return outcome !== "pending";
}

/**
 * Signed percent from the honest fill (or the planned entry) to `mark`.
 * Buy: (mark − entry) / entry; sell: (entry − mark) / entry.
 */
export function pnlPercentFromEntry(
  direction: TrackedDirection,
  entry: number,
  mark: number,
): number {
  if (!(entry > 0) || !Number.isFinite(mark)) return 0;
  const raw = direction === "sell" ? (entry - mark) / entry : (mark - entry) / entry;
  return Math.round(raw * 10000) / 100;
}

export function formatPnlPercent(pct: number): string {
  const body = Math.abs(pct).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (pct > 0) return `+${body}%`;
  if (pct < 0) return `−${body}%`;
  return "0.00%";
}

export function formatCardPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Western digits, Riyadh clock — the card is a screenshot, not a chat stamp. */
export function formatCardDate(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: PROFIT_CARD_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function sanitizeSymbol(symbol: string): string {
  const cleaned = symbol.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return cleaned || "xauusd";
}

export function profitCardFilename(input: {
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
  return `lonora-${sanitizeSymbol(input.symbol)}-${input.side}-${day}.png`;
}

function hitPriceOf(rec: ProfitCardSource): number | null {
  const n =
    rec.outcome === "win_tp3" ? 3 : rec.outcome === "win_tp2" ? 2 : rec.outcome === "win_tp1" ? 1 : 0;
  if (n === 1 || n === 2 || n === 3) return bankedTargetPriceOf(rec, n);
  if (rec.outcome === "loss") return finite(rec.exitPrice) ?? finite(rec.stopLoss);
  return finite(rec.exitPrice);
}

function resolveMark(
  rec: ProfitCardSource,
  livePrice: number | null | undefined,
): { price: number | null; kind: ProfitCardMarkKind } {
  if (isRealizedOutcome(rec.outcome)) {
    const hit = hitPriceOf(rec);
    if (hit != null) return { price: hit, kind: "hit" };
    const last = finite(rec.priceAtCreation);
    return { price: last, kind: "last" };
  }
  const live = finite(livePrice);
  if (live != null) return { price: live, kind: "current" };
  const last = finite(rec.priceAtCreation);
  return { price: last, kind: "last" };
}

function resolveDateMs(rec: ProfitCardSource, terminal: boolean, now: number): number {
  if (terminal) {
    return (
      finite(rec.exitAt) ??
      finite(rec.tp3HitAt) ??
      finite(rec.tp2HitAt) ??
      finite(rec.tp1HitAt) ??
      finite(rec.slHitAt) ??
      finite(rec.expiredAt) ??
      finite(rec.invalidatedAt) ??
      finite(rec.cancelledAt) ??
      rec.createdAt
    );
  }
  return now;
}

export function buildProfitCardModel(
  rec: ProfitCardSource,
  options: {
    locale: AppLocale;
    livePrice?: number | null;
    now?: number;
  },
): ProfitCardModel {
  const now = options.now ?? Date.now();
  const summary = computeTradeMetricsSummary(rec, now);
  const entry = finite(rec.effectiveEntry) ?? rec.entry;
  const mark = resolveMark(rec, options.livePrice);
  const rMultiple = displayROf(rec, mark.price);
  const side = sideOf(rec.direction);
  const dateMs = resolveDateMs(rec, summary.terminal, now);

  return {
    symbol: rec.symbol || "XAUUSD",
    side,
    kind: summary.terminal ? "realized" : "unrealized",
    rMultiple,
    isLoss: rMultiple != null ? rMultiple < 0 : false,
    markPrice: mark.price,
    markKind: mark.kind,
    entry,
    dateMs,
    shareUrl: PROFIT_CARD_SHARE_URL,
    filename: profitCardFilename({ symbol: rec.symbol, side, dateMs }),
    dir: "ltr",
  };
}

export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (typeof File === "undefined") return false;
  try {
    const probe = new File([new Blob()], "p.png", { type: "image/png" });
    return typeof navigator.canShare === "function" ? navigator.canShare({ files: [probe] }) : true;
  } catch {
    return typeof navigator.share === "function";
  }
}
