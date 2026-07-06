"""AiChart bridge client — proxies manifest, embed URLs, and agent API calls."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx

logger = logging.getLogger(__name__)

_SYMBOL_RE = re.compile(r"^[A-Z0-9._]{6,12}$")
_INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"}

ALLOWED_AGENT_PREFIXES = (
    "market/",
    "trade/",
    "risk/",
    "recommendation",
    "chart/",
    "ea/",
    "settings",
    "mode",
    "execution/",
    "portfolio",
    "trades/",
    "instruments",
)

FALLBACK_MANIFEST: dict[str, Any] = {
    "version": "1.0.0",
    "integration": "odysseus",
    "host": "aichart",
    "capabilities": {
        "chatEmbeddedChart": True,
        "oandaServerSideMarketData": True,
        "tradingViewAdvancedChartingLibrary": True,
        "mt5EaExecutionBridge": True,
        "visionForReportsOnly": True,
        "internalBacktesting": "planned",
    },
    "tradingModes": [
        {"alias": "manual", "aichartMode": "direct"},
        {"alias": "semi_auto", "aichartMode": "approval"},
        {"alias": "full_auto", "aichartMode": "auto"},
    ],
    "tools": [],
}


def aichart_base_url() -> str:
    raw = (os.getenv("AICHART_BASE_URL") or "http://127.0.0.1:3000").strip()
    return raw.rstrip("/")


def aichart_service_token() -> str | None:
    raw = (os.getenv("AICHART_SERVICE_TOKEN") or "").strip().replace("\r", "")
    return raw if len(raw) >= 16 else None


def bridge_user_sig(email: str) -> str | None:
    token = aichart_service_token()
    if not token:
        return None
    normalized = email.strip().lower()
    return hmac.new(token.encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256).hexdigest()


def bridge_headers(user_email: str | None) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    token = aichart_service_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if user_email:
        email = user_email.strip().lower()
        sig = bridge_user_sig(email)
        if sig:
            headers["X-Aichart-User-Email"] = email
            headers["X-Aichart-User-Sig"] = sig
    return headers


def sanitize_symbol(raw: str | None) -> str:
    s = (raw or "EURUSD").upper().strip()
    s = re.sub(r"[^A-Z0-9._]", "", s)
    if not _SYMBOL_RE.match(s):
        return "EURUSD"
    return s


def sanitize_interval(raw: str | None) -> str:
    iv = (raw or "15m").lower().strip()
    return iv if iv in _INTERVALS else "15m"


def sanitize_source(raw: str | None) -> str:
    return "ea" if (raw or "").lower().strip() == "ea" else "oanda"


def is_allowed_agent_path(path: str) -> bool:
    p = (path or "").lstrip("/")
    if not p:
        return False
    if p.startswith("agent/"):
        p = p[len("agent/") :]
    return any(p == prefix.rstrip("/") or p.startswith(prefix) for prefix in ALLOWED_AGENT_PREFIXES)


async def fetch_manifest() -> dict[str, Any]:
    url = urljoin(aichart_base_url() + "/", "api/integrations/odysseus/manifest")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.get(url, headers={"Accept": "application/json"})
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, dict):
                    return data
    except Exception as exc:
        logger.warning("AiChart manifest fetch failed: %s", exc)
    fallback = dict(FALLBACK_MANIFEST)
    fallback["baseUrl"] = aichart_base_url()
    fallback["endpoints"] = {
        "manifest": f"{aichart_base_url()}/api/integrations/odysseus/manifest",
        "embed": f"{aichart_base_url()}/integrations/odysseus/embed",
    }
    return fallback


async def mint_embed_token(
    user_email: str,
    session_id: str | None = None,
    *,
    symbol: str | None = None,
    interval: str | None = None,
    source: str | None = None,
) -> dict[str, Any] | None:
    url = urljoin(aichart_base_url() + "/", "api/integrations/odysseus/embed-token")
    payload: dict[str, Any] = {"email": user_email.strip().lower()}
    if session_id:
        payload["sessionId"] = session_id
    if symbol:
        payload["symbol"] = sanitize_symbol(symbol)
    if interval:
        payload["interval"] = sanitize_interval(interval)
    if source:
        payload["source"] = sanitize_source(source)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(url, headers=bridge_headers(user_email), json=payload)
            if res.status_code == 200:
                data = res.json()
                return data if isinstance(data, dict) else None
    except Exception as exc:
        logger.warning("AiChart embed-token failed: %s", exc)
    return None


def build_chart_embed_url(
    *,
    symbol: str,
    interval: str,
    source: str,
    session_id: str | None = None,
    layout_id: str | None = None,
    recommendation_id: str | None = None,
    token: str | None = None,
    readonly_agent_drawings: bool = False,
) -> str:
    q: dict[str, str] = {
        "symbol": sanitize_symbol(symbol),
        "interval": sanitize_interval(interval),
        "source": sanitize_source(source),
    }
    if session_id:
        q["sessionId"] = session_id
    if layout_id:
        q["layoutId"] = layout_id
    if recommendation_id:
        q["recommendationId"] = recommendation_id
    if token:
        q["token"] = token
    if readonly_agent_drawings:
        q["readonlyAgentDrawings"] = "1"
    return f"{aichart_base_url()}/integrations/odysseus/embed?{urlencode(q)}"


async def proxy_agent_request(
    method: str,
    path: str,
    user_email: str,
    *,
    query: dict[str, str] | None = None,
    json_body: Any | None = None,
) -> tuple[int, Any]:
    if not is_allowed_agent_path(path):
        return 403, {"error": "Agent path not allowed"}
    if not aichart_service_token():
        return 503, {"error": "AICHART_SERVICE_TOKEN not configured"}
    clean = path.lstrip("/")
    if clean.startswith("agent/"):
        clean = clean[len("agent/") :]
    url = urljoin(aichart_base_url() + "/", f"api/agent/{clean}")
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.request(
                method.upper(),
                url,
                headers={**bridge_headers(user_email), "Content-Type": "application/json"},
                params=query or None,
                json=json_body,
            )
            try:
                body = res.json()
            except json.JSONDecodeError:
                body = {"body": res.text}
            return res.status_code, body
    except httpx.TimeoutException:
        return 504, {"error": "AiChart bridge timeout"}
    except Exception as exc:
        logger.warning("AiChart proxy failed %s %s: %s", method, path, exc)
        return 502, {"error": "AiChart bridge error"}
