# Trading Calendar & Gap Policy v1.2 + Canonical Evidence Keys

Phase 1+2 of the pro-agent upgrade. Two structural causes of the permanent
"WAIT — analysis blocked until the data is repaired" are fixed here.

## Why analysis was permanently blocked (root cause)

`isForexMarketOpen(_symbol, …)` ignored its symbol argument and modelled the
week with fixed UTC hours (Fri/Sun 22:00). Two consequences on XAUUSD:

1. **Metals daily maintenance break** ([17:00, 18:00) New York, Mon–Thu) was
   counted as *missing open-market bars*: 4 phantom 15m bars/day × ~5 days in
   the 500-bar window = "20 missing bars across 5 gaps" — permanently.
2. **DST**: OANDA daily candles align to 17:00 America/New_York (21:00 UTC in
   EDT), but the fixed 22:00-UTC boundary judged the weekend candidate "open"
   → one phantom missing daily bar per week ("19 missing across 18 gaps").

The old gap policy (`maxSingleGapBars: 1, maxTotalMissingBars: 2`, absolute)
then classified this as critical, and `orchestrator.ts` returned WAIT before
any analysis agent or the decision LLM ever ran.

## Trading calendar — `web/src/lib/markets/tradingCalendar.ts`

- Week = **Sunday 17:00 → Friday 17:00 America/New_York wall time**, computed
  via `Intl.DateTimeFormat` (no dependency). DST transitions land exactly on
  UTC hour boundaries, so NY weekday+hour is memoized per UTC hour — exact.
- Symbol classes: `fx` / `metal` (XAU/XAG: Sunday open 18:00 NY + daily break
  17:00–18:00 NY) / `crypto` (always open) / unknown → fx.
- `isExpectedDailyBarOpen`: a daily bar exists iff the candidate opens at
  17:00 NY on Sun–Thu — exactly 5 per week, DST-proof.
- `web/src/lib/agent/marketSession.ts` is now a thin delegate (exported names
  unchanged); `detectCandleGaps` uses the calendar + the daily-bar predicate.
- Env: `TRADING_CALENDAR_FX_BREAK_MINUTES` (default 0) if the fx feed shows a
  daily break too.

## Gap severity ladder — `dataQualityPolicy.ts` v1.2.0

`none | minor | significant | catastrophic`, window-relative:

| Tier | Default trigger | Effect |
| --- | --- | --- |
| minor | any missing bars | nothing |
| significant | single gap > 3 bars (`CANDLE_GAP_MAX_SINGLE_BARS`) or total > 2% of window (`CANDLE_GAP_MAX_MISSING_RATIO`) | bilingual warning in riskWarnings + auto-repair job; **analysis proceeds** |
| catastrophic | single gap ≥ 20 bars (`CANDLE_GAP_CATASTROPHIC_SINGLE_BARS`) or total ≥ 10% (`CANDLE_GAP_CATASTROPHIC_RATIO`) | the only remaining hard block; summary says repair started |

`hasCriticalGaps` now means *catastrophic only*. The count-based statistical
gates (300/500-bar coverage, trade gate for recommendations) are unchanged.
Auto-repair: `candle_gap_repair` queue job (10-min cooldown per series, queue
idempotency across processes) → `repairRecentCandleGaps`.

## Canonical evidence keys — `web/src/lib/strategies/matchingKeys.ts`

`strategy_deployments` are keyed by canonical symbol + research timeframe
(`XAUUSD`, `1h`). Recommendations historically stored broker-suffixed symbols
(`XAUUSDM`) and alias timeframes (`H1`, `60`, `1D`), so the deployment lookup
and the execution-eligibility join could never match — BUY/SELL was
structurally impossible even with validated evidence.

- `canonicalStrategySymbol` (via `normalizeSymbol().canonical`) and
  `canonicalStrategyTimeframe` (7 research timeframes; MT/TV aliases mapped;
  null when unmappable) are applied at every write and read site:
  recommendation route, `getStrategyDeployment`,
  `checkRecommendationExecutionEligibility` (now resolves the deployment via
  the canonicalising helper instead of a raw SQL join).
- BUY/SELL with a non-research timeframe → 400 with the valid list. WAIT keeps
  free-form frames (audit trail preserves the claim).
- Idempotent startup migration canonicalises legacy rows (both SQLite/PG).
- `strategy_backtests.strategy_version` now derives from
  `CATALOG_SPEC_REVISION` (was hardcoded `.1` while the spec used `.2`).

## Registry fixes

- `XAGUSD` added to the research-service `SYMBOL_REGISTRY` (5000 oz, pip
  0.001) — the web exporter already allowlisted it.
- Gold pip size is a static 0.01 (`spread.ts`) — no longer flips at a $1000
  mid-price; matches the research registry.
- `30m` added to `CANDLE_SYNC_INTERVALS` defaults (it is a research timeframe).

## MCP catalog ids — pattern, not enum

`zBacktestStrategyId` validates SHAPE (`^[a-z0-9_]+_v\d+$`); membership is
validated server-side (409 for unknown ids, deployment evidence for BUY/SELL).
The web catalog (`web/src/lib/strategies/catalog.ts`) is the single source of
truth — a growing catalog no longer churns the MCP contract.

## Tests

- `web/src/lib/markets/__tests__/tradingCalendar.test.ts` — DST boundaries
  (2026: Mar 8 / Nov 1), metals break, exactly 5 daily bars in normal AND both
  transition weeks.
- `web/src/lib/agent/__tests__/dataQualityPolicy.test.ts` — severity tiers,
  env overrides, the old blocker case now significant.
- `web/src/lib/ohlc/__tests__/candleQuality.test.ts` — gold break and weekly
  daily-bar regressions on `detectCandleGaps`.
- `web/src/lib/strategies/__tests__/matchingKeys.test.ts` — the exact
  XAUUSDM/"60" → XAUUSD/1h production mismatch.
- `integrationBoundaries.test.ts` — catastrophic still gates before the fleet;
  significant provably proceeds without an early return.
