# Strategy Specification

## Purpose and trust boundary

The Phase 3 Strategy Specification is declarative JSON data. It never accepts Python,
JavaScript, shell, MQL, import paths, expressions, callbacks, or user-defined executable code.
Pydantic models reject unknown fields, non-finite numbers, unsupported enum values, and
unbounded configuration.

The implementation is under `research-service/app/strategies/`. A validated specification is
an input to research simulation only. It does not create an AiChart recommendation, broker
order, approval, or live-trading permission.

Current specification version: `1.0.0`.

## Identity

Every specification contains:

- `strategy_id`, `version_id`, `name`, `description`;
- `market`, currently fixed to `forex`;
- one or more normalized supported symbols;
- `enabled`, `created_at`, and `spec_version`;
- timeframe, direction, condition, entry, stop, target, sizing, management, risk, and cost
  configuration.

`created_at` must be timezone-aware and is normalized to UTC. Symbol input removes only common
pair separators and is normalized to uppercase. Duplicate normalized symbols are rejected.
The local registry contains the common 28 Forex pairs and `XAUUSD`, with digits, pip/tick size,
contract size, currencies, minimum lot, and lot step.

## Timeframes and direction

Supported timeframes are:

```text
1m  5m  15m  30m  1h  4h  1d
```

The entry timeframe is required. Up to three unique higher timeframes may be declared, and each
must be larger than the entry timeframe. Every timeframe used by a condition must appear in this
declaration.

Directions are `long`, `short`, and `both`. A single-direction strategy uses
`entry_conditions`. A `both` strategy must instead provide distinct
`long_entry_conditions` and `short_entry_conditions`; a shared tree is rejected.

## Condition trees

Trees use exactly one of `all`, `any`, or `not` at each branch. Empty branches, depth above eight,
or more than 256 leaves are rejected. The strict schema currently accepts only:

| Condition | Main inputs | Availability rule |
|---|---|---|
| `price_comparison` | OHLC field, constant or current/previous OHLC reference, operator | Closed bars only |
| `ema_relation` | timeframe, fast/slow periods, relation/cross | Warm-up through slow period |
| `sma_relation` | timeframe, fast/slow periods, relation/cross | Warm-up through slow period |
| `rsi_threshold` | timeframe, period, threshold, relation/cross | No early value |
| `atr_threshold` | timeframe, period, threshold and unit | No early value |
| `range_breakout` | timeframe, lookback, direction, confirmation | Prior range only |
| `market_session` | Asia, London, New York, or London/New York overlap | Decision timestamp |
| `day_of_week` | Monday through Friday | Decision timestamp |
| `time_window` | IANA timezone and `HH:MM` bounds | DST-aware local conversion |

EMA/SMA fast periods must be smaller than slow periods. Periods are positive and bounded. RSI is
bounded to 0-100. Time windows require an explicit IANA zone and an explicit overnight flag when
the end precedes the start.

Advanced concepts such as liquidity sweeps, order blocks, FVG, BOS, CHoCH, supply/demand zones,
market regime, MACD, Bollinger position, and candle-pattern conditions are not accepted by the
current strict schema. Some backtest internals contain evaluator branches for additional concepts,
but they are not public supported conditions until represented and tested by the strict schema.

`price_comparison.equal` is implemented with a deterministic tight numeric tolerance. The same
condition evaluator handles above/below/cross operations, so schema and engine parsing remain
aligned.

## Entry and execution

Order types are `market`, `limit`, and `stop`. Typed fields include price reference, offset,
validity bars, opposite-signal cancellation, re-entry, and cooldown.

Safe references are `next_bar_open`, `signal_bar_close`, `previous_high`, `previous_low`,
`indicator_value`, and `fixed_offset_from_signal_close`. Market orders are deliberately limited to
`next_bar_open` with no offset. Limit and stop orders activate no earlier than the next bar.

`indicator_value` reuses the engine's point-in-time SMA/EMA/ATR series and warm-up rules. It never
loads a second indicator implementation or a not-yet-closed higher-timeframe value.
See [BACKTEST_EXECUTION_POLICY.md](BACKTEST_EXECUTION_POLICY.md) for fill and ambiguity policies.

## Stops, targets, sizing, management, and risk

A stop loss is mandatory. Typed stop forms are fixed pips, ATR multiple, recent swing, percentage,
and structure level. Values and lookbacks are bounded.

Targets may use fixed pips, risk/reward, ATR multiple, percentage, or structure level. One to ten
targets are permitted and their `size_percent` values must total exactly 100 percent. There is no
implicit remainder.

Sizing is one of:

- `fixed_lot`;
- `fixed_notional` in USD;
- `risk_percent` against a USD account.

Risk-percent sizing is accepted only where registered metadata provides direct USD quote-currency
support. Cross-currency conversion is never guessed.

Management supports move-to-break-even, tightening-only trailing stop, finite maximum holding
bars, close on opposite signal, and session-close exit. Risk controls bound open positions,
positions per symbol, daily loss, consecutive losses, cooldown, daily trade count, and minimum
reward/risk. These are simulation controls and do not replace the live AiChart Risk Guard.

## Costs and carry

Every specification explicitly supplies all four cost policies:

- spread: none, fixed pips, bar column, or session schedule;
- slippage: none, fixed pips/ticks, percentage, or seeded distribution;
- commission: none, per lot per side, per trade, or percentage notional;
- swap/carry: none, fixed daily, or bar column.

Seeded slippage requires a persisted seed and bounded distribution parameters. A request for
accurate carry cannot silently select `none` or fixed daily approximation. The current engine
rejects bar-column carry because the canonical bar model has no carry field; fixed daily or none
are the executable choices today.

## Canonicalization, hashing, compilation, and versioning

After validation, the service serializes JSON with aliases, omitted nulls, sorted object keys, no
NaN/Infinity, and stable compact separators. SHA-256 of those UTF-8 bytes is the strategy hash.
Object key ordering does not change the hash; set-like symbol, higher-timeframe, session, and day
fields are normalized.

The strategy compiler emits metadata only: canonical specification/hash, declared symbols and
metadata, condition types, indicator requirements, warm-up bars, bar-close signal timing, and
next-bar activation. It does not generate source code.

`StrategyDefinition`, immutable `StrategyVersion`, `StrategyValidationResult`, and
`BacktestRunReference` are modeled. Version statuses are `draft`, `valid`, `invalid`, and
`deprecated`. `InMemoryStrategyStore` enforces sequential parent-linked immutable versions but is
process-local and volatile; it is not production durability.

## Deferred

- executable or expression-based strategies;
- optimization and parameter search;
- unregistered instruments and silent currency conversion;
- advanced smart-money detectors;
- durable strategy persistence and public strategy APIs;
- any path from a research classification to live order execution.
