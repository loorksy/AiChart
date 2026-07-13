from __future__ import annotations

import statistics
from collections.abc import Callable, Sequence

from app.validation._statistics import (
    maximum_drawdown_from_equity,
    period_returns,
    positive_equity,
    sharpe_ratio,
)
from app.validation.models import (
    MAX_OBSERVATIONS,
    WalkForwardConfig,
    WalkForwardResult,
    WalkForwardWindow,
    WindowSegmentSummary,
)


def run_walk_forward(
    equity_values: Sequence[float],
    config: WalkForwardConfig,
    *,
    cancel_check: Callable[[], None] | None = None,
) -> WalkForwardResult:
    """Summarize a fixed strategy across sequential, non-overlapping windows.

    This function performs no fitting or parameter selection. It labels fixed
    sequential segments as training, validation, and out-of-sample so an
    integration can report stability without leaking later segments backward.
    """

    equity = positive_equity(equity_values)
    if len(equity) > MAX_OBSERVATIONS:
        raise ValueError(f"walk-forward input exceeds {MAX_OBSERVATIONS} observations")

    window_size = (
        config.training_observations
        + config.validation_observations
        + config.out_of_sample_observations
    )
    available_windows = len(equity) // window_size
    if available_windows < config.minimum_windows:
        required = window_size * config.minimum_windows
        raise ValueError(
            f"walk-forward requires at least {required} observations for "
            f"{config.minimum_windows} complete window(s)"
        )
    window_count = min(available_windows, config.maximum_windows)

    windows = []
    for window_index in range(window_count):
        if cancel_check is not None:
            cancel_check()
        start = window_index * window_size
        training_end = start + config.training_observations
        validation_end = training_end + config.validation_observations
        out_of_sample_end = validation_end + config.out_of_sample_observations
        windows.append(
            WalkForwardWindow(
                window_number=window_index + 1,
                training=_summarize_segment(equity, start, training_end, config.periods_per_year),
                validation=_summarize_segment(
                    equity, training_end, validation_end, config.periods_per_year
                ),
                out_of_sample=_summarize_segment(
                    equity, validation_end, out_of_sample_end, config.periods_per_year
                ),
            )
        )

    if cancel_check is not None:
        cancel_check()
    out_of_sample_returns = [window.out_of_sample.total_return for window in windows]
    observations_used = window_count * window_size
    return WalkForwardResult(
        windows=windows,
        observations_used=observations_used,
        unused_observations=len(equity) - observations_used,
        non_overlapping=_windows_are_non_overlapping(windows),
        fixed_strategy_only=True,
        out_of_sample_profitable_fraction=(
            sum(value > 0.0 for value in out_of_sample_returns) / len(out_of_sample_returns)
        ),
        out_of_sample_mean_return=statistics.fmean(out_of_sample_returns),
        assumptions=[
            "The strategy and parameters are fixed before every reported segment.",
            "No optimization, model fitting, or selection is performed on out-of-sample data.",
            "Incomplete trailing observations are reported as unused rather than reused.",
        ],
    )


def _summarize_segment(
    equity: list[float], start: int, end: int, periods_per_year: int | None
) -> WindowSegmentSummary:
    segment = equity[start:end]
    returns = period_returns(segment)
    return WindowSegmentSummary(
        start_index=start,
        end_index=end,
        observations=len(segment),
        total_return=segment[-1] / segment[0] - 1.0,
        mean_period_return=statistics.fmean(returns),
        sharpe=sharpe_ratio(returns, periods_per_year),
        maximum_drawdown=maximum_drawdown_from_equity(segment),
    )


def _windows_are_non_overlapping(windows: Sequence[WalkForwardWindow]) -> bool:
    previous_end = 0
    for window in windows:
        segments = (window.training, window.validation, window.out_of_sample)
        for segment in segments:
            if segment.start_index < previous_end:
                return False
            previous_end = segment.end_index
    return True
