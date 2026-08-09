"""`compute_factor`'s contract: the guards, the error codes, and the rule that
a factor with no defined value returns NaN rather than raising."""

from __future__ import annotations

import math

import pytest

from app.engine.factors.frame import NAN, FactorError, Frame
from app.engine.factors.models import build_frame
from app.engine.factors.registry import all_factors, compute_factor, compute_panel_factor
from app.storage.models import Bar


def bars(count: int, *, start: float = 100.0, step: float = 1.5) -> list[Bar]:
    out: list[Bar] = []
    price = start
    for index in range(count):
        open_price = price
        price = round(price + (step if index % 3 else -step), 4)
        out.append(
            Bar(
                time=f"2026-03-01T{index // 60:02d}:{index % 60:02d}:00+00:00",
                open=open_price,
                high=max(open_price, price) + 0.75,
                low=min(open_price, price) - 0.75,
                close=price,
                volume=1000.0 + index,
            )
        )
    return out


def frame(count: int) -> Frame:
    return build_frame(bars(count), [])


FUNDAMENTAL_ROWS = [
    {"market_cap": 1.0e9, "net_income": 5.0e7, "revenue": 2.0e8},
    {"market_cap": 1.2e9, "net_income": 6.0e7, "revenue": 2.5e8},
]

# Every column the seven fundamental factors declare, for the sweep below.
FULL_FUNDAMENTAL_ROWS = [
    {
        "market_cap": 1.0e9 + index * 1.0e8,
        "net_income": 5.0e7 + index * 1.0e6,
        "book_value": 3.0e8 - index * 2.0e6,
        "shareholder_equity": 5.5e8 + index * 3.0e6,
        "revenue": 2.0e8 + index * 5.0e6,
        "total_debt": 1.8e8 - index * 1.0e6,
        "free_cash_flow": 3.0e7 + index * 7.0e5,
    }
    for index in range(4)
]


def test_empty_frame_is_no_data() -> None:
    empty = Frame(columns={}, row_count=0)
    with pytest.raises(FactorError) as excinfo:
        compute_factor("sma", empty)
    assert excinfo.value.code == "factor.noData"


def test_missing_column_is_missing_fields() -> None:
    closes_only = Frame(columns={"close": (1.0, 2.0, 3.0)}, row_count=3)
    with pytest.raises(FactorError) as excinfo:
        compute_factor("atr", closes_only)
    assert excinfo.value.code == "factor.missingFields"

    with pytest.raises(FactorError) as excinfo:
        compute_factor("market_cap", closes_only)
    assert excinfo.value.code == "factor.missingFields"


def test_short_history_is_insufficient_history() -> None:
    with pytest.raises(FactorError) as excinfo:
        compute_factor("sma", frame(5), {"period": 20})
    assert excinfo.value.code == "factor.insufficientHistory"


@pytest.mark.parametrize(
    ("factor_id", "params"),
    [
        ("sma", {"period": 1}),
        ("sma", {"period": 5001}),
        ("sma", {"period": "twenty"}),
        # `int()` truncates before the range check, so 1.5 lands under the
        # minimum of 2 — while 2.5 truncates to a legal 2 and is accepted.
        ("sma", {"period": 1.5}),
        ("macd", {"fast_period": 26, "slow_period": 26}),
        ("ppo", {"fast_period": 30, "slow_period": 20}),
        ("kama", {"fast_period": 30, "slow_period": 30}),
        ("chaikin_oscillator", {"fast_period": 10, "slow_period": 10}),
        ("awesome_oscillator", {"fast_period": 40, "slow_period": 34}),
        ("ultimate_oscillator", {"fast_period": 7, "medium_period": 28, "slow_period": 28}),
        ("bollinger_bands", {"stddev": -1.0}),
        ("bollinger_bands", {"stddev": "wide"}),
        ("supertrend", {"multiplier": 0}),
        ("adx", {"output": "trend"}),
        ("macd", {"output": "hist"}),
        ("kdj", {"output": "x"}),
    ],
)
def test_invalid_parameters(factor_id: str, params: dict[str, object]) -> None:
    with pytest.raises(FactorError) as excinfo:
        compute_factor(factor_id, frame(120), params)
    assert excinfo.value.code == "factor.invalidParameter"


def test_falsy_period_falls_back_to_the_minimum() -> None:
    """Upstream spells the guard `int(params.get(key) or minimum)`, so 0, None
    and "" all mean "use the minimum" rather than "period zero"."""
    closes = frame(30)
    baseline = compute_factor("sma", closes, {"period": 2})
    for falsy in (0, None, "", False):
        assert compute_factor("sma", closes, {"period": falsy}) == baseline


def test_params_are_shallow_merged_over_the_declared_defaults() -> None:
    closes = frame(200)
    explicit = compute_factor(
        "macd", closes, {"fast_period": 12, "slow_period": 26, "signal_period": 9}
    )
    assert compute_factor("macd", closes) == explicit
    # Overriding one key leaves the rest at their declared defaults.
    assert compute_factor("macd", closes, {"output": "histogram"}) == explicit


def test_non_finite_result_becomes_nan_not_an_error() -> None:
    closes = [10.0, 10.5, 10.2, 10.9, 11.4]
    untraded = Frame(
        columns={
            "close": tuple(closes),
            "volume": (100.0, 120.0, 0.0, 90.0, 130.0),
        },
        row_count=5,
    )
    value = compute_factor("amihud_illiquidity", untraded, {"period": 4})
    assert math.isnan(value)


