from __future__ import annotations

import ast
import json
import logging
import os
from pathlib import Path

import pytest
from conftest import TOKEN, headers, job_body, wait_terminal
from fastapi.testclient import TestClient

from app.core.redaction import bounded_metadata, contains_rejected_content, redact, redact_text
from app.errors import ServiceError
from app.logging import JsonFormatter
from app.storage.artifacts import ArtifactStore


def test_artifact_job_hash_reference_and_tenant_isolation(client: TestClient) -> None:
    response = client.post(
        "/internal/research/jobs",
        headers=headers(),
        json=job_body(
            key="artifact-key-01",
            job_type="artifact_smoke_test",
            payload={"duration_ms": 5, "steps": 1, "name": "result.json"},
        ),
    )
    job = wait_terminal(client, response.json()["job"]["job_id"])
    assert job["status"] == "succeeded"
    reference = job["artifact_refs"][0]
    assert len(reference["sha256"]) == 64
    assert not Path(reference["relative_path"]).is_absolute()
    own = client.get(
        f"/internal/research/jobs/{job['job_id']}/artifacts/{reference['artifact_id']}",
        headers=headers(),
    )
    other = client.get(
        f"/internal/research/jobs/{job['job_id']}/artifacts/{reference['artifact_id']}",
        headers=headers(2, "req-user-2"),
    )
    assert own.status_code == 200
    assert other.status_code == 404


async def test_artifact_rejects_traversal_absolute_and_oversize(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path / "artifacts", 32)
    await store.initialize()
    for invalid in ["../escape.json", str((tmp_path / "absolute.json").resolve())]:
        with pytest.raises(ServiceError, match="invalid artifact name"):
            await store.write(1, "rj_test", "json", invalid, b"{}")
    with pytest.raises(ServiceError) as oversized:
        await store.write(1, "rj_test", "json", "large.json", b"x" * 33)
    assert oversized.value.code == "ARTIFACT_TOO_LARGE"


async def test_artifact_rejects_symlink_escape_when_supported(tmp_path: Path) -> None:
    root = tmp_path / "artifacts"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    user_dir = root / "u-1"
    try:
        os.symlink(outside, user_dir, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation is unavailable on this Windows account")
    store = ArtifactStore(root, 100)
    with pytest.raises(ServiceError):
        await store.write(1, "rj_test", "json", "safe.json", b"{}")


async def test_artifact_store_enforces_no_overwrite_and_per_job_limits(
    tmp_path: Path,
) -> None:
    store = ArtifactStore(
        tmp_path / "bounded-artifacts",
        8,
        max_artifacts_per_job=2,
        max_total_bytes_per_job=6,
    )
    await store.initialize()
    first = await store.write(1, "rj_bounded", "json", "first.json", b"{}")
    with pytest.raises(ServiceError) as duplicate:
        await store.write(1, "rj_bounded", "json", "first.json", b"xx")
    assert duplicate.value.code == "ARTIFACT_CONFLICT"
    assert (store.root / first.relative_path).read_bytes() == b"{}"

    await store.write(1, "rj_bounded", "json", "second.json", b"1234")
    with pytest.raises(ServiceError) as count_limited:
        await store.write(1, "rj_bounded", "json", "third.json", b"")
    assert count_limited.value.code == "ARTIFACT_LIMIT"
    assert await store.usage_for_job(1, "rj_bounded") == (2, 6)

    # Limits are scoped per tenant and job, not process-wide.
    await store.write(1, "rj_other", "json", "first.json", b"123456")
    assert await store.usage_for_job(1, "rj_other") == (1, 6)


async def test_artifact_store_enforces_total_bytes_independently_of_count(
    tmp_path: Path,
) -> None:
    store = ArtifactStore(
        tmp_path / "total-artifacts",
        8,
        max_artifacts_per_job=4,
        max_total_bytes_per_job=5,
    )
    await store.initialize()
    await store.write(1, "rj_total", "json", "one.json", b"123")
    with pytest.raises(ServiceError) as total_limited:
        await store.write(1, "rj_total", "json", "two.json", b"456")
    assert total_limited.value.code == "ARTIFACT_LIMIT"
    assert await store.usage_for_job(1, "rj_total") == (1, 3)


def test_redaction_and_private_key_rejection() -> None:
    value = redact(
        {
            "authorization": f"Bearer {TOKEN}",
            "nested": {"api_key": "secret-value"},
            "message": f"Authorization: Bearer {TOKEN}",
        }
    )
    encoded = json.dumps(value)
    assert TOKEN not in encoded
    assert "secret-value" not in encoded
    assert redact_text("-----BEGIN PRIVATE KEY-----\nabc") == "[REJECTED_PRIVATE_KEY]"
    assert bounded_metadata({"token": TOKEN, "x": "a" * 5000}, 64) == {"truncated": True}
    assert contains_rejected_content({"private_key": "value"})
    assert contains_rejected_content({"note": "-----BEGIN PRIVATE KEY-----"})


def test_structured_log_redacts_message_and_context() -> None:
    record = logging.LogRecord(
        "research",
        logging.INFO,
        __file__,
        1,
        f"request Authorization: Bearer {TOKEN}",
        (),
        None,
    )
    record.context = {"request_id": "req-log", "api_key": TOKEN}
    encoded = JsonFormatter().format(record)
    body = json.loads(encoded)
    assert TOKEN not in encoded
    assert body["service"] == "aichart-research"
    assert body["request_id"] == "req-log"


def test_request_size_limit_and_token_non_disclosure(client: TestClient) -> None:
    response = client.post(
        "/internal/research/jobs",
        headers={**headers(), "Content-Length": "5000"},
        content=b"{}",
    )
    assert response.status_code == 413
    assert TOKEN not in response.text


def test_service_has_static_no_execution_boundary() -> None:
    app_root = Path(__file__).parents[1] / "app"
    forbidden_imports = {
        "aiohttp",
        "cloudpickle",
        "dill",
        "httpx",
        "importlib",
        "pickle",
        "requests",
        "subprocess",
        "urllib",
    }
    forbidden_calls = {
        "__import__",
        "broker_order",
        "close_trade",
        "compile",
        "ea_order",
        "eval",
        "exec",
        "execute_trade",
        "modify_sl_tp",
        "mt5_order",
        "open_trade",
        "request_approval",
        "respond_approval",
    }
    forbidden_attributes = {
        "os.popen",
        "os.system",
        "subprocess.call",
        "subprocess.check_call",
        "subprocess.check_output",
        "subprocess.popen",
        "subprocess.run",
    }
    violations: list[str] = []
    for path in app_root.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".", 1)[0].lower() in forbidden_imports:
                        violations.append(f"{path}:{node.lineno}: import {alias.name}")
            elif isinstance(node, ast.ImportFrom) and node.module:
                if node.module.split(".", 1)[0].lower() in forbidden_imports:
                    violations.append(f"{path}:{node.lineno}: from {node.module}")
            elif isinstance(node, ast.Call):
                call_name = _ast_call_name(node.func).lower()
                if call_name in forbidden_calls or call_name in forbidden_attributes:
                    violations.append(f"{path}:{node.lineno}: call {call_name}")
    assert violations == []


def _ast_call_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _ast_call_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""
