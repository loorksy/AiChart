from __future__ import annotations

import asyncio
import csv
import io
import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import headers, job_body, wait_terminal
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.jobs.cancellation import JobCancelled
from app.jobs.payloads import ValidateDatasetPayload
from app.models.jobs import JobCreateRequest, JobStatus, JobType, utc_now
from app.services.artifacts import JobArtifactService


def _csv_bars(count: int = 8) -> bytes:
    output = io.StringIO(newline="")
    fields = (
        "timestamp",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "spread",
        "symbol",
        "timeframe",
        "source",
        "timezone",
    )
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    start = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    for index in range(count):
        price = 1.0 + index * 0.0005
        writer.writerow(
            {
                "timestamp": (start + timedelta(minutes=15 * index)).isoformat(),
                "open": price,
                "high": price + 0.0004,
                "low": price - 0.0002,
                "close": price + 0.0002,
                "volume": 100,
                "spread": 0.0001,
                "symbol": "EURUSD",
                "timeframe": "15m",
                "source": "fixture",
                "timezone": "UTC",
            }
        )
    return output.getvalue().encode("utf-8")


def _warehouse_payload() -> dict[str, Any]:
    bars = []
    start = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    for index in range(3):
        bars.append(
            {
                "timestamp": (start + timedelta(minutes=15 * index)).isoformat(),
                "open": "1.1000",
                "high": "1.1020",
                "low": "1.0990",
                "close": "1.1010",
                "volume": "100",
                "spread": "0.0002",
                "symbol": "EURUSD",
                "timeframe": "15m",
                "source": "aichart_candle_warehouse",
                "timezone": "UTC",
                "is_closed": True,
            }
        )
    return {
        "schema_version": "aichart-candle-warehouse-v1",
        "source": "aichart_candle_warehouse",
        "exported_at": (start + timedelta(hours=1)).isoformat(),
        "closed_bars_only": True,
        "bars": bars,
    }


def _large_warehouse_payload(count: int = 400) -> dict[str, Any]:
    start = datetime(2026, 1, 5, 0, 0, tzinfo=UTC)
    bars = []
    for index in range(count):
        open_price = 1.0 + index * 0.0005
        bars.append(
            {
                "timestamp": (start + timedelta(minutes=15 * index)).isoformat(),
                "open": f"{open_price:.5f}",
                "high": f"{open_price + 0.0015:.5f}",
                "low": f"{open_price - 0.0002:.5f}",
                "close": f"{open_price + 0.0005:.5f}",
                "volume": "100",
                "spread": "0.0001",
                "symbol": "EURUSD",
                "timeframe": "15m",
                "source": "aichart_candle_warehouse",
                "timezone": "UTC",
                "is_closed": True,
            }
        )
    return {
        "schema_version": "aichart-candle-warehouse-v1",
        "source": "aichart_candle_warehouse",
        "exported_at": (start + timedelta(minutes=15 * count)).isoformat(),
        "closed_bars_only": True,
        "bars": bars,
    }


def _write_input(
    client: TestClient,
    *,
    user_id: int = 1,
    job_id: str = "rj_input_dataset",
    name: str = "bars.csv",
    artifact_type: str = "csv",
    content: bytes | None = None,
):
    manager = client.app.state.manager
    return asyncio.run(
        manager.artifacts.write(
            user_id,
            job_id,
            artifact_type,
            name,
            content if content is not None else _csv_bars(),
        )
    )


async def _seed_succeeded_backtest(client: TestClient):
    manager = client.app.state.manager
    request = JobCreateRequest(
        job_type=JobType.RUN_FOREX_BACKTEST,
        user_id=1,
        request_id="req-seeded-backtest",
        idempotency_key="seeded-backtest-001",
        payload={},
    )
    job, _ = await manager.store.create_or_get(request, 10, 1)
    job = await manager.store.transition(
        job.job_id, JobStatus.RUNNING, attempt=1, started_at=utc_now()
    )
    service = JobArtifactService(manager.artifacts, manager.store)
    await service.write_json(
        job,
        "metrics.json",
        {
            "trade_count": 25,
            "maximum_drawdown_percent": 0.12,
            "profit_factor": 1.4,
            "expectancy": 4.0,
            "intrabar_ambiguity_rate": 0.0,
        },
    )
    await service.write_json(job, "run_config.json", {"initial_capital": 10_000})
    trade_fields = (
        "net_pnl",
        "gross_pnl",
        "spread_cost",
        "slippage_cost",
        "commission_cost",
        "carry_cost",
    )
    trade_rows = []
    for index in range(25):
        net = 20.0 if index % 3 else -8.0
        trade_rows.append(
            {
                "net_pnl": net,
                "gross_pnl": net + 2.0,
                "spread_cost": 1.0,
                "slippage_cost": 0.5,
                "commission_cost": 0.5,
                "carry_cost": 0.0,
            }
        )
    await service.write_csv(job, "trades.csv", trade_fields, trade_rows)
    equity = 10_000.0
    equity_rows = []
    for index in range(36):
        equity *= 1.001 if index % 7 else 0.999
        equity_rows.append({"equity": equity})
    await service.write_csv(job, "equity.csv", ("equity",), equity_rows)
    job = await manager.store.transition(
        job.job_id,
        JobStatus.SUCCEEDED,
        completed_at=utc_now(),
        result_summary="seeded backtest",
    )
    return job


