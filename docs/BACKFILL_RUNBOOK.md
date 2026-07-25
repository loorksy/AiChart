# Warehouse Backfill & Pipeline Scale-Out Runbook (Phase 5)

The mass-backtest pipeline consumes warehouse history. New symbols/timeframes
need depth BEFORE their catalog wave is seeded, or every submit dies at the
"insufficient coverage" gate and wastes pipeline capacity.

## Current scale settings

- `CANDLE_SYNC_SYMBOLS` — 12 series set: `EURUSD,GBPUSD,USDJPY,USDCHF,AUDUSD,USDCAD,NZDUSD,EURGBP,EURJPY,GBPJPY,XAUUSD,XAGUSD`
- `CANDLE_SYNC_INTERVALS=1m,5m,15m,30m,1h,4h,1d` (7)
- `CANDLE_SYNC_MAX_SERIES=15` per 10-min cron tick → 12×7 = 84 series → full
  round-robin cycle ≈ 60 min. OANDA load stays ≈ 1–2 req/s peak per tick.

## Staged backfill order (per NEW symbol)

Depth builds by `CANDLE_SYNC_MAX_PAGES` (default 5 × 4500 bars ≈ 22.5k
bars/series/tick), so deep intraday history takes elapsed days by design —
never hammer OANDA to shortcut it.

1. **1d + 4h to ~5y** (few ticks — the daily needs one).
2. **1h to 2–3y** (~1–2 ticks).
3. **30m/15m to 12–24 months** (2–3 ticks each).
4. 5m/1m accumulate opportunistically (not needed for the pipeline wave).

Watch progress: `GET /api/cron/candle-warehouse?symbol=GBPUSD` (cron secret) →
first/last candle + gap counts per interval.

## Seeding a new symbol into the pipeline

1. Confirm coverage (above) meets the per-timeframe lookbacks the pipeline
   uses: 15m→12mo, 30m→24mo, 1h→36mo, 4h→60mo.
2. Add the symbol to `STRATEGY_PIPELINE_SYMBOLS` (comma-separated) and
   restart web + worker (`pm2 restart aichart-web aichart-worker --update-env`).
3. The next `/api/cron/strategy-pipeline` tick starts submitting its combos —
   batch-paced (2/tick), so a full 60-strategy × 4-TF wave for one symbol
   trickles over ~20 hours. That pacing is intentional (single-concurrency
   research container).
4. Watch `GET /api/cron/strategy-pipeline` — `backtests` counts by state,
   `ineligibleReasons` shows WHICH statistical gate kills candidates.

## Prune before you scale

Before seeding the 10 majors, look at the gold wave's results: families with
zero `eligible` survivors on XAUUSD across all timeframes should be removed
from the catalog (delete the family in `catalogGen.ts`, bump
`CATALOG_SPEC_REVISION`) rather than burning compute on 10 more symbols. A
sparse-but-honest catalog is the desired outcome — never loosen the gates to
fill it.

## VPS prerequisites checklist

- `REDIS_URL` set (pipeline cron no-ops without it — by design).
- `RESEARCH_SERVICE_ENABLED=1`, `RESEARCH_BACKTEST_ENABLED=1`,
  `RESEARCH_VALIDATION_ENABLED=1` in web/.env; research-service container up
  (`docker compose ps` in infra/) with
  `RESEARCH_SERVICE_MAX_TIMEOUT_SECONDS=600` for 50k-bar samples.
- `STRATEGY_PIPELINE_USER_ID` = the operator's user id.
- `/etc/cron.d/aichart` contains the `strategy-pipeline` entry (see
  `infra/aichart.cron`).
