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
from services.trading.execution import (
    ExecutionError,
    open_order,
    proposed_from_args,
    risk_context as _risk_context,
)
from services.trading.models import ensure_tables
from services.trading.risk import compute_reward_risk, evaluate_trade

logger = logging.getLogger(__name__)


def _sanitize_symbol(raw: str | None) -> str:
    s = (raw or "EURUSD").upper().strip()
    import re

    s = re.sub(r"[^A-Z0-9._]", "", s)
    return s or "EURUSD"


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
            "ea": store.ea_connected(owner),
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
        proposed = proposed_from_args(body)
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
        """Evaluate + route a trade. In non-auto modes an unapproved request
        is stored as a pending intent instead of executing."""
        owner = require_user(request)
        proposed = proposed_from_args(body)
        try:
            result = open_order(
                owner, proposed,
                approved=bool(body.get("approved")),
                reason=body.get("reason"),
                raw_payload=body,
            )
        except ExecutionError as exc:
            return JSONResponse({"ok": False, "reason": str(exc)}, status_code=422)
        if not result.get("ok"):
            return JSONResponse(result, status_code=422)
        return result

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
        # On approval, execute the trade from the stored payload (this is the
        # explicit user approval that clears the Risk Guard mode gate).
        trade = None
        error = None
        if approve and row.get("payload"):
            import json

            try:
                payload = json.loads(row["payload"])
                proposed = proposed_from_args(payload)
                # Explicit approval clears the mode gate; force execution.
                result = open_order(owner, proposed, approved=True, reason=payload.get("reason"))
                if not result.get("ok"):
                    error = result.get("reason")
                trade = result.get("trade")
            except ExecutionError as exc:
                error = str(exc)
            except Exception as exc:
                logger.warning("Intent materialize failed: %s", exc)
                error = "تعذّر تنفيذ الصفقة."
        return {"ok": True, "intent": row, "trade": trade, "error": error}

    # ── EA / MT5 live state ───────────────────────────────────────────────────
    @router.get("/ea/state")
    async def ea_state(request: Request):
        owner = require_user(request)
        st = store.get_ea_state(owner)
        st["online"] = store.ea_is_online(st)
        return st

    @router.post("/broker/ea-token")
    async def mint_ea_token(request: Request):
        """Mint a one-time EA bridge token for the user's MetaTrader 5 EA."""
        owner = require_user(request)
        token = store.generate_ea_token(owner)
        return {"token": token, "hint": "أدخل هذا التوكن في EaToken داخل الإكسبيرت. يظهر مرة واحدة."}

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

    # ── Journal / performance / backtest / monitor ────────────────────────────
    @router.get("/journal/stats")
    async def journal_stats(request: Request):
        owner = require_user(request)
        from services.trading.journal import performance_stats

        return performance_stats(owner)

    @router.get("/backtest")
    async def backtest(request: Request, symbol: str = "EURUSD", interval: str = "15m", count: int = 500):
        owner = require_user(request)
        from services.trading.backtest import backtest_symbol

        count = max(120, min(int(count), 5000))
        return await backtest_symbol(owner, _sanitize_symbol(symbol), normalize_interval(interval), count)

    @router.post("/monitor/scan")
    async def monitor_scan(request: Request, body: dict[str, Any] = Body(default={})):
        """Scan a watchlist and create recommendations for directional setups."""
        owner = require_user(request)
        from services.trading.analysis import build_analysis

        symbols = body.get("symbols") or ["EURUSD", "GBPUSD", "XAUUSD", "USDJPY"]
        interval = normalize_interval(body.get("interval") or "15m")
        created = []
        for sym in symbols[:10]:
            a = await build_analysis(owner, _sanitize_symbol(sym), interval)
            if a.get("direction") in ("buy", "sell") and (a.get("confidence") or 0) >= 65:
                rec = store.create_recommendation(owner, {
                    "symbol": a["symbol"], "interval": interval, "side": a["direction"],
                    "entry": a["entry"], "stop_loss": a["stop_loss"], "take_profit": a["take_profit"],
                    "confidence": a["confidence"], "summary": a["verdict"], "reasons": a["reasons"],
                })
                created.append(rec)
        return {"scanned": len(symbols[:10]), "created": created}

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
