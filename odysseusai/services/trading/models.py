"""SQLAlchemy models for the native trading engine.

Registered on the shared Odysseus ``Base`` so ``init_db`` creates them
alongside the rest of the workspace tables. All user-scoped rows carry an
``owner`` (username) column, matching Odysseus's ownership convention.

Broker secrets are never stored in the clear — they pass through
``src.secret_storage`` (Fernet) before hitting these columns.
"""

from __future__ import annotations

import logging

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text

from core.database import Base, TimestampMixin, engine, utcnow_naive

logger = logging.getLogger(__name__)


class TradingSettings(TimestampMixin, Base):
    """Per-user trading configuration (mode, caps, risk limits)."""

    __tablename__ = "trading_settings"

    owner = Column(String, primary_key=True, index=True)  # username
    mode = Column(String, nullable=False, default="approval")   # auto|approval|direct
    approval = Column(String, nullable=False, default="manual")  # manual|delegate
    experience = Column(String, nullable=False, default="expert")
    style = Column(String, nullable=False, default="balanced")
    trading_style = Column(String, nullable=False, default="day")  # scalp|day|swing|position
    scalp_max_trades = Column(Integer, nullable=False, default=0)
    scalp_enabled = Column(Integer, nullable=False, default=0)
    scalp_execution_mode = Column(String, nullable=False, default="paper")
    max_capital = Column(Float, nullable=False, default=1000.0)
    per_trade_pct = Column(Float, nullable=False, default=2.0)
    max_open_trades = Column(Integer, nullable=False, default=3)
    min_rr = Column(Float, nullable=False, default=1.0)
    min_confidence = Column(Integer, nullable=False, default=80)
    daily_loss_limit_pct = Column(Float, nullable=False, default=5.0)
    monthly_loss_limit_pct = Column(Float, nullable=False, default=15.0)
    daily_profit_target_pct = Column(Float, nullable=False, default=0.0)
    daily_profit_target_usd = Column(Float, nullable=False, default=0.0)
    risk_guard_enabled = Column(Integer, nullable=False, default=1)
    active_market = Column(String, nullable=False, default="forex")
    env_preference = Column(String, nullable=False, default="demo")  # demo|live
    allowed_assets = Column(Text, nullable=False, default="")


class AdminLimits(TimestampMixin, Base):
    """Global admin ceilings + kill switch. Single row keyed on id='global'.

    Caps are CEILINGS: 0 (or less) means UNLIMITED (see risk.resolve_*).
    """

    __tablename__ = "trading_admin_limits"

    id = Column(String, primary_key=True, default="global")
    can_execute = Column(Boolean, nullable=False, default=True)
    max_capital_cap = Column(Float, nullable=False, default=0.0)
    max_open_trades_cap = Column(Integer, nullable=False, default=0)
    kill_switch = Column(Boolean, nullable=False, default=False)


class BrokerCredential(TimestampMixin, Base):
    """Encrypted broker/data-provider credentials, per user + provider.

    ``secret_enc`` values are Fernet-encrypted via ``src.secret_storage``.
    """

    __tablename__ = "trading_broker_credentials"

    id = Column(String, primary_key=True, index=True)  # f"{owner}:{provider}"
    owner = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False)  # oanda|mt5|telegram|anthropic
    account_id = Column(String, nullable=True)
    api_key_enc = Column(Text, nullable=True)
    secret_enc = Column(Text, nullable=True)
    env = Column(String, nullable=False, default="demo")  # demo|live
    meta = Column(Text, nullable=True)  # JSON blob for provider-specific extras


class Trade(TimestampMixin, Base):
    """An executed or historical trade (open/closed)."""

    __tablename__ = "trading_trades"

    id = Column(String, primary_key=True, index=True)
    owner = Column(String, nullable=False, index=True)
    symbol = Column(String, nullable=False)
    side = Column(String, nullable=False)  # buy|sell
    notional = Column(Float, nullable=False, default=0.0)
    volume = Column(Float, nullable=True)  # broker lot size
    entry = Column(Float, nullable=True)
    stop_loss = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)
    exit_price = Column(Float, nullable=True)
    status = Column(String, nullable=False, default="open")  # open|closed|cancelled
    pnl = Column(Float, nullable=True)
    env = Column(String, nullable=False, default="demo")
    broker_ticket = Column(String, nullable=True)  # MT5 position ticket
    confidence = Column(Float, nullable=True)
    reason = Column(Text, nullable=True)
    opened_at = Column(DateTime, nullable=True, default=utcnow_naive)
    closed_at = Column(DateTime, nullable=True)


class Recommendation(TimestampMixin, Base):
    """An agent recommendation (verdict card), tradeable or informational."""

    __tablename__ = "trading_recommendations"

    id = Column(String, primary_key=True, index=True)
    owner = Column(String, nullable=False, index=True)
    symbol = Column(String, nullable=False)
    interval = Column(String, nullable=False, default="15m")
    side = Column(String, nullable=True)  # buy|sell|null (informational)
    entry = Column(Float, nullable=True)
    stop_loss = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)
    confidence = Column(Float, nullable=True)
    reward_risk = Column(Float, nullable=True)
    summary = Column(Text, nullable=True)
    reasons = Column(Text, nullable=True)  # JSON array of confluences
    status = Column(String, nullable=False, default="active")  # active|expired|acted


class Intent(TimestampMixin, Base):
    """An approval-flow intent: agent proposes, operator approves/rejects."""

    __tablename__ = "trading_intents"

    id = Column(String, primary_key=True, index=True)
    owner = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False, default="open")  # open|close|modify
    symbol = Column(String, nullable=False)
    payload = Column(Text, nullable=True)  # JSON proposed trade
    status = Column(String, nullable=False, default="pending")  # pending|approved|rejected|expired
    decided_at = Column(DateTime, nullable=True)


class EaState(TimestampMixin, Base):
    """Live MT5/EA bridge state per user (heartbeat, quotes, positions)."""

    __tablename__ = "trading_ea_state"

    owner = Column(String, primary_key=True, index=True)
    connected = Column(Boolean, nullable=False, default=False)
    online = Column(Boolean, nullable=False, default=False)
    account_login = Column(String, nullable=True)
    account_server = Column(String, nullable=True)
    balance = Column(Float, nullable=True)
    equity = Column(Float, nullable=True)
    currency = Column(String, nullable=True, default="USD")
    last_heartbeat = Column(DateTime, nullable=True)
    last_quotes = Column(Text, nullable=True)     # JSON: {symbol: {bid, ask, ts}}
    last_positions = Column(Text, nullable=True)  # JSON array of broker positions


# All trading tables, in dependency order (none have FKs between them today).
_TRADING_TABLES = [
    TradingSettings.__table__,
    AdminLimits.__table__,
    BrokerCredential.__table__,
    Trade.__table__,
    Recommendation.__table__,
    Intent.__table__,
    EaState.__table__,
]

_tables_ready = False


def ensure_tables() -> None:
    """Create the trading tables if they don't exist yet.

    ``init_db()`` runs at import time of ``core.database`` — before this
    module is imported — so the trading tables miss that pass. This
    idempotent helper (``create_all`` only creates missing tables) is called
    when the trading layer first loads so the schema is always present.
    """
    global _tables_ready
    if _tables_ready:
        return
    try:
        Base.metadata.create_all(bind=engine, tables=_TRADING_TABLES)
        _tables_ready = True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Trading table creation failed: %s", exc)
