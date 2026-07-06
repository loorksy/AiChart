"""Data-access layer for the trading engine.

Thin helpers over the SQLAlchemy models that return plain dicts (so the
risk engine and routes stay decoupled from the ORM). Broker secrets are
encrypted at rest via ``src.secret_storage``.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from core.database import get_db_session

from . import constants as const
from .models import (
    AdminLimits,
    BrokerCredential,
    EaState,
    Intent,
    Recommendation,
    Trade,
    TradingSettings,
    ensure_tables,
)

logger = logging.getLogger(__name__)

# Providers whose credentials we accept.
KNOWN_PROVIDERS = ("oanda", "mt5", "telegram", "anthropic")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _row_to_dict(row: Any, exclude: tuple[str, ...] = ()) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col in row.__table__.columns:
        if col.name in exclude:
            continue
        val = getattr(row, col.name)
        if isinstance(val, datetime):
            val = val.isoformat()
        out[col.name] = val
    return out


# ── Settings ──────────────────────────────────────────────────────────────────
def get_settings(owner: str) -> dict[str, Any]:
    """Return the user's trading settings, creating defaults on first read."""
    ensure_tables()
    with get_db_session() as db:
        row = db.get(TradingSettings, owner)
        if row is None:
            row = TradingSettings(owner=owner, **_default_settings_kwargs())
            db.add(row)
            db.commit()
            db.refresh(row)
        return _row_to_dict(row)


def _default_settings_kwargs() -> dict[str, Any]:
    # Only keys that map to columns (DEFAULT_SETTINGS is column-aligned).
    return dict(const.DEFAULT_SETTINGS)


def update_settings(owner: str, patch: dict[str, Any]) -> dict[str, Any]:
    ensure_tables()
    allowed = {c.name for c in TradingSettings.__table__.columns} - {"owner", "created_at", "updated_at"}
    with get_db_session() as db:
        row = db.get(TradingSettings, owner)
        if row is None:
            row = TradingSettings(owner=owner, **_default_settings_kwargs())
            db.add(row)
        for key, val in patch.items():
            if key == "mode":
                val = const.normalize_trading_mode(val)
            elif key == "trading_style":
                val = const.normalize_trading_style(val)
            elif key == "env_preference":
                val = const.normalize_execution_env(val)
            if key in allowed:
                setattr(row, key, val)
        db.commit()
        db.refresh(row)
        return _row_to_dict(row)


# ── Admin limits (global) ─────────────────────────────────────────────────────
def get_admin_limits() -> dict[str, Any]:
    ensure_tables()
    with get_db_session() as db:
        row = db.get(AdminLimits, "global")
        if row is None:
            row = AdminLimits(id="global", **{
                "can_execute": bool(const.DEFAULT_ADMIN_LIMITS["can_execute"]),
                "max_capital_cap": float(const.DEFAULT_ADMIN_LIMITS["max_capital_cap"]),
                "max_open_trades_cap": int(const.DEFAULT_ADMIN_LIMITS["max_open_trades_cap"]),
                "kill_switch": bool(const.DEFAULT_ADMIN_LIMITS["kill_switch"]),
            })
            db.add(row)
            db.commit()
            db.refresh(row)
        return _row_to_dict(row, exclude=("id",))


def update_admin_limits(patch: dict[str, Any]) -> dict[str, Any]:
    ensure_tables()
    allowed = {"can_execute", "max_capital_cap", "max_open_trades_cap", "kill_switch"}
    with get_db_session() as db:
        row = db.get(AdminLimits, "global")
        if row is None:
            row = AdminLimits(id="global")
            db.add(row)
        for key, val in patch.items():
            if key in allowed:
                setattr(row, key, val)
        db.commit()
        db.refresh(row)
        return _row_to_dict(row, exclude=("id",))


def set_kill_switch(on: bool) -> dict[str, Any]:
    return update_admin_limits({"kill_switch": bool(on)})


