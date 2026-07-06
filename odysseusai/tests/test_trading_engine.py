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


# ── Analysis confluences (deterministic verdict inputs) ───────────────────────
def test_analysis_confluences_direction():
    from services.trading.analysis import _confluences

    bull = {"trend": "uptrend", "rsi14": 62.0, "macd": {"histogram": 0.001},
            "price": 1.10, "ema20": 1.099}
    direction, reasons = _confluences(bull)
    assert direction == "buy" and len(reasons) >= 3

    bear = {"trend": "downtrend", "rsi14": 38.0, "macd": {"histogram": -0.001},
            "price": 1.10, "ema20": 1.101}
    direction, _ = _confluences(bear)
    assert direction == "sell"

    flat = {"trend": "sideways", "rsi14": 50.0, "macd": {"histogram": 0.0},
            "price": 1.10, "ema20": 1.10}
    direction, _ = _confluences(flat)
    assert direction == "neutral"


# ── MT5 symbol mapping ────────────────────────────────────────────────────────
def test_mt5_symbol_mapping():
    from services.trading.mt5map import forex_canonical_key, resolve_mt5_symbol

    assert forex_canonical_key("EURUSDm") == "EURUSD"
    assert forex_canonical_key("XAUUSD.pro") == "XAUUSD"
    assert forex_canonical_key("EUR_USD") == "EURUSD"

    broker = ["EURUSDm", "GBPUSDm", "XAUUSD.pro"]
    assert resolve_mt5_symbol(broker, "EURUSDm") == "EURUSDm"   # exact
    assert resolve_mt5_symbol(broker, "eurusdm") == "EURUSDm"   # case-insensitive
    assert resolve_mt5_symbol(broker, "EURUSD") == "EURUSDm"    # canonical
    assert resolve_mt5_symbol(broker, "XAUUSD") == "XAUUSD.pro"
    assert resolve_mt5_symbol(broker, "USDJPY") is None         # unavailable
    assert resolve_mt5_symbol([], "EURUSD") is None


# ── EA bridge: token + command reconciliation (DB-backed) ─────────────────────
def test_ea_token_and_command_flow():
    from services.trading import store

    owner = "ea_test_user"
    token = store.generate_ea_token(owner)
    assert token.startswith("ea_")
    assert store.resolve_owner_by_ea_token(token) == owner
    assert store.resolve_owner_by_ea_token("ea_wrong") is None

    # Heartbeat marks the bridge online.
    from datetime import datetime, timezone
    store.update_ea_state(owner, {
        "connected": True, "last_heartbeat": datetime.now(timezone.utc).isoformat(),
        "symbol_specs": [{"symbol": "EURUSDm"}], "balance": 1000.0,
    })
    assert store.ea_connected(owner) is True
    assert store.ea_symbol_list(owner) == ["EURUSDm"]

    # A pending open command linked to a pending trade, then acked → open.
    trade = store.record_trade(owner, {"symbol": "EURUSD", "side": "buy",
                                       "notional": 20, "status": "pending", "env": "live"})
    cmd = store.create_ea_command(owner, "open_position",
                                  {"symbol": "EURUSDm", "side": "buy", "lots": 0.02},
                                  trade_id=trade["id"])
    pending = store.list_pending_commands(owner, mark_sent=True)
    assert any(c["id"] == cmd["id"] for c in pending)
    store.ack_command(owner, cmd["id"], "acked", {"ticket": 999, "price": 1.1004, "lots": 0.02})
    filled = [t for t in store.list_trades(owner) if t["id"] == trade["id"]][0]
    assert filled["status"] == "open" and filled["broker_ticket"] == "999"


# ── Native agent tools (registry contract, DB-backed) ─────────────────────────
def test_agent_trading_tools():
    import asyncio
    import json as _json
    from src.agent_tools.trading_tools import (
        SetTradingModeTool, GetRiskSettingsTool, ExecuteMt5OrderTool, EmergencyStopTool,
    )

    ctx = {"owner": "tool_test_user", "session_id": "s1"}
    run = lambda tool, c="": asyncio.get_event_loop().run_until_complete(tool.execute(c, ctx))

    _, r = run(SetTradingModeTool(), _json.dumps({"mode": "full_auto"}))
    assert r["exit_code"] == 0 and r["data"]["settings"]["mode"] == "auto"

    # Auto mode + demo env → paper trade with valid SL/RR.
    _, r = run(ExecuteMt5OrderTool(), _json.dumps(
        {"symbol": "EURUSD", "side": "buy", "notional": 20, "entry": 1.10,
         "stop_loss": 1.095, "take_profit": 1.115, "confidence": 85}))
    assert r["exit_code"] == 0 and r["data"]["routed"] == "paper"

    # Missing SL → Risk Guard denial (tool surfaces an error).
    _, r = run(ExecuteMt5OrderTool(), _json.dumps(
        {"symbol": "EURUSD", "side": "buy", "notional": 20, "entry": 1.10, "take_profit": 1.115}))
    assert r["exit_code"] == 1

    # Emergency stop drops the user to analyze-only.
    run(EmergencyStopTool(), _json.dumps({"enabled": True}))
    _, r = run(GetRiskSettingsTool())
    assert r["data"]["settings"]["mode"] == "direct"