def test_unknown_factor_is_not_found() -> None:
    with pytest.raises(FactorError) as excinfo:
        compute_factor("no_such_factor", frame(30))
    assert excinfo.value.code == "factor.notFound"


def test_fundamental_factors_read_pushed_in_columns() -> None:
    rows = build_frame([], FUNDAMENTAL_ROWS)
    assert compute_factor("market_cap", rows) == pytest.approx(1.2e9)
    assert compute_factor("earnings_yield", rows) == pytest.approx(6.0e7 / 1.2e9)
    assert compute_factor("revenue_growth", rows) == pytest.approx(2.5e8 / 2.0e8 - 1.0)


def test_fundamental_growth_needs_two_periods() -> None:
    single = build_frame([], FUNDAMENTAL_ROWS[:1])
    with pytest.raises(FactorError) as excinfo:
        compute_factor("revenue_growth", single)
    assert excinfo.value.code == "factor.insufficientHistory"


def test_fundamental_ratio_with_zero_denominator_is_nan() -> None:
    rows = build_frame([], [{"net_income": 1.0e7, "market_cap": 0.0}])
    assert math.isnan(compute_factor("earnings_yield", rows))


def test_null_fundamental_is_absent_not_zero() -> None:
    """A field the vendor did not report arrives as null and must be dropped,
    so the factor reads the last value that actually exists."""
    rows = build_frame([], [{"market_cap": 5.0e8}, {"market_cap": None}])
    assert compute_factor("market_cap", rows) == pytest.approx(5.0e8)

    missing_everywhere = build_frame([], [{"market_cap": None}])
    with pytest.raises(FactorError) as excinfo:
        compute_factor("market_cap", missing_everywhere)
    assert excinfo.value.code == "factor.insufficientHistory"


def test_panel_drops_unusable_symbols_but_propagates_bad_parameters() -> None:
    panel = {
        "AAA": frame(60),
        "BBB": frame(3),  # too short
        "CCC": Frame(columns={"close": (1.0, 2.0)}, row_count=2),  # short too
        "DDD": Frame(columns={}, row_count=0),  # no data
        "EEE": Frame(columns={"volume": (1.0,) * 40}, row_count=40),  # missing close
    }
    values = compute_panel_factor("sma", panel, {"period": 20})
    assert set(values) == {"AAA"}

    with pytest.raises(FactorError) as excinfo:
        compute_panel_factor("sma", panel, {"period": 0.5})
    assert excinfo.value.code == "factor.invalidParameter"


def test_panel_drops_nan_results() -> None:
    poisoned = Frame(
        columns={
            "close": (10.0, 10.5, 10.2, 10.9, 11.4),
            "volume": (100.0, 120.0, 0.0, 90.0, 130.0),
        },
        row_count=5,
    )
    healthy = Frame(
        columns={
            "close": (10.0, 10.5, 10.2, 10.9, 11.4),
            "volume": (100.0, 120.0, 80.0, 90.0, 130.0),
        },
        row_count=5,
    )
    values = compute_panel_factor(
        "amihud_illiquidity", {"BAD": poisoned, "GOOD": healthy}, {"period": 4}
    )
    assert set(values) == {"GOOD"}


def test_build_frame_keeps_a_missing_volume_absent() -> None:
    candles = bars(3)
    candles[1] = candles[1].model_copy(update={"volume": None})
    built = build_frame(candles, [])
    assert built.row_count == 3
    assert math.isnan(built.raw("volume")[1])
    assert built.raw("volume")[0] == 1000.0


def test_build_frame_pads_absent_fundamental_fields() -> None:
    built = build_frame([], [{"revenue": 1.0}, {"market_cap": 2.0}])
    assert built.row_count == 2
    assert math.isnan(built.raw("revenue")[1])
    assert math.isnan(built.raw("market_cap")[0])


def test_every_available_factor_computes_over_a_generous_frame() -> None:
    """No declaration may point at a kernel that cannot run at all."""
    candles = frame(400)
    fundamentals = build_frame([], FULL_FUNDAMENTAL_ROWS)
    for definition in all_factors():
        target = fundamentals if definition.factor_type == "fundamental" else candles
        value = compute_factor(definition.factor_id, target)
        assert isinstance(value, float)
        assert math.isfinite(value), definition.factor_id


def test_nan_column_does_not_crash_the_kernels() -> None:
    columns = {
        "open": (1.0, 2.0, 3.0, 4.0, 5.0),
        "high": (1.5, 2.5, 3.5, 4.5, 5.5),
        "low": (0.5, 1.5, 2.5, 3.5, 4.5),
        "close": (1.0, 2.0, 3.0, 4.0, 5.0),
        "volume": (NAN, NAN, NAN, NAN, NAN),
    }
    unreported = Frame(columns=columns, row_count=5)
    # Volume-free feeds are normal in forex: the factors that need volume must
    # say so, not return a fabricated number.
    with pytest.raises(FactorError) as excinfo:
        compute_factor("volume_ratio", unreported, {"period": 3})
    assert excinfo.value.code == "factor.insufficientHistory"
    assert compute_factor("obv", unreported, {"period": 3}) == 0.0
