"""Native trading tools for the Odysseus agent.

These call the in-tree Python trading engine (``services.trading``) directly —
no external AiChart bridge. Each tool keeps the registry ``execute(content,
ctx)`` contract and returns ``(description, result_dict)``. ``ctx['owner']`` is
the Odysseus username used to scope all trading data.

Execution safety: order tools route through the shared Risk Guard
(``services.trading.execution``); the LLM cannot bypass a mandatory stop, the
R:R floor, the caps, or the kill switch.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_MODE_ALIASES = {
    "manual": "direct", "semi_auto": "approval", "full_auto": "auto",
    "direct": "direct", "approval": "approval", "auto": "auto",
}
_MODE_LABELS = {"direct": "يدوي", "approval": "نصف آلي", "auto": "آلي كامل"}


def _args(content: str) -> dict[str, Any]:
    raw = (content or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def _owner(ctx: dict[str, Any] | None) -> str:
    return str((ctx or {}).get("owner") or "").strip()


def _symbol(raw: Any) -> str:
    s = re.sub(r"[^A-Z0-9._]", "", str(raw or "EURUSD").upper().strip())
    return s or "EURUSD"


def _ok(payload: Any, summary: str) -> dict[str, Any]:
    return {"output": summary, "exit_code": 0, "data": payload}


def _err(message: str) -> dict[str, Any]:
    return {"error": message, "exit_code": 1}


def _interval(raw: Any) -> str:
    from services.trading.constants import normalize_interval

    return normalize_interval(str(raw or "15m"))


class OpenChartTool:
    """Open a chart for a symbol in the trading workspace conversation."""

    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _args(content)
        symbol, interval = _symbol(args.get("symbol")), _interval(args.get("interval"))
        workspace = {"symbol": symbol, "interval": interval, "source": "oanda",
                     "sessionId": (ctx or {}).get("session_id")}
        return f"open_chart: {symbol} {interval}", {
            "output": f"فتحتُ شارت {symbol} ({interval}) من OANDA في مساحة التداول.",
            "exit_code": 0, "trading_workspace": workspace,
        }


class AnalyzeMarketTool:
    """Deterministic verdict card (regime/momentum/structure → entry/SL/TP)."""

    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading.analysis import build_analysis

        args = _args(content)
        symbol, interval = _symbol(args.get("symbol")), _interval(args.get("interval"))
        owner = _owner(ctx)
        a = await build_analysis(owner, symbol, interval)
        parts = [f"{symbol} {interval}: {a['verdict']}"]
        if a.get("entry"):
            parts.append(f"دخول {a['entry']:g} · وقف {a['stop_loss']:g} · هدف {a['take_profit']:g} · R:R {a['reward_risk']}")
        reasons = "· ".join(a.get("reasons", [])[:3])
        if reasons:
            parts.append(reasons)
        result = _ok(a, " — ".join(parts))
        if a.get("direction") in ("buy", "sell"):
            result["trading_workspace"] = {
                "symbol": symbol, "interval": interval, "source": "oanda",
                "sessionId": (ctx or {}).get("session_id"),
                "levels": {"entry": a.get("entry"), "stop_loss": a.get("stop_loss"), "take_profit": a.get("take_profit")},
            }
        return f"analyze_market: {symbol} {interval}", result


class GetCandlesTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading.market import OandaClient

        args = _args(content)
        symbol, interval = _symbol(args.get("symbol")), _interval(args.get("interval"))
        count = int(args.get("count") or args.get("limit") or 200)
        client = OandaClient.for_user(_owner(ctx))
        if not client.configured:
            return "get_candles", _err("OANDA غير مُهيّأ — أضف مفتاح OANDA في الإعدادات.")
        try:
            candles = await client.fetch_candles(symbol, interval, count)
        except Exception as exc:
            return "get_candles", _err(f"تعذّر جلب الشموع: {exc}")
        last = candles[-1] if candles else None
        summary = f"{symbol} {interval}: {len(candles)} شمعة" + (f"، آخر إغلاق {last.close:g}" if last else "")
        return f"get_candles: {symbol} {interval}", _ok(
            {"symbol": symbol, "interval": interval, "candles": [c.__dict__ for c in candles[-50:]]}, summary)


class GetOandaInstrumentsTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading.market import OandaClient

        args = _args(content)
        q = str(args.get("q") or args.get("search") or "").upper().strip()
        client = OandaClient.for_user(_owner(ctx))
        if not client.configured:
            return "get_oanda_instruments", _err("OANDA غير مُهيّأ.")
        try:
            items = await client.fetch_instruments()
        except Exception as exc:
            return "get_oanda_instruments", _err(f"تعذّر جلب الأدوات: {exc}")
        if q:
            items = [i for i in items if q in i["symbol"]]
        return "get_oanda_instruments", _ok(
            {"instruments": items}, f"{len(items)} أداة متاحة من OANDA.")


class CreateRecommendationTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading import store

        args = _args(content)
        if not args.get("symbol"):
            return "create_recommendation", _err("`symbol` مطلوب.")
        owner = _owner(ctx)
        rec = store.create_recommendation(owner, {
            "symbol": _symbol(args.get("symbol")),
            "interval": _interval(args.get("interval") or args.get("timeframe")),
            "side": args.get("side") or args.get("action"),
            "entry": args.get("entry"), "stop_loss": args.get("stop_loss") or args.get("stopLoss"),
            "take_profit": args.get("take_profit") or args.get("takeProfit"),
            "confidence": args.get("confidence"),
            "summary": args.get("summary") or args.get("rationale"),
            "reasons": args.get("reasons") or [],
        })
        return f"create_recommendation: {rec['symbol']}", _ok(
            rec, f"سجّلت توصية {rec['symbol']} (R:R {rec.get('reward_risk')}).")


class ExecuteMt5OrderTool:
    """Route a trade through the Risk Guard to MT5 (live) or paper (demo)."""

    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading.execution import ExecutionError, open_order, proposed_from_args

        args = _args(content)
        owner = _owner(ctx)
        proposed = proposed_from_args(args)
        approved = bool(args.get("approved_by_user") or args.get("approved"))
        try:
            result = open_order(owner, proposed, approved=approved, reason=args.get("rationale") or args.get("reason"))
        except ExecutionError as exc:
            return "execute_mt5_order", _err(str(exc))
        if not result.get("ok"):
            return "execute_mt5_order", _err(result.get("reason") or "رُفض من Risk Guard.")
        if result.get("queued"):
            return "execute_mt5_order", _ok(result, "أُدرجت الصفقة للموافقة (نصف آلي).")
        routed = result.get("routed")
        msg = "أرسلت الأمر إلى MT5 (بانتظار تأكيد الجسر)." if routed == "mt5" else "سُجّلت صفقة تجريبية (paper)."
        return f"execute_mt5_order: {proposed.symbol} {proposed.side}", _ok(result, msg)


class GetMt5StatusTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading import store

        owner = _owner(ctx)
        st = store.get_ea_state(owner)
        online = store.ea_is_online(st)
        summary = (
            f"جسر MT5: {'متصل' if online else 'غير متصل'}"
            + (f" · الحساب {st.get('account_login')} · الرصيد {st.get('balance')}" if online else "")
        )
        return "get_mt5_status", _ok({**st, "online": online}, summary)


class GetRiskSettingsTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading import store

        owner = _owner(ctx)
        s = store.get_settings(owner)
        limits = store.get_admin_limits()
        summary = (
            f"الوضع {_MODE_LABELS.get(s.get('mode'), s.get('mode'))} · البيئة {s.get('env_preference')} · "
            f"مخاطرة/صفقة {s.get('per_trade_pct')}% · أقصى مفتوحة {s.get('max_open_trades')} · "
            f"Kill switch: {'مفعّل' if limits.get('kill_switch') else 'لا'}"
        )
        return "get_risk_settings", _ok({"settings": s, "limits": limits}, summary)


class EmergencyStopTool:
    """Per-user emergency stop: drop the agent to analyze-only (no execution)."""

    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading import store

        args = _args(content)
        enabled = args.get("enabled", True)
        if isinstance(enabled, str):
            enabled = enabled.lower() not in ("0", "false", "off", "no")
        owner = _owner(ctx)
        if enabled:
            store.update_settings(owner, {"mode": "direct", "risk_guard_enabled": 1})
            return "emergency_stop", _ok({"stopped": True}, "⛔ إيقاف طارئ — الوكيل في وضع التحليل فقط، لا تنفيذ.")
        return "emergency_stop", _ok({"stopped": False}, "أُلغي الإيقاف الطارئ.")


class SetTradingModeTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        from services.trading import store

        args = _args(content)
        raw = args.get("mode") or args.get("alias") or args.get("trading_mode")
        mode = _MODE_ALIASES.get(str(raw or "").strip().lower())
        if not mode:
            return "set_trading_mode", _err("mode يجب أن يكون manual/semi_auto/full_auto.")
        s = store.update_settings(_owner(ctx), {"mode": mode})
        return f"set_trading_mode: {mode}", _ok({"settings": s}, f"وضع التداول: {_MODE_LABELS[mode]}.")
