"""The six numerical subtleties that a naive reimplementation gets wrong.

The golden table already pins every factor's value against upstream's output.
These tests are the second, independent check: each one derives the expected
number by hand (or from a deliberately-different reference implementation) so a
failure says WHICH quirk was lost, not merely that some digit moved.
"""

from __future__ import annotations

import math

import pytest

from app.engine.factors.compute import (
    _adx_components,
    _atr,
    _bollinger,
    _ema,
    _kdj,
    _sma,
    _true_range,
    _zscore_last,
)
from app.engine.factors.frame import NAN, Frame
from app.engine.factors.registry import compute_factor

# ---------------------------------------------------------------------------


def frame(
    *,
    open_: list[float] | None = None,
    high: list[float] | None = None,
    low: list[float] | None = None,
    close: list[float],
    volume: list[float] | None = None,
) -> Frame:
    columns: dict[str, tuple[float, ...]] = {"close": tuple(close)}
    columns["open"] = tuple(open_ if open_ is not None else close)
    columns["high"] = tuple(high if high is not None else close)
    columns["low"] = tuple(low if low is not None else close)
    columns["volume"] = tuple(volume if volume is not None else [1.0] * len(close))
    return Frame(columns=columns, row_count=len(close))


# --- 1. bar-0 true range ---------------------------------------------------


def test_true_range_includes_bar_zero_as_high_minus_low() -> None:
    """Upstream's row-wise max skips NaN, so bar 0 survives as `high - low`
    instead of being dropped the way TA-Lib drops it. Every ATR-derived factor
    inherits the resulting one-bar offset."""
    bars = frame(
        high=[11.0, 13.0, 12.5, 14.0],
        low=[9.0, 10.0, 11.0, 12.0],
        close=[10.0, 12.0, 11.5, 13.5],
    )
    ranges = _true_range(bars)
    assert len(ranges) == bars.row_count == 4
    assert ranges[0] == pytest.approx(2.0)  # 11 - 9, not dropped
    assert ranges[1] == pytest.approx(max(13.0 - 10.0, abs(13.0 - 10.0), abs(10.0 - 10.0)))
    assert ranges[2] == pytest.approx(max(12.5 - 11.0, abs(12.5 - 12.0), abs(11.0 - 12.0)))
    assert ranges[3] == pytest.approx(max(14.0 - 12.0, abs(14.0 - 11.5), abs(12.0 - 11.5)))


def test_atr_seed_includes_bar_zero() -> None:
    bars = frame(
        high=[11.0, 13.0, 12.5, 14.0],
        low=[9.0, 10.0, 11.0, 12.0],
        close=[10.0, 12.0, 11.5, 13.5],
    )
    ranges = _true_range(bars)
    seed = (ranges[0] + ranges[1] + ranges[2]) / 3.0
    expected = (seed * 2.0 + ranges[3]) / 3.0
    assert _atr(bars, {"period": 3}) == pytest.approx(expected, rel=1e-15)

    # Dropping bar 0 the way TA-Lib does would give a materially different ATR.
    talib_style_seed = (ranges[1] + ranges[2] + ranges[3]) / 3.0
    assert not math.isclose(expected, talib_style_seed, rel_tol=1e-9)


# --- 2. population vs sample standard deviation ----------------------------

_DDOF_CLOSES = [10.0, 11.0, 12.0, 13.0, 14.0]
_POPULATION_STD = math.sqrt(2.0)  # variance 10/5
_SAMPLE_STD = math.sqrt(2.5)  # variance 10/4


def test_bollinger_uses_population_deviation() -> None:
    bars = frame(close=_DDOF_CLOSES)
    upper = _bollinger(bars, {"period": 5, "stddev": 2.0, "output": "upper"})
    lower = _bollinger(bars, {"period": 5, "stddev": 2.0, "output": "lower"})
    assert upper == pytest.approx(12.0 + 2.0 * _POPULATION_STD, rel=1e-15)
    assert lower == pytest.approx(12.0 - 2.0 * _POPULATION_STD, rel=1e-15)
    # The sample deviation would widen the band; the two must not be confused.
    assert not math.isclose(upper, 12.0 + 2.0 * _SAMPLE_STD, rel_tol=1e-9)


