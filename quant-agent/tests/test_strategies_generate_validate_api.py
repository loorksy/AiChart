from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import headers


def _valid_spec(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "strategy_id": "declarative_ema_cross_v1",
        "version": "1.0.0",
        "display_name": "Declarative EMA Cross",
        "description": "EMA20/50 crossover gated by ADX",
        "regime_affinity": "trend",
        "direction": "buy",
        "entry_conditions": {
            "all": [
                {
                    "type": "ema_relation",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "crosses_above",
                },
                {"type": "adx_threshold", "operator": "above", "value": 20.0},
            ]
        },
        "stop_loss_atr_multiple": 1.5,
        "take_profit_r_multiples": [1.0, 2.0, 3.0],
    }
    base.update(overrides)
    return base


def _strategy_count(client: TestClient) -> int:
    response = client.get("/internal/quant-agent/strategies", headers=headers())
    assert response.status_code == 200
    return len(response.json()["strategies"])


def test_generate_validate_persists_valid_spec_disabled(client: TestClient) -> None:
    before = _strategy_count(client)

    response = client.post(
        "/internal/quant-agent/strategies/generate-validate",
        headers=headers(),
        json={"spec": _valid_spec()},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "persisted"
    assert payload["errors"] == []
    strategy = payload["strategy"]
    assert strategy["strategy_id"] == "declarative_ema_cross_v1"
    assert strategy["enabled"] is False
    assert strategy["source_generated"] is True
    assert strategy["params_json"] is not None

    after = _strategy_count(client)
    assert after == before + 1

    listed = client.get("/internal/quant-agent/strategies", headers=headers())
    matching = [
        item
        for item in listed.json()["strategies"]
        if item["strategy_id"] == "declarative_ema_cross_v1"
    ]
    assert len(matching) == 1
    assert matching[0]["enabled"] is False
    assert matching[0]["source_generated"] is True


def test_generate_validate_rejects_invalid_spec_without_writing_a_row(client: TestClient) -> None:
    before = _strategy_count(client)

    response = client.post(
        "/internal/quant-agent/strategies/generate-validate",
        headers=headers(),
        json={"spec": _valid_spec(entry_conditions={"all": [{"type": "not_a_real_type"}]})},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["strategy"] is None
    assert len(payload["errors"]) > 0
    assert all({"path", "message"} <= item.keys() for item in payload["errors"])

    after = _strategy_count(client)
    assert after == before


def test_generate_validate_rejects_out_of_range_values_without_writing_a_row(
    client: TestClient,
) -> None:
    before = _strategy_count(client)

    response = client.post(
        "/internal/quant-agent/strategies/generate-validate",
        headers=headers(),
        json={
            "spec": _valid_spec(
                entry_conditions={
                    "all": [{"type": "rsi_threshold", "operator": "above", "value": 500.0}]
                }
            )
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "invalid"
    assert _strategy_count(client) == before


def test_generate_validate_rejects_strategy_id_colliding_with_builtin(client: TestClient) -> None:
    before = _strategy_count(client)

    response = client.post(
        "/internal/quant-agent/strategies/generate-validate",
        headers=headers(),
        json={"spec": _valid_spec(strategy_id="ema_trend_v1")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "invalid"
    assert _strategy_count(client) == before

    # The built-in row must remain untouched: still enabled, still not
    # source_generated.
    listed = client.get("/internal/quant-agent/strategies", headers=headers())
    builtin = next(
        item for item in listed.json()["strategies"] if item["strategy_id"] == "ema_trend_v1"
    )
    assert builtin["enabled"] is True
    assert builtin["source_generated"] is False


def test_generate_validate_rejects_extra_unknown_top_level_field(client: TestClient) -> None:
    response = client.post(
        "/internal/quant-agent/strategies/generate-validate",
        headers=headers(),
        json={"spec": _valid_spec(), "unexpected": True},
    )
    assert response.status_code == 422  # GenerateValidateRequest forbids extra fields


def test_patch_enable_toggles_generated_strategy(client: TestClient) -> None:
    client.post(
        "/internal/quant-agent/strategies/generate-validate",
        headers=headers(),
        json={"spec": _valid_spec()},
    )

    response = client.patch(
        "/internal/quant-agent/strategies/declarative_ema_cross_v1",
        headers=headers(),
        json={"enabled": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["source_generated"] is True

    listed = client.get("/internal/quant-agent/strategies", headers=headers())
    matching = next(
        item
        for item in listed.json()["strategies"]
        if item["strategy_id"] == "declarative_ema_cross_v1"
    )
    assert matching["enabled"] is True

    disable_response = client.patch(
        "/internal/quant-agent/strategies/declarative_ema_cross_v1",
        headers=headers(),
        json={"enabled": False},
    )
    assert disable_response.status_code == 200
    assert disable_response.json()["enabled"] is False


def test_patch_rejects_hardcoded_strategy_ema_trend_v1(client: TestClient) -> None:
    response = client.patch(
        "/internal/quant-agent/strategies/ema_trend_v1",
        headers=headers(),
        json={"enabled": False},
    )
    assert response.status_code == 404

    listed = client.get("/internal/quant-agent/strategies", headers=headers())
    builtin = next(
        item for item in listed.json()["strategies"] if item["strategy_id"] == "ema_trend_v1"
    )
    assert builtin["enabled"] is True


def test_patch_rejects_hardcoded_strategy_rsi_reversion_v1(client: TestClient) -> None:
    response = client.patch(
        "/internal/quant-agent/strategies/rsi_reversion_v1",
        headers=headers(),
        json={"enabled": False},
    )
    assert response.status_code == 404

    listed = client.get("/internal/quant-agent/strategies", headers=headers())
    builtin = next(
        item for item in listed.json()["strategies"] if item["strategy_id"] == "rsi_reversion_v1"
    )
    assert builtin["enabled"] is True


def test_patch_rejects_unknown_strategy_id(client: TestClient) -> None:
    response = client.patch(
        "/internal/quant-agent/strategies/does_not_exist_v1",
        headers=headers(),
        json={"enabled": True},
    )
    assert response.status_code == 404
