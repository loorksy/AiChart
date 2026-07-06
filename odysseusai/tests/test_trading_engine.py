"""Unit tests for the native Python trading engine (indicators + Risk Guard).

Pure-logic coverage — no DB, broker, or network required.
"""

from services.trading import constants as const
from services.trading import indicators as ind
from services.trading import risk


# ── Indicators ────────────────────────────────────────────────────────────────
def test_sma():
    vals = [float(x) for x in range(1, 60)]
    assert ind.sma(vals, 5) == 57.0
    assert ind.sma([1, 2], 5) is None


def test_rsi_monotonic_up_is_100():
    vals = [float(x) for x in range(1, 60)]
    assert ind.rsi(vals, 14) == 100.0
    assert ind.rsi([1, 2], 14) is None


def test_ema_and_atr_and_macd():
    vals = [float(x) for x in range(1, 60)]
    assert ind.ema(vals, 10) is not None
    candles = [ind.Candle(high=h + 1, low=h - 1, close=h) for h in vals]
    a = ind.atr(candles, 14)
    assert a is not None and a > 0
    m = ind.macd(vals)
    assert m is not None and m.macd > 0


# ── reward:risk + admin caps ──────────────────────────────────────────────────
def test_reward_risk():
    assert risk.compute_reward_risk(100, 95, 110) == 2.0
    assert risk.compute_reward_risk(None, 95, 110) is None
    assert risk.compute_reward_risk(100, 100, 110) is None  # zero risk


def test_admin_cap_zero_means_unlimited():
    # The min(userValue, 0) == 0 trap: a 0 admin cap must NOT block everything.
    assert risk.resolve_max_open_trades(3, 0) == 3
    assert risk.resolve_max_open_trades(3, 2) == 2
    assert risk.resolve_effective_capital(1000, 0) == 1000
    assert risk.resolve_effective_capital(1000, 500) == 500


# ── Risk Guard ────────────────────────────────────────────────────────────────
def _settings(**over):
    base = dict(
        mode="auto", max_capital=1000, per_trade_pct=2, max_open_trades=3, min_rr=1,
        risk_guard_enabled=1, active_market="forex", env_preference="demo",
        allowed_assets="", daily_loss_limit_pct=5, monthly_loss_limit_pct=15,
        daily_profit_target_pct=0, daily_profit_target_usd=0,
    )
    base.update(over)
    return base


def _limits(**over):
    base = dict(can_execute=True, max_capital_cap=0, max_open_trades_cap=0, kill_switch=False)
    base.update(over)
    return base


def test_good_trade_allowed():
    p = risk.ProposedTrade(symbol="EURUSD", side="buy", notional=20, confidence=90,
                           entry=1.10, stop_loss=1.095, take_profit=1.115)
    d = risk.evaluate_trade(_settings(), _limits(), p, risk.RiskContext(resolved_env="demo"))
    assert d.ok and d.per_trade_max == 20.0


def test_missing_stop_denied():
    p = risk.ProposedTrade(symbol="EURUSD", side="buy", notional=20, confidence=90,
                           entry=1.10, stop_loss=None, take_profit=1.115)
    d = risk.evaluate_trade(_settings(), _limits(), p, risk.RiskContext(resolved_env="demo"))
    assert not d.ok


def test_kill_switch_denied():
    p = risk.ProposedTrade(symbol="EURUSD", side="buy", notional=20, confidence=90,
                           entry=1.10, stop_loss=1.095, take_profit=1.115)
    d = risk.evaluate_trade(_settings(), _limits(kill_switch=True), p, risk.RiskContext())
    assert not d.ok


def test_oversize_and_rr_denied():
    over = risk.ProposedTrade(symbol="EURUSD", side="buy", notional=21, confidence=90,
                              entry=1.10, stop_loss=1.095, take_profit=1.115)
    assert not risk.evaluate_trade(_settings(), _limits(), over, risk.RiskContext()).ok
    bad_rr = risk.ProposedTrade(symbol="EURUSD", side="buy", notional=10, confidence=90,
                                entry=1.10, stop_loss=1.09, take_profit=1.105)
    assert not risk.evaluate_trade(_settings(), _limits(), bad_rr, risk.RiskContext()).ok


def test_constants_normalization():
    assert const.normalize_trading_mode("advisory") == "approval"
    assert const.normalize_trading_mode(None) == "approval"
    assert const.normalize_interval("99x") == "15m"
    assert const.normalize_trading_style("scalp") == "scalp"