def test_zscore_factors_use_sample_deviation() -> None:
    bars = frame(close=_DDOF_CLOSES, volume=_DDOF_CLOSES)
    expected = (14.0 - 12.0) / _SAMPLE_STD
    assert _zscore_last(bars.raw("close"), {"period": 5}) == pytest.approx(expected, rel=1e-15)
    assert compute_factor("mean_reversion_zscore", bars, {"period": 5}) == pytest.approx(
        expected, rel=1e-15
    )
    assert compute_factor("volume_zscore", bars, {"period": 5}) == pytest.approx(
        expected, rel=1e-15
    )
    assert not math.isclose(expected, (14.0 - 12.0) / _POPULATION_STD, rel_tol=1e-9)


def test_realized_volatility_uses_sample_deviation() -> None:
    closes = [100.0, 110.0, 99.0, 108.9, 119.79]
    bars = frame(close=closes)
    returns = [closes[i] / closes[i - 1] - 1.0 for i in range(1, len(closes))]
    average = sum(returns) / len(returns)
    sample = math.sqrt(sum((r - average) ** 2 for r in returns) / (len(returns) - 1))
    assert compute_factor("realized_volatility", bars, {"period": 4}) == pytest.approx(
        sample * math.sqrt(252.0), rel=1e-14
    )


# --- 3. the ADX smoothing loop shape ---------------------------------------


def _upstream_adx_loop(
    tr: list[float], plus_dm: list[float], minus_dm: list[float], period: int
) -> tuple[float, float, float]:
    """Upstream's loop, transcribed literally: it starts at `period - 1` but
    only advances the Wilder sums from `period`, so the first DX comes off the
    raw window sums, and +DI/-DI leak out of the final iteration."""
    smooth_tr = sum(tr[:period])
    smooth_plus = sum(plus_dm[:period])
    smooth_minus = sum(minus_dm[:period])
    plus_di = minus_di = 0.0
    dx_values = []
    for index in range(period - 1, len(tr)):
        if index >= period:
            smooth_tr = smooth_tr - smooth_tr / period + tr[index]
            smooth_plus = smooth_plus - smooth_plus / period + plus_dm[index]
            smooth_minus = smooth_minus - smooth_minus / period + minus_dm[index]
        plus_di = 100.0 * smooth_plus / smooth_tr if smooth_tr else 0.0
        minus_di = 100.0 * smooth_minus / smooth_tr if smooth_tr else 0.0
        total = plus_di + minus_di
        dx_values.append(100.0 * abs(plus_di - minus_di) / total if total else 0.0)
    adx_value = dx_values[0]
    for value in dx_values[1:]:
        adx_value = (adx_value * (period - 1) + value) / period
    return adx_value, plus_di, minus_di


def _corrected_adx_loop(
    tr: list[float], plus_dm: list[float], minus_dm: list[float], period: int
) -> float:
    """The textbook version: smoothing advances on every step from `period`."""
    smooth_tr = sum(tr[:period])
    smooth_plus = sum(plus_dm[:period])
    smooth_minus = sum(minus_dm[:period])
    dx_values = []
    for index in range(period, len(tr)):
        smooth_tr = smooth_tr - smooth_tr / period + tr[index]
        smooth_plus = smooth_plus - smooth_plus / period + plus_dm[index]
        smooth_minus = smooth_minus - smooth_minus / period + minus_dm[index]
        plus_di = 100.0 * smooth_plus / smooth_tr if smooth_tr else 0.0
        minus_di = 100.0 * smooth_minus / smooth_tr if smooth_tr else 0.0
        total = plus_di + minus_di
        dx_values.append(100.0 * abs(plus_di - minus_di) / total if total else 0.0)
    adx_value = dx_values[0]
    for value in dx_values[1:]:
        adx_value = (adx_value * (period - 1) + value) / period
    return adx_value


# A zig-zag, so +DM and -DM are both active and DX actually varies; on a
# one-directional series the two loop shapes converge and prove nothing.
_ADX_HIGHS = [11.0, 13.0, 12.0, 14.5, 12.5, 15.0, 13.0, 16.0, 13.5]
_ADX_LOWS = [9.0, 10.5, 9.5, 12.0, 10.0, 12.5, 10.5, 13.5, 11.0]
_ADX_CLOSES = [10.0, 12.5, 10.0, 14.0, 10.5, 14.5, 11.0, 15.5, 11.5]
_ADX_PERIOD = 3


