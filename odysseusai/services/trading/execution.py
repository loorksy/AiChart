"""Shared trade-execution logic used by both the HTTP routes and the agent
tools, so the Risk Guard and MT5/paper routing live in exactly one place.

Flow: quality gate (Risk Guard) → mode gate (auto vs approval/direct) →
route to the MT5 bridge (live, requires an online EA + resolvable symbol) or
record a paper trade (demo). Non-auto proposals without explicit approval are
queued as pending intents.
"""

from __future__ import annotations

import logging
from typing import Any

from . import store
from .mt5map import resolve_mt5_symbol
from .risk import ProposedTrade, RiskContext, evaluate_trade

logger = logging.getLogger(__name__)


class ExecutionError(Exception):
    """A safe, user-facing reason a trade could not be routed to execution."""


def risk_context(owner: str, settings: dict[str, Any]) -> RiskContext:
    connected = store.ea_connected(owner)
    return RiskContext(
        open_trades_count=store.open_trades_count(owner),
        env_preference=settings.get("env_preference", "demo"),
        resolved_env=("live" if settings.get("env_preference") == "live" else "demo") if connected else None,
    )


def notional_to_lots(notional: float) -> float:
    """Rough USD-risk → lots for forex majors (0.01 lot per $10), floored at
    the 0.01 micro-lot minimum. The broker validates final sizing."""
    try:
        return round(max(0.01, float(notional) / 10.0 * 0.01), 2)
    except (TypeError, ValueError):
        return 0.01


def open_order(
    owner: str,
    proposed: ProposedTrade,
    *,
    approved: bool = False,
    reason: str | None = None,
    raw_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate + route a proposed trade. Returns a result dict:
      {ok, queued, trade?, command?, intent?, routed?, reason?}

    Raises nothing for a clean risk denial — returns ok=False with a reason.
    """
    settings = store.get_settings(owner)
    limits = store.get_admin_limits()
    will_execute = settings.get("mode") == "auto" or approved

    # Trade QUALITY gate (mandatory SL, R:R, capital, caps, kill switch),
    # checked independently of the mode gate.
    ctx = risk_context(owner, settings)
    ctx.explicit_approval = True
    decision = evaluate_trade(settings, limits, proposed, ctx)
    if not decision.ok:
        return {"ok": False, "reason": decision.reason, "deny_code": decision.deny_code}

    if not will_execute:
        intent = store.create_intent(owner, "open", proposed.symbol, raw_payload or _payload(proposed, reason))
        return {"ok": True, "queued": True, "intent": intent}

    result = _route(owner, settings, proposed, reason)
    result.update({"ok": True, "queued": False})
    return result


def _route(owner: str, settings: dict[str, Any], proposed: ProposedTrade, reason: str | None) -> dict[str, Any]:
    env = settings.get("env_preference", "demo")
    lots = notional_to_lots(proposed.notional)
    common = {
        "symbol": proposed.symbol, "side": proposed.side, "notional": proposed.notional,
        "entry": proposed.entry, "stop_loss": proposed.stop_loss,
        "take_profit": proposed.take_profit, "confidence": proposed.confidence,
        "reason": reason, "volume": lots,
    }
    if env == "live":
        if not store.ea_connected(owner):
            raise ExecutionError("جسر MT5 غير متصل — لا تنفيذ حقيقي بدون جسر متصل.")
        ea_symbols = store.ea_symbol_list(owner)
        broker_symbol = resolve_mt5_symbol(ea_symbols, proposed.symbol) if ea_symbols else None
        if not broker_symbol:
            raise ExecutionError(f"الرمز {proposed.symbol} غير متاح لدى وسيط MT5 المتصل.")
        trade = store.record_trade(owner, {**common, "env": "live", "status": "pending"})
        payload = {
            "symbol": broker_symbol, "side": proposed.side, "lots": lots,
            "stop_loss": proposed.stop_loss, "take_profit": proposed.take_profit,
        }
        command = store.create_ea_command(owner, "open_position", payload, trade_id=trade["id"])
        command["payload"] = payload
        return {"trade": trade, "command": command, "routed": "mt5"}
    trade = store.record_trade(owner, {**common, "env": "demo"})
    return {"trade": trade, "routed": "paper"}


def _payload(proposed: ProposedTrade, reason: str | None) -> dict[str, Any]:
    return {
        "symbol": proposed.symbol, "side": proposed.side, "notional": proposed.notional,
        "entry": proposed.entry, "stopLoss": proposed.stop_loss, "takeProfit": proposed.take_profit,
        "confidence": proposed.confidence, "reason": reason,
    }


def proposed_from_args(args: dict[str, Any]) -> ProposedTrade:
    import re

    sym = (args.get("symbol") or "EURUSD").upper().strip()
    sym = re.sub(r"[^A-Z0-9._]", "", sym) or "EURUSD"
    return ProposedTrade(
        symbol=sym,
        side=(args.get("side") or "buy").lower(),
        notional=float(args.get("notional") or args.get("size") or 0) or 0.0,
        confidence=float(args.get("confidence") or 0) or 0.0,
        market=args.get("market"),
        entry=_num(args.get("entry")),
        stop_loss=_num(args.get("stop_loss") if args.get("stop_loss") is not None else args.get("stopLoss")),
        take_profit=_num(args.get("take_profit") if args.get("take_profit") is not None else args.get("takeProfit")),
    )


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
