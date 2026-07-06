"""Trading domain constants — modes, styles, intervals, defaults.

Ported from the former AiChart ``lib/types.ts`` and ``lib/constants.ts``.
Kept dependency-free so it can be imported from anywhere (routes, agent
tools, workers) without side effects.
"""

from __future__ import annotations

import os

# ── Bootstrap admin account (created on first run) ────────────────────────────
ADMIN_EMAIL: str = os.getenv("ADMIN_EMAIL", "loorksy@gmail.com")
ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin12345")

# ── Trading modes ─────────────────────────────────────────────────────────────
# - auto:     the agent opens/closes trades on its own (Risk Guard gated).
# - approval: the agent proposes; the operator approves each entry.
# - direct:   the operator drives; the agent trades only on explicit command.
TRADING_MODES: tuple[str, ...] = ("auto", "approval", "direct")


def normalize_trading_mode(raw: str | None) -> str:
    """Normalize a stored/legacy mode value. Legacy 'advisory' -> 'approval'."""
    if raw == "advisory":
        return "approval"
    return raw if raw in TRADING_MODES else "approval"


# ── Trading styles (cadence, distinct from execution authority) ───────────────
TRADING_STYLES: tuple[str, ...] = ("scalp", "day", "swing", "position")


def normalize_trading_style(raw: str | None) -> str:
    return raw if raw in TRADING_STYLES else "day"


# Default analysis interval per trading style.
STYLE_DEFAULT_INTERVAL: dict[str, str] = {
    "scalp": "1m",
    "day": "15m",
    "swing": "4h",
    "position": "1d",
}

# ── Chart intervals (superset accepted by the chart + market layers) ──────────
INTERVALS: tuple[str, ...] = (
    "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w",
)


def normalize_interval(raw: str | None) -> str:
    iv = (raw or "15m").lower().strip()
    return iv if iv in INTERVALS else "15m"


# ── Execution environments ────────────────────────────────────────────────────
EXECUTION_ENVS: tuple[str, ...] = ("demo", "live")


def normalize_execution_env(raw: str | None) -> str:
    return raw if raw in EXECUTION_ENVS else "demo"


# ── Default trading settings (per user) ───────────────────────────────────────
# Mirrors the TradingSettings shape from AiChart. Values are conservative
# defaults; the platform is forex-first.
DEFAULT_SETTINGS: dict[str, object] = {
    "mode": "approval",
    "approval": "manual",
    "experience": "expert",
    "style": "balanced",
    "trading_style": "day",
    "scalp_max_trades": 0,
    "scalp_enabled": 0,
    "scalp_execution_mode": "paper",
    "max_capital": 1000.0,
    "per_trade_pct": 2.0,
    "max_open_trades": 3,
    "min_rr": 1.0,
    "min_confidence": 80,
    "daily_loss_limit_pct": 5.0,
    "monthly_loss_limit_pct": 15.0,
    "daily_profit_target_pct": 0.0,
    "daily_profit_target_usd": 0.0,
    "risk_guard_enabled": 1,
    "active_market": "forex",
    "env_preference": "demo",
    "allowed_assets": "",
}

# ── Default admin limits (ceilings; 0 or less = unlimited) ─────────────────────
DEFAULT_ADMIN_LIMITS: dict[str, object] = {
    "can_execute": True,
    "max_capital_cap": 0.0,
    "max_open_trades_cap": 0,
    "kill_switch": False,
}
