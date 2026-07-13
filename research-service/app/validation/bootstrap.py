from __future__ import annotations

import random
import statistics
from collections.abc import Callable, Sequence

from app.validation._statistics import (
    compoundable_returns,
    maximum_drawdown_from_returns,
    percentile,
    sharpe_ratio,
)
from app.validation.models import (
    BootstrapConfig,
    BootstrapMethod,
    BootstrapMetric,
    BootstrapResult,
    MetricConfidenceInterval,
)

MetricFunction = Callable[[Sequence[float], int | None], float | None]


def run_bootstrap(
    returns: Sequence[float],
    config: BootstrapConfig,
    *,
    cancel_check: Callable[[], None] | None = None,
) -> BootstrapResult:
    """Calculate deterministic percentile confidence intervals for trade metrics."""

    normalized = compoundable_returns(returns)
    if len(normalized) < config.minimum_observations:
        raise ValueError(
            f"at least {config.minimum_observations} trade-return observations are required"
        )
    if config.block_size is not None and config.block_size > len(normalized):
        raise ValueError("moving-block size cannot exceed the observation count")

    rng = random.Random(config.seed)  # noqa: S311 - deterministic simulation, not security
    samples = []
    for simulation in range(config.simulations):
        if cancel_check is not None and simulation % 64 == 0:
            cancel_check()
        samples.append(_resample(normalized, config.method, config.block_size, rng))
    if cancel_check is not None:
        cancel_check()
    intervals = [_metric_interval(metric, normalized, samples, config) for metric in config.metrics]

    if config.method is BootstrapMethod.MOVING_BLOCK:
        null_hypothesis = (
            "Contiguous return blocks are exchangeable and preserve dependence only within the "
            "configured moving-block length."
        )
        assumptions = [
            "Circular moving blocks are sampled with replacement.",
            "Dependence beyond the configured block length is not preserved.",
        ]
    else:
        null_hypothesis = (
            "Under the IID bootstrap, individual observed trade returns are independent and "
            "identically distributed draws from the empirical return distribution."
        )
        assumptions = ["IID bootstrap does not preserve serial dependence."]
    if config.periods_per_year is None:
        assumptions.append("Sharpe is unannualized because periods_per_year was not supplied.")

    return BootstrapResult(
        method=config.method,
        seed=config.seed,
        simulations=config.simulations,
        observations=len(normalized),
        confidence=config.confidence,
        block_size=config.block_size,
        null_hypothesis=null_hypothesis,
        intervals=intervals,
        assumptions=assumptions,
    )


def _resample(
    returns: list[float],
    method: BootstrapMethod,
    block_size: int | None,
    rng: random.Random,
) -> list[float]:
    if method is BootstrapMethod.IID:
        return rng.choices(returns, k=len(returns))

    assert block_size is not None
    sample: list[float] = []
    while len(sample) < len(returns):
        start = rng.randrange(len(returns))
        for offset in range(block_size):
            sample.append(returns[(start + offset) % len(returns)])
            if len(sample) == len(returns):
                break
    return sample


def _metric_interval(
    metric: BootstrapMetric,
    observed_returns: list[float],
    samples: list[list[float]],
    config: BootstrapConfig,
) -> MetricConfidenceInterval:
    metric_function = _METRICS[metric]
    observed = metric_function(observed_returns, config.periods_per_year)
    values = [
        value
        for sample in samples
        if (value := metric_function(sample, config.periods_per_year)) is not None
    ]
    if observed is None:
        return MetricConfidenceInterval(
            metric=metric,
            valid_simulations=len(values),
            reason=_undefined_reason(metric),
        )
    if not values:
        return MetricConfidenceInterval(
            metric=metric,
            observed=observed,
            valid_simulations=0,
            reason="metric was undefined in every bootstrap sample",
        )

    values.sort()
    alpha = (1.0 - config.confidence) / 2.0
    reason = None
    if len(values) < config.simulations:
        reason = f"undefined in {config.simulations - len(values)} bootstrap samples"
    return MetricConfidenceInterval(
        metric=metric,
        observed=observed,
        lower=percentile(values, alpha),
        upper=percentile(values, 1.0 - alpha),
        valid_simulations=len(values),
        reason=reason,
    )


def _mean_return(returns: Sequence[float], _periods_per_year: int | None) -> float:
    return statistics.fmean(returns)


def _expectancy(returns: Sequence[float], _periods_per_year: int | None) -> float:
    wins = [value for value in returns if value > 0.0]
    losses = [value for value in returns if value < 0.0]
    win_probability = len(wins) / len(returns)
    loss_probability = len(losses) / len(returns)
    average_win = statistics.fmean(wins) if wins else 0.0
    average_loss = statistics.fmean(losses) if losses else 0.0
    return win_probability * average_win + loss_probability * average_loss


def _win_rate(returns: Sequence[float], _periods_per_year: int | None) -> float:
    return sum(value > 0.0 for value in returns) / len(returns)


def _profit_factor(returns: Sequence[float], _periods_per_year: int | None) -> float | None:
    gross_profit = sum(value for value in returns if value > 0.0)
    gross_loss = abs(sum(value for value in returns if value < 0.0))
    if gross_loss == 0.0:
        return None
    return gross_profit / gross_loss


def _sharpe(returns: Sequence[float], periods_per_year: int | None) -> float | None:
    return sharpe_ratio(returns, periods_per_year)


def _maximum_drawdown(returns: Sequence[float], _periods_per_year: int | None) -> float:
    return maximum_drawdown_from_returns(returns)


def _undefined_reason(metric: BootstrapMetric) -> str:
    if metric is BootstrapMetric.PROFIT_FACTOR:
        return "profit factor is undefined without at least one losing return"
    if metric is BootstrapMetric.SHARPE:
        return "Sharpe is undefined with fewer than two returns or zero return variance"
    return "metric is undefined for the supplied observations"


_METRICS: dict[BootstrapMetric, MetricFunction] = {
    BootstrapMetric.MEAN_TRADE_RETURN: _mean_return,
    BootstrapMetric.EXPECTANCY: _expectancy,
    BootstrapMetric.WIN_RATE: _win_rate,
    BootstrapMetric.PROFIT_FACTOR: _profit_factor,
    BootstrapMetric.SHARPE: _sharpe,
    BootstrapMetric.MAXIMUM_DRAWDOWN: _maximum_drawdown,
}
