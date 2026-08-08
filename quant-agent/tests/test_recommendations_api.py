from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import headers
from tests.fixtures import bars_no_signal, bars_triggering_ema_trend_buy


def _create_body(bars, **overrides):
    body = {
        "symbol": "EURUSD",
        "market": "forex",
        "interval": "M15",
        "owner_user_id": 1,
        "request_id": "req-test-0001",
        "bars": bars,
    }
    body.update(overrides)
    return body


def test_post_then_get_by_id_round_trip(client: TestClient) -> None:
    response = client.post(
        "/internal/quant-agent/recommendations",
        headers=headers(),
        json=_create_body(bars_triggering_ema_trend_buy()),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "created"
    recommendation = payload["recommendation"]
    assert recommendation["symbol"] == "EURUSD"
    assert recommendation["direction"] == "buy"
    assert recommendation["strategy_id"] == "ema_trend_v1"
    assert recommendation["lifecycle_state"] == "active"

    fetched = client.get(
        f"/internal/quant-agent/recommendations/{recommendation['id']}", headers=headers()
    )
    assert fetched.status_code == 200
    assert fetched.json()["id"] == recommendation["id"]


def test_get_by_id_unknown_is_not_found(client: TestClient) -> None:
    response = client.get("/internal/quant-agent/recommendations/qrec_missing", headers=headers())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "QUANT_AGENT_NOT_FOUND"


def test_repeat_post_with_identical_bars_deduplicates(client: TestClient) -> None:
    bars = bars_triggering_ema_trend_buy()
    first = client.post(
        "/internal/quant-agent/recommendations",
        headers=headers(),
        json=_create_body(bars, request_id="req-a"),
    )
    second = client.post(
        "/internal/quant-agent/recommendations",
        headers=headers(),
        json=_create_body(bars, request_id="req-b"),
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["status"] == "created"
    assert second.json()["status"] == "deduplicated"
    assert first.json()["recommendation"]["id"] == second.json()["recommendation"]["id"]


def test_no_signal_market_returns_no_signal_status_without_persisting(client: TestClient) -> None:
    response = client.post(
        "/internal/quant-agent/recommendations",
        headers=headers(),
        json=_create_body(bars_no_signal()),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "no_signal"
    assert payload["recommendation"] is None
    assert payload["no_signal"]["symbol"] == "EURUSD"

    listed = client.get("/internal/quant-agent/recommendations", headers=headers())
    assert listed.json()["recommendations"] == []


def test_insufficient_bars_is_rejected(client: TestClient) -> None:
    short_bars = bars_triggering_ema_trend_buy()[:5]
    response = client.post(
        "/internal/quant-agent/recommendations",
        headers=headers(),
        json=_create_body(short_bars),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "QUANT_AGENT_INSUFFICIENT_BARS"


def test_list_filters_by_symbol_and_state(client: TestClient) -> None:
    client.post(
        "/internal/quant-agent/recommendations",
        headers=headers(),
        json=_create_body(bars_triggering_ema_trend_buy(), symbol="EURUSD"),
    )
    client.post(
        "/internal/quant-agent/recommendations",
        headers=headers(),
        json=_create_body(bars_triggering_ema_trend_buy(), symbol="GBPUSD"),
    )

    eurusd_only = client.get(
        "/internal/quant-agent/recommendations", headers=headers(), params={"symbol": "EURUSD"}
    )
    assert [r["symbol"] for r in eurusd_only.json()["recommendations"]] == ["EURUSD"]

    active_only = client.get(
        "/internal/quant-agent/recommendations", headers=headers(), params={"state": "active"}
    )
    assert len(active_only.json()["recommendations"]) == 2

    expired_only = client.get(
        "/internal/quant-agent/recommendations", headers=headers(), params={"state": "expired"}
    )
    assert expired_only.json()["recommendations"] == []


def test_strategies_endpoint_lists_registered_strategies(client: TestClient) -> None:
    response = client.get("/internal/quant-agent/strategies", headers=headers())
    assert response.status_code == 200
    strategy_ids = {item["strategy_id"] for item in response.json()["strategies"]}
    assert strategy_ids == {"ema_trend_v1", "rsi_reversion_v1"}
