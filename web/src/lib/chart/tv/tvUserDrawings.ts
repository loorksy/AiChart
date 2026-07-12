/**
 * Read + mutate the USER's own hand-drawn TradingView shapes.
 *
 * The app only tracks the shapes IT created (via TvDrawingManager). Every other
 * shape on the chart is a manual user drawing. This module reads those shapes,
 * serializes them into the safe, plain `SerializedChartDrawing` transport shape
 * (NEVER exposing raw TradingView objects to the backend), and applies the
 * agent's validated mutations back onto the native shapes.
 *
 * All TradingView calls are feature-detected and wrapped in try/catch: a chart
 * where the library shape below isn't available simply yields no user drawings
 * rather than throwing.
 */
import type { EntityId, IChartWidgetApi } from "@/vendor/tradingview/charting_library";
import { sanitizeSerializedDrawing } from "@/lib/chart/drawings/serializeUserDrawings";
import type {
  SerializedChartDrawing,
  UserDrawingMutationCommand,
} from "@/lib/chart/drawings/types";

/** Loose, defensive view over the TV shape/chart APIs we touch for reading. */
interface ShapeInfo {
  id: EntityId;
  name?: string;
}
interface LineShapeApi {
  getPoints?: () => Array<{ time?: number; price?: number }>;
  getProperties?: () => Record<string, unknown>;
  setPoints?: (points: Array<{ time?: number; price?: number }>) => void;
  setProperties?: (props: Record<string, unknown>) => void;
  isSelected?: () => boolean;
}
interface ReadableChart {
  getAllShapes?: () => ShapeInfo[];
  getShapeById?: (id: EntityId) => LineShapeApi | null | undefined;
  removeEntity?: (id: EntityId) => void;
  selection?: () => { allSources?: () => EntityId[] } | null | undefined;
}

function asReadable(chart: IChartWidgetApi): ReadableChart {
  return chart as unknown as ReadableChart;
}

/** TV shape "name" → a coarse serialized type the agent reasons about. */
function mapShapeType(name: string | undefined): string {
  const n = (name ?? "").toLowerCase();
  if (!n) return "drawing";
  if (n.includes("horizontal")) return "hline";
  if (n.includes("vertical")) return "vline";
  if (n.includes("rectangle") || n.includes("range")) return "rectangle";
  if (n.includes("parallel") || n.includes("channel")) return "channel";
  if (n.includes("fib")) return "fibonacci";
  if (n.includes("trend") || n === "ray") return "trend_line";
  if (n.includes("position")) return "position";
  if (n.includes("text") || n.includes("note") || n.includes("label")) return "text";
  return n;
}

function pointsMs(
  raw: Array<{ time?: number; price?: number }> | undefined,
): Array<{ time?: number; price?: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    // TV reports time in unix seconds; the rest of the app uses ms.
    time:
      typeof p.time === "number" && Number.isFinite(p.time) ? p.time * 1000 : undefined,
    price: typeof p.price === "number" && Number.isFinite(p.price) ? p.price : undefined,
  }));
}

function textOf(props: Record<string, unknown> | undefined): string | undefined {
  if (!props) return undefined;
  const t = props.text ?? props.title;
  return typeof t === "string" && t.trim() ? t.trim() : undefined;
}

/**
 * Serialize every user-drawn shape on the chart (all shapes MINUS the ones the
 * app's drawing manager created). Returns safe, bounded, plain objects only.
 */
