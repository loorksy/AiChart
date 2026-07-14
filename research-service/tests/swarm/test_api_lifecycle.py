from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import TOKEN, headers
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def swarm_settings(tmp_path: Path) -> Settings:
    return Settings(
        internal_token=TOKEN,
        environment="test",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
        max_queued_jobs=8,
        max_artifact_bytes=128 * 1024,
        swarm_enabled=True,
        swarm_presets_enabled=True,
        swarm_db_path=tmp_path / "work" / "swarm.sqlite3",
        swarm_run_timeout_seconds=10,
        swarm_task_timeout_seconds=5,
        swarm_artifact_bytes=128 * 1024,
        swarm_stale_seconds=2,
    )


@pytest.fixture
def swarm_client(swarm_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(swarm_settings)) as active:
        yield active


def _body(key: str, **updates: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "preset": "forex_research_committee",
        "title": "Bounded swarm test",
        "objective": "Research evidence without live execution",
        "idempotency_key": key,
    }
    body.update(updates)
    return body


def _terminal(client: TestClient, run_id: str, attempts: int = 500) -> dict[str, Any]:
    for _ in range(attempts):
        response = client.get(f"/internal/research/swarms/{run_id}", headers=headers())
        assert response.status_code == 200
        run = response.json()
        if run["status"] in {
            "succeeded",
            "partially_completed",
            "failed",
            "timed_out",
            "cancelled",
        }:
            return run
        time.sleep(0.01)
    raise AssertionError("swarm run did not become terminal")


def test_swarm_is_disabled_by_default(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/internal/research/swarms", json=_body("disabled-key-001"), headers=headers()
        )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SWARM_DISABLED"


def test_success_idempotency_auth_tenant_and_artifacts(swarm_client: TestClient) -> None:
    unauthenticated = swarm_client.post("/internal/research/swarms", json=_body("auth-key-0001"))
    assert unauthenticated.status_code == 401
    created = swarm_client.post(
        "/internal/research/swarms", json=_body("success-key-001"), headers=headers()
    )
    assert created.status_code == 202
    run_id = created.json()["run"]["swarm_run_id"]
    duplicate = swarm_client.post(
        "/internal/research/swarms", json=_body("success-key-001"), headers=headers()
    )
    assert duplicate.json()["created"] is False
    assert duplicate.json()["run"]["swarm_run_id"] == run_id
    conflict = swarm_client.post(
        "/internal/research/swarms",
        json=_body("success-key-001", title="Conflicting request"),
        headers=headers(),
    )
    assert conflict.status_code == 409
    assert (
        swarm_client.get(
            f"/internal/research/swarms/{run_id}", headers=headers(user_id=2)
        ).status_code
        == 404
    )
    run = _terminal(swarm_client, run_id)
    assert run["status"] == "succeeded"
    assert len(run["artifact_refs"]) == 8
    artifacts = swarm_client.get(f"/internal/research/swarms/{run_id}/artifacts", headers=headers())
    assert artifacts.status_code == 200
    assert {item["name"] for item in artifacts.json()["artifacts"]} >= {
        "swarm_plan.json",
        "task_graph.json",
        "final_synthesis.json",
        "evidence_index.json",
    }
    assert (
        swarm_client.get(
            f"/internal/research/swarms/{run_id}/artifacts", headers=headers(user_id=2)
        ).status_code
        == 404
    )


def test_partial_completion_and_retry_are_explicit(swarm_client: TestClient) -> None:
    partial = swarm_client.post(
        "/internal/research/swarms",
        json=_body(
            "partial-key-001",
            preset="gold_strategy_lab",
            parameters={"fail_optional_roles": ["backtest_analyst"]},
        ),
        headers=headers(),
    ).json()["run"]
    partial_run = _terminal(swarm_client, partial["swarm_run_id"])
    assert partial_run["status"] == "partially_completed"
    tasks = swarm_client.get(
        f"/internal/research/swarms/{partial['swarm_run_id']}/tasks", headers=headers()
    ).json()["tasks"]
    assert any(task["status"] == "failed" and not task["required"] for task in tasks)

    retry = swarm_client.post(
        "/internal/research/swarms",
        json=_body(
            "retry-key-0001",
            preset="gold_strategy_lab",
            parameters={"retry_once_roles": ["backtest_analyst"]},
        ),
        headers=headers(),
    ).json()["run"]
    assert _terminal(swarm_client, retry["swarm_run_id"])["status"] == "succeeded"
    events = swarm_client.get(
        f"/internal/research/swarms/{retry['swarm_run_id']}/events", headers=headers()
    ).json()["events"]
    assert any(event["event_type"] == "task_retried" for event in events)