def test_validate_strategy_and_inline_warehouse_jobs_write_safe_artifacts(
    phase3_client: TestClient, phase3_strategy: dict[str, Any]
) -> None:
    strategy_response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-strategy-001",
            job_type="validate_strategy_spec",
            payload={"strategy_spec": phase3_strategy},
            max_retries=0,
        ),
    )
    strategy_job = wait_terminal(phase3_client, strategy_response.json()["job"]["job_id"])
    assert strategy_job["status"] == "succeeded"
    assert {item["name"] for item in strategy_job["artifact_refs"]} == {
        "strategy_validation.json",
        "strategy_spec.json",
    }

    dataset_response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-dataset-001",
            job_type="validate_dataset",
            payload={
                "dataset": {
                    "source": "aichart_candle_warehouse",
                    "payload": _warehouse_payload(),
                }
            },
            max_retries=0,
        ),
    )
    dataset_job = wait_terminal(phase3_client, dataset_response.json()["job"]["job_id"])
    assert dataset_job["status"] == "succeeded"
    assert dataset_job["result_summary"] == "dataset validated: 3 rows"
    assert [item["name"] for item in dataset_job["artifact_refs"]] == ["dataset_quality.json"]


def test_artifact_dataset_backtest_generates_complete_outputs_and_progress(
    phase3_client: TestClient, phase3_strategy: dict[str, Any]
) -> None:
    source = _write_input(phase3_client)
    response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-backtest-001",
            job_type="run_forex_backtest",
            timeout_seconds=10,
            max_retries=0,
            payload={
                "strategy_spec": phase3_strategy,
                "dataset": {
                    "source": "artifact",
                    "job_id": source.job_id,
                    "artifact_id": source.artifact_id,
                    "format": "csv",
                },
                "run_config": {
                    "initial_capital": 10_000,
                    "account_currency": "USD",
                    "leverage": 30,
                    "seed": 42,
                    "intrabar_policy": "worst_case",
                },
            },
        ),
    )
    job = wait_terminal(phase3_client, response.json()["job"]["job_id"])

    assert job["status"] == "succeeded", job
    names = {item["name"] for item in job["artifact_refs"]}
    assert {
        "strategy_spec.json",
        "dataset_quality.json",
        "run_config.json",
        "metrics.json",
        "trades.csv",
        "orders.csv",
        "equity.csv",
        "drawdown.csv",
        "events.json",
        "attribution.json",
        "chart_annotations.json",
    } <= names
    events = phase3_client.get(
        f"/internal/research/jobs/{job['job_id']}/events", headers=headers()
    ).json()["events"]
    assert [event["percent"] for event in events] == sorted(event["percent"] for event in events)
    assert "run_simulation" in {event["stage"] for event in events}


def test_phase3_retries_paths_urls_and_dynamic_code_are_rejected(
    phase3_client: TestClient, phase3_strategy: dict[str, Any]
) -> None:
    retry = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-retry-001",
            job_type="validate_strategy_spec",
            payload={"strategy_spec": phase3_strategy},
            max_retries=1,
        ),
    )
    assert retry.status_code == 422

    for dataset in (
        {
            "source": "artifact",
            "artifact_id": "ra_123",
            "job_id": "rj_123",
            "format": "csv",
            "path": "../x",
        },
        {"source": "aichart_candle_warehouse", "payload": {"url": "https://example.test/x"}},
    ):
        response = phase3_client.post(
            "/internal/research/jobs",
            headers=headers(),
            json=job_body(
                key=f"phase3-reject-{len(json.dumps(dataset))}",
                job_type="validate_dataset",
                payload={"dataset": dataset},
                max_retries=0,
            ),
        )
        assert response.status_code == 422

    unsafe_strategy = {**phase3_strategy, "python": "print('not executed')"}
    response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-code-reject-001",
            job_type="validate_strategy_spec",
            payload={"strategy_spec": unsafe_strategy},
            max_retries=0,
        ),
    )
    assert response.status_code == 422


