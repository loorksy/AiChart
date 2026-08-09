/**
 * Sanitize/serialize chart drawings into the safe, bounded transport shape.
 * Used on the client (after reading native TradingView shapes) and mirrored by
 * the stream route's Zod schema. Rejects malformed points and enforces caps.
 */
import { DRAWING_LIMITS, type SerializedChartDrawing } from "./types";

function cleanPoints(raw: unknown): SerializedChartDrawing["points"] {
  if (!Array.isArray(raw)) return [];
  const out: SerializedChartDrawing["points"] = [];
  for (const p of raw) {
    if (out.length >= DRAWING_LIMITS.maxPoints) break;
    if (!p || typeof p !== "object") continue;
    const pt = p as { time?: unknown; price?: unknown };
    const time = typeof pt.time === "number" && Number.isFinite(pt.time) ? pt.time : undefined;
    const price =
      typeof pt.price === "number" && Number.isFinite(pt.price) && pt.price > 0
        ? pt.price
        : undefined;
    if (time === undefined && price === undefined) continue; // malformed → drop
    out.push({ time, price });
  }
  return out;
}

function cleanLevels(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0,
  );
  return out.length ? out.slice(0, DRAWING_LIMITS.maxPoints) : undefined;
}

/** Sanitize one candidate drawing; returns null when it has no usable geometry. */
export function sanitizeSerializedDrawing(
  raw: unknown,
): SerializedChartDrawing | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const id = typeof d.id === "string" ? d.id : "";
  const type = typeof d.type === "string" ? d.type : "";
  if (!id || !type) return null;

  const owner =
    d.owner === "agent" || d.owner === "recommendation" ? d.owner : "user";
  const source = d.source === "lonora" ? "lonora" : "tradingview";
  const points = cleanPoints(d.points);
  const priceLevels = cleanLevels(d.priceLevels);
  if (points.length === 0 && !priceLevels) return null; // nothing to reason on

  const label =
    typeof d.label === "string" ? d.label.slice(0, DRAWING_LIMITS.maxLabel) : undefined;

  return {
    id,
    owner,
    type,
    symbol: typeof d.symbol === "string" ? d.symbol.toUpperCase() : "",
    interval: typeof d.interval === "string" ? d.interval : "",
    points,
    priceLevels,
    label: label || undefined,
    color: typeof d.color === "string" ? d.color.slice(0, 40) : undefined,
    lineStyle: typeof d.lineStyle === "string" ? d.lineStyle.slice(0, 20) : undefined,
    visible: typeof d.visible === "boolean" ? d.visible : undefined,
    locked: typeof d.locked === "boolean" ? d.locked : undefined,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : undefined,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : undefined,
    source,
  };
}

/** Sanitize + cap a list of drawings for safe transport. */
export function sanitizeSerializedDrawings(raw: unknown): SerializedChartDrawing[] {
  if (!Array.isArray(raw)) return [];
  const out: SerializedChartDrawing[] = [];
  for (const item of raw) {
    if (out.length >= DRAWING_LIMITS.maxDrawings) break;
    const clean = sanitizeSerializedDrawing(item);
    if (clean) out.push(clean);
  }
  return out;
}

/** All representative price levels of a drawing (points + explicit levels). */
export function drawingPriceLevels(d: SerializedChartDrawing): number[] {
  const fromPoints = d.points
    .map((p) => p.price)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return [...fromPoints, ...(d.priceLevels ?? [])];
}