def _directional_movement() -> tuple[list[float], list[float], list[float]]:
    tr: list[float] = []
    plus_dm: list[float] = []
    minus_dm: list[float] = []
    for index in range(1, len(_ADX_CLOSES)):
        tr.append(
            max(
                _ADX_HIGHS[index] - _ADX_LOWS[index],
                abs(_ADX_HIGHS[index] - _ADX_CLOSES[index - 1]),
                abs(_ADX_LOWS[index] - _ADX_CLOSES[index - 1]),
            )
        )
        up = _ADX_HIGHS[index] - _ADX_HIGHS[index - 1]
        down = _ADX_LOWS[index - 1] - _ADX_LOWS[index]
        plus_dm.append(up if up > down and up > 0 else 0.0)
        minus_dm.append(down if down > up and down > 0 else 0.0)
    return tr, plus_dm, minus_dm


def test_adx_reproduces_the_upstream_loop_not_the_textbook_one() -> None:
    bars = frame(high=_ADX_HIGHS, low=_ADX_LOWS, close=_ADX_CLOSES)
    tr, plus_dm, minus_dm = _directional_movement()
    expected = _upstream_adx_loop(tr, plus_dm, minus_dm, _ADX_PERIOD)
    assert _adx_components(bars, _ADX_PERIOD) == pytest.approx(expected, rel=1e-15)
    assert not math.isclose(
        expected[0], _corrected_adx_loop(tr, plus_dm, minus_dm, _ADX_PERIOD), rel_tol=1e-9
    )


def test_adx_plus_and_minus_di_are_the_final_iteration_values() -> None:
    """`plus_di` / `minus_di` are the leaked loop locals, i.e. the DI pair from
    the LAST bar — not the DI of the seed window the loop started from."""
    bars = frame(high=_ADX_HIGHS, low=_ADX_LOWS, close=_ADX_CLOSES)
    tr, plus_dm, minus_dm = _directional_movement()
    _, plus_di, minus_di = _adx_components(bars, _ADX_PERIOD)
    _, reference_plus, reference_minus = _upstream_adx_loop(
        tr, plus_dm, minus_dm, _ADX_PERIOD
    )
    assert plus_di == pytest.approx(reference_plus, rel=1e-15)
    assert minus_di == pytest.approx(reference_minus, rel=1e-15)

    seed_plus = 100.0 * sum(plus_dm[:_ADX_PERIOD]) / sum(tr[:_ADX_PERIOD])
    assert not math.isclose(plus_di, seed_plus, rel_tol=1e-9)

    params = {"period": _ADX_PERIOD}
    assert compute_factor("adx", bars, {**params, "output": "plus_di"}) == pytest.approx(
        plus_di, rel=1e-15
    )
    assert compute_factor("adx", bars, {**params, "output": "minus_di"}) == pytest.approx(
        minus_di, rel=1e-15
    )


# --- 4. the KDJ 50.0 seed --------------------------------------------------


def test_kdj_seeds_k_and_d_at_fifty() -> None:
    """With `period == row_count` the recursion runs exactly once, so the seed
    is the whole answer: a Wilder-style seed (k = rsv) would give a very
    different J."""
    highs = [11.0, 13.0, 12.5, 14.0, 15.5]
    lows = [9.0, 10.0, 11.0, 12.0, 13.0]
    closes = [10.0, 12.0, 11.5, 13.5, 15.0]
    bars = frame(high=highs, low=lows, close=closes)

    rsv = (closes[-1] - min(lows)) / (max(highs) - min(lows)) * 100.0
    expected_k = (2 * 50.0 + rsv) / 3.0
    expected_d = (2 * 50.0 + expected_k) / 3.0
    params = {"period": 5, "k_period": 3, "d_period": 3}

    assert _kdj(bars, {**params, "output": "k"}) == pytest.approx(expected_k, rel=1e-15)
    assert _kdj(bars, {**params, "output": "d"}) == pytest.approx(expected_d, rel=1e-15)
    assert _kdj(bars, {**params, "output": "j"}) == pytest.approx(
        3.0 * expected_k - 2.0 * expected_d, rel=1e-15
    )
    # A rsv-seeded K would be `rsv` itself.
    assert not math.isclose(expected_k, rsv, rel_tol=1e-9)


