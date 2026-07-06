from __future__ import annotations

import pytest

pytest.importorskip("fastapi")

from routes.aichart_routes import _fallback_manifest


def test_fallback_manifest_contains_required_tools():
    manifest = _fallback_manifest()
    tools = {tool["name"] for tool in manifest["tools"]}

    assert manifest["capabilities"]["chatEmbeddedChart"] is True
    assert manifest["capabilities"]["visionForReportsOnly"] is True
    assert "open_chart" in tools
    assert "execute_mt5_order" in tools
    assert "get_mt5_status" in tools
    assert "set_trading_mode" in tools
