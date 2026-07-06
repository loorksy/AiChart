"""AiChart trading workspace routes for Odysseus chat embed."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from services.aichart_bridge import (
    aichart_service_token,
    build_chart_embed_url,
    fetch_manifest,
    mint_embed_token,
    proxy_agent_request,
    sanitize_interval,
    sanitize_source,
    sanitize_symbol,
)
from src.auth_helpers import get_current_user

logger = logging.getLogger(__name__)


def setup_aichart_routes() -> APIRouter:
    router = APIRouter(prefix="/api/aichart", tags=["aichart"])

    @router.get("/manifest")
    async def get_manifest():
        data = await fetch_manifest()
        return JSONResponse(data)

    @router.get("/chart-url")
    async def get_chart_url(
        request: Request,
        symbol: str = "EURUSD",
        interval: str = "15m",
        source: str = "oanda",
        session_id: str | None = None,
        layout_id: str | None = None,
        recommendation_id: str | None = None,
        readonly_agent_drawings: bool = False,
    ):
        sym = sanitize_symbol(symbol)
        iv = sanitize_interval(interval)
        src = sanitize_source(source)
        sid = (session_id or request.query_params.get("sessionId") or "").strip() or None
        ro = (
            request.query_params.get("readonly_agent_drawings")
            or request.query_params.get("readonlyAgentDrawings")
            or ""
        ).lower()
        readonly_on = readonly_agent_drawings or ro in ("1", "true", "yes")
        token = None
        user = get_current_user(request)
        if user and aichart_service_token():
            minted = await mint_embed_token(
                user,
                sid,
                symbol=sym,
                interval=iv,
                source=src,
            )
            if minted and minted.get("embedUrl"):
                return minted
            token = (minted or {}).get("token")
        url = build_chart_embed_url(
            symbol=sym,
            interval=iv,
            source=src,
            session_id=sid,
            layout_id=layout_id,
            recommendation_id=recommendation_id,
            token=token,
            readonly_agent_drawings=readonly_on,
        )
        return {
            "embedUrl": url,
            "symbol": sym,
            "interval": iv,
            "source": src,
            "sessionId": sid,
        }

    @router.api_route("/proxy/agent/{path:path}", methods=["GET", "POST", "PATCH"])
    async def proxy_agent(path: str, request: Request):
        user = get_current_user(request)
        if not user:
            raise HTTPException(401, "Sign in required for trading bridge")
        query = dict(request.query_params)
        body: Any | None = None
        if request.method in ("POST", "PATCH"):
            try:
                body = await request.json()
            except Exception:
                body = None
        status, payload = await proxy_agent_request(
            request.method,
            path,
            user,
            query=query,
            json_body=body,
        )
        return JSONResponse(payload, status_code=status)

    return router
