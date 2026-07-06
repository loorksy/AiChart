from __future__ import annotations

import hashlib
import hmac

from services.aichart_bridge import (
    assert_agent_path_allowed,
    bridge_headers,
    build_chart_embed_url,
)


def test_build_chart_embed_url_sanitizes_symbol_and_interval(monkeypatch):
    monkeypatch.setenv("AICHART_BASE_URL", "https://aichart.test/")
    url = build_chart_embed_url(
        symbol="eur/usd<script>",
        interval="4h",
        source="ea",
        session_id="s1",
        recommendation_id="r1",
    )

    assert url == (
        "https://aichart.test/integrations/odysseus/embed?"
        "symbol=EURUSD&interval=4h&source=ea&readonlyAgentDrawings=1&"
        "sessionId=s1&recommendationId=r1"
    )


def test_bridge_headers_sign_user_email(monkeypatch):
    monkeypatch.setenv("AICHART_SERVICE_TOKEN", "super-secret-token")
    headers = bridge_headers("Trader@Example.com")
    expected = hmac.new(
        b"super-secret-token",
        b"trader@example.com",
        hashlib.sha256,
    ).hexdigest()

    assert headers["Authorization"] == "Bearer super-secret-token"
    assert headers["X-Aichart-User-Email"] == "trader@example.com"
    assert headers["X-Aichart-User-Sig"] == expected


def test_agent_proxy_allowlist():
    assert assert_agent_path_allowed("api/agent/market/analyze") == "agent/market/analyze"

    try:
        assert_agent_path_allowed("admin/users")
    except ValueError as exc:
        assert "not allow-listed" in str(exc)
    else:
        raise AssertionError("admin path should be rejected")
