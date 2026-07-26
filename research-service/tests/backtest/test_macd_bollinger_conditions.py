"""MACD and Bollinger as DSL condition leaves (RELIABILITY_PLAN item 17, A).

The engine always computed both indicators; only the strategy language could
not express them, so no catalog strategy could use them. These tests lock the
new leaves: the closed DSL still rejects anything undeclared, and the
evaluation matches the indicator maths (no free expressions, ever).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.backtest.indicators import bollinger, macd
from app.strategies.models import Timeframe
from app.strategies.schema import BollingerCondition, MacdCondition


def _series(n: int = 80) -> list[float]:
    # A rising series with a pullback so crosses actually occur.
    out: list[float] = []
    for i in range(n):
        base = 100 + i * 0.5
        out.append(base - 6 if 40 <= i < 55 else base)
    return out


class TestMacdLeaf:
    def test_accepts_a_declared_signal_cross(self) -> None:
        leaf = MacdCondition.model_validate(
            {
                "type": "macd",
                "timeframe": Timeframe.M15,
                "operator": "crosses_above",
                "reference": "signal",
            }
        )
        assert leaf.fast_period == 12
        assert leaf.slow_period == 26
        assert leaf.series == "macd"

    def test_rejects_slow_period_not_greater_than_fast(self) -> None:
        with pytest.raises(ValidationError):
            MacdCondition.model_validate(
                {
                    "type": "macd",
                    "timeframe": Timeframe.M15,
                    "operator": "above",
                    "fast_period": 26,
                    "slow_period": 12,
                }
            )

    def test_value_reference_requires_a_value(self) -> None:
        with pytest.raises(ValidationError):
            MacdCondition.model_validate(
                {"type": "macd", "timeframe": Timeframe.M15, "operator": "above", "reference": "value"}
            )

    def test_value_is_rejected_without_the_value_reference(self) -> None:
        with pytest.raises(ValidationError):
            MacdCondition.model_validate(
                {
                    "type": "macd",
                    "timeframe": Timeframe.M15,
                    "operator": "above",
                    "reference": "zero",
                    "value": 1.0,
                }
            )

    def test_rejects_comparing_the_signal_line_to_itself(self) -> None:
        with pytest.raises(ValidationError):
            MacdCondition.model_validate(
                {
                    "type": "macd",
                    "timeframe": Timeframe.M15,
                    "operator": "above",
                    "series": "signal",
                    "reference": "signal",
                }
            )

    def test_rejects_undeclared_fields_the_dsl_stays_closed(self) -> None:
        with pytest.raises(ValidationError):
            MacdCondition.model_validate(
                {
                    "type": "macd",
                    "timeframe": Timeframe.M15,
                    "operator": "above",
                    "expression": "macd > signal * 2",  # free expressions are forbidden
                }
            )

    def test_histogram_equals_line_minus_signal(self) -> None:
        values = _series()
        line, signal, histogram = macd(values, 12, 26, 9)
        for a, b, h in zip(line, signal, histogram, strict=False):
            if a is None or b is None:
                assert h is None
            else:
                assert h == pytest.approx(a - b)


class TestBollingerLeaf:
    def test_accepts_a_declared_band_touch(self) -> None:
        leaf = BollingerCondition.model_validate(
            {
                "type": "bollinger",
                "timeframe": Timeframe.M15,
                "band": "lower",
                "operator": "crosses_below",
            }
        )
        assert leaf.period == 20
        assert leaf.std_dev == 2.0
        assert leaf.source == "close"

    def test_rejects_a_non_positive_deviation(self) -> None:
        with pytest.raises(ValidationError):
            BollingerCondition.model_validate(
                {
                    "type": "bollinger",
                    "timeframe": Timeframe.M15,
                    "band": "upper",
                    "operator": "above",
                    "std_dev": 0,
                }
            )

    def test_rejects_an_unknown_band(self) -> None:
        with pytest.raises(ValidationError):
            BollingerCondition.model_validate(
                {
                    "type": "bollinger",
                    "timeframe": Timeframe.M15,
                    "band": "middle_upper",
                    "operator": "above",
                }
            )

    def test_bands_bracket_the_middle(self) -> None:
        values = _series()
        lower, middle, upper = bollinger(values, 20, 2.0)
        seen = 0
        for lo, mid, up in zip(lower, middle, upper, strict=False):
            if lo is None or mid is None or up is None:
                continue
            seen += 1
            assert lo <= mid <= up
        assert seen > 0, "the fixture must produce evaluable bands"
