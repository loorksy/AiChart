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
    trade_exit_indices: Sequence[int] | None = None,
    trade_returns: Sequence[float] | None = None,
) -> WalkForwardResult:
    """Summarize a fixed strategy across sequential, non-overlapping windows.

    This function performs no fitting or parameter selection. It labels fixed
    sequential segments as training, validation, and out-of-sample so an
    integration can report stability without leaking later segments backward.

    When ``trade_exit_indices`` and ``trade_returns`` are supplied (same length),
    each segment also reports trade_count / win_rate / expectancy for trades whose
    exit bar index falls in ``[start, end)``.
    """

    equity = positive_equity(equity_values)
    if len(equity) > MAX_OBSERVATIONS:
        raise ValueError(f"walk-forward input exceeds {MAX_OBSERVATIONS} observations")
    trade_exits: list[int] | None = None
    trade_rets: list[float] | None = None
    if trade_exit_indices is not None or trade_returns is not None:
        if trade_exit_indices is None or trade_returns is None:
            raise ValueError("trade_exit_indices and trade_returns must be supplied together")
        if len(trade_exit_indices) != len(trade_returns):
            raise ValueError("trade_exit_indices and trade_returns length mismatch")
        trade_exits = [int(index) for index in trade_exit_indices]
        trade_rets = [float(value) for value in trade_returns]

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
                training=_summarize_segment(
                    equity,
                    start,
                    training_end,
                    config.periods_per_year,
                    trade_exits,
                    trade_rets,
                ),
                validation=_summarize_segment(
                    equity,
                    training_end,
                    validation_end,
                    config.periods_per_year,
                    trade_exits,
                    trade_rets,
                ),
                out_of_sample=_summarize_segment(
                    equity,
                    validation_end,
                    out_of_sample_end,
                    config.periods_per_year,
                    trade_exits,
                    trade_rets,
                ),
            )
        )

    if cancel_check is not None:
        cancel_check()
    out_of_sample_returns = [window.out_of_sample.total_return for window in windows]
    training_returns = [window.training.total_return for window in windows]
    observations_used = window_count * window_size
    oos_profitable_fraction = (
        sum(value > 0.0 for value in out_of_sample_returns) / len(out_of_sample_returns)
    )
    training_profitable_fraction = (
        sum(value > 0.0 for value in training_returns) / len(training_returns)
    )
    # Overfit heuristic: training mostly profitable while OOS repeatedly fails.
    likely_overfit = (
        training_profitable_fraction >= 0.6
        and oos_profitable_fraction < 0.4
        and len(windows) >= 2
    )
    return WalkForwardResult(
        windows=windows,
        observations_used=observations_used,
        unused_observations=len(equity) - observations_used,
        non_overlapping=_windows_are_non_overlapping(windows),
        fixed_strategy_only=True,
        out_of_sample_profitable_fraction=oos_profitable_fraction,
        out_of_sample_mean_return=statistics.fmean(out_of_sample_returns),
        training_mean_return=statistics.fmean(training_returns),
        training_profitable_fraction=training_profitable_fraction,
        likely_overfit=likely_overfit,
        assumptions=[
            "The strategy and parameters are fixed before every reported segment.",
            "No optimization, model fitting, or selection is performed on out-of-sample data.",
            "Incomplete trailing observations are reported as unused rather than reused.",
            "Each window uses an earlier training block and a later out-of-sample block (no look-ahead).",
            (
                "likely_overfit is a descriptive heuristic when training is repeatedly "
                "profitable but out-of-sample windows are not."
            ),
        ],
    )


def _summarize_segment(
    equity: list[float],
    start: int,
    end: int,
    periods_per_year: int | None,
    trade_exit_indices: list[int] | None = None,
    trade_returns: list[float] | None = None,
) -> WindowSegmentSummary:
    segment = equity[start:end]
    returns = period_returns(segment)
    trade_count: int | None = None
    win_rate: float | None = None
    expectancy: float | None = None
    if trade_exit_indices is not None and trade_returns is not None:
        segment_returns = [
            ret
            for exit_index, ret in zip(trade_exit_indices, trade_returns, strict=True)
            if start <= exit_index < end
        ]
        trade_count = len(segment_returns)
        if trade_count > 0:
            win_rate = sum(1 for ret in segment_returns if ret > 0.0) / trade_count
            expectancy = statistics.fmean(segment_returns)
        else:
            win_rate = None
            expectancy = None
    return WindowSegmentSummary(
        start_index=start,
        end_index=end,
        observations=len(segment),
        total_return=segment[-1] / segment[0] - 1.0,
        mean_period_return=statistics.fmean(returns),
        sharpe=sharpe_ratio(returns, periods_per_year),
        maximum_drawdown=maximum_drawdown_from_equity(segment),
        trade_count=trade_count,
        win_rate=win_rate,
        expectancy=expectancy,
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
