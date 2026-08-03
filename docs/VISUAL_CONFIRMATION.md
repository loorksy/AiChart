# Multi-Timeframe Visual Confirmation

Chart images are a formal step in the recommendation path, not an ad-hoc lookup. A
recommendation is expected to rest on three legs:

1. **Visual** — several timeframes captured together (15m for precise entry, 1h for
   immediate context, 4h for trend, 1D for the big picture).
2. **Numeric** — the deterministic engines for those same timeframes: RSI, ADX,
   `detect_levels`, `detect_market_regime`, and the `get_strategy_performance`
   backtest evidence.
3. **Agreement or disagreement** — stated explicitly in the recommendation text and
   recorded as a field, not silently dropped.

## `capture_multi_timeframe_snapshot`

MCP tool → `POST /api/agent/chart/multi-snapshot` →
`web/src/lib/chart/multiTimeframeCapture.ts`.

| Input | Default | Notes |
| --- | --- | --- |
| `symbol` | — | required |
| `timeframes` | `["15m","1h","4h","1D"]` | scalp `["5m","15m","1h"]`, swing `["1h","4h","1D","1W"]` |
| `max_images` | `4` | hard ceiling 6 |
| `include_numeric_context` | `true` | off only for a pure visual look |
| `inline_base64` | `false` | also repeat raw base64 in the JSON block |
| `fresh` | `false` | bypass the snapshot cache |

Every timeframe is captured **in parallel**, each with its own ~8s budget
(`image_timeout_ms`, 2–20s). The platform's own TradingView chart is tried
first, falling back to the server-rendered chart within the same budget.

Response, per timeframe:

```json
{
  "timeframe": "1h",
  "content_type": "image/png",
  "captured_at": "2026-07-25T10:00:01.000Z",
  "image_source": "mt5",
  "from_cache": false,
  "numeric_context": {
    "price": 4130.02,
    "rsi": 54.7,
    "adx": 28.4,
    "trend": "uptrend",
    "structure": "uptrend",
    "regime": "trending",
    "nearest_support": 4106.7,
    "nearest_resistance": 4159.6,
    "sources": { "rsi": "get_market_snapshot", "levels": "detect_levels" }
  }
}
```

The MCP layer delivers each PNG as an inline **image block** preceded by a small
label block naming its timeframe and numbers, so the model can bind a chart to the
timeframe it belongs to. `imageBase64` is repeated inside the JSON summary only
when `inline_base64: true` — four charts duplicated as text approach a megabyte of
payload for no gain.

### Partial success

One failed timeframe never fails the request. The others return and the gap is
reported:

```json
{ "partial_success": true,
  "captured_timeframes": ["15m", "1h", "4h"],
  "missing_timeframes": [{ "timeframe": "1d", "reason": "capture_timeout" }] }
```

Reasons include `capture_timeout`, `mt5_offline`, `chart_render_unavailable`,
`unsupported_timeframe`, `duplicate_timeframe`, `max_images_exceeded`. An
unsupported label is reported rather than coerced — silently falling back to `1h`
would hand the model four copies of the same chart. Only a request where *nothing*
was captured returns 503.

### Snapshot cache

`web/src/lib/chart/snapshotCache.ts` keeps captured PNGs for ~12s
(`CHART_SNAPSHOT_CACHE_TTL_MS`, max 60s, `0` disables) keyed by
user/market/symbol/timeframe. It removes duplicate renders inside a single
analysis without ever serving a stale bar. Deliberately in-process: entries are
hundreds of kilobytes and live for seconds.

## `create_recommendation` audit fields

Both fields are optional — recommendations written before visual review existed
keep validating unchanged.

- `visual_confirmation`: `"confirmed" | "contradicted" | "not_checked"`, or the
  boolean shorthand (`true` → confirmed, `false` → contradicted). A caller that
  did not look at charts must **omit** the field.
- `timeframes_reviewed`: the timeframes actually reviewed, e.g.
  `["15m","1h","4h","1D"]`.

Both are persisted in `recommendations.context_json` and written to the audit log
line alongside strategy, backtest id, and regime. No schema migration is needed.

## Guardrails

**1 — An image is context, never a number.** Every figure returned next to an
image comes from the deterministic engines, and `sources` names which engine
produced it. A support/resistance level quoted in a recommendation must match
`numeric_context` / `detect_levels`; nothing in the pipeline extracts a price
from pixels.

**2 — Visual review never authorises live execution.**
`checkRecommendationExecutionEligibility` reads strategy id, backtest id, and
deployment state only. `visual_confirmation` is not in its query, in
`/api/agent/trade/open`, or in the readiness/safety checks — and
`web/src/lib/recommendations/__tests__/visualConfirmation.test.ts` fails if a
future edit introduces it. Visual review is a layer stacked on the statistical
gates (validated backtest + calibrated confidence + ≥100 historical trades), not
a substitute for them.

**3 — A disagreement costs confidence.** When `visual_confirmation` is
`contradicted`, the **displayed** confidence is reduced by a configurable
percentage (`VISUAL_CONTRADICTION_PENALTY_PCT`, default 15% relative). The
server-owned statistical evidence — `backtested_confidence`, its interval, and
the backtest id — is written unchanged; the penalty communicates uncertainty to
the operator, it does not restate the measured edge. Agreement earns no bonus:
this path can only ever lower a number.

The response echoes what happened under `visual_review`:

```json
{ "visual_review": {
    "visual_confirmation": "contradicted",
    "timeframes_reviewed": ["15m", "1h", "4h", "1d"],
    "confidence_penalty_applied": true,
    "confidence_penalty_pct": 15,
    "confidence_before_penalty": 62.5 } }
```

## Tests

- `mcp/src/tools/__tests__/multiTimeframeVisual.test.ts` — tool contract, image
  block layout, partial success, backward-compatible recommendation schema.
- `web/src/lib/chart/__tests__/multiTimeframeCapture.test.ts` — timeframe
  canonicalisation (`1D`→`1d`, `1M` stays month), dedupe, image budget, cache TTL.
- `web/src/lib/recommendations/__tests__/visualConfirmation.test.ts` — penalty
  maths, backward compatibility, and the execution-isolation guardrail.
