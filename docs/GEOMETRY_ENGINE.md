# Chart Geometry Engine (Phase 3)

`web/src/lib/chart/geometry/` — one deterministic engine that turns candles
into trendlines, channels, and named chart patterns with a
**forming | completed | invalidated** state, feeding every surface from the
same detection: the decision path, the live TradingView chart, the PNG
snapshots, the MT5 captures, and the MCP numeric context.

## Modules

| Module | Role |
| --- | --- |
| `pivots.ts` | Confirmed fractal pivots (configurable lookback) + alternating ATR-filtered zigzag. Resurrects the `Pivot[]` producer the builders in `analysis/drawings.ts` lost. |
| `trendlines.ts` | Multi-line, both sides (top 2 non-collinear per side). Generalises `proposeStructuralTrendline`'s scoring (base 40 + separation + ATR distance + touches, accept ≥ 60) **without** the `Math.max(touches, 2)` floor. |
| `channels.ts` | Parallel boundary voted by opposite-side pivots (≥2 touches within 0.15×ATR, width 1–8 ATR). Max one channel. |
| `triangles.ts` | Converging boundaries → ascending/descending/symmetrical triangle **and** wedges (same machinery, same-sign slopes). Boundary = largest conforming recent pivot suffix. |
| `headShoulders.ts` | 5-pivot template ±inverse; head ≥ 0.8×ATR over shoulders, symmetry ≤ 35%, neckline through the troughs, measured-move target. |
| `doubleExtremes.ts` | Double top/bottom: extremes within 0.4×ATR, ≥8 bars apart, neckline break completion. |
| `flags.ts` | Impulse ≥ 2.5×ATR in 5–10 bars + adaptive consolidation (grows until a close escapes it — the breakout candle never pollutes the range). Converging consolidation = pennant. |
| `patternState.ts` | Shared state machine: completion = **CLOSE** beyond boundary ± 0.25×ATR (wick = sweep, never a break). Forming confidence ×0.85, invalidated ×0.4. |
| `detectGeometry.ts` | Entry point: 500-bar cap, ≥60 candles, `GEOMETRY_MIN_CONFIDENCE` env (default 60), output bounds (≤2 lines/side, ≤1 channel, ≤3 patterns), overlap dedupe where **specificity outranks confidence** (H&S > triangles/wedges > doubles/flags — a flat-top triangle also matches the looser double-top template; the richer claim wins). |
| `toDrawings.ts` | Snapshot → `ChartDrawing[]` (trend_line / parallel_channel / polyline_pattern+patternType / neckline, forming = dashed, H&S gains synthetic lead-in/exit for TV's 7-point tool) + `summarizeGeometry` / `geometryEvidenceLines` for numeric consumers. |

Pure by contract: geometry imports nothing from `lib/agent`; the agent imports
geometry. Same input ⇒ same output (locked by a determinism test).

## Consumers

1. **Decision path** — `orchestrator.ts` computes the snapshot once. The
   synthesizer receives a `chartGeometry` evidence block (summary + one-liners)
   with an explicit prompt rule: cite patterns by name when they support the
   decision, treat *forming* as weaker evidence, never cite an absent pattern.
   `buildDrawingPlan` gains `selectedGeometry` (own sub-budget of 3 inside
   `MAX_PLAN_OBJECTS` 7→9, same strength threshold as levels, invalidated
   patterns never drawn); `drawingAgent` renders it.
2. **TradingView live** — flows through the existing adapter (native editable
   tools). `PATTERN_TOOL` now covers wedge (triangle tool), flag/pennant/cup
   (labeled polyline).
3. **PNG snapshots** — `chartSnapshot.buildChartJson` gained a semantic
   down-mapping (supply/demand/decision/range/retest → zone, parallel_channel
   → channel, neckline → trend_line, positions → level cluster, plus a
   `polyline_pattern` case). This also fixes a live bug: the zone types the
   drawing agent emits were silently dropped from every recommendation PNG.
4. **MT5** — the EA bridge (and `eaChartDraw.mapDrawingsForMt5`, which pre-mapped
   semantic types onto the MT5-native set it rendered) was removed; drawings
   now reach the operator only through the platform TradingView chart.
5. **MCP** — `capture_multi_timeframe_snapshot`'s `numeric_context.geometry`
   carries the same-frame pattern list (name, state, break direction,
   projected target, confidence) next to each image — shape confirmation stays
   visual, numbers stay deterministic.

## Guardrails

- Geometry is **evidence, never authority**: it cannot force BUY/SELL and it
  never touches the execution eligibility chain (backtest evidence only).
- Completion requires a close, not a wick.
- Bounded output + `GEOMETRY_MIN_CONFIDENCE` to tighten in production without
  a redeploy.

## Tests

`web/src/lib/chart/geometry/__tests__/geometry.test.ts` — synthetic fixtures:
ascending triangle (breakout → completed/up with target; no breakout →
forming, discounted confidence), H&S (neckline break → completed/down, 7-point
drawing; holding → forming), bull flag (breakout → completed; collapse →
invalidated, never completed), zigzag alternation, determinism (double call
deep-equal), output bounds, empty below minimum window, vocabulary-bound
drawings with state labels.