# ── Broker credentials (encrypted) ────────────────────────────────────────────
def set_broker_credential(
    owner: str,
    provider: str,
    *,
    api_key: str | None = None,
    secret: str | None = None,
    account_id: str | None = None,
    env: str = "demo",
    meta: dict | None = None,
) -> None:
    """Encrypt and persist credentials for (owner, provider)."""
    from src.secret_storage import encrypt

    ensure_tables()
    cred_id = f"{owner}:{provider}"
    with get_db_session() as db:
        row = db.get(BrokerCredential, cred_id)
        if row is None:
            row = BrokerCredential(id=cred_id, owner=owner, provider=provider)
            db.add(row)
        if api_key is not None:
            row.api_key_enc = encrypt(api_key) if api_key else None
        if secret is not None:
            row.secret_enc = encrypt(secret) if secret else None
        if account_id is not None:
            row.account_id = account_id
        row.env = const.normalize_execution_env(env)
        if meta is not None:
            row.meta = json.dumps(meta)
        db.commit()


def get_broker_credential(owner: str, provider: str) -> dict[str, Any] | None:
    """Return decrypted credentials for (owner, provider), or None."""
    from src.secret_storage import decrypt

    ensure_tables()
    with get_db_session() as db:
        row = db.get(BrokerCredential, f"{owner}:{provider}")
        if row is None:
            return None
        return {
            "provider": row.provider,
            "account_id": row.account_id,
            "api_key": decrypt(row.api_key_enc) if row.api_key_enc else None,
            "secret": decrypt(row.secret_enc) if row.secret_enc else None,
            "env": row.env,
            "meta": json.loads(row.meta) if row.meta else {},
        }


def has_broker_credential(owner: str, provider: str) -> bool:
    ensure_tables()
    with get_db_session() as db:
        row = db.get(BrokerCredential, f"{owner}:{provider}")
        return bool(row and (row.api_key_enc or row.secret_enc))