def test_phase3_failure_message_is_normalized_and_tenant_input_isolated(
    phase3_client: TestClient,
) -> None:
    source = _write_input(phase3_client, content=b"not,a,canonical,dataset\n1,2,3,4\n")
    response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-invalid-data-001",
            job_type="validate_dataset",
            payload={
                "dataset": {
                    "source": "artifact",
                    "job_id": source.job_id,
                    "artifact_id": source.artifact_id,
                    "format": "csv",
                }
            },
            max_retries=0,
        ),
    )
    job = wait_terminal(phase3_client, response.json()["job"]["job_id"])
    assert job["status"] == "failed"
    assert job["error_code"] == "DATASET_INVALID"
    assert job["error_message"] == "dataset validation failed"
    assert "canonical" not in job["error_message"]

    other_response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(2, "req-user-2"),
        json=job_body(
            user_id=2,
            request_id="req-user-2",
            key="phase3-cross-user-001",
            job_type="validate_dataset",
            payload={
                "dataset": {
                    "source": "artifact",
                    "job_id": source.job_id,
                    "artifact_id": source.artifact_id,
                    "format": "csv",
                }
            },
            max_retries=0,
        ),
    )
    other = wait_terminal(phase3_client, other_response.json()["job"]["job_id"], user_id=2)
    assert other["error_code"] == "JOB_NOT_FOUND"
    assert other["error_message"] == "research input artifact not found"


def test_run_config_accepts_json_enum_and_payload_byte_limits_are_per_job() -> None:
    payload = {
        "strategy_spec": {"strategy_id": "strat.placeholder"},
        "dataset": {
            "source": "aichart_candle_warehouse",
            "payload": _warehouse_payload(),
        },
        "run_config": {
            "initial_capital": 10_000,
            "account_currency": "USD",
            "seed": 42,
            "intrabar_policy": "worst_case",
        },
    }
    # The run config reaches JSON-mode parsing; strategy completeness is checked by its own job.
    from app.jobs.payloads import RunForexBacktestPayload

    parsed = RunForexBacktestPayload.model_validate(payload)
    assert parsed.run_config.intrabar_policy.value == "worst_case"

    with pytest.raises(ValidationError):
        JobCreateRequest(
            job_type=JobType.SERVICE_SMOKE_TEST,
            user_id=1,
            request_id="req-size",
            idempotency_key="smoke-size-001",
            payload={"value": "🙂" * 3000},
        )
    JobCreateRequest(
        job_type=JobType.VALIDATE_DATASET,
        user_id=1,
        request_id="req-size",
        idempotency_key="phase3-size-001",
        payload={"value": "x" * 9000},
    )
    with pytest.raises(ValidationError):
        JobCreateRequest(
            job_type=JobType.VALIDATE_DATASET,
            user_id=1,
            request_id="req-size",
            idempotency_key="phase3-size-002",
            payload={"value": "x" * (8 * 1024 * 1024)},
        )

    oversized_warehouse = _warehouse_payload()
    oversized_warehouse["padding"] = "x" * 1500
    with pytest.raises(ValidationError, match="size limit"):
        ValidateDatasetPayload.model_validate(
            {
                "dataset": {
                    "source": "aichart_candle_warehouse",
                    "payload": oversized_warehouse,
                },
                "limits": {"max_file_bytes": 1024},
            }
        )


