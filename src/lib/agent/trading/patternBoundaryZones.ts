/**
 * Entry zones from the boundaries of patterns still forming (plan §11 F.3).
 *
 * A triangle's rising lows, a rectangle's floor, a neckline before its third
 * touch — these are places a plan can legitimately enter BEFORE the pattern
 * completes, at declared extra risk. The synthesizer's prompt already described
 * such opportunities in words; this makes them real candidates, because a
 * boundary the model can only talk about is not a level the candidate engine
 * validated, and the plan built on it would fail level grounding.
 *
 * Output is ordinary supply/demand zones tagged with their boundary type, so
 * `buildTradeCandidates` scores them with the same geometry rules as every other
 * POI. Nothing here decides — a boundary zone is one more entry on the menu.
 */
import type { GeometrySnapshot, PatternInstance } from "@/lib/chart/geometry";
import type { SupplyDemandZone } from "../marketContext/detectors";

export type BoundaryType =
  | "support_boundary"
  | "resistance_boundary"
  | "neckline"
  | "range_edge"
  | "pattern_invalidation_boundary";

export interface PatternBoundaryZone extends SupplyDemandZone {
  /** Marks the zone as pattern-derived so the candidate carries the caveat. */
  patternBoundary: {
    patternType: string;
    boundaryType: BoundaryType;
    stage: string;
  };
}

/** Half-height of a boundary zone, in ATR. Tight: the boundary IS the level. */
const ZONE_HALF_ATR = 0.35;

function zoneAround(
  price: number,
  atr: number,
  type: "supply" | "demand",
  time: number,
  pattern: PatternInstance,
  boundaryType: BoundaryType,
): PatternBoundaryZone {
  const half = atr * ZONE_HALF_ATR;
  return {
    type,
    low: price - half,
    high: price + half,
    time,
    patternBoundary: {
      patternType: pattern.patternType,
      boundaryType,
      stage: pattern.stage ?? pattern.status,
    },
  };
}

/**
 * Boundaries worth offering, from patterns that are still open.
 *
 * Only forming structures produce zones: a completed pattern's boundary has
 * already broken, and an invalidated one has nothing to defend. The zone side
 * follows the boundary's role — a floor is demand, a ceiling is supply — not the
 * pattern's eventual break direction, because the anticipatory entry trades the
 * boundary holding, not the break.
 */
export function patternBoundaryZones(
  geometry: GeometrySnapshot | null | undefined,
  atr: number | null,
): PatternBoundaryZone[] {
  if (!geometry || !atr || atr <= 0) return [];
  const zones: PatternBoundaryZone[] = [];

  for (const pattern of geometry.patterns ?? []) {
    if (pattern.status !== "forming") continue;
    const lastAnchor = pattern.anchors[pattern.anchors.length - 1];
    if (!lastAnchor) continue;
    const time = lastAnchor.time;

    // The neckline (when the detector reports one) is the pattern's decisive
    // level: demand under a bottoming shape, supply under a topping one.
    if (pattern.neckline) {
      const price = pattern.neckline.to.price;
      const type = pattern.breakDirection === "up" ? "supply" : "demand";
      zones.push(zoneAround(price, atr, type, time, pattern, "neckline"));
    }

    // Boundary pivots: the extremes the structure keeps respecting. For a
    // rectangle these are the range edges; for triangles/wedges the touched
    // trendline ends; for cups the rim.
    const highs = pattern.anchors.filter((a) => a.kind === "high");
    const lows = pattern.anchors.filter((a) => a.kind === "low");
    const isRange = pattern.patternType === "rectangle" || pattern.patternType === "range";

    if (lows.length >= 2) {
      const floor = Math.min(...lows.map((a) => a.price));
      zones.push(
        zoneAround(
          floor,
          atr,
          "demand",
          time,
          pattern,
          isRange ? "range_edge" : "support_boundary",
        ),
      );
    }
    if (highs.length >= 2) {
      const ceiling = Math.max(...highs.map((a) => a.price));
      zones.push(
        zoneAround(
          ceiling,
          atr,
          "supply",
          time,
          pattern,
          isRange ? "range_edge" : "resistance_boundary",
        ),
      );
    }
  }

  return zones;
}

/** True when a zone came from a forming-pattern boundary. */
export function isPatternBoundaryZone(
  zone: SupplyDemandZone,
): zone is PatternBoundaryZone {
  return "patternBoundary" in zone && zone.patternBoundary != null;
}
