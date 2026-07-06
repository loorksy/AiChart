"""Tests for AiChart FastAPI routes."""
from __future__ import annotations

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]

os.environ.setdefault("AICHART_BASE_URL", "http://127.0.0.1:3000")
os.environ.setdefault("AICHART_SERVICE_TOKEN", "test_bridge_token_16chars")


def _load_module(name: str, rel_path: str):
    path = ROOT / rel_path
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


bridge_mod = _load_module("aichart_bridge", "services/aichart_bridge.py")
services_pkg = types.ModuleType("services")
services_pkg.aichart_bridge = bridge_mod
sys.modules["services"] = services_pkg
sys.modules["services.aichart_bridge"] = bridge_mod

auth_helpers = types.ModuleType("src.auth_helpers")
auth_helpers.get_current_user = lambda _request: None
sys.modules.setdefault("src", types.ModuleType("src"))
sys.modules["src.auth_helpers"] = auth_helpers

aichart_routes = _load_module("aichart_routes", "routes/aichart_routes.py")


class AichartRoutesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        app = FastAPI()
        app.include_router(aichart_routes.setup_aichart_routes())
        cls.client = TestClient(app)

    @patch.object(aichart_routes, "fetch_manifest", new_callable=AsyncMock)
    def test_manifest_route(self, mock_fetch):
        mock_fetch.return_value = {"integration": "odysseus", "version": "1.0.0"}
        res = self.client.get("/api/aichart/manifest")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["integration"], "odysseus")

    @patch.object(aichart_routes, "get_current_user", return_value=None)
    @patch.object(aichart_routes, "mint_embed_token", new_callable=AsyncMock)
    def test_chart_url_sanitizes_symbol(self, mock_mint, _user):
        mock_mint.return_value = None
        res = self.client.get(
            "/api/aichart/chart-url",
            params={"symbol": "eur/usd!", "interval": "99x", "source": "ea"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["symbol"], "EURUSD")
        self.assertEqual(body["interval"], "15m")
        self.assertEqual(body["source"], "ea")
        self.assertIn("embedUrl", body)
        self.assertIn("symbol=EURUSD", body["embedUrl"])

    @patch.object(aichart_routes, "get_current_user", return_value=None)
    def test_chart_url_readonly_query(self, _user):
        res = self.client.get(
            "/api/aichart/chart-url",
            params={"symbol": "EURUSD", "readonly_agent_drawings": "1"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("readonlyAgentDrawings=1", res.json()["embedUrl"])


if __name__ == "__main__":
    unittest.main()
