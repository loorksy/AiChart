from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import headers

_VALID_CODE = """
def evaluate(features):
    idx = features['last']
    atr = features['atr14']
    if idx < 0 or idx >= len(atr) or atr[idx] is None:
        return None
    return {
        'direction': 'buy',
        'stop_loss_atr_multiple': 1.5,
        'take_profit_r_multiples': [1.0, 2.0, 3.0],
        'rationale': 'fires whenever ATR is available',
    }
"""

_UNSAFE_CODE = "import os\n\ndef evaluate(features):\n    os.system('id')\n    return None\n"


def _valid_body(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "owner_user_id": 7001,
        "strategy_id": "sandboxed_ema_v1",
        "version": "1.0.0",
        "display_name": "Sandboxed Code Strategy",
        "description": "AI-generated Python, sandbox-validated",
        "regime_affinity": "trend",
        "code": _VALID_CODE,
    }
    base.update(overrides)
    return base


def _strategy_count(client: TestClient) -> int:
    response = client.get("/internal/quant-agent/strategies", headers=headers())
    assert response.status_code == 200
    return len(response.json()["strategies"])


def test_generate_validate_code_persists_valid_code_disabled(client: TestClient) -> None:
    before = _strategy_count(client)

    response = client.post(
        "/internal/quant-agent/strategies/generate-validate-code",
        headers=headers(),
        json=_valid_body(),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "persisted"
    assert payload["errors"] == []
    strategy = payload["strategy"]
    assert strategy["strategy_id"] == "sandboxed_ema_v1"
    assert strategy["enabled"] is False
    assert strategy["source_generated"] is True
    assert strategy["generation_mode"] == "sandboxed_code"
    assert strategy["source_code"] == _VALID_CODE
    assert strategy["params_json"] is None

    after = _strategy_count(client)
    assert after == before + 1


def test_generate_validate_code_rejects_unsafe_code_without_writing_a_row(
    client: TestClient,
) -> None:
    before = _strategy_count(client)

    response = client.post(
        "/internal/quant-agent/strategies/generate-validate-code",
        headers=headers(),
        json=_valid_body(code=_UNSAFE_CODE),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["strategy"] is None
    assert len(payload["errors"]) > 0

    after = _strategy_count(client)
    assert after == before


def test_generate_validate_code_rejects_strategy_id_colliding_with_builtin(
    client: TestClient,
) -> None:
    before = _strategy_count(client)

    response = client.post(
        "/internal/quant-agent/strategies/generate-validate-code",
        headers=headers(),
        json=_valid_body(strategy_id="ema_trend_v1"),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "invalid"
    assert _strategy_count(client) == before

    listed = client.get("/internal/quant-agent/strategies", headers=headers())
    builtin = next(
        item for item in listed.json()["strategies"] if item["strategy_id"] == "ema_trend_v1"
    )
    assert builtin["enabled"] is True
    assert builtin["source_generated"] is False


def test_generate_validate_code_rejects_extra_unknown_top_level_field(
    client: TestClient,
) -> None:
    body = _valid_body()
    body["unexpected"] = True
    response = client.post(
        "/internal/quant-agent/strategies/generate-validate-code",
        headers=headers(),
        json=body,
    )
    assert response.status_code == 422


def test_patch_enable_toggles_sandboxed_code_strategy(client: TestClient) -> None:
    client.post(
        "/internal/quant-agent/strategies/generate-validate-code",
        headers=headers(),
        json=_valid_body(),
    )

    response = client.patch(
        "/internal/quant-agent/strategies/sandboxed_ema_v1",
        headers=headers(),
        json={"status": "active", "owner_user_id": 7001},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["generation_mode"] == "sandboxed_code"

    disable_response = client.patch(
        "/internal/quant-agent/strategies/sandboxed_ema_v1",
        headers=headers(),
        json={"status": "paused", "owner_user_id": 7001},
    )
    assert disable_response.status_code == 200
    assert disable_response.json()["enabled"] is False
