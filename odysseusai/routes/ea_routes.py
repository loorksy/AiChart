"""MT5/EA bridge endpoints (token-authenticated).

The user's MetaTrader 5 Expert Advisor talks to these endpoints with its own
bearer token (``ea_…``) — NOT a session cookie — so they live under the
auth-exempt ``/api/ea-bridge`` prefix and authenticate via
``store.resolve_owner_by_ea_token``. Protocol mirrors the AiChart EA v4
contract: heartbeat carries account/positions/symbols; the EA polls
``/commands`` and acks results.

Execution safety: this bridge only *relays* commands the platform already
approved through the Risk Guard. It never originates a trade.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException, Request

from services.trading import store
from services.trading.models import ensure_tables

logger = logging.getLogger(__name__)


def _auth(request: Request, authorization: str | None, x_ea_token: str | None) -> str:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_ea_token:
        token = x_ea_token.strip()
    owner = store.resolve_owner_by_ea_token(token) if token else None
    # owner may legitimately be "" in single-user/AUTH_ENABLED=false mode; only
    # a None result means "no matching token".
    if owner is None:
        raise HTTPException(401, "Invalid or missing EA token")
    return owner


def setup_ea_routes() -> APIRouter:
    ensure_tables()
    router = APIRouter(prefix="/api/ea-bridge", tags=["ea-bridge"])

    @router.post("/heartbeat")
    async def heartbeat(
        request: Request,
        body: dict[str, Any] = Body(...),
        authorization: str | None = Header(default=None),
        x_ea_token: str | None = Header(default=None),
    ):
        owner = _auth(request, authorization, x_ea_token)
        account = body.get("account") or {}
        symbols = body.get("symbols") or []
        positions = body.get("positions") or []

        quotes = {
            s["symbol"]: {"bid": s.get("bid"), "ask": s.get("ask"), "ts": _iso()}
            for s in symbols if isinstance(s, dict) and s.get("symbol")
        }
        patch = {
            "connected": True,
            "online": True,
            "last_heartbeat": _iso(),
            "account_login": str(account.get("login") or "") or None,
            "account_server": account.get("broker") or account.get("server"),
            "trade_mode": account.get("trade_mode"),
            "balance": account.get("balance"),
            "equity": account.get("equity"),
            "currency": account.get("currency") or "USD",
            "last_quotes": quotes,
            "last_positions": positions,
            "symbol_specs": symbols,
        }
        store.update_ea_state(owner, patch)

        limits = store.get_admin_limits()
        return {
            "ok": True,
            "server_time": _iso(),
            "flags": {
                "kill_switch": bool(limits.get("kill_switch")),
                "close_open_trades": bool(limits.get("kill_switch")),
            },
            "commands": store.list_pending_commands(owner, mark_sent=True),
        }

    @router.post("/quotes")
    async def quotes(
        request: Request,
        body: dict[str, Any] = Body(...),
        authorization: str | None = Header(default=None),
        x_ea_token: str | None = Header(default=None),
    ):
        """Intraday tick flush from the EA (best-effort; updates live quotes)."""
        owner = _auth(request, authorization, x_ea_token)
        symbols = body.get("symbols") or body.get("quotes") or []
        if isinstance(symbols, list) and symbols:
            quotes = {
                s["symbol"]: {"bid": s.get("bid"), "ask": s.get("ask"), "ts": _iso()}
                for s in symbols if isinstance(s, dict) and s.get("symbol")
            }
            if quotes:
                store.update_ea_state(owner, {"last_quotes": quotes, "last_heartbeat": _iso()})
        return {"ok": True}

    @router.post("/event")
    async def event(
        request: Request,
        body: dict[str, Any] = Body(default={}),
        authorization: str | None = Header(default=None),
        x_ea_token: str | None = Header(default=None),
    ):
        """Trade-event notification from the EA (accepted; no-op ack)."""
        _auth(request, authorization, x_ea_token)
        return {"ok": True}

    @router.get("/commands")
    async def commands(
        request: Request,
        authorization: str | None = Header(default=None),
        x_ea_token: str | None = Header(default=None),
    ):
        owner = _auth(request, authorization, x_ea_token)
        return {"commands": store.list_pending_commands(owner, mark_sent=True)}

    @router.post("/commands/{command_id}/ack")
    async def ack(
        request: Request,
        command_id: str,
        body: dict[str, Any] = Body(default={}),
        authorization: str | None = Header(default=None),
        x_ea_token: str | None = Header(default=None),
    ):
        owner = _auth(request, authorization, x_ea_token)
        status = (body.get("status") or "acked").lower()
        result = body.get("result") or {}
        out = store.ack_command(owner, command_id, status, result)
        if out is None:
            raise HTTPException(404, "Command not found")
        return out

    return router


def _iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
