"""Native trading routes for Odysseus (Python engine).

Replaces the old AiChart HTTP-bridge embed with first-class endpoints backed
by ``services.trading``. User endpoints are owner-scoped; admin endpoints are
gated by ``require_admin`` and govern the global Risk Guard ceilings + kill
switch.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse

from core.middleware import require_admin
from src.auth_helpers import require_user
from services.trading import market as mk
from services.trading import store
from services.trading.constants import normalize_interval
from services.trading.models import ensure_tables
from services.trading.risk import (
    ProposedTrade,
    RiskContext,
    compute_reward_risk,
    evaluate_trade,
)

logger = logging.getLogger(__name__)


def _sanitize_symbol(raw: str | None) -> str:
    s = (raw or "EURUSD").upper().strip()
    import re

    s = re.sub(r"[^A-Z0-9._]", "", s)
    return s or "EURUSD"


def _risk_context(owner: str, settings: dict[str, Any]) -> RiskContext:
    ea = store.get_ea_state(owner)
    resolved_env = "live" if ea.get("connected") and settings.get("env_preference") == "live" else "demo"
    return RiskContext(
        open_trades_count=store.open_trades_count(owner),
        env_preference=settings.get("env_preference", "demo"),
        resolved_env=resolved_env if ea.get("connected") else None,
    )


def setup_trading_routes() -> APIRouter:
    ensure_tables()
    router = APIRouter(prefix="/api/trading", tags=["trading"])

    # ── Settings ──────────────────────────────────────────────────────────────
    @router.get("/settings")
    async def get_settings(request: Request):
        owner = require_user(request)
        return store.get_settings(owner)

    @router.patch("/settings")
    async def patch_settings(request: Request, patch: dict[str, Any] = Body(...)):
        owner = require_user(request)
        return store.update_settings(owner, patch or {})

    # ── Market data ───────────────────────────────────────────────────────────
    @router.get("/market/snapshot")
    async def market_snapshot(request: Request, symbol: str = "EURUSD", interval: str = "15m"):
        owner = require_user(request)
        return await mk.market_snapshot(owner, _sanitize_symbol(symbol), normalize_interval(interval))

    @router.get("/market/analyze")
    async def analyze(request: Request, symbol: str = "EURUSD", interval: str = "15m"):
        owner = require_user(request)
        from services.trading.analysis import build_analysis

        return await build_analysis(owner, _sanitize_symbol(symbol), normalize_interval(interval))

    @router.get("/market/price")
    async def market_price(request: Request, symbol: str = "EURUSD"):
        owner = require_user(request)
        price = await mk.get_price(owner, _sanitize_symbol(symbol))
        return {"symbol": _sanitize_symbol(symbol), "price": price}

    @router.get("/market/candles")
    async def market_candles(request: Request, symbol: str = "EURUSD", interval: str = "15m", count: int = 200):
        owner = require_user(request)
        client = mk.OandaClient.for_user(owner)
        if not client.configured:
            return {"symbol": _sanitize_symbol(symbol), "candles": [], "configured": False}
        try:
            candles = await client.fetch_candles(_sanitize_symbol(symbol), normalize_interval(interval), count)
        except Exception as exc:
            raise HTTPException(502, f"OANDA error: {exc}")
        return {
            "symbol": _sanitize_symbol(symbol),
            "interval": normalize_interval(interval),
            "candles": [c.__dict__ for c in candles],
            "configured": True,
        }

    @router.get("/instruments")
    async def instruments(request: Request):
        owner = require_user(request)
        client = mk.OandaClient.for_user(owner)
        try:
            return {"instruments": await client.fetch_instruments()}
        except Exception as exc:
            raise HTTPException(502, f"OANDA error: {exc}")

    # ── Broker credentials (OANDA data + MT5 later) ───────────────────────────
    @router.get("/broker/status")
    async def broker_status(request: Request):
        owner = require_user(request)
        return {
            "oanda": store.has_broker_credential(owner, "oanda"),
            "mt5": store.has_broker_credential(owner, "mt5"),
            "ea": store.get_ea_state(owner).get("connected", False),
        }

    @router.post("/broker/oanda")
    async def set_oanda(request: Request, body: dict[str, Any] = Body(...)):
        owner = require_user(request)
        token = (body.get("api_key") or body.get("token") or "").strip()
        if not token:
            raise HTTPException(400, "api_key required")
        store.set_broker_credential(
            owner, "oanda",
            api_key=token,
            account_id=(body.get("account_id") or "").strip() or None,
            env="live" if body.get("env") == "live" else "demo",
        )
        return {"ok": True}

    # ── Portfolio / trades ────────────────────────────────────────────────────
    @router.get("/portfolio")
    async def portfolio(request: Request):
        owner = require_user(request)
        return store.portfolio_summary(owner)

    @router.get("/trades")
    async def trades(request: Request, status: str | None = None):
        owner = require_user(request)
        return {"trades": store.list_trades(owner, status)}

    @router.post("/trades/evaluate")
    async def evaluate(request: Request, body: dict[str, Any] = Body(...)):
        """Run the Risk Guard on a proposed trade WITHOUT executing it."""
        owner = require_user(request)
        settings = store.get_settings(owner)
        limits = store.get_admin_limits()
        proposed = _proposed_from_body(body)
        decision = evaluate_trade(settings, limits, proposed, _risk_context(owner, settings))
        return {
            "ok": decision.ok,
            "reason": decision.reason,
            "per_trade_max": decision.per_trade_max,
            "effective_capital": decision.effective_capital,
            "reward_risk": compute_reward_risk(proposed.entry, proposed.stop_loss, proposed.take_profit),
            "deny_code": decision.deny_code,
        }

    @router.post("/trades/open")
    async def open_trade(request: Request, body: dict[str, Any] = Body(...)):
        """Evaluate + record a trade. In non-auto modes an unapproved request
        is stored as a pending intent instead of executing."""
        owner = require_user(request)
        settings = store.get_settings(owner)
        limits = store.get_admin_limits()
        proposed = _proposed_from_body(body)
        approved = bool(body.get("approved"))
        will_execute = settings.get("mode") == "auto" or approved
        ctx = _risk_context(owner, settings)
        # Check trade QUALITY (mandatory SL, R:R, capital, caps, kill switch)
        # independently of the mode gate — so an approval-mode proposal that is
        # itself unsafe is rejected outright rather than silently queued.
        ctx.explicit_approval = True
        decision = evaluate_trade(settings, limits, proposed, ctx)
        if not decision.ok:
            return JSONResponse(
                {"ok": False, "reason": decision.reason, "deny_code": decision.deny_code},
                status_code=422,
            )
        # Approval-gated modes: queue an intent unless explicitly approved.
        if not will_execute:
            intent = store.create_intent(owner, "open", proposed.symbol, body)
            return {"ok": True, "queued": True, "intent": intent}
        trade = store.record_trade(owner, {
            "symbol": proposed.symbol, "side": proposed.side, "notional": proposed.notional,
            "entry": proposed.entry, "stop_loss": proposed.stop_loss,
            "take_profit": proposed.take_profit, "confidence": proposed.confidence,
            "env": settings.get("env_preference", "demo"), "reason": body.get("reason"),
        })
        return {"ok": True, "queued": False, "trade": trade}

    @router.post("/trades/{trade_id}/close")
    async def close_trade(request: Request, trade_id: str, body: dict[str, Any] = Body(default={})):
        owner = require_user(request)
        exit_price = body.get("exit_price")
        pnl = body.get("pnl")
        row = store.close_trade(owner, trade_id, exit_price, pnl)
        if row is None:
            raise HTTPException(404, "Trade not found")
        return {"ok": True, "trade": row}

    # ── Recommendations ───────────────────────────────────────────────────────
    @router.get("/recommendations")
    async def recommendations(request: Request, status: str | None = "active"):
        owner = require_user(request)
        return {"recommendations": store.list_recommendations(owner, status)}

    @router.post("/recommendations")
    async def create_recommendation(request: Request, body: dict[str, Any] = Body(...)):
        owner = require_user(request)
        if not body.get("symbol"):
            raise HTTPException(400, "symbol required")
        return store.create_recommendation(owner, body)

    # ── Intents (approval flow) ───────────────────────────────────────────────
    @router.get("/intents")
    async def intents(request: Request, status: str = "pending"):
        owner = require_user(request)
        return {"intents": store.list_intents(owner, status)}

    @router.post("/intents/{intent_id}/decide")
    async def decide_intent(request: Request, intent_id: str, body: dict[str, Any] = Body(...)):
        owner = require_user(request)
        approve = bool(body.get("approve"))
        row = store.decide_intent(owner, intent_id, approve)
        if row is None:
            raise HTTPException(404, "Intent not found")
        # On approval, materialize the trade from the stored payload.
        trade = None
        if approve and row.get("payload"):
            import json

            try:
                payload = json.loads(row["payload"])
                proposed = _proposed_from_body(payload)
                trade = store.record_trade(owner, {
                    "symbol": proposed.symbol, "side": proposed.side, "notional": proposed.notional,
                    "entry": proposed.entry, "stop_loss": proposed.stop_loss,
                    "take_profit": proposed.take_profit, "confidence": proposed.confidence,
                    "env": store.get_settings(owner).get("env_preference", "demo"),
                })
            except Exception as exc:
                logger.warning("Intent materialize failed: %s", exc)
        return {"ok": True, "intent": row, "trade": trade}

    # ── EA / MT5 live state ───────────────────────────────────────────────────
    @router.get("/ea/state")
    async def ea_state(request: Request):
        owner = require_user(request)
        return store.get_ea_state(owner)

    @router.get("/risk/status")
    async def risk_status(request: Request):
        owner = require_user(request)
        settings = store.get_settings(owner)
        limits = store.get_admin_limits()
        return {
            "risk_guard_enabled": bool(settings.get("risk_guard_enabled", 1)),
            "kill_switch": bool(limits.get("kill_switch")),
            "can_execute": bool(limits.get("can_execute")),
            "open_trades": store.open_trades_count(owner),
            "max_open_trades": settings.get("max_open_trades"),
            "mode": settings.get("mode"),
            "env_preference": settings.get("env_preference"),
        }

    # ── Admin ─────────────────────────────────────────────────────────────────
    @router.get("/admin/limits")
    async def admin_limits(request: Request):
        require_admin(request)
        return store.get_admin_limits()

    @router.patch("/admin/limits")
    async def patch_admin_limits(request: Request, patch: dict[str, Any] = Body(...)):
        require_admin(request)
        return store.update_admin_limits(patch or {})

    @router.post("/admin/kill-switch")
    async def kill_switch(request: Request, body: dict[str, Any] = Body(...)):
        require_admin(request)
        return store.set_kill_switch(bool(body.get("on")))

    return router


def _proposed_from_body(body: dict[str, Any]) -> ProposedTrade:
    return ProposedTrade(
        symbol=_sanitize_symbol(body.get("symbol")),
        side=(body.get("side") or "buy").lower(),
        notional=float(body.get("notional", 0) or 0),
        confidence=float(body.get("confidence", 0) or 0),
        market=body.get("market"),
        entry=body.get("entry"),
        stop_loss=body.get("stop_loss") if body.get("stop_loss") is not None else body.get("stopLoss"),
        take_profit=body.get("take_profit") if body.get("take_profit") is not None else body.get("takeProfit"),
    )
