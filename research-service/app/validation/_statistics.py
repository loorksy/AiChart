from __future__ import annotations

import math
import statistics
from collections.abc import Sequence

from app.validation.models import DistributionSummary, QuantileInterval


def finite_values(values: Sequence[float], *, label: str) -> list[float]:
    normalized = [float(value) for value in values]
    if any(not math.isfinite(value) for value in normalized):
        raise ValueError(f"{label} must contain only finite values")
    return normalized


def compoundable_returns(values: Sequence[float], *, label: str = "returns") -> list[float]:
    normalized = finite_values(values, label=label)
    if any(value <= -1.0 for value in normalized):
        raise ValueError(f"{label} must be greater than -1.0 for compounding")
    return normalized


def positive_equity(values: Sequence[float]) -> list[float]:
    normalized = finite_values(values, label="equity values")
    if any(value <= 0.0 for value in normalized):
        raise ValueError("equity values must be positive")
    return normalized


def terminal_return(returns: Sequence[float]) -> float:
    equity = 1.0
    for value in returns:
        equity *= 1.0 + value
    return equity - 1.0


def maximum_drawdown_from_returns(returns: Sequence[float]) -> float:
    equity = 1.0
    peak = equity
    maximum_drawdown = 0.0
    for value in returns:
        equity *= 1.0 + value
        peak = max(peak, equity)
        maximum_drawdown = max(maximum_drawdown, (peak - equity) / peak)
    return maximum_drawdown


def maximum_drawdown_from_equity(equity_values: Sequence[float]) -> float:
    peak = equity_values[0]
    maximum_drawdown = 0.0
    for equity in equity_values:
        peak = max(peak, equity)
        maximum_drawdown = max(maximum_drawdown, (peak - equity) / peak)
    return maximum_drawdown


def period_returns(equity_values: Sequence[float]) -> list[float]:
    return [
        current / previous - 1.0
        for previous, current in zip(equity_values, equity_values[1:], strict=False)
    ]


def sharpe_ratio(returns: Sequence[float], periods_per_year: int | None) -> float | None:
    if len(returns) < 2:
        return None
    standard_deviation = statistics.stdev(returns)
    if standard_deviation == 0.0:
        return None
    scale = math.sqrt(periods_per_year) if periods_per_year is not None else 1.0
    return statistics.fmean(returns) / standard_deviation * scale


def percentile(sorted_values: Sequence[float], percentile_value: float) -> float:
    if not sorted_values:
        raise ValueError("cannot calculate a percentile of an empty sequence")
    if not 0.0 <= percentile_value <= 1.0:
        raise ValueError("percentile must be between 0 and 1")
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    position = percentile_value * (len(sorted_values) - 1)
    lower_index = math.floor(position)
    upper_index = math.ceil(position)
    if lower_index == upper_index:
        return float(sorted_values[lower_index])
    weight = position - lower_index
    return float(sorted_values[lower_index] * (1.0 - weight) + sorted_values[upper_index] * weight)


def distribution_summary(values: Sequence[float], confidence: float) -> DistributionSummary:
    normalized = sorted(finite_values(values, label="distribution values"))
    alpha = (1.0 - confidence) / 2.0
    return DistributionSummary(
        count=len(normalized),
        mean=statistics.fmean(normalized),
        median=statistics.median(normalized),
        standard_deviation=statistics.pstdev(normalized),
        minimum=normalized[0],
        maximum=normalized[-1],
        interval=QuantileInterval(
            confidence=confidence,
            lower=percentile(normalized, alpha),
            upper=percentile(normalized, 1.0 - alpha),
        ),
    )
