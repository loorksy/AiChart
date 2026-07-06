"""AiChart integration routes for Odysseus.

Odysseus is the primary application. These routes only expose chart embed URLs,
manifest discovery, and allow-listed proxying to AiChart. All execution remains
inside AiChart and its Risk Guard / MT5 bridge.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from services.aichart_bridge import (
    assert_agent_path_allowed,
    build_chart_embed_url,
    fetch_manifest,
    proxy_get,
    proxy_post,
)


def _fallback_manifest() -> dict[str, Any]:
    return {
        "name": "AiChart Trading Workspace",
        "defaultChart": {
            "symbol": "EURUSD",
            "interval": "15m",
            "source": "oanda",
            "embedUrl": build_chart_embed_url(symbol="EURUSD", interval="15m", source="oanda"),
        },
        "capabilities": {
            "chatEmbeddedChart": True,
            "oandaServerSideMarketData": True,
            "tradingViewAdvancedChartingLibrary": True,
            "mt5EaExecutionBridge": True,
            "visionForReportsOnly": True,
            "internalBacktesting": "planned",
            "modes": ["manual", "semi_auto", "full_auto"],
        },
        "tools": [
            {"name": "open_chart", "method": "GET", "path": "/api/aichart/chart-url"},
            {"name": "get_oanda_instruments", "method": "GET", "path": "/api/instruments?market=forex&wrapped=1"},
            {"name": "get_candles", "method": "GET", "path": "/api/market/klines?market=forex&symbol=EURUSD&interval=15m&fresh=1"},
            {"name": "analyze_market", "method": "POST", "path": "/api/agent/market/analyze"},
            {"name": "create_recommendation", "method": "POST", "path": "/api/agent/recommendation"},
            {"name": "execute_mt5_order", "method": "POST", "path": "/api/agent/trade/open"},
            {"name": "emergency_stop", "method": "POST", "path": "/api/agent/risk-guard"},
            {"name": "get_mt5_status", "method": "GET", "path": "/api/agent/mt/status"},
            {"name": "get_risk_settings", "method": "GET", "path": "/api/agent/risk/status"},
            {"name": "set_trading_mode", "method": "POST", "path": "/api/agent/mode"},
        ],
    }


def _request_user_email(request: Request) -> str | None:
    return (
        request.headers.get("x-aichart-user-email")
        or request.headers.get("x-odysseus-user-email")
        or request.headers.get("x-user-email")
    )


def setup_aichart_routes() -> APIRouter:
    router = APIRouter(prefix="/api/aichart", tags=["aichart"])

    @router.get("/manifest")
    async def aichart_manifest(fallback: bool = Query(default=True)) -> dict[str, Any]:
        try:
            return await fetch_manifest()
        except Exception:
            if fallback:
                return _fallback_manifest()
            raise

    @router.get("/chart-url")
    async def aichart_chart_url(
        symbol: str = "EURUSD",
        interval: str = "15m",
        source: str = "oanda",
        session_id: str | None = None,
        recommendation_id: str | None = None,
        layout_id: str | None = None,
    ) -> dict[str, str]:
        return {
            "embedUrl": build_chart_embed_url(
                symbol=symbol,
                interval=interval,
                source=source,
                session_id=session_id,
                recommendation_id=recommendation_id,
                layout_id=layout_id,
            )
        }

    @router.get("/proxy/{path:path}")
    async def aichart_proxy_get(path: str, request: Request) -> Any:
        try:
            normalized = assert_agent_path_allowed(path)
            return await proxy_get(normalized, _request_user_email(request), request.query_params)
        except ValueError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", 502)
            detail = getattr(getattr(exc, "response", None), "text", str(exc))
            raise HTTPException(status_code=status, detail=detail) from exc

    @router.post("/proxy/{path:path}")
    async def aichart_proxy_post(path: str, request: Request) -> Any:
        try:
            normalized = assert_agent_path_allowed(path)
            payload = await request.json()
            return await proxy_post(normalized, _request_user_email(request), payload)
        except ValueError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", 502)
            detail = getattr(getattr(exc, "response", None), "text", str(exc))
            raise HTTPException(status_code=status, detail=detail) from exc

    return router
