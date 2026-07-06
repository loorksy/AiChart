"""AiChart trading tools — chart embed + bridge proxies for Odysseus chat."""
from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx

from services.aichart_bridge import (
    aichart_base_url,
    aichart_service_token,
    bridge_headers,
    proxy_agent_request,
    sanitize_interval,
    sanitize_source,
    sanitize_symbol,
)

logger = logging.getLogger(__name__)

_MODE_ALIASES = {
    "manual": "direct",
    "semi_auto": "approval",
    "full_auto": "auto",
    "direct": "direct",
    "approval": "approval",
    "auto": "auto",
}


def _parse_args(content: str) -> dict[str, Any]:
    raw = (content or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def _owner_email(ctx: dict[str, Any] | None) -> str:
    return str((ctx or {}).get("owner") or "").strip()


def _bridge_error(message: str, *, bridge: Any = None) -> dict[str, Any]:
    out: dict[str, Any] = {"error": message, "exit_code": 1}
    if bridge is not None:
        out["bridge"] = bridge
    return out


def _bridge_ok(payload: Any, *, summary: str | None = None) -> dict[str, Any]:
    text = summary
    if text is None:
        try:
            text = json.dumps(payload, ensure_ascii=False)[:8000]
        except (TypeError, ValueError):
            text = str(payload)[:8000]
    return {"output": text, "exit_code": 0, "bridge": payload}


async def _proxy(
    email: str,
    method: str,
    path: str,
    *,
    query: dict[str, str] | None = None,
    body: Any | None = None,
) -> dict[str, Any]:
    if not email:
        return _bridge_error(
            "Sign in required — AiChart bridge needs your Odysseus account email "
            "to match an AiChart user."
        )
    if not aichart_service_token():
        return _bridge_error("AICHART_SERVICE_TOKEN is not configured on the server.")
    status, payload = await proxy_agent_request(
        method,
        path,
        email,
        query=query,
        json_body=body,
    )
    if status >= 400:
        err = payload.get("error") if isinstance(payload, dict) else None
        msg = err or payload.get("message") if isinstance(payload, dict) else str(payload)
        return _bridge_error(msg or f"AiChart bridge error ({status})", bridge=payload)
    return _bridge_ok(payload)


class OpenChartTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        symbol = sanitize_symbol(args.get("symbol"))
        interval = sanitize_interval(args.get("interval"))
        source = sanitize_source(args.get("source"))
        session_id = (
            (ctx or {}).get("session_id")
            or args.get("sessionId")
            or args.get("session_id")
        )
        workspace: dict[str, Any] = {
            "symbol": symbol,
            "interval": interval,
            "source": source,
            "sessionId": session_id,
        }
        for key in ("layoutId", "layout_id", "recommendationId", "recommendation_id"):
            if args.get(key) is not None:
                out_key = "layoutId" if "layout" in key else "recommendationId"
                workspace[out_key] = args[key]
        if args.get("tradeProposal"):
            workspace["tradeProposal"] = args["tradeProposal"]
        if args.get("tradingMode"):
            workspace["tradingMode"] = args["tradingMode"]
        desc = f"open_chart: {symbol} {interval}"
        return desc, {
            "aichart_workspace": workspace,
            "output": f"Opened embedded chart for {symbol} ({interval}, {source}).",
            "exit_code": 0,
        }


class AnalyzeMarketTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        body = {
            "symbol": sanitize_symbol(args.get("symbol")),
            "interval": sanitize_interval(args.get("interval")),
            "market": "forex",
            "data_source": sanitize_source(args.get("source") or args.get("data_source")),
        }
        if args.get("layout_id") or args.get("layoutId"):
            body["layout_id"] = args.get("layout_id") or args.get("layoutId")
        email = _owner_email(ctx)
        desc = f"analyze_market: {body['symbol']} {body['interval']}"
        result = await _proxy(email, "POST", "market/analyze", body=body)
        if result.get("exit_code") == 0 and isinstance(result.get("bridge"), dict):
            bridge = result["bridge"]
            layout_id = bridge.get("layoutId") or bridge.get("layout_id")
            rec = bridge.get("recommendation") or {}
            if layout_id or rec:
                workspace: dict[str, Any] = {
                    "symbol": body["symbol"],
                    "interval": body["interval"],
                    "source": body["data_source"],
                    "sessionId": (ctx or {}).get("session_id"),
                }
                if layout_id:
                    workspace["layoutId"] = layout_id
                if rec:
                    workspace["tradeProposal"] = {
                        "symbol": rec.get("symbol") or body["symbol"],
                        "side": rec.get("action") or rec.get("side") or "buy",
                        "entry": rec.get("entry"),
                        "stop_loss": rec.get("stop_loss"),
                        "take_profit": rec.get("take_profit"),
                        "notional": rec.get("notional"),
                    }
                result["aichart_workspace"] = workspace
        return desc, result


class CreateRecommendationTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        if not args.get("rationale"):
            return "create_recommendation: invalid", _bridge_error("`rationale` is required.")
        body = dict(args)
        body["symbol"] = sanitize_symbol(args.get("symbol"))
        email = _owner_email(ctx)
        desc = f"create_recommendation: {body['symbol']}"
        result = await _proxy(email, "POST", "recommendation", body=body)
        if result.get("exit_code") == 0 and isinstance(result.get("bridge"), dict):
            bridge = result["bridge"]
            rec = bridge.get("recommendation") or bridge
            workspace = {
                "symbol": rec.get("symbol") or body["symbol"],
                "interval": sanitize_interval(args.get("timeframe") or args.get("interval")),
                "source": sanitize_source(args.get("source")),
                "sessionId": (ctx or {}).get("session_id"),
                "tradeProposal": {
                    "symbol": rec.get("symbol") or body["symbol"],
                    "side": rec.get("action") or args.get("action") or "buy",
                    "entry": rec.get("entry"),
                    "stop_loss": rec.get("stop_loss"),
                    "take_profit": rec.get("take_profit"),
                },
            }
            if rec.get("id") is not None:
                workspace["recommendationId"] = rec["id"]
            result["aichart_workspace"] = workspace
        return desc, result


class ExecuteMt5OrderTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        body = {
            "symbol": sanitize_symbol(args.get("symbol")),
            "side": args.get("side") or "buy",
            "market": "forex",
            "stop_loss": args.get("stop_loss") or args.get("stopLoss"),
            "take_profit": args.get("take_profit") or args.get("takeProfit"),
            "notional": args.get("notional") or args.get("size"),
            "lots": args.get("lots"),
            "entry": args.get("entry"),
            "confidence": args.get("confidence", 0),
            "rationale": args.get("rationale"),
            "recommendation_id": args.get("recommendation_id") or args.get("recommendationId"),
            "approved_by_user": bool(args.get("approved_by_user")),
        }
        body = {k: v for k, v in body.items() if v is not None}
        email = _owner_email(ctx)
        desc = f"execute_mt5_order: {body['symbol']} {body['side']}"
        return desc, await _proxy(email, "POST", "trade/open", body=body)


class GetMt5StatusTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        email = _owner_email(ctx)
        return "get_mt5_status", await _proxy(email, "GET", "ea/diagnostics")


class GetRiskSettingsTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        email = _owner_email(ctx)
        return "get_risk_settings", await _proxy(email, "GET", "risk/status")


class EmergencyStopTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        enabled = args.get("enabled", True)
        if isinstance(enabled, str):
            enabled = enabled.lower() not in ("0", "false", "off", "no")
        email = _owner_email(ctx)
        return "emergency_stop", await _proxy(
            email,
            "POST",
            "risk/kill-switch",
            body={"enabled": bool(enabled)},
        )


class SetTradingModeTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        raw = args.get("mode") or args.get("alias") or args.get("trading_mode")
        mode = _MODE_ALIASES.get(str(raw or "").strip().lower())
        if not mode:
            return "set_trading_mode: invalid", _bridge_error(
                "mode must be manual, semi_auto, full_auto, direct, approval, or auto."
            )
        email = _owner_email(ctx)
        return f"set_trading_mode: {mode}", await _proxy(
            email,
            "POST",
            "mode",
            body={"mode": mode},
        )


class GetCandlesTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        query = {
            "symbol": sanitize_symbol(args.get("symbol")),
            "interval": sanitize_interval(args.get("interval")),
            "market": "forex",
        }
        source = args.get("source") or args.get("data_source")
        if source:
            query["data_source"] = sanitize_source(source)
        email = _owner_email(ctx)
        desc = f"get_candles: {query['symbol']} {query['interval']}"
        return desc, await _proxy(email, "GET", "market/ohlc", query=query)


class GetOandaInstrumentsTool:
    async def execute(self, content: str, ctx: dict[str, Any] | None):
        args = _parse_args(content)
        q = str(args.get("q") or args.get("search") or "").strip()
        query: dict[str, str] = {"wrapped": "1"}
        if q:
            query["q"] = q
        email = _owner_email(ctx)
        url = urljoin(aichart_base_url() + "/", f"api/instruments?{urlencode(query)}")
        if not aichart_service_token():
            return "get_oanda_instruments", _bridge_error("AICHART_SERVICE_TOKEN is not configured.")
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(url, headers=bridge_headers(email or None))
                payload = res.json()
                if res.status_code >= 400:
                    err = payload.get("error") if isinstance(payload, dict) else res.text
                    return "get_oanda_instruments", _bridge_error(err or f"HTTP {res.status_code}", bridge=payload)
                return "get_oanda_instruments", _bridge_ok(payload)
        except Exception as exc:
            logger.warning("get_oanda_instruments failed: %s", exc)
            return "get_oanda_instruments", _bridge_error("Could not fetch instruments from AiChart.")