def test_tenant_scoped_cancel_timeout_and_no_post_cancel_artifacts(
    swarm_client: TestClient,
) -> None:
    created = swarm_client.post(
        "/internal/research/swarms",
        json=_body("cancel-key-001", parameters={"task_delay_ms": 1_000}),
        headers=headers(),
    ).json()["run"]
    run_id = created["swarm_run_id"]
    assert (
        swarm_client.post(
            f"/internal/research/swarms/{run_id}/cancel", headers=headers(user_id=2)
        ).status_code
        == 404
    )
    assert (
        swarm_client.post(
            f"/internal/research/swarms/{run_id}/cancel", headers=headers()
        ).status_code
        == 200
    )
    cancelled = _terminal(swarm_client, run_id)
    count = len(cancelled["artifact_refs"])
    time.sleep(0.1)
    after = swarm_client.get(f"/internal/research/swarms/{run_id}", headers=headers()).json()
    assert after["status"] == "cancelled"
    assert len(after["artifact_refs"]) == count

    timed = swarm_client.post(
        "/internal/research/swarms",
        json=_body("timeout-key-001", timeout_seconds=1, parameters={"task_delay_ms": 2_000}),
        headers=headers(),
    ).json()["run"]
    assert _terminal(swarm_client, timed["swarm_run_id"])["status"] == "timed_out"


def test_optional_task_cancel_and_budget_exhaustion(swarm_client: TestClient) -> None:
    created = swarm_client.post(
        "/internal/research/swarms",
        json=_body(
            "task-cancel-001",
            preset="performance_attribution_team",
            parameters={"task_delay_ms": 500},
        ),
        headers=headers(),
    ).json()["run"]
    run_id = created["swarm_run_id"]
    cancelled = swarm_client.post(
        f"/internal/research/swarms/{run_id}/tasks/dna_review/cancel", headers=headers()
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] in {"running", "cancelled"}
    required = swarm_client.post(
        f"/internal/research/swarms/{run_id}/tasks/attribution/cancel", headers=headers()
    )
    assert required.status_code == 409
    assert _terminal(swarm_client, run_id)["status"] == "partially_completed"
    tasks = swarm_client.get(f"/internal/research/swarms/{run_id}/tasks", headers=headers()).json()[
        "tasks"
    ]
    dna = next(task for task in tasks if task["task_id"] == "dna_review")
    assert dna["status"] == "cancelled"

    budgeted = swarm_client.post(
        "/internal/research/swarms",
        json=_body("budget-key-001", budgets={"token_budget": 100}),
        headers=headers(),
    ).json()["run"]
    failed = _terminal(swarm_client, budgeted["swarm_run_id"])
    assert failed["status"] == "failed"
    events = swarm_client.get(
        f"/internal/research/swarms/{budgeted['swarm_run_id']}/events", headers=headers()
    ).json()["events"]
    assert any(event["event_type"] == "budget_exhausted" for event in events)


def test_budget_above_server_limit_and_cross_tenant_evidence_are_rejected(
    swarm_client: TestClient,
) -> None:
    excessive = swarm_client.post(
        "/internal/research/swarms",
        json=_body("budget-key-002", budgets={"max_workers": 99}),
        headers=headers(),
    )
    assert excessive.status_code == 422
    cross_tenant = swarm_client.post(
        "/internal/research/swarms",
        json=_body(
            "evidence-key-001",
            evidence_refs=[
                {
                    "evidence_type": "artifact",
                    "reference_id": "artifact_other",
                    "owner_user_id": 2,
                }
            ],
        ),
        headers=headers(),
    )
    assert cross_tenant.status_code == 404


def test_artifact_count_budget_stops_the_run(swarm_client: TestClient) -> None:
    created = swarm_client.post(
        "/internal/research/swarms",
        json=_body("artifact-budget-001", budgets={"artifact_count": 1}),
        headers=headers(),
    )
    assert created.status_code == 202
    run = _terminal(swarm_client, created.json()["run"]["swarm_run_id"])
    assert run["status"] == "failed"
    assert run["error_code"] == "SWARM_BUDGET_EXHAUSTED"
    assert len(run["artifact_refs"]) == 1
