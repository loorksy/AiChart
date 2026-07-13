from __future__ import annotations

import asyncio
import time

from conftest import headers, job_body, wait_terminal
from fastapi.testclient import TestClient

from app.models.jobs import JobCreateRequest, JobType
from app.storage.memory import InMemoryJobStore


def test_supported_job_has_opaque_stable_id_and_succeeds(client: TestClient) -> None:
    response = client.post("/internal/research/jobs", headers=headers(), json=job_body())
    assert response.status_code == 202
    created = response.json()
    assert created["created"] is True
    assert created["job"]["job_id"].startswith("rj_")
    assert created["job"]["status"] in {"queued", "running"}
    terminal = wait_terminal(client, created["job"]["job_id"])
    assert terminal["status"] == "succeeded"
    assert terminal["progress_percent"] == 100


def test_unsupported_type_invalid_payload_and_timeout_are_rejected(client: TestClient) -> None:
    unsupported = job_body(job_type="backtest", key="unsupported-key")
    invalid_payload = job_body(payload={"duration_ms": -1}, key="payload-key-01")
    invalid_timeout = job_body(timeout_seconds=99, key="timeout-key-01")
    assert (
        client.post("/internal/research/jobs", headers=headers(), json=unsupported).status_code
        == 422
    )
    payload_response = client.post(
        "/internal/research/jobs", headers=headers(), json=invalid_payload
    )
    timeout_response = client.post(
        "/internal/research/jobs", headers=headers(), json=invalid_timeout
    )
    assert payload_response.status_code == 422
    assert payload_response.json()["error"]["code"] == "JOB_INPUT_INVALID"
    assert timeout_response.status_code == 422
    unsafe = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="unsafe-key-0001",
            payload={"duration_ms": 1, "steps": 1, "api_key": "must-not-enter"},
        ),
    )
    assert unsafe.status_code == 422
    assert "must-not-enter" not in unsafe.text


def test_idempotency_same_conflict_and_cross_tenant(client: TestClient) -> None:
    body = job_body(payload={"duration_ms": 100, "steps": 2})
    first = client.post("/internal/research/jobs", headers=headers(), json=body)
    second = client.post("/internal/research/jobs", headers=headers(), json=body)
    conflict = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json={**body, "payload": {"duration_ms": 200, "steps": 2}},
    )
    other = job_body(user_id=2, request_id="req-user-2", key=body["idempotency_key"])
    other_response = client.post(
        "/internal/research/jobs", headers=headers(2, "req-user-2"), json=other
    )
    assert first.json()["job"]["job_id"] == second.json()["job"]["job_id"]
    assert second.json()["created"] is False
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert other_response.status_code == 202
    assert other_response.json()["job"]["job_id"] != first.json()["job"]["job_id"]


async def test_concurrent_duplicate_store_creation_is_atomic() -> None:
    store = InMemoryJobStore()
    request = JobCreateRequest(
        job_type=JobType.SERVICE_SMOKE_TEST,
        user_id=7,
        request_id="req-concurrent",
        idempotency_key="concurrent-key-01",
        payload={"steps": 1},
    )
    results = await asyncio.gather(*[store.create_or_get(request, 10, 1) for _ in range(20)])
    assert len({job.job_id for job, _ in results}) == 1
    assert sum(created for _, created in results) == 1


def test_tenant_read_cancel_and_unknown_do_not_leak(client: TestClient) -> None:
    response = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(payload={"duration_ms": 500, "steps": 5}),
    )
    job_id = response.json()["job"]["job_id"]
    other_headers = headers(2, "req-user-2")
    read = client.get(f"/internal/research/jobs/{job_id}", headers=other_headers)
    cancel = client.post(f"/internal/research/jobs/{job_id}/cancel", headers=other_headers)
    unknown = client.get("/internal/research/jobs/rj_unknown", headers=other_headers)
    assert read.status_code == cancel.status_code == unknown.status_code == 404
    assert read.json() == unknown.json()


def test_running_and_repeated_cancellation_is_terminal(client: TestClient) -> None:
    response = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(payload={"duration_ms": 1000, "steps": 20}),
    )
    job_id = response.json()["job"]["job_id"]
    time.sleep(0.05)
    first = client.post(f"/internal/research/jobs/{job_id}/cancel", headers=headers())
    terminal = wait_terminal(client, job_id)
    second = client.post(f"/internal/research/jobs/{job_id}/cancel", headers=headers())
    assert first.status_code == second.status_code == 200
    assert terminal["status"] == second.json()["status"] == "cancelled"


def test_queued_cancellation_never_becomes_success(client: TestClient) -> None:
    blocker = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(key="blocker-key-01", payload={"duration_ms": 800, "steps": 8}),
    ).json()["job"]
    queued = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(key="queued-key-001", payload={"duration_ms": 10, "steps": 1}),
    ).json()["job"]
    cancelled = client.post(f"/internal/research/jobs/{queued['job_id']}/cancel", headers=headers())
    client.post(f"/internal/research/jobs/{blocker['job_id']}/cancel", headers=headers())
    assert cancelled.json()["status"] == "cancelled"
    assert wait_terminal(client, queued["job_id"])["status"] == "cancelled"


def test_timeout_failure_retry_and_progress_events(client: TestClient) -> None:
    timeout = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="timeout-job-01",
            job_type="timeout_smoke_test",
            timeout_seconds=1,
            payload={"duration_ms": 1500, "steps": 3},
        ),
    ).json()["job"]
    failed = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="failure-job-01",
            job_type="failure_smoke_test",
            payload={"duration_ms": 5, "steps": 1, "retryable": False},
        ),
    ).json()["job"]
    retried = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="retry-job-0001",
            job_type="failure_smoke_test",
            max_retries=1,
            payload={
                "duration_ms": 5,
                "steps": 1,
                "retryable": True,
                "fail_attempts": 1,
            },
        ),
    ).json()["job"]
    assert wait_terminal(client, timeout["job_id"])["status"] == "timed_out"
    assert wait_terminal(client, failed["job_id"])["status"] == "failed"
    retry_terminal = wait_terminal(client, retried["job_id"])
    assert retry_terminal["status"] == "succeeded"
    assert retry_terminal["attempt"] == 2
    events = client.get(
        f"/internal/research/jobs/{retried['job_id']}/events", headers=headers()
    ).json()["events"]
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert [event["percent"] for event in events] == sorted(event["percent"] for event in events)
    assert events[-1]["percent"] == 100
    assert any(event["stage"] == "retry_wait" for event in events)
