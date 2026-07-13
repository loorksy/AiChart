from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-internal-token-with-32-characters"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        internal_token=TOKEN,
        environment="test",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
        max_concurrent_jobs=1,
        max_queued_jobs=8,
        default_timeout_seconds=3,
        max_timeout_seconds=5,
        max_retries=2,
        max_request_bytes=4096,
        max_artifact_bytes=2048,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as active:
        yield active


def headers(user_id: int = 1, request_id: str = "req-test") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-AiChart-User-Id": str(user_id),
        "X-AiChart-Request-Id": request_id,
        "X-AiChart-Caller": "aichart-web-tests",
    }


def job_body(
    *,
    user_id: int = 1,
    request_id: str = "req-test",
    key: str = "research-key-0001",
    job_type: str = "service_smoke_test",
    payload: dict[str, Any] | None = None,
    timeout_seconds: int = 3,
    max_retries: int = 0,
) -> dict[str, Any]:
    return {
        "job_type": job_type,
        "user_id": user_id,
        "request_id": request_id,
        "idempotency_key": key,
        "timeout_seconds": timeout_seconds,
        "max_retries": max_retries,
        "payload": payload or {"duration_ms": 20, "steps": 2},
    }


def wait_terminal(
    client: TestClient, job_id: str, user_id: int = 1, attempts: int = 200
) -> dict[str, Any]:
    for _ in range(attempts):
        response = client.get(f"/internal/research/jobs/{job_id}", headers=headers(user_id))
        assert response.status_code == 200
        job = response.json()
        if job["status"] in {"succeeded", "failed", "timed_out", "cancelled"}:
            return job
        time.sleep(0.01)
    raise AssertionError("job did not reach a terminal state")
