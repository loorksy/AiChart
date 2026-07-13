# Deterministic Forex/XAUUSD Backtest Engine

## Status

Phase 3 implementation modules now exist for strict strategies, normalized data, a bar-by-bar
engine, metrics/attribution, and statistical validation. They are research-only and contain no
broker or live-order capability.

Phase 3 job types, artifact writers, aligned TypeScript/Python request contracts, disabled-default
flags and configuration examples, a warehouse producer, and pinned PyArrow are now present.
Execution-cost and compiled-strategy numeric sensitivity are job-integrated. Inline warehouse
transfer is bounded at 8 MiB, and a regression pipeline exercises a payload above the former
48 KiB boundary through readiness and artifacts. Completion still depends on the validation matrix
reported for the current working tree.

Related contracts:

- [STRATEGY_SPECIFICATION.md](STRATEGY_SPECIFICATION.md)
- [DATASET_CONTRACT.md](DATASET_CONTRACT.md)
- [BACKTEST_EXECUTION_POLICY.md](BACKTEST_EXECUTION_POLICY.md)
- [STATISTICAL_VALIDATION.md](STATISTICAL_VALIDATION.md)
- [RESEARCH_SECURITY_MODEL.md](RESEARCH_SECURITY_MODEL.md)

## Pre-implementation audit

### AiChart

AiChart's Candle Warehouse is the correct owner of historical bars but must not be exposed through
production DB credentials. Its symbol/timeframe conventions and server-side tenant identity are
accepted at a bounded export boundary.

The audit found hazards that the engine must not inherit:

- an OANDA path drops the upstream `complete` flag while retaining the forming bar, and warehouse
  writes default missing completeness to true;
- warehouse reads do not require `complete=1`;
- existing resampling groups from the first requested row rather than fixed UTC boundaries;
- swing/structure detectors use right-hand confirmation bars or future classification data;
- live Gold Agent/recommendation/session code uses live state, simplified ambiguity rules, or fixed
  UTC assumptions.

The Phase 3 data boundary therefore requires an explicit closed-bar export and performs independent
validation. Existing live-analysis modules are not imported as evaluators.

### Vibe-Trading

Vibe material was reviewed for concepts and risk patterns. The following were accepted as idea
only and independently reimplemented for AiChart: N-close/N+1-open timing, bar-by-bar separation of
policies, explicit ambiguity, named seeded simulations, descriptive attribution, and cost-aware
fills.

Rejected concepts include dynamic strategy imports, generated Python, arbitrary local/network
loaders, extra-allow schemas, silent timezone/source repair, guessed Forex metadata/carry, generic
annualization, and claims that shifted arrays alone prevent leakage. No Vibe source, tests, formula
set, prose, or dataset was copied. See [VIBE_ATTRIBUTION.md](VIBE_ATTRIBUTION.md).

## Architecture

```text
strict StrategySpecification + canonical hash
                  |
bounded CanonicalDataset + quality/hash/alignment
                  |
typed compiler metadata and backtest compiler
                  |
bar-by-bar engine (orders, fills, positions, account)
                  |
metrics + descriptive attribution
                  |
named statistical validation + readiness
```

The strategy compiler never emits source. Dataset loaders never import user modules or fetch URLs.
The engine receives validated objects and a persisted seed. Identical strategy hash, dataset hash,
run configuration, engine/indicator versions, and seed are intended to reproduce the same result.

## Engine behavior

- Signals use closed-bar data and market entries activate on the next bar.
- Higher-timeframe availability uses bar close time, including exact close boundaries.
- Market, limit, and stop orders have finite validity and explicit gap policies.
- Stops are mandatory; multiple targets and bounded partial exits are supported.
- Break-even and trailing updates become active on the next bar and never widen risk.
- Spread, slippage, commission, and fixed-daily carry are recorded separately.
- Intrabar ambiguity, including pending-entry/stop/target ordering, is configurable and counted.
- Account state tracks balance, equity, PnL, margin, free margin, peak, and drawdown.
- Quote/account currency mismatch is rejected rather than approximated.

Order entries assume full fills. Market depth, volume participation, partial entry fills,
financing calendars, and tick reconstruction are not modeled. Insufficient entry margin is
rejected; a path that would require a margin call/liquidation fails closed instead of simulating an
invented liquidation.

## Indicators and conditions

`aichart-indicators-v1` implements deterministic SMA, EMA, RSI, ATR, MACD, Bollinger bands,
rolling high/low, and basic candle-pattern helpers with stable `None` warm-up. The strict strategy
surface currently exposes price comparison, EMA/SMA, RSI, ATR, range breakout, sessions, weekdays,
and time windows only. Unsupported conditions fail closed.

The backtest compiler stores `aichart-forex-v1`, indicator version, strategy hash, dataset hash,
and run configuration in `BacktestResult`.

## Metrics and artifacts

The metrics function returns returns/PnL, wins/losses, profit factor, expectancy, direction counts,
R statistics, drawdown, Sharpe/Sortino, recovery, holding, streaks, exposure, costs, ambiguity, and
breakdowns by symbol, direction, session, weekday, exit reason, regime, and condition set. Undefined
metrics are `null` with `metric_reasons` rather than invented values.

Attribution is explicitly descriptive: winners/losers, remove-top-winner scenarios, holding
buckets, session/regime/direction/cost breakdowns, ambiguity, cancelled pending orders, and missed
expired orders. It does not make causal claims.

The backtest job writes `strategy_spec.json`, `dataset_quality.json`, `run_config.json`,
`metrics.json`, `events.json`, `attribution.json`, `chart_annotations.json`, `trades.csv`,
`orders.csv`, `equity.csv`, and `drawdown.csv`. Strategy and validation jobs additionally write
strategy-validation, `validation.json`, and `readiness.json` artifacts; validation also writes
`sensitivity.json` when execution-cost or strategy-parameter sensitivity is requested. Artifact
output remains bounded by the Phase 2 store.

## Security invariants

- No dynamic code, expression evaluation, subprocess, pickle, or user import path.
- No arbitrary URL and no path outside the authorized artifact root.
- No Research Service access to AiChart production DB or broker credentials.
- No live trading route, permission, or recommendation migration.
- Inputs, files, rows, simulations, windows, combinations, artifacts, queue, timeout, and retry are
  bounded at their responsible layer.
- Readiness labels never authorize live trading.

## Phase 3 exit validation

The implementation blockers above are resolved in the current working tree. Python, the isolated
Python 3.12/PyArrow path, TypeScript CI, type checking, lint, web production build, MCP build/tests,
and diff checks pass. Docker image build and container smoke remain unverified because this host
has no Docker CLI/runtime. Under the strict exit rule, that unavailable validation keeps Phase 3
not complete until it is rerun on a Docker-capable host.

No Phase 4 work is included.
