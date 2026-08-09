from __future__ import annotations

from app.engine.combine import combine_signals
from app.engine.strategies.base import Signal


def _signal(strategy_id: str, direction: str, regime: str) -> Signal:
    return Signal(
        strategy_id=strategy_id,
        strategy_version="1.0.0",
        direction=direction,  # type: ignore[arg-type]
        plan_type="immediate",
        entry=1.1,
        stop_loss=1.09 if direction == "buy" else 1.11,
        take_profit=1.12 if direction == "buy" else 1.08,
        targets=[1.12] if direction == "buy" else [1.08],
        confidence=0.6,
        regime=regime,  # type: ignore[arg-type]
        rationale=[f"{strategy_id} fired"],
        evidence={},
    )


def test_no_strategy_fires_returns_no_signal() -> None:
    result = combine_signals([None, None], regime="range")
    assert result.signal is None
    assert "no strategy" in result.rationale[0]


def test_single_strategy_fires_wins_outright() -> None:
    trend_signal = _signal("ema_trend_v1", "buy", "trend")
    result = combine_signals([trend_signal, None], regime="trend")
    assert result.signal is trend_signal
    assert result.corroborating == []
    assert result.conflicting == []
    assert "single strategy fired" in result.rationale[0]


def test_both_agree_regime_matched_strategy_wins_other_is_corroborating() -> None:
    trend_signal = _signal("ema_trend_v1", "buy", "trend")
    reversion_signal = _signal("rsi_reversion_v1", "buy", "range")
    result = combine_signals([trend_signal, reversion_signal], regime="trend")
    assert result.signal is trend_signal
    assert result.corroborating == [reversion_signal]
    assert result.conflicting == []
    assert any("agree" in fragment for fragment in result.rationale)


def test_both_agree_but_regime_matches_the_other_strategy() -> None:
    trend_signal = _signal("ema_trend_v1", "buy", "trend")
    reversion_signal = _signal("rsi_reversion_v1", "buy", "range")
    result = combine_signals([trend_signal, reversion_signal], regime="range")
    assert result.signal is reversion_signal
    assert result.corroborating == [trend_signal]


def test_both_disagree_regime_matched_strategy_wins_conflict_is_recorded() -> None:
    trend_signal = _signal("ema_trend_v1", "buy", "trend")
    reversion_signal = _signal("rsi_reversion_v1", "sell", "range")
    result = combine_signals([trend_signal, reversion_signal], regime="trend")
    assert result.signal is trend_signal
    assert result.conflicting == [reversion_signal]
    assert result.corroborating == []
    assert any("conflict" in fragment for fragment in result.rationale)
    assert any("rsi_reversion_v1" in fragment for fragment in result.rationale)


def test_both_disagree_and_regime_matches_neither_falls_back_to_first() -> None:
    trend_signal = _signal("ema_trend_v1", "buy", "trend")
    reversion_signal = _signal("rsi_reversion_v1", "sell", "range")
    result = combine_signals([trend_signal, reversion_signal], regime="high_volatility")
    assert result.signal is trend_signal
    assert any("matches none" in fragment for fragment in result.rationale)
