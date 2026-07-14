from conftest import TOKEN
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_liveness_is_small_and_unauthenticated(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {
        "status": "live",
        "service": "aichart-research",
        "version": "0.1.0",
    }


def test_readiness_requires_valid_internal_token(client: TestClient) -> None:
    missing = client.get("/health/ready")
    invalid = client.get("/health/ready", headers={"Authorization": "Bearer wrong"})
    valid = client.get("/health/ready", headers={"Authorization": f"Bearer {TOKEN}"})
    assert missing.status_code == invalid.status_code == 401
    assert valid.status_code == 200
    assert valid.json()["storage"] == "volatile"
    assert TOKEN not in missing.text + invalid.text + valid.text


def test_job_endpoint_does_not_trust_user_header_without_auth(client: TestClient) -> None:
    response = client.get(
        "/internal/research/jobs/rj_fake",
        headers={"X-AiChart-User-Id": "1", "X-AiChart-Request-Id": "req-test"},
    )
    assert response.status_code == 401


def test_production_defaults_to_durable_store_and_is_ready(tmp_path) -> None:
    token = "production-internal-token-32-characters"
    settings = Settings(
        internal_token=token,
        environment="production",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
    )
    with TestClient(create_app(settings)) as production:
        assert production.get("/health/live").status_code == 200
        response = production.get("/health/ready", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json()["status"] == "ready"
        assert response.json()["storage"] == "durable"


def test_production_explicit_volatile_store_is_not_ready(tmp_path) -> None:
    token = "production-internal-token-32-characters"
    settings = Settings(
        internal_token=token,
        environment="production",
        job_storage="memory",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
    )
    with TestClient(create_app(settings)) as production:
        response = production.get("/health/ready", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 503
        assert response.json()["status"] == "not_ready"
        assert response.json()["storage"] == "volatile"
