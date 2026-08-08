"""Hand-verified coverage for `calculate_backtest_metrics`: every case below
uses R-values chosen so the expected metric is a clean number worked out by
hand (in the comment), not just re-deriving the formula under test."""

from __future__ import annotations

from app.engine.backtest.metrics import calculate_backtest_metrics
from app.engine.backtest.models import SimulatedTrade


def _trade(r_multiple: float) -> SimulatedTrade:
    outcome = "target" if r_multiple > 0 else "stop"
    return SimulatedTrade(
        strategy_id="s",
        strategy_version="1.0.0",
        direction="buy",
        entry_step_index=0,
        exit_step_index=1,
        entry=100.0,
        stop_loss=95.0,
        target=110.0,
        exit_price=110.0 if outcome == "target" else 95.0,
        outcome=outcome,  # type: ignore[arg-type]
        r_multiple=r_multiple,
    )


def test_metrics_empty_trade_list_is_all_none_with_reasons() -> None:
    metrics = calculate_backtest_metrics([])
    assert metrics.trade_count == 0
    assert metrics.win_rate is None
    assert metrics.profit_factor is None
    assert metrics.expectancy_r is None
    assert metrics.max_drawdown_r is None
    assert metrics.max_drawdown_percent is None
    assert metrics.sharpe_r is None
    assert set(metrics.metric_reasons) == {
        "win_rate",
        "profit_factor",
        "expectancy_r",
        "max_drawdown_r",
        "max_drawdown_percent",
        "sharpe_r",
    }


def test_metrics_mixed_wins_and_losses_match_hand_computed_values() -> None:
    """r = [1, 1, -1, -1]:
      win_rate      = 2/4                = 0.5
      profit_factor = (1+1) / abs(-1-1)  = 2/2  = 1.0
      expectancy_r  = (1+1-1-1)/4        = 0/4  = 0.0
      cumulative R curve: 1, 2, 1, 0 ; running peak: 1, 2, 2, 2
      drawdown_r:         0, 0, 1, 2 -> max_drawdown_r = 2.0
      drawdown_%:         0, 0, 50, 100 -> max_drawdown_percent = 100.0
      sharpe_r = mean(0) / pstdev(1) = 0.0
    """
    trades = [_trade(1.0), _trade(1.0), _trade(-1.0), _trade(-1.0)]
    metrics = calculate_backtest_metrics(trades)

    assert metrics.trade_count == 4
    assert metrics.win_rate == 0.5
    assert metrics.profit_factor == 1.0
    assert metrics.expectancy_r == 0.0
    assert metrics.max_drawdown_r == 2.0
    assert metrics.max_drawdown_percent == 100.0
    assert metrics.sharpe_r == 0.0
    assert metrics.metric_reasons == {}


def test_metrics_all_wins_reports_none_profit_factor_with_reason() -> None:
    """r = [1, 2]:
      win_rate = 2/2 = 1.0
      profit_factor -> None ("no losing trades")
      expectancy_r = (1+2)/2 = 1.5
      cumulative: 1, 3 ; peak: 1, 3 ; drawdown: 0, 0 -> max_drawdown_r=0.0, %=0.0
      sharpe_r = mean(1.5) / pstdev([1,2]=0.5) = 3.0
    """
    trades = [_trade(1.0), _trade(2.0)]
    metrics = calculate_backtest_metrics(trades)

    assert metrics.trade_count == 2
    assert metrics.win_rate == 1.0
    assert metrics.profit_factor is None
    assert metrics.metric_reasons["profit_factor"] == "no losing trades"
    assert metrics.expectancy_r == 1.5
    assert metrics.max_drawdown_r == 0.0
    assert metrics.max_drawdown_percent == 0.0
    assert metrics.sharpe_r == 3.0


def test_metrics_single_trade_reports_none_sharpe_with_reason() -> None:
    trades = [_trade(1.0)]
    metrics = calculate_backtest_metrics(trades)

    assert metrics.trade_count == 1
    assert metrics.win_rate == 1.0
    assert metrics.profit_factor is None
    assert metrics.metric_reasons["profit_factor"] == "no losing trades"
    assert metrics.expectancy_r == 1.0
    assert metrics.sharpe_r is None
    assert metrics.metric_reasons["sharpe_r"] == "fewer than 2 trades"


def test_metrics_all_losses_from_start_reports_none_drawdown_percent_and_sharpe() -> None:
    """r = [-1, -1]: the cumulative R curve never rises above its 0 baseline,
    so "percent of peak" is undefined (division by zero) -- must be `None`
    with an explicit reason, not a crash or a fabricated 0/100."""
    trades = [_trade(-1.0), _trade(-1.0)]
    metrics = calculate_backtest_metrics(trades)

    assert metrics.trade_count == 2
    assert metrics.win_rate == 0.0
    assert metrics.profit_factor == 0.0  # gross_profit_r=0 / abs(gross_loss_r)=2 -> 0.0, not None
    assert metrics.expectancy_r == -1.0
    assert metrics.max_drawdown_r == 2.0
    assert metrics.max_drawdown_percent is None
    assert metrics.metric_reasons["max_drawdown_percent"] == "cumulative R never rose above zero"
    assert metrics.sharpe_r is None
    assert metrics.metric_reasons["sharpe_r"] == "zero variance in trade R-returns"
