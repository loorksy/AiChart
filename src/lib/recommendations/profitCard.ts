/**
 * Shareable profit-card projection — numbers only, no copy.
 *
 * The React card and the PNG capture both read this model so a list row,
 * the report modal, and the detail page can never disagree about the %.
 * Labels live in the dictionaries; this file never calls `t()`.
 */
import { BRAND_DOMAIN, BRAND_URL } from "@/lib/brand";
import { dirForLocale, type AppLocale, type Direction } from "@/lib/i18n";
import { computeTradeMetricsSummary } from "./tradeMetricsSummary";
import type { TrackedDirection, TrackedRecommendation } from "./types";

/** Real Lonora face-mark (white on transparent) — dark-gold card, not a fake SVG. */
export const PROFIT_CARD_LOGO_SRC = "/brand/aichart-mark-dark.png";

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
  pnlPct: number;
  isLoss: boolean;
  markPrice: number | null;
  markKind: ProfitCardMarkKind;
  entry: number;
  dateMs: number;
  rMultiple: number | null;
  shareUrl: string;
  filename: string;
  dir: Direction;
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
  if (n === 1) return finite(rec.tp1HitPrice) ?? finite(rec.targets[0]);
  if (n === 2) return finite(rec.tp2HitPrice) ?? finite(rec.targets[1]);
  if (n === 3) return finite(rec.tp3HitPrice) ?? finite(rec.targets[2]);
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
  const pnlPct = mark.price != null ? pnlPercentFromEntry(rec.direction, entry, mark.price) : 0;
  const side = sideOf(rec.direction);
  const dateMs = resolveDateMs(rec, summary.terminal, now);
  const rMultiple = summary.terminal ? summary.realizedR : null;

  return {
    symbol: rec.symbol || "XAUUSD",
    side,
    kind: summary.terminal ? "realized" : "unrealized",
    pnlPct,
    isLoss: pnlPct < 0,
    markPrice: mark.price,
    markKind: mark.kind,
    entry,
    dateMs,
    rMultiple,
    shareUrl: PROFIT_CARD_SHARE_URL,
    filename: profitCardFilename({ symbol: rec.symbol, side, dateMs }),
    dir: dirForLocale(options.locale),
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