def test_validation_job_resolves_backtest_artifacts_and_writes_sensitivity(
    phase3_client: TestClient,
) -> None:
    source_job = asyncio.run(_seed_succeeded_backtest(phase3_client))
    references = {reference.name: reference.artifact_id for reference in source_job.artifact_refs}
    response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-validation-001",
            job_type="run_backtest_validation",
            timeout_seconds=20,
            max_retries=0,
            payload={
                "backtest_run": {
                    "job_id": source_job.job_id,
                    "metrics_artifact_id": references["metrics.json"],
                    "trades_artifact_id": references["trades.csv"],
                    "equity_artifact_id": references["equity.csv"],
                    "run_config_artifact_id": references["run_config.json"],
                },
                "validation_config": {
                    "seed": 9,
                    "simulation_count": 100,
                    "methods": ["trade_return_bootstrap", "execution_cost_stress"],
                    "bootstrap_samples": 100,
                    "walk_forward_windows": 2,
                    "cost_sensitivity_points": 3,
                },
            },
        ),
    )
    job = wait_terminal(phase3_client, response.json()["job"]["job_id"])

    assert job["status"] == "succeeded", job
    assert {reference["name"] for reference in job["artifact_refs"]} == {
        "validation.json",
        "readiness.json",
        "sensitivity.json",
    }
    events = phase3_client.get(
        f"/internal/research/jobs/{job['job_id']}/events", headers=headers()
    ).json()["events"]
    stages = {event["stage"] for event in events}
    assert {"monte_carlo", "bootstrap", "walk_forward", "sensitivity"} <= stages


def test_cancellation_event_reaches_running_backtest_engine(
    phase3_client: TestClient,
    phase3_strategy: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _write_input(phase3_client, job_id="rj_cancel_input")

    class SlowEngine:
        def __init__(self, *_args: object) -> None:
            pass

        async def run(self, cancelled: asyncio.Event):
            while not cancelled.is_set():
                await asyncio.sleep(0.005)
            raise JobCancelled

    monkeypatch.setattr("app.jobs.phase3.BacktestEngine", SlowEngine)
    response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-cancel-001",
            job_type="run_forex_backtest",
            timeout_seconds=10,
            max_retries=0,
            payload={
                "strategy_spec": phase3_strategy,
                "dataset": {
                    "source": "artifact",
                    "job_id": source.job_id,
                    "artifact_id": source.artifact_id,
                    "format": "csv",
                },
                "run_config": {"initial_capital": 10_000},
            },
        ),
    )
    job_id = response.json()["job"]["job_id"]
    for _ in range(100):
        current = phase3_client.get(f"/internal/research/jobs/{job_id}", headers=headers()).json()
        if current["status"] == "running":
            break
    cancelled = phase3_client.post(f"/internal/research/jobs/{job_id}/cancel", headers=headers())
    assert cancelled.status_code == 200
    terminal = wait_terminal(phase3_client, job_id)
    assert terminal["status"] == "cancelled"
    assert terminal["max_attempts"] == 1