def test_kdj_degenerate_range_falls_back_to_rsv_fifty() -> None:
    bars = frame(close=[7.0] * 12)
    for output in ("k", "d", "j"):
        assert _kdj(bars, {"period": 9, "output": output}) == pytest.approx(50.0)


# --- 5. NaN poisoning in the illiquidity measure ---------------------------


def test_amihud_is_nan_when_any_bar_has_no_traded_value() -> None:
    """One untraded bar makes the whole factor NaN. That IS the answer — the
    window contains a session with no price impact to measure — and reporting
    a mean over the remaining bars would invent a number."""
    closes = [10.0, 10.5, 10.2, 10.9, 11.4]
    bars = frame(close=closes, volume=[100.0, 120.0, 0.0, 90.0, 130.0])
    assert math.isnan(compute_factor("amihud_illiquidity", bars, {"period": 4}))

    traded = frame(close=closes, volume=[100.0, 120.0, 80.0, 90.0, 130.0])
    assert math.isfinite(compute_factor("amihud_illiquidity", traded, {"period": 4}))


def test_zero_volume_does_not_poison_the_skipna_factors() -> None:
    """The NaN must not leak: `cmf`, `obv` and `mfi` fill or skip on purpose."""
    closes = [10.0, 10.5, 10.2, 10.9, 11.4]
    bars = frame(
        high=[c + 0.5 for c in closes],
        low=[c - 0.5 for c in closes],
        close=closes,
        volume=[100.0, 120.0, 0.0, 90.0, 130.0],
    )
    assert math.isfinite(compute_factor("cmf", bars, {"period": 4}))
    assert math.isfinite(compute_factor("obv", bars, {"period": 4}))
    assert math.isfinite(compute_factor("mfi", bars, {"period": 4}))


def test_missing_volume_is_absent_not_zero() -> None:
    """A bar whose volume the feed did not report arrives as NaN, and the
    factors that drop NaN must drop it rather than average in a zero."""
    columns = {
        "close": (10.0, 10.5, 10.2, 10.9),
        "volume": (100.0, NAN, 120.0, 140.0),
    }
    bars = Frame(columns=columns, row_count=4)
    # `_volume_ratio` cleans first, so it averages the three reported bars.
    assert compute_factor("volume_ratio", bars, {"period": 3}) == pytest.approx(
        140.0 / ((100.0 + 120.0 + 140.0) / 3.0), rel=1e-15
    )


# --- 6. the SMA-seeded EMA -------------------------------------------------


def test_ema_seed_equals_the_simple_average_of_the_first_window() -> None:
    closes = [10.0, 12.0, 11.0, 13.0, 14.0]
    bars = frame(close=closes)
    assert _ema(bars, {"period": 5}) == pytest.approx(sum(closes) / 5.0, rel=1e-15)
    assert _ema(bars, {"period": 5}) == pytest.approx(_sma(bars, {"period": 5}), rel=1e-15)


def test_ema_advances_from_the_sma_seed_with_the_standard_multiplier() -> None:
    closes = [10.0, 12.0, 11.0, 13.0, 14.0]
    bars = frame(close=closes)
    seed = sum(closes[:4]) / 4.0
    multiplier = 2.0 / (4.0 + 1.0)
    expected = (closes[4] - seed) * multiplier + seed
    assert _ema(bars, {"period": 4}) == pytest.approx(expected, rel=1e-15)
    # A first-value seed (`ema[0] = close[0]`) would land somewhere else.
    assert not math.isclose(expected, closes[0], rel_tol=1e-9)


def test_every_ema_derived_factor_shares_the_seed() -> None:
    """`keltner_channels`' middle band is an EMA, so with exactly `period` bars
    it must equal the SMA of the same window."""
    closes = [10.0, 12.0, 11.0, 13.0, 14.0, 13.5]
    bars = frame(
        high=[c + 1.0 for c in closes], low=[c - 1.0 for c in closes], close=closes
    )
    middle = compute_factor(
        "keltner_channels", bars, {"period": 6, "atr_period": 3, "output": "middle"}
    )
    assert middle == pytest.approx(sum(closes) / 6.0, rel=1e-15)
