"""Service client for forwarding Odysseus trading actions to AiChart.

Odysseus never executes trades locally. This module only builds embed URLs,
fetches the AiChart manifest, and forwards allow-listed API calls with the
same user email identity that AiChart's bridge auth expects.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from typing import Any, Mapping
from urllib.parse import quote, urlencode


ALLOWED_AGENT_PREFIXES = {
    "agent/market/analyze",
    "agent/market/multi-snapshot",
    "agent/market/ohlc",
    "agent/market/price",
    "agent/recommendation",
    "agent/risk/status",
    "agent/settings",
    "agent/trade/open",
    "agent/trade/readiness",
    "agent/trades/open",
    "agent/mt/status",
    "agent/ea/diagnostics",
}


def aichart_base_url() -> str:
    return os.getenv("AICHART_BASE_URL", "http://localhost:3010").rstrip("/")


def service_token() -> str:
    return os.getenv("AICHART_SERVICE_TOKEN", "").strip()


def bridge_headers(user_email: str | None = None) -> dict[str, str]:
    token = service_token()
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if user_email:
        email = user_email.strip().lower()
        headers["X-Aichart-User-Email"] = email
        if token:
            headers["X-Aichart-User-Sig"] = hmac.new(
                token.encode("utf-8"),
                email.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
    return headers


def clean_symbol(symbol: str | None) -> str:
    without_tags = re.sub(r"<[^>]*>", "", symbol or "EURUSD")
    raw = without_tags.upper()
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in "._:-")
    return cleaned or "EURUSD"


def clean_interval(interval: str | None) -> str:
    allowed = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"}
    return interval if interval in allowed else "15m"


def clean_source(source: str | None) -> str:
    return "ea" if source == "ea" else "oanda"


def build_chart_embed_url(
    *,
    symbol: str | None = None,
    interval: str | None = None,
    source: str | None = None,
    session_id: str | None = None,
    recommendation_id: str | None = None,
    layout_id: str | None = None,
    readonly_agent_drawings: bool = True,
) -> str:
    params: dict[str, str] = {
        "symbol": clean_symbol(symbol),
        "interval": clean_interval(interval),
        "source": clean_source(source),
        "readonlyAgentDrawings": "1" if readonly_agent_drawings else "0",
    }
    if session_id:
        params["sessionId"] = session_id
    if recommendation_id:
        params["recommendationId"] = recommendation_id
    if layout_id:
        params["layoutId"] = layout_id
    return f"{aichart_base_url()}/integrations/odysseus/embed?{urlencode(params)}"


async def fetch_manifest() -> dict[str, Any]:
    import httpx

    timeout = httpx.Timeout(8.0, connect=3.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(
            f"{aichart_base_url()}/api/integrations/odysseus/manifest",
            headers=bridge_headers(),
        )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise TypeError("AiChart manifest returned a non-object payload")
    return data


def assert_agent_path_allowed(path: str) -> str:
    normalized = path.strip("/")
    if normalized.startswith("api/"):
        normalized = normalized[4:]
    if normalized not in ALLOWED_AGENT_PREFIXES:
        raise ValueError(f"AiChart proxy path is not allow-listed: {path}")
    return normalized


async def proxy_get(path: str, user_email: str | None, params: Mapping[str, Any] | None = None) -> Any:
    normalized = assert_agent_path_allowed(path)
    import httpx

    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=3.0)) as client:
        response = await client.get(
            f"{aichart_base_url()}/api/{normalized}",
            params=params,
            headers=bridge_headers(user_email),
        )
    response.raise_for_status()
    return response.json()


async def proxy_post(path: str, user_email: str | None, payload: Mapping[str, Any] | None = None) -> Any:
    normalized = assert_agent_path_allowed(path)
    import httpx

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=3.0)) as client:
        response = await client.post(
            f"{aichart_base_url()}/api/{normalized}",
            json=dict(payload or {}),
            headers={**bridge_headers(user_email), "Content-Type": "application/json"},
        )
    response.raise_for_status()
    return response.json()