export function readUserDrawings(input: {
  chart: IChartWidgetApi;
  trackedIds: EntityId[];
  symbol: string;
  interval: string;
}): SerializedChartDrawing[] {
  const chart = asReadable(input.chart);
  let all: ShapeInfo[] = [];
  try {
    all = chart.getAllShapes?.() ?? [];
  } catch {
    return [];
  }
  const tracked = new Set(input.trackedIds.map((id) => String(id)));
  const out: SerializedChartDrawing[] = [];

  for (const info of all) {
    if (tracked.has(String(info.id))) continue; // app-owned → not a user drawing
    let shape: LineShapeApi | null | undefined;
    try {
      shape = chart.getShapeById?.(info.id);
    } catch {
      shape = null;
    }
    if (!shape) continue;

    let rawPoints: Array<{ time?: number; price?: number }> | undefined;
    let props: Record<string, unknown> | undefined;
    try {
      rawPoints = shape.getPoints?.();
    } catch {
      rawPoints = undefined;
    }
    try {
      props = shape.getProperties?.();
    } catch {
      props = undefined;
    }

    const clean = sanitizeSerializedDrawing({
      id: String(info.id),
      owner: "user",
      type: mapShapeType(info.name),
      symbol: input.symbol,
      interval: input.interval,
      points: pointsMs(rawPoints),
      label: textOf(props),
      source: "tradingview",
    });
    if (clean) out.push(clean);
  }
  return out;
}

/** The id of the currently-selected user shape, if exactly one is selected. */
export function readSelectedUserDrawingId(input: {
  chart: IChartWidgetApi;
  trackedIds: EntityId[];
}): string | undefined {
  const chart = asReadable(input.chart);
  const tracked = new Set(input.trackedIds.map((id) => String(id)));
  try {
    const sources = chart.selection?.()?.allSources?.() ?? [];
    const userSelected = sources
      .map((id) => String(id))
      .filter((id) => !tracked.has(id));
    return userSelected.length === 1 ? userSelected[0] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Apply the agent's validated mutations onto the native user shapes. Only shapes
 * present on the chart AND not owned by the app are ever touched. Returns the
 * ids that were actually applied (for the caller's idempotency bookkeeping).
 */
export function applyUserDrawingMutations(input: {
  chart: IChartWidgetApi;
  trackedIds: EntityId[];
  commands: UserDrawingMutationCommand[];
}): void {
  const chart = asReadable(input.chart);
  const tracked = new Set(input.trackedIds.map((id) => String(id)));

  let all: ShapeInfo[] = [];
  try {
    all = chart.getAllShapes?.() ?? [];
  } catch {
    return;
  }
  const byId = new Map<string, EntityId>();
  for (const s of all) {
    const key = String(s.id);
    if (!tracked.has(key)) byId.set(key, s.id);
  }

  for (const { mutation } of input.commands) {
    const entityId = byId.get(mutation.drawingId);
    if (entityId == null) continue; // gone or app-owned → never touch

    try {
      if (mutation.type === "delete") {
        chart.removeEntity?.(entityId);
        byId.delete(mutation.drawingId);
        continue;
      }
      const shape = chart.getShapeById?.(entityId);
      if (!shape) continue;

      if (mutation.type === "move_level") {
        const existing = shape.getPoints?.() ?? [];
        const base = existing[0] ?? {};
        shape.setPoints?.([{ time: base.time, price: mutation.price }]);
      } else if (mutation.type === "resize_zone") {
        const existing = shape.getPoints?.() ?? [];
        const t0 = existing[0]?.time;
        const t1 = existing[1]?.time ?? existing[0]?.time;
        shape.setPoints?.([
          { time: t0, price: mutation.upperPrice },
          { time: t1, price: mutation.lowerPrice },
        ]);
      } else if (mutation.type === "replace_points") {
        shape.setPoints?.(
          mutation.points.map((p) => ({
            time: p.time != null ? Math.round(p.time / 1000) : undefined,
            price: p.price,
          })),
        );
      } else if (mutation.type === "move_point") {
        const existing = shape.getPoints?.() ?? [];
        const next = existing.slice();
        next[mutation.pointIndex] = {
          time:
            mutation.point.time != null
              ? Math.round(mutation.point.time / 1000)
              : existing[mutation.pointIndex]?.time,
          price: mutation.point.price,
        };
        shape.setPoints?.(next);
      } else if (mutation.type === "update_label") {
        shape.setProperties?.({ text: mutation.label });
      }
    } catch {
      /* skip a shape TV won't let us mutate */
    }
  }
}
