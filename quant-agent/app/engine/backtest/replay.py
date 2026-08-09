"""Backtest replay: re-runs a `Strategy` across historical bars.

Every strategy except `GeneratedCodeStrategy` is replayed exactly like the
live per-bar path (`app/api/recommendations.py`): `.evaluate(features)`
called once in-process per step. `GeneratedCodeStrategy` is special-cased
into ONE batched sandbox call (`run_evaluate_batch_in_sandbox`) instead of
one `.evaluate()` call per step -- calling `.evaluate()` per step would
still pay the live path's one-subprocess-per-call cost thousands of times
over, defeating the entire point of the batch sandbox mechanism (see
`app/sandbox/safe_exec.py`'s `safe_exec_isolated_batch` docstring).

Performance note (plan section 1): `compute_features()` is never called per
step here. Instead, the pure indicator helper functions it calls internally
(`ema`/`rsi`/`macd`/`bollinger`/`atr`/`adx`, all already exported by
`app.engine.features`) are called ONCE over the full bar array, and each
step's `Features` is built by list-slicing those full-length series. This
turns the dominant cost from O(n^2) indicator arithmetic into O(n)
arithmetic plus cheap list-slice copies (memcpy-level) -- O(n^2) total
copying for the in-process replay path (one `Features` alive at a time, so
peak memory stays O(n)), but bounded to a small trailing window for the
`GeneratedCodeStrategy` batch path specifically (see `_BATCH_FEATURES_WINDOW`
below) since that path must hold many steps' views in memory at once inside
a memory-capped sandbox subprocess. Together this keeps a several-thousand-
bar backtest in the "tens of seconds" range instead of minutes.
`app/engine/features.py` itself is NOT modified.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.engine.features import Features, adx, atr, bollinger, ema, macd, rsi
from app.engine.strategies.base import Signal, Strategy
from app.engine.strategies.generated_code.contract import (
    BACKTEST_BATCH_TIMEOUT_SECONDS,
    BACKTEST_PER_BAR_TIMEOUT_SECONDS,
    _features_view,
    run_evaluate_batch_in_sandbox,
)
from app.engine.strategies.generated_code.interpreter import (
    GeneratedCodeStrategy,
    _build_signal_from_output,
)
from app.storage.models import Bar


@dataclass
class _PrecomputedSeries:
    """Full-length indicator series computed once for the whole bar array --
    the thing every backtest step slices instead of recomputing."""

    times: list[str]
    opens: list[float]
    highs: list[float]
    lows: list[float]
    closes: list[float]
    volumes: list[float | None]
    ema20: list[float | None]
    ema50: list[float | None]
    ema200: list[float | None]
    rsi14: list[float | None]
    macd_line: list[float | None]
    macd_signal: list[float | None]
    macd_hist: list[float | None]
    atr14: list[float | None]
    bb_lower: list[float | None]
    bb_middle: list[float | None]
    bb_upper: list[float | None]
    adx14: list[float | None]


def _precompute_series(bars: list[Bar]) -> _PrecomputedSeries:
    """Mirrors `app.engine.features.compute_features`'s own body exactly
    (same helper calls, same arguments) -- the only difference is this
    result gets sliced per-step by `_features_at` instead of being handed to
    strategies directly."""
    opens = [bar.open for bar in bars]
    highs = [bar.high for bar in bars]
    lows = [bar.low for bar in bars]
    closes = [bar.close for bar in bars]
    volumes: list[float | None] = [bar.volume for bar in bars]
    macd_line, macd_signal, macd_hist = macd(closes)
    bb_lower, bb_middle, bb_upper = bollinger(closes)
    return _PrecomputedSeries(
        times=[bar.time for bar in bars],
        opens=opens,
        highs=highs,
        lows=lows,
        closes=closes,
        volumes=volumes,
        ema20=ema(closes, 20),
        ema50=ema(closes, 50),
        ema200=ema(closes, 200),
        rsi14=rsi(closes, 14),
        macd_line=macd_line,
        macd_signal=macd_signal,
        macd_hist=macd_hist,
        atr14=atr(highs, lows, closes, 14),
        bb_lower=bb_lower,
        bb_middle=bb_middle,
        bb_upper=bb_upper,
        adx14=adx(highs, lows, closes, 14),
    )


def _features_at(
    symbol: str, market: str, interval: str, series: _PrecomputedSeries, index: int
) -> Features:
    """Build one step's `Features` by list-slicing the precomputed
    full-length series up to and including `index` -- NOT by calling
    `compute_features()` again. `Features.__post_init__`'s `.regime`
    derivation only ever looks at the tail (`[-1]`, plus a short trailing
    window) of whatever series it is handed, so a slice ending at `index`
    produces the exact same `Features` (including `.regime`) that
    `compute_features(bars[:index+1])` would."""
    return _windowed_features_at(symbol, market, interval, series, index, window=None)


# How many trailing bars a GeneratedCodeStrategy's per-step batch view carries
# (see `_windowed_features_at`) -- comfortably above every indicator's own
# lookback need (EMA200's 200-bar seed is already baked into the precomputed
# *value*, not re-derived from this window; the regime classifier's own
# largest lookback is `ATR_VOLATILITY_LOOKBACK`=50) with margin to spare.
_BATCH_FEATURES_WINDOW = 100

# How many steps one `run_evaluate_batch_in_sandbox` call covers. Discovered
# empirically while implementing this module: `safe_exec_isolated_batch`
# (locked, not modified here) sends its whole `outputs` list back to the
# parent through a `multiprocessing.Pipe` via ONE `Connection.send()` call,
# but the parent only starts draining that pipe AFTER `proc.join()` returns
# -- i.e. after the child has already exited. A child whose pickled output
# exceeds the pipe's kernel buffer blocks forever inside `send()` (nothing is
# draining it yet), so the child never exits, `proc.join()` never returns,
# and the whole call silently eats its full `wall_clock_timeout` before the
# parent's hard kill -- a classic bounded-pipe producer/consumer deadlock,
# not a "the code is slow" problem. Chunking keeps each call's `outputs`
# payload small enough to never approach that limit (empirically safe well
# past 500 steps/chunk of real, dict-returning outputs; this value keeps
# comfortable margin below where the deadlock was observed).
_BATCH_CHUNK_SIZE = 500


def _windowed_features_at(
    symbol: str,
    market: str,
    interval: str,
    series: _PrecomputedSeries,
    index: int,
    window: int | None,
) -> Features:
    """Like `_features_at`, but the slice only carries the trailing `window`
    bars instead of the full history since the start of the replay (pass
    `window=None` for the full, unbounded slice `_features_at` uses).

    Every precomputed indicator VALUE at `index` is unaffected by this --
    those were already computed once over the FULL bar array by
    `_precompute_series`; windowing only trims how much of that array's
    *history* is exposed alongside it. `Features.__post_init__`'s regime
    classifier only ever looks at the trailing `ATR_VOLATILITY_LOOKBACK`/
    `LOW_LIQUIDITY_LOOKBACK` bars, both well under `_BATCH_FEATURES_WINDOW`,
    so `.regime` is identical either way. Only sandboxed-code strategies
    that deliberately look back further than that window would ever observe
    a difference -- and doing so is already unlike every strategy in this
    codebase (which never look back more than 1-2 bars). This bound exists
    only to keep the batch sandbox call's payload small (see
    `_BATCH_FEATURES_WINDOW`/`_BATCH_CHUNK_SIZE`); it is not used for the
    in-process replay of the three other strategy types."""
    upto = index + 1
    start = 0 if window is None else max(0, upto - window)
    return Features(
        symbol=symbol,
        market=market,
        interval=interval,
        times=series.times[start:upto],
        opens=series.opens[start:upto],
        highs=series.highs[start:upto],
        lows=series.lows[start:upto],
        closes=series.closes[start:upto],
        volumes=series.volumes[start:upto],
        ema20=series.ema20[start:upto],
        ema50=series.ema50[start:upto],
        ema200=series.ema200[start:upto],
        rsi14=series.rsi14[start:upto],
        macd_line=series.macd_line[start:upto],
        macd_signal=series.macd_signal[start:upto],
        macd_hist=series.macd_hist[start:upto],
        atr14=series.atr14[start:upto],
        bb_lower=series.bb_lower[start:upto],
        bb_middle=series.bb_middle[start:upto],
        bb_upper=series.bb_upper[start:upto],
        adx14=series.adx14[start:upto],
    )


def replay_strategy(
    strategy: Strategy,
    symbol: str,
    market: str,
    interval: str,
    bars: list[Bar],
    min_bars: int,
    *,
    batch_wall_clock_timeout_seconds: int = BACKTEST_BATCH_TIMEOUT_SECONDS,
    batch_per_bar_timeout_seconds: int = BACKTEST_PER_BAR_TIMEOUT_SECONDS,
) -> list[tuple[int, Signal]]:
    """Replay `strategy` across `bars`, from step `min_bars - 1` to
    `len(bars) - 1` inclusive, returning every `(bar_index, Signal)` pair it
    fired on. Returns `[]` (never raises) if there are fewer than `min_bars`
    bars to replay."""
    if min_bars < 1 or len(bars) < min_bars:
        return []

    series = _precompute_series(bars)
    steps = list(range(min_bars - 1, len(bars)))

    if isinstance(strategy, GeneratedCodeStrategy):
        return _replay_generated_code_strategy(
            strategy,
            symbol,
            market,
            interval,
            series,
            steps,
            batch_wall_clock_timeout_seconds=batch_wall_clock_timeout_seconds,
            batch_per_bar_timeout_seconds=batch_per_bar_timeout_seconds,
        )

    fired: list[tuple[int, Signal]] = []
    for index in steps:
        features = _features_at(symbol, market, interval, series, index)
        signal = strategy.evaluate(features)
        if signal is not None:
            fired.append((index, signal))
    return fired


def _replay_generated_code_strategy(
    strategy: GeneratedCodeStrategy,
    symbol: str,
    market: str,
    interval: str,
    series: _PrecomputedSeries,
    steps: list[int],
    *,
    batch_wall_clock_timeout_seconds: int,
    batch_per_bar_timeout_seconds: int,
) -> list[tuple[int, Signal]]:
    """Replay in fixed-size chunks (`_BATCH_CHUNK_SIZE` steps each, windowed
    to `_BATCH_FEATURES_WINDOW` trailing bars per view -- see both constants'
    docstrings for why), making ONE `run_evaluate_batch_in_sandbox` call per
    chunk instead of a single call for the entire replay. This is still one
    subprocess spawn per CHUNK, not per bar -- for a 5000-bar replay that is
    ~10 subprocesses, not 5000 -- while keeping every call's payload well
    within the sizes this module's tests have verified are safe.

    A chunk that fails outright (subprocess crash/timeout) is treated as "no
    signal on any of its steps" and replay continues with the next chunk,
    fail-closed per chunk rather than discarding the entire backtest over
    one bad chunk."""
    fired: list[tuple[int, Signal]] = []
    for chunk_start in range(0, len(steps), _BATCH_CHUNK_SIZE):
        chunk_steps = steps[chunk_start : chunk_start + _BATCH_CHUNK_SIZE]
        features_by_step = [
            _windowed_features_at(symbol, market, interval, series, index, _BATCH_FEATURES_WINDOW)
            for index in chunk_steps
        ]
        views = [_features_view(features) for features in features_by_step]

        success, outputs, _error = run_evaluate_batch_in_sandbox(
            strategy.source_code,
            views,
            wall_clock_timeout_seconds=batch_wall_clock_timeout_seconds,
            per_bar_timeout_seconds=batch_per_bar_timeout_seconds,
        )
        if not success or outputs is None:
            continue

        # `outputs` may be a strict PREFIX of `chunk_steps`/`features_by_step`
        # if this chunk's own call was truncated by its wall-clock budget --
        # zip() stopping at the shortest sequence is exactly "handle a short
        # list" per `run_evaluate_batch_in_sandbox`'s own contract.
        for index, features, output in zip(chunk_steps, features_by_step, outputs, strict=False):
            if output is None:
                continue
            step = features.last
            atr_value = features.atr14[step] if 0 <= step < len(features.atr14) else None
            close = features.closes[step] if 0 <= step < len(features.closes) else None
            if atr_value is None or close is None:
                continue
            signal = _build_signal_from_output(
                strategy_id=strategy.strategy_id,
                version=strategy.version,
                regime_affinity=strategy.regime_affinity,
                regime=features.regime,
                output=output,
                atr_value=atr_value,
                close=close,
            )
            if signal is not None:
                fired.append((index, signal))
    return fired
