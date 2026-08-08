/** Geometry engine public surface. */
export {
  detectChartGeometry,
  geometryMinConfidence,
  GEOMETRY_WINDOW_BARS,
  MIN_GEOMETRY_CANDLES,
} from "./detectGeometry";
export {
  geometryToDrawings,
  summarizeGeometry,
  geometryEvidenceLines,
  type GeometrySummary,
  type GeometryPatternSummary,
} from "./toDrawings";
export {
  allConfirmedPivots,
  confirmedPivots,
  geometryAtr,
  zigzagPivots,
} from "./pivots";
export {
  detectTrendlines,
  evaluateTrendlineCandidates,
  MAX_ANCHOR_AGE_BARS,
} from "./trendlines";
export type {
  ChannelGeometry,
  GeometryCandle,
  GeometryPivot,
  GeometrySnapshot,
  PatternInstance,
  PatternStatus,
  TrendlineGeometry,
} from "./types";