def test_large_warehouse_real_pipeline_reaches_strategy_sensitivity_and_readiness(
    phase3_client: TestClient,
    phase3_strategy: dict[str, Any],
) -> None:
    warehouse = _large_warehouse_payload()
    assert len(json.dumps(warehouse, separators=(",", ":")).encode("utf-8")) > 48 * 1024
    strategy = json.loads(json.dumps(phase3_strategy))
    strategy["entry"]["allow_reentry"] = True
    strategy["targets"] = [{"type": "risk_reward", "size_percent": 100.0, "value": 1.0}]
    strategy["risk_controls"]["daily_trade_limit"] = 1_000
    strategy["risk_controls"]["max_consecutive_losses"] = 1_000
    strategy["risk_controls"]["minimum_reward_risk"] = 1.0

    strategy_response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-e2e-strategy-001",
            job_type="validate_strategy_spec",
            max_retries=0,
            payload={"strategy_spec": strategy},
        ),
    )
    strategy_job = wait_terminal(phase3_client, strategy_response.json()["job"]["job_id"])
    assert strategy_job["status"] == "succeeded", strategy_job

    dataset_input = {"source": "aichart_candle_warehouse", "payload": warehouse}
    dataset_response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-e2e-dataset-001",
            job_type="validate_dataset",
            max_retries=0,
            payload={"dataset": dataset_input},
        ),
    )
    dataset_job = wait_terminal(phase3_client, dataset_response.json()["job"]["job_id"])
    assert dataset_job["status"] == "succeeded", dataset_job

    backtest_response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-e2e-backtest-001",
            job_type="run_forex_backtest",
            timeout_seconds=30,
            max_retries=0,
            payload={
                "strategy_spec": strategy,
                "dataset": dataset_input,
                "run_config": {
                    "initial_capital": 10_000,
                    "account_currency": "USD",
                    "seed": 17,
                    "intrabar_policy": "worst_case",
                },
            },
        ),
    )
    backtest_job = wait_terminal(phase3_client, backtest_response.json()["job"]["job_id"])
    assert backtest_job["status"] == "succeeded", backtest_job
    backtest_artifacts = {
        reference["name"]: reference["artifact_id"] for reference in backtest_job["artifact_refs"]
    }
    assert {
        "strategy_spec.json",
        "dataset_quality.json",
        "metrics.json",
        "trades.csv",
        "equity.csv",
        "chart_annotations.json",
    } <= backtest_artifacts.keys()

    validation_response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-e2e-validation-001",
            job_type="run_backtest_validation",
            timeout_seconds=30,
            max_retries=0,
            payload={
                "backtest_run": {
                    "job_id": backtest_job["job_id"],
                    "metrics_artifact_id": backtest_artifacts["metrics.json"],
                    "trades_artifact_id": backtest_artifacts["trades.csv"],
                    "equity_artifact_id": backtest_artifacts["equity.csv"],
                    "run_config_artifact_id": backtest_artifacts["run_config.json"],
                },
                "validation_config": {
                    "seed": 23,
                    "simulation_count": 100,
                    "methods": [
                        "trade_return_bootstrap",
                        "execution_cost_stress",
                    ],
                    "bootstrap_samples": 100,
                    "walk_forward_windows": 2,
                    "cost_sensitivity_points": 3,
                    "strategy_sensitivity": {
                        "parameters": [
                            {
                                "name": "stop_loss.value",
                                "base_value": 10.0,
                                "lower_bound": 8.0,
                                "upper_bound": 12.0,
                                "step_count": 3,
                            }
                        ],
                        "maximum_combinations": 3,
                    },
                },
            },
        ),
    )
    validation_job = wait_terminal(
        phase3_client,
        validation_response.json()["job"]["job_id"],
        attempts=400,
    )
    assert validation_job["status"] == "succeeded", validation_job
    assert {reference["name"] for reference in validation_job["artifact_refs"]} == {
        "validation.json",
        "readiness.json",
        "sensitivity.json",
    }
    sensitivity_reference = next(
        reference
        for reference in validation_job["artifact_refs"]
        if reference["name"] == "sensitivity.json"
    )
    manager = phase3_client.app.state.manager
    sensitivity_artifact = asyncio.run(
        JobArtifactService(manager.artifacts, manager.store).read_json_object(
            user_id=1,
            source_job_id=validation_job["job_id"],
            artifact_id=sensitivity_reference["artifact_id"],
            max_bytes=8 * 1024 * 1024,
        )
    )
    assert sensitivity_artifact["execution_cost"] is not None
    assert sensitivity_artifact["strategy_parameters"]["combinations"]
    assert {
        outcome["parameters"]["stop_loss.value"]
        for outcome in sensitivity_artifact["strategy_parameters"]["combinations"]
    } == {8.0, 10.0, 12.0}


def test_statistical_job_cancels_inside_worker_loop_without_partial_artifacts(
    phase3_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_job = asyncio.run(_seed_succeeded_backtest(phase3_client))
    references = {reference.name: reference.artifact_id for reference in source_job.artifact_refs}

    def cancellable_simulation(*_args: object, **kwargs: object) -> object:
        cancel_check = kwargs["cancel_check"]
        assert callable(cancel_check)
        while True:
            cancel_check()
            time.sleep(0.002)

    monkeypatch.setattr("app.jobs.phase3.run_monte_carlo", cancellable_simulation)
    response = phase3_client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="phase3-validation-cancel-001",
            job_type="run_backtest_validation",
            timeout_seconds=20,
            max_retries=0,
            payload={
                "backtest_run": {
                    "job_id": source_job.job_id,
                    "metrics_artifact_id": references["metrics.json"],
                    "trades_artifact_id": references["trades.csv"],
                    "equity_artifact_id": references["equity.csv"],
                    "run_config_artifact_id": references["run_config.json"],
                },
                "validation_config": {
                    "seed": 9,
                    "simulation_count": 1_000,
                    "methods": ["trade_return_bootstrap"],
                },
            },
        ),
    )
    job_id = response.json()["job"]["job_id"]
    for _ in range(200):
        current = phase3_client.get(f"/internal/research/jobs/{job_id}", headers=headers()).json()
        if current["status"] == "running":
            break
        time.sleep(0.005)
    cancel_response = phase3_client.post(
        f"/internal/research/jobs/{job_id}/cancel", headers=headers()
    )
    assert cancel_response.status_code == 200
    terminal = wait_terminal(phase3_client, job_id)
    assert terminal["status"] == "cancelled"
    assert terminal["artifact_refs"] == []
