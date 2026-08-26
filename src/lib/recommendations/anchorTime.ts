/**
 * The profit/loss zones on the chart are anchored at the recommendation's
 * `created_at`. Three producers built the Recommendation object WITHOUT it
 * (a `as Recommendation` cast hid the omission), so the chart adapter fell
 * back to wall-clock "now" — and every redraw, poll hydration, and page
 * reload re-anchored the zones at the latest candle. That is the reported
 * "the box moves with the candle": it slid right to hug the live bar instead
 * of staying where the plan was issued.
 *
 * This module is the single rule for stamping that anchor: a recommendation
 * keeps its own `created_at` byte-for-byte when it has one; a payload that
 * arrives without one inherits the anchor of the SAME plan it replaces; only
 * a genuinely new plan is stamped with the current instant — exactly once.
 */

/** The fields that identify one trade plan (and carry its time anchor). */
export interface TradePlanAnchorFields {
  symbol?: unknown;
  action?: unknown;
  entry?: unknown;
  stop_loss?: unknown;
  take_profit?: unknown;
  created_at?: unknown;
}

/** created_at → epoch ms, or null when absent/unparseable. Accepts epoch
 *  seconds, epoch ms, or a date string — the shapes seen in stored layouts. */
export function createdAtMs(raw: unknown): number | null {
  const parsed =
    typeof raw === "number"
      ? raw < 1e12
        ? raw * 1000
        : raw
      : typeof raw === "string" && raw
        ? Date.parse(raw)
        : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** True when both payloads describe the same plan: same side and the same
 *  entry/stop/target prices (and the same symbol when both declare one). */
export function sameTradePlan(
  a: TradePlanAnchorFields | null | undefined,
  b: TradePlanAnchorFields | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.action !== b.action) return false;
  if (
    typeof a.symbol === "string" &&
    typeof b.symbol === "string" &&
    a.symbol !== b.symbol
  ) {
    return false;
  }
  return (
    num(a.entry) === num(b.entry) &&
    num(a.stop_loss) === num(b.stop_loss) &&
    num(a.take_profit) === num(b.take_profit)
  );
}

/**
 * Return `next` carrying a STABLE `created_at`:
 * - its own when present (persisted anchors are reused byte-for-byte);
 * - the previous recommendation's when it is the same plan re-delivered
 *   without one (poll/MCP re-writes must not re-anchor);
 * - otherwise `nowIso`, stamped once at creation.
 */
export function withStableCreatedAt<T extends TradePlanAnchorFields>(
  next: T | null,
  prev: TradePlanAnchorFields | null | undefined,
  nowIso: string = new Date().toISOString(),
): T | null {
  if (!next) return null;
  if (createdAtMs(next.created_at) != null) return next;
  if (prev && sameTradePlan(prev, next) && createdAtMs(prev.created_at) != null) {
    // createdAtMs validated prev.created_at as a parseable string/number, so
    // carrying it verbatim is safe — and required: the anchor must be reused
    // byte-for-byte, never re-serialized.
    return { ...next, created_at: prev.created_at } as T;
  }
  return { ...next, created_at: nowIso } as T;
}
