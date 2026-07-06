"""Tests for AiChart bridge helpers."""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_bridge():
    path = ROOT / "services" / "aichart_bridge.py"
    spec = importlib.util.spec_from_file_location("aichart_bridge", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["aichart_bridge"] = mod
    spec.loader.exec_module(mod)
    return mod


bridge = _load_bridge()


class AichartBridgeTests(unittest.TestCase):
    def setUp(self):
        self._token = os.environ.get("AICHART_SERVICE_TOKEN")
        os.environ["AICHART_SERVICE_TOKEN"] = "test_bridge_token_16chars"

    def tearDown(self):
        if self._token is None:
            os.environ.pop("AICHART_SERVICE_TOKEN", None)
        else:
            os.environ["AICHART_SERVICE_TOKEN"] = self._token

    def test_bridge_user_sig_hmac(self):
        email = "User@Example.com"
        expected = hmac.new(
            b"test_bridge_token_16chars",
            b"user@example.com",
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(bridge.bridge_user_sig(email), expected)

    def test_bridge_headers_include_email_and_sig(self):
        headers = bridge.bridge_headers("trader@example.com")
        self.assertEqual(headers["X-Aichart-User-Email"], "trader@example.com")
        self.assertIn("X-Aichart-User-Sig", headers)
        self.assertTrue(headers["Authorization"].startswith("Bearer "))

    def test_sanitize_symbol_interval_source(self):
        self.assertEqual(bridge.sanitize_symbol("eur/usd!"), "EURUSD")
        self.assertEqual(bridge.sanitize_interval("99x"), "15m")
        self.assertEqual(bridge.sanitize_source("ea"), "ea")
        self.assertEqual(bridge.sanitize_source("oanda"), "oanda")

    def test_build_chart_embed_url(self):
        url = bridge.build_chart_embed_url(
            symbol="gbpusd",
            interval="1h",
            source="oanda",
            session_id="sess-1",
            readonly_agent_drawings=True,
        )
        self.assertIn("symbol=GBPUSD", url)
        self.assertIn("interval=1h", url)
        self.assertIn("sessionId=sess-1", url)
        self.assertIn("readonlyAgentDrawings=1", url)

    def test_agent_path_allowlist(self):
        self.assertTrue(bridge.is_allowed_agent_path("trade/open"))
        self.assertTrue(bridge.is_allowed_agent_path("risk/kill-switch"))
        self.assertTrue(bridge.is_allowed_agent_path("mode"))
        self.assertFalse(bridge.is_allowed_agent_path("users/delete"))


if __name__ == "__main__":
    unittest.main()
