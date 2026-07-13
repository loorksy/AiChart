# Backtest Execution Policy

## Timeline and no-look-ahead

For entry timeframe bar N:

1. Process already-active orders and positions using bar N.
2. Set decision time to bar N close (`open_time + timeframe duration`).
3. Expose only bars whose close time is at or before that decision time, including higher
   timeframes through point-in-time lookup.
4. Evaluate the typed condition tree.
5. Create an order with `signal_time` at N close and activation index N+1.
6. A market order fills at N+1 open. Limit/stop orders may trigger from N+1 onward.

No market entry fills on the signal bar. Signal time, activation, fill time, reference price, and
executable fill are recorded in order/event state. Existing UI/live-analysis detectors are not
imported into this path.

## Orders and gaps

Supported order types are market, limit, and stop. Orders have finite validity bars, cancellation
on an opposite signal when configured, and statuses for pending, filled, partially filled,
cancelled, expired, and rejected.

The initial engine assumes full order fills. The `partially_filled` status is modeled but market
depth, volume participation, and partial entry fills are not implemented.

- Market: next available bar open.
- Limit: touch is determined from OHLC; a favorable gap still fills at the requested limit. This
  is a documented conservative no-price-improvement policy.
- Stop: a normal touch fills at the trigger. An unfavorable gap through the stop fills at the next
  available open, not the ideal trigger.
- Protective stop: an unfavorable gap through the stop likewise exits at the bar open.

## Bid/ask and spread

If complete bid/ask OHLC is present, an open-price fill uses ask for buys and bid for sells. If
only mid/reference OHLC exists, the engine applies half of one explicit spread on each executable
side. This prevents charging a full spread at both entry and exit.

Spread models are fixed pips, bar column, and DST-aware session schedule. `none` is valid only when
the research configuration intentionally models zero spread. Bar-column spread requires full
coverage. A session schedule must have an active-session value; it does not silently fall back.

Current limitation: bid/ask selection is implemented for open-price fills. Non-open limit, stop,
target, and protective-stop references use the reference price plus the configured spread model;
full bid/ask high/low intrabar triggering is not reconstructed.

## Slippage, commission, and carry

Slippage supports none, fixed pips, fixed ticks, percentage, and a seeded local distribution.
Seeded simulations use a run-local `random.Random(seed)`, persist the run seed, cap absolute
slippage, and do not use global nondeterministic randomness.

Commission supports none, per lot per side, per trade, and percentage notional. Per-trade
commission is charged once at entry; partial exits do not duplicate it. Entry costs are allocated
proportionally across partial exits so they are not double charged.

Carry supports none and fixed daily in the current engine. Fixed daily applies once for each
elapsed UTC calendar day to remaining size. A requested bar-column carry model is rejected because
the canonical dataset currently has no carry field. Fixed daily is a configured approximation,
not a claim of broker-accurate rollover, triple-swap, or holiday behavior.

Each completed trade records gross PnL, spread, slippage, commission, carry, and net PnL.

## Same-candle ambiguity

When an open position's stop and one or more targets are touched by the same OHLC bar, the event is
flagged and one configured policy applies:

| Policy | Resolution |
|---|---|
| `worst_case` | Stop only |
| `best_case` | Touched targets |
| `stop_first` | Stop only |
| `target_first` | Touched targets, then stop any remaining size |
| `ohlc_path` | Bullish: O-L-H-C; bearish: O-H-L-C; configured conservative doji path |
| `reject_ambiguous` | Record rejection event and leave the position unresolved for that bar |

`ohlc_path` is a deterministic assumption, not reconstructed tick order. Ambiguity count and rate
are included in metrics and descriptive artifacts.

For a newly triggered pending entry, the engine evaluates both canonical activation-bar paths
(`O-L-H-C` and `O-H-L-C`) beginning at the actual entry trigger. Pre-entry extremes are not reused
as post-entry fills. If the two outcomes differ, the execution is ambiguous and the configured
policy chooses the outcome; `ohlc_path` uses candle direction and the configured doji rule. Every
such execution records `intrabar_ambiguous=true`, the selected policy, and a public-safe event.

## Position management

Multiple targets close bounded fractions; total target allocation originates from the strict
100-percent specification. Remaining size can be stopped. Closed size is capped by remaining size.

Break-even and trailing candidates are scheduled as pending stops and activate on the next bar,
so a stop cannot be moved retroactively inside the bar that triggered the update. Trailing updates
are tightening-only. Maximum holding and opposite-signal/session exits are scheduled, then execute
on a later bar open.

The engine tracks balance, equity, realized/unrealized PnL, margin, free margin, peak equity, and
drawdown. It rejects every symbol whose quote currency differs from account currency because no
conversion series is supplied. Entry is rejected when required margin exceeds free margin. If a
subsequent mark would require a margin call or liquidation, the run fails closed because this
engine does not invent broker liquidation behavior.

## Forex sessions and calendar limits

Session labels convert UTC into `Asia/Tokyo`, `Europe/London`, and `America/New_York` with IANA
timezone rules, so London/New York DST shifts are date-aware. Session hours are local 08:00-17:00.

`forex_weekend_only` is the only accepted calendar policy. It enforces the DST-aware New York
Friday 17:00 close and Sunday 17:00 open and rejects bars opened inside the closed weekend.
Holiday/early-close and broker-rollover calendars are intentionally unsupported; callers cannot
select them silently. Those closures must appear as absent bars in an otherwise validated dataset.
`session_close_exit` means transition to the engine's `off_session` label; it is not a universal
market-close model.
