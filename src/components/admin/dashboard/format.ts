"use client";

import { tierDef } from "@/lib/billing/tiers";

/**
 * Shared presentation layer for the platform overview.
 *
 * Two constraints shape everything here:
 *
 * 1. The API buckets days against Riyadh time (UTC+3). Formatting the same
 *    epoch with the *browser's* zone would put an event at 01:00 Riyadh on the
 *    previous calendar day, so the chart label and the table's "last activity"
 *    would disagree with the series the server produced. Every date below is
 *    therefore rendered through the same fixed offset instead of the host zone.
 * 2. These modules are `"use client"` but still pre-render on the server. Any
 *    `toLocaleDateString` would resolve against the server's ICU data first and
 *    the browser's second, which React reports as a hydration mismatch. Month
 *    names are a literal table for that reason.
 */

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;

const USD_FMT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INT_FMT = new Intl.NumberFormat("en-US");

/** The placeholder for "this number does not exist" — never NaN, never ∞. */
export const EM_DASH = "—";

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Money, always 2 decimals. Render inside `dir="ltr"` so the sign stays put. */
export function formatUsd(value: number | null | undefined): string {
  if (!isNum(value)) return EM_DASH;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${USD_FMT.format(Math.abs(value))}`;
}

/** Axis/label money: `$1.2k`, `$3.4M`. Keeps a 90-day Y axis readable. */
export function formatUsdCompact(value: number | null | undefined): string {
  if (!isNum(value)) return EM_DASH;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  if (abs === 0) return "$0";
  if (abs < 1) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatInt(value: number | null | undefined): string {
  if (!isNum(value)) return EM_DASH;
  return INT_FMT.format(Math.round(value));
}

function riyadhParts(ms: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const shifted = new Date(ms + RIYADH_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** "31 يوليو 2026" */
export function formatDate(ms: number | null | undefined): string {
  if (!isNum(ms)) return EM_DASH;
  const p = riyadhParts(ms);
  return `${p.day} ${MONTHS_AR[p.month]} ${p.year}`;
}

/** "31 يوليو" — for range subtitles where the year is obvious. */
export function formatDateCompact(ms: number | null | undefined): string {
  if (!isNum(ms)) return EM_DASH;
  const p = riyadhParts(ms);
  return `${p.day} ${MONTHS_AR[p.month]}`;
}

/** "14:05" Riyadh. */
export function formatTime(ms: number | null | undefined): string {
  if (!isNum(ms)) return EM_DASH;
  const p = riyadhParts(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function splitDay(day: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Series keys arrive as "YYYY-MM-DD" already bucketed by the server. They are
 * parsed by hand — `new Date("2026-07-31")` is UTC midnight, which the browser
 * would then re-render as the 30th anywhere west of Greenwich.
 */
export function formatDayTick(day: string): string {
  const parts = splitDay(day);
  if (!parts) return day;
  return `${parts[2]}/${parts[1]}`;
}

/** "31 يوليو" from a "YYYY-MM-DD" bucket. */
export function formatDayLabel(day: string): string {
  const parts = splitDay(day);
  if (!parts) return day;
  return `${parts[2]} ${MONTHS_AR[parts[1] - 1] ?? ""}`.trim();
}

export type DeltaDirection = "up" | "down" | "flat";

/**
 * Direction comes from the raw pair, not from `pct`. If the API ever changes
 * its percentage convention the arrow and the colour still agree with the two
 * numbers the tile is actually comparing.
 */
export function deltaDirection(delta: { value: number; prev: number }): DeltaDirection {
  if (delta.value > delta.prev) return "up";
  if (delta.value < delta.prev) return "down";
  return "flat";
}

/** `pct` is a percentage (12.5 → "12.5%"). Null means "no baseline period". */
export function formatDeltaPct(pct: number | null | undefined): string {
  if (!isNum(pct)) return EM_DASH;
  return `${Math.abs(pct).toFixed(1)}%`;
}

export function tierLabelAr(tier: string | null | undefined): string {
  if (!tier) return "بدون باقة";
  return tierDef(tier)?.nameAr ?? tier;
}

const USER_STATUS_AR: Record<string, string> = {
  active: "نشط",
  pending: "بانتظار التفعيل",
  suspended: "موقوف",
};

export function userStatusLabelAr(status: string | null | undefined): string {
  if (!status) return EM_DASH;
  return USER_STATUS_AR[status] ?? status;
}

const SUB_STATUS_AR: Record<string, string> = {
  active: "مفعّل",
  past_due: "متأخر السداد",
  canceled: "ملغى",
};

export function subStatusLabelAr(status: string | null | undefined): string {
  if (!status) return "بلا اشتراك";
  return SUB_STATUS_AR[status] ?? status;
}

/** Avatar initial for an account that has no picture — the local part's letter. */
export function initialFor(email: string, username?: string | null): string {
  const source = (username?.trim() || email.trim() || "?").replace(/^@/, "");
  return source.charAt(0).toLocaleUpperCase("en-US");
}