# ── Trades / portfolio ────────────────────────────────────────────────────────
def list_trades(owner: str, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    ensure_tables()
    with get_db_session() as db:
        q = db.query(Trade).filter(Trade.owner == owner)
        if status:
            q = q.filter(Trade.status == status)
        q = q.order_by(Trade.created_at.desc()).limit(limit)
        return [_row_to_dict(r) for r in q.all()]


def open_trades_count(owner: str) -> int:
    ensure_tables()
    with get_db_session() as db:
        return db.query(Trade).filter(Trade.owner == owner, Trade.status == "open").count()


def record_trade(owner: str, data: dict[str, Any]) -> dict[str, Any]:
    import uuid

    ensure_tables()
    with get_db_session() as db:
        row = Trade(
            id=data.get("id") or uuid.uuid4().hex,
            owner=owner,
            symbol=data["symbol"],
            side=data["side"],
            notional=float(data.get("notional", 0) or 0),
            volume=data.get("volume"),
            entry=data.get("entry"),
            stop_loss=data.get("stop_loss"),
            take_profit=data.get("take_profit"),
            status=data.get("status", "open"),
            env=const.normalize_execution_env(data.get("env", "demo")),
            broker_ticket=data.get("broker_ticket"),
            confidence=data.get("confidence"),
            reason=data.get("reason"),
            opened_at=_now(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _row_to_dict(row)


def close_trade(owner: str, trade_id: str, exit_price: float | None, pnl: float | None) -> dict[str, Any] | None:
    ensure_tables()
    with get_db_session() as db:
        row = db.get(Trade, trade_id)
        if row is None or row.owner != owner:
            return None
        row.status = "closed"
        row.exit_price = exit_price
        row.pnl = pnl
        row.closed_at = _now()
        db.commit()
        db.refresh(row)
        return _row_to_dict(row)


def portfolio_summary(owner: str) -> dict[str, Any]:
    ensure_tables()
    with get_db_session() as db:
        rows = db.query(Trade).filter(Trade.owner == owner).all()
        # Materialize everything inside the session — attributes expire on
        # commit/close, so any access after the `with` block would detach-error.
        open_rows = [_row_to_dict(r) for r in rows if r.status == "open"]
        closed = [r for r in rows if r.status == "closed"]
        realized = sum((r.pnl or 0.0) for r in closed)
        closed_count = len(closed)
    return {
        "open_count": len(open_rows),
        "closed_count": closed_count,
        "realized_pnl": realized,
        "open_trades": open_rows,
    }


# ── Recommendations ───────────────────────────────────────────────────────────
def create_recommendation(owner: str, data: dict[str, Any]) -> dict[str, Any]:
    import uuid

    from .risk import compute_reward_risk

    ensure_tables()
    rr = compute_reward_risk(data.get("entry"), data.get("stop_loss"), data.get("take_profit"))
    with get_db_session() as db:
        row = Recommendation(
            id=data.get("id") or uuid.uuid4().hex,
            owner=owner,
            symbol=data["symbol"],
            interval=const.normalize_interval(data.get("interval")),
            side=data.get("side"),
            entry=data.get("entry"),
            stop_loss=data.get("stop_loss"),
            take_profit=data.get("take_profit"),
            confidence=data.get("confidence"),
            reward_risk=rr,
            summary=data.get("summary"),
            reasons=json.dumps(data.get("reasons") or []),
            status="active",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _row_to_dict(row)


def list_recommendations(owner: str, status: str | None = "active", limit: int = 50) -> list[dict[str, Any]]:
    ensure_tables()
    with get_db_session() as db:
        q = db.query(Recommendation).filter(Recommendation.owner == owner)
        if status:
            q = q.filter(Recommendation.status == status)
        q = q.order_by(Recommendation.created_at.desc()).limit(limit)
        return [_row_to_dict(r) for r in q.all()]


# ── Intents (approval flow) ───────────────────────────────────────────────────
def create_intent(owner: str, kind: str, symbol: str, payload: dict[str, Any]) -> dict[str, Any]:
    import uuid

    ensure_tables()
    with get_db_session() as db:
        row = Intent(
            id=uuid.uuid4().hex,
            owner=owner,
            kind=kind,
            symbol=symbol,
            payload=json.dumps(payload),
            status="pending",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _row_to_dict(row)


def list_intents(owner: str, status: str = "pending", limit: int = 50) -> list[dict[str, Any]]:
    ensure_tables()
    with get_db_session() as db:
        q = db.query(Intent).filter(Intent.owner == owner)
        if status:
            q = q.filter(Intent.status == status)
        q = q.order_by(Intent.created_at.desc()).limit(limit)
        return [_row_to_dict(r) for r in q.all()]


def decide_intent(owner: str, intent_id: str, approve: bool) -> dict[str, Any] | None:
    ensure_tables()
    with get_db_session() as db:
        row = db.get(Intent, intent_id)
        if row is None or row.owner != owner:
            return None
        row.status = "approved" if approve else "rejected"
        row.decided_at = _now()
        db.commit()
        db.refresh(row)
        return _row_to_dict(row)


# ── EA / MT5 live state ───────────────────────────────────────────────────────
def get_ea_state(owner: str) -> dict[str, Any]:
    ensure_tables()
    with get_db_session() as db:
        row = db.get(EaState, owner)
        if row is None:
            return {"owner": owner, "connected": False, "online": False}
        data = _row_to_dict(row)
        for key in ("last_quotes", "last_positions"):
            if data.get(key):
                try:
                    data[key] = json.loads(data[key])
                except (json.JSONDecodeError, TypeError):
                    pass
        return data


def update_ea_state(owner: str, patch: dict[str, Any]) -> dict[str, Any]:
    ensure_tables()
    json_fields = {"last_quotes", "last_positions"}
    allowed = {c.name for c in EaState.__table__.columns} - {"owner", "created_at", "updated_at"}
    with get_db_session() as db:
        row = db.get(EaState, owner)
        if row is None:
            row = EaState(owner=owner)
            db.add(row)
        for key, val in patch.items():
            if key not in allowed:
                continue
            if key in json_fields and not isinstance(val, str):
                val = json.dumps(val)
            setattr(row, key, val)
        db.commit()
        db.refresh(row)
        return _row_to_dict(row)
