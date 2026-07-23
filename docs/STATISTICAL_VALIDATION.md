# Statistical Validation

## Scope

`research-service/app/validation/` provides deterministic descriptive robustness checks over
validated return/equity arrays. It does not discover a strategy, optimize parameters, prove
causality, correct selection bias, or authorize trading. Every result is conditional on its named
method, supplied observations, assumptions, and seed.

## Monte Carlo

Implemented named methods are:

| Method | Null/interpretation |
|---|---|
| `trade_order_permutation` | Observed path drawdown is compared with random orderings of the same realized returns. Terminal return is unchanged by ordering. |
| `trade_return_bootstrap` | Future returns are treated as IID empirical draws. Serial dependence is not preserved. |
| `execution_cost_stress` | Gross returns remain profitable when observed costs are multiplied within a bounded configured range. |

Each configuration persists method, seed, simulation count, confidence, minimum observations, and
method assumptions. Simulation count is bounded to 10,000 and uses a local seeded RNG.

`parameter_perturbation` is not implemented as a Monte Carlo method. Numeric sensitivity exists as
a separate bounded grid. This is a documented Phase 3 gap, not an alias.

## Bootstrap confidence intervals

Bootstrap supports IID and moving-block resampling. Moving-block requires an explicit block size
and is preferred when the selected block assumption is justified for autocorrelated returns.
Intervals are available for mean trade return, expectancy, win rate, profit factor, Sharpe, and
maximum drawdown.

Undefined metrics return no estimate plus a reason, for example profit factor without a losing
return or Sharpe without enough non-constant observations. A supplied `periods_per_year` is
required for annualized Sharpe; the validator does not silently substitute `sqrt(252)`.

Neither IID nor moving-block intervals account for strategy-selection, multiple-testing, regime
shift, or data-snooping bias.

## Walk-forward

The implemented walk-forward procedure partitions an equity sequence into complete, sequential,
non-overlapping training, validation, and out-of-sample observation blocks. Integration jobs size
each window approximately **70% training / ~30% out-of-sample** (plus a tiny unused-for-fitting
validation slice for schema compatibility). The strategy is fixed for all segments. It reports
per-segment return, mean period return, optional Sharpe, drawdown, optional trade-level
`win_rate` / `expectancy` / `trade_count` (when exit indexes are supplied), profitable out-of-sample
fraction, training vs OOS summary fields, a descriptive `likely_overfit` heuristic, and unused
trailing observations.

### Backtest trade-count root cause (ema_trend_follow_v1)

Two stacked defects capped historical trade counts:

1. **One-trade-ever:** catalog `entry.allow_reentry: false` plus an engine set `_entered_symbols`
   that was never cleared after a full close capped every multi-bar run at **one trade per symbol**.
   The intended constraint was one *open* position at a time (`max_open_positions`). Fix: allow
   re-entry after close in the catalog, and discard the symbol from `_entered_symbols` on full close.
2. **Permanent consecutive-loss halt:** `max_consecutive_losses` permanently blocked new entries for
   the rest of the sample after N losers (observed as exactly 4 trades with win rate 0). Fix: treat
   the limit as a circuit-breaker *pause* that resets the counter after `consecutive_loss_pause_bars`
   (or a derived pause), so the historical sample can continue.

There is no fitting, parameter selection, or optimization in training/validation, and no access to
out-of-sample data for selection. Window boundaries are observation indexes rather than market
timestamps, and the current summary does not include per-window trade count or profit factor.

## Sensitivity

Sensitivity generates a bounded Cartesian grid for one to six named numeric parameters, with two
to seven values each and at most 1,000 combinations. Categorical logic is not mutated. Results
report baseline/minimum/median/maximum score, positive fraction, worst relative degradation, and a
stability decision.

The evaluator is trusted integration code; user code, expressions, imports, and callbacks are
never accepted. The validation job supports two bounded forms: an execution-cost multiplier grid,
and one to three allowlisted numeric paths in the compiled source strategy (maximum 25
combinations per job). Each strategy combination is schema-validated and rerun against the same
canonical dataset and run configuration. The job reports every combination, including the declared
baseline; it does not select, persist, or promote a best strategy. Both forms are written to
`sensitivity.json`, and requested stability results feed readiness.

## Readiness classification

Statuses are:

```text
rejected
experimental
needs_more_data
paper_ready
demo_ready
live_candidate
```

Foundational strategy/data failure produces `rejected`. Insufficient trades produces
`needs_more_data`. Higher levels apply monotonic configurable gates covering trade count,
out-of-sample windows, drawdown, profit factor, expectancy, cost stress, walk-forward consistency,
bootstrap expectancy lower bound, ambiguity rate, sensitivity, and Monte Carlo loss probability.
Missing evidence is reported in warnings and fails any gate that requires it.

Every `ReadinessResult` has `live_trading_authorized=false`. `live_candidate` means only that the
configured research gates passed; independent governance, paper/demo observation, risk review, and
explicit future approval remain mandatory. The service has no order capability.

## Annualization policy

Engine metrics derive periods per year from Forex cadence: daily uses 260; intraday uses
`52 * 5 * 24 * 60 / timeframe_minutes`. The chosen period count is emitted with metrics. This is a
declared 24-hour, five-day approximation, not an exchange calendar and not `sqrt(252)`.

Bootstrap and walk-forward accept an explicit periods-per-year value and otherwise leave Sharpe
unannualized/undefined according to the helper contract. Annualization assumptions must accompany
any comparison across timeframes.

## Integration status and limitations

The suite runner and `run_backtest_validation` job orchestrate configured Monte Carlo, bootstrap,
fixed-strategy walk-forward, optional execution-cost/strategy sensitivity, and readiness, then write
`validation.json`, `readiness.json`, and optional `sensitivity.json`. Monte Carlo and bootstrap
check cancellation at bounded simulation intervals; walk-forward and sensitivity check between
windows/combinations. Statistical functions run in a worker thread so the service event loop can
accept cancellation. A cancelled job terminates without partial validation artifacts.

The aligned server-only helper sends a succeeded backtest job ID plus metrics, trades, equity, and
run-configuration artifact IDs and a compact validation configuration. The service verifies the
source job type, success state, tenant ownership, artifact size/shape, and derives return/equity
arrays itself. It does not accept client-supplied readiness evidence or arbitrary evaluators.
