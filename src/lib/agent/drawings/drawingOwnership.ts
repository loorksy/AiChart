/**
 * Drawing ownership + versioning + sanitization.
 *
 * Every agent-produced drawing is stamped with owner="agent", the run's
 * analysisId, and a createdAt so the UI can (a) tell agent drawings apart from
 * the user's manual drawings and (b) clear/replace only a given analysis. User
 * drawings are never touched by agent clearing.
 */
import type { ChartDrawing } from "@/lib/chartDrawings";

export type DrawingOwner = "user" | "agent" | "system";

export interface DrawingOwnershipMeta {
  owner: DrawingOwner;
  analysisId?: string;
  agentName?: string;
  createdAt: number;
}

/** Read the owner of a drawing (defaults to "user" for legacy/manual shapes). */
export function drawingOwner(d: ChartDrawing): DrawingOwner {
  const owner = (d.meta as { owner?: DrawingOwner } | undefined)?.owner;
  return owner === "agent" || owner === "system" ? owner : "user";
}

/** Stamp ownership + analysisId onto a drawing's meta (immutably). */
export function stampOwnership(
  d: ChartDrawing,
  meta: DrawingOwnershipMeta,
): ChartDrawing {
  return { ...d, meta: { ...(d.meta ?? {}), ...meta } };
}

/**
 * Keep every user/system drawing, drop agent drawings from the given analysis
 * (or all agent drawings when analysisId is omitted). Never removes user work.
 */
export function clearAgentDrawings(
  drawings: ChartDrawing[],
  analysisId?: string,
): ChartDrawing[] {
  return drawings.filter((d) => {
    if (drawingOwner(d) !== "agent") return true;
    if (!analysisId) return false;
    const id = (d.meta as { analysisId?: string } | undefined)?.analysisId;
    return id !== analysisId;
  });
}

/**
 * True only when meta.owner is explicitly "user". Unstamped leftovers default
 * to "user" in drawingOwner() — those are almost always legacy agent
 * analysis drawings sitting in layout state, and a "clear all drawings"
 * must drop them. Manual TV drawings live on the widget, not this array,
 * and are stamped owner="user" when they do appear here.
 */
export function isExplicitUserDrawing(d: ChartDrawing): boolean {
  return (d.meta as { owner?: DrawingOwner } | undefined)?.owner === "user";
}

/** Keep explicitly stamped user drawings; drop agent, system, and unstamped. */
export function keepExplicitUserDrawings(
  drawings: ChartDrawing[],
): ChartDrawing[] {
  return drawings.filter(isExplicitUserDrawing);
}

/**
 * Validate + sanitize agent drawings before persist/render: drop invalid
 * types/points, require finite positive prices, keep prices within sane candle
 * bounds, cap the count, and stamp ownership.
 */
export function sanitizeAgentDrawings(
  drawings: ChartDrawing[],
  opts: {
    analysisId: string;
    agentName?: string;
    priceBounds?: { min: number; max: number } | null;
    maxDrawings?: number;
  },
): ChartDrawing[] {
  const max = opts.maxDrawings ?? 40;
  const out: ChartDrawing[] = [];
  const withinBounds = (price: number) => {
    if (!Number.isFinite(price) || price <= 0) return false;
    if (!opts.priceBounds) return true;
    return price >= opts.priceBounds.min && price <= opts.priceBounds.max;
  };

  for (const d of drawings) {
    if (out.length >= max) break;
    if (!d || typeof d.type !== "string") continue;

    const points = Array.isArray(d.points) ? d.points : [];
    const validPoints = points.filter(
      (p) =>
        p &&
        Number.isFinite(p.price) &&
        p.price > 0 &&
        withinBounds(p.price),
    );

    // A drawing needs either valid points OR a valid flat price.
    const hasFlatPrice = typeof d.price === "number" && withinBounds(d.price);
    if (validPoints.length === 0 && !hasFlatPrice) continue;

    out.push(
      stampOwnership(
        { ...d, points: validPoints.length ? validPoints : d.points ?? [] },
        {
          owner: "agent",
          analysisId: opts.analysisId,
          agentName: opts.agentName ?? "smart_chart_agent",
          createdAt: Date.now(),
        },
      ),
    );
  }
  return out;
}
