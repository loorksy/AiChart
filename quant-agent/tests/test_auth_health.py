from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import TOKEN


def test_liveness_is_public_and_small(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {
        "status": "live",
        "service": "aichart-quant-agent",
        "version": "0.1.0",
    }


def test_readiness_requires_valid_internal_token(client: TestClient) -> None:
    missing = client.get("/health/ready")
    invalid = client.get("/health/ready", headers={"Authorization": "Bearer wrong"})
    valid = client.get("/health/ready", headers={"Authorization": f"Bearer {TOKEN}"})
    assert missing.status_code == invalid.status_code == 401
    assert valid.status_code == 200
    assert valid.json()["status"] == "ready"
    assert valid.json()["network_mode"] == "disabled"
    assert TOKEN not in missing.text + invalid.text + valid.text


def test_recommendations_endpoints_require_auth(client: TestClient) -> None:
    assert client.get("/internal/quant-agent/recommendations").status_code == 401
    assert client.get("/internal/quant-agent/recommendations/qrec_fake").status_code == 401
    assert client.get("/internal/quant-agent/strategies").status_code == 401
    assert client.post("/internal/quant-agent/recommendations", json={}).status_code == 401
