"""The bot endpoints end to end, with ownership checked on every by-id verb."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import headers

BASE = "/internal/quant-agent/bots"

OWNER = 501
INTRUDER = 502


def grid_config(**overrides: Any) -> dict[str, Any]:
    config: dict[str, Any] = {
        "side": "long",
        "market_type": "spot",
        "start_price": 100.0,
        "end_price": 110.0,
        "grid_count": 5,
        "total_amount_quote": 500.0,
        "initial_position_pct": 0,
        "max_open_orders": 5,
        "min_spread_between_orders": 0,
    }
    config.update(overrides)
    return config


def create_bot(client: TestClient, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "owner_user_id": OWNER,
        "bot_type": "grid",
        "name": "XAUUSD grid",
        "symbol": "XAUUSD",
        "market": "forex",
        "interval": "1h",
        "initial_capital": 1000.0,
        "fee_rate": 0.001,
        "config": grid_config(),
    }
    body.update(overrides)
    response = client.post(BASE, json=body, headers=headers())
    assert response.status_code == 200, response.text
    return dict(response.json())


def bars(prices: list[tuple[float, float, float]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for index, (low, high, close) in enumerate(prices):
        out.append(
            {
                "time": f"2026-05-01T{index:02d}:00:00+00:00",
                "open": (low + high) / 2.0,
                "high": high,
                "low": low,
                "close": close,
            }
        )
    return out


def test_every_bot_endpoint_requires_auth(client: TestClient) -> None:
    assert client.get(BASE, params={"owner_user_id": OWNER}).status_code == 401
    assert client.post(f"{BASE}/preview", json={"bot_type": "grid"}).status_code == 401
    assert client.post(BASE, json={}).status_code == 401
    assert client.get(f"{BASE}/x", params={"owner_user_id": OWNER}).status_code == 401
    assert client.delete(f"{BASE}/x", params={"owner_user_id": OWNER}).status_code == 401
    assert client.post(f"{BASE}/x/simulate", json={}).status_code == 401


def test_preview_returns_a_ladder_without_storing_anything(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/preview",
        json={"bot_type": "grid", "config": grid_config()},
        headers=headers(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["execution_mode"] == "simulation"
    assert len(body["levels"]) == 5
    assert body["summary"]["level_count"] == 5
    assert body["blocking_warning"] == ""

    listed = client.get(BASE, params={"owner_user_id": OWNER}, headers=headers())
    assert listed.json()["bots"] == []


def test_preview_explains_a_bad_config_in_the_body_not_an_http_error(
    client: TestClient,
) -> None:
    response = client.post(
        f"{BASE}/preview",
        json={"bot_type": "grid", "config": grid_config(grid_count=500)},
        headers=headers(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "invalid"
    assert body["error"].startswith("GRID_COUNT_EXCEEDS_SAFE_LIMIT")


def test_preview_flags_a_blocking_warning(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/preview",
        json={"bot_type": "martingale", "config": {"entry_price": 0, "base_order_size": 0}},
        headers=headers(),
    )
    body = response.json()
    assert body["status"] == "ok"
    assert body["blocking_warning"] in ("missing_entry_price", "missing_base_order_size")


def test_creating_a_bot_stores_the_normalized_config_and_its_ladder(
    client: TestClient,
) -> None:
    bot = create_bot(client)
    assert bot["execution_mode"] == "simulation"
    assert bot["owner_user_id"] == OWNER
    assert bot["config"]["grid_count"] == 5
    assert len(bot["levels"]) == 5
    assert bot["id"].startswith("qbot_")


def test_a_blocking_config_cannot_be_saved(client: TestClient) -> None:
    response = client.post(
        BASE,
        json={
            "owner_user_id": OWNER,
            "bot_type": "martingale",
            "name": "bad",
            "symbol": "XAUUSD",
            "interval": "1h",
            "config": {"entry_price": 0, "base_order_size": 0},
        },
        headers=headers(),
    )
    assert response.status_code == 422
    assert "INVALID_EXECUTOR_CONFIG" in response.json()["error"]["message"]


def test_listing_is_scoped_to_the_owner(client: TestClient) -> None:
    create_bot(client)
    mine = client.get(BASE, params={"owner_user_id": OWNER}, headers=headers())
    assert len(mine.json()["bots"]) == 1
    theirs = client.get(BASE, params={"owner_user_id": INTRUDER}, headers=headers())
    assert theirs.json()["bots"] == []


def test_reading_someone_elses_bot_is_a_404_not_a_403(client: TestClient) -> None:
    bot = create_bot(client)
    ok = client.get(f"{BASE}/{bot['id']}", params={"owner_user_id": OWNER}, headers=headers())
    assert ok.status_code == 200
    denied = client.get(
        f"{BASE}/{bot['id']}", params={"owner_user_id": INTRUDER}, headers=headers()
    )
    assert denied.status_code == 404
    assert denied.json()["error"]["code"] == "QUANT_AGENT_NOT_FOUND"


def test_deleting_someone_elses_bot_does_nothing(client: TestClient) -> None:
    bot = create_bot(client)
    denied = client.delete(
        f"{BASE}/{bot['id']}", params={"owner_user_id": INTRUDER}, headers=headers()
    )
    assert denied.status_code == 404
    still_there = client.get(
        f"{BASE}/{bot['id']}", params={"owner_user_id": OWNER}, headers=headers()
    )
    assert still_there.status_code == 200

    removed = client.delete(
        f"{BASE}/{bot['id']}", params={"owner_user_id": OWNER}, headers=headers()
    )
    assert removed.status_code == 200
    assert (
        client.get(
            f"{BASE}/{bot['id']}", params={"owner_user_id": OWNER}, headers=headers()
        ).status_code
        == 404
    )


def test_simulating_someone_elses_bot_is_a_404(client: TestClient) -> None:
    bot = create_bot(client)
    response = client.post(
        f"{BASE}/{bot['id']}/simulate",
        json={"owner_user_id": INTRUDER, "bars": bars([(100.0, 110.0, 105.0)])},
        headers=headers(),
    )
    assert response.status_code == 404


def test_listing_runs_for_someone_elses_bot_is_a_404(client: TestClient) -> None:
    bot = create_bot(client)
    response = client.get(
        f"{BASE}/{bot['id']}/runs", params={"owner_user_id": INTRUDER}, headers=headers()
    )
    assert response.status_code == 404


def test_a_simulation_persists_its_run_fills_and_ledger(client: TestClient) -> None:
    bot = create_bot(client)
    response = client.post(
        f"{BASE}/{bot['id']}/simulate",
        json={
            "owner_user_id": OWNER,
            "bars": bars(
                [
                    (104.0, 106.0, 105.0),
                    (101.0, 105.0, 102.0),
                    (101.5, 109.0, 108.0),
                    (103.0, 108.5, 104.0),
                ]
            ),
        },
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "completed"
    assert body["execution_mode"] == "simulation"
    run = body["run"]
    assert run["execution_mode"] == "simulation"
    assert run["bar_count"] == 4
    assert run["fill_count"] == len(body["fills"])
    assert run["fill_count"] > 0
    assert len(body["ledger"]) >= run["fill_count"]
    assert all(entry["owner_user_id"] == OWNER for entry in body["ledger"])

    runs = client.get(
        f"{BASE}/{bot['id']}/runs", params={"owner_user_id": OWNER}, headers=headers()
    )
    assert [item["id"] for item in runs.json()["runs"]] == [run["id"]]


def test_a_rejected_grid_still_records_the_attempt(client: TestClient) -> None:
    bot = create_bot(
        client, config=grid_config(start_price=100.0, end_price=100.5, grid_count=10)
    )
    response = client.post(
        f"{BASE}/{bot['id']}/simulate",
        json={"owner_user_id": OWNER, "bars": bars([(100.0, 100.5, 100.2)])},
        headers=headers(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "invalid"
    assert body["error"].startswith("Grid spacing is too narrow after fees")
    assert body["run"]["status"] == "invalid"
    runs = client.get(
        f"{BASE}/{bot['id']}/runs", params={"owner_user_id": OWNER}, headers=headers()
    )
    assert len(runs.json()["runs"]) == 1


def test_a_ladder_only_bot_says_so_rather_than_pretending_to_run(
    client: TestClient,
) -> None:
    """DCA and both martingales are ladder generators upstream expresses as
    generated strategy source. There is no replay engine for them here, and
    saying so is better than reporting a run that did not happen."""
    bot = create_bot(
        client,
        bot_type="martingale",
        name="mart",
        config={
            "side": "long",
            "market_type": "swap",
            "entry_price": 100,
            "base_order_size": 10,
            "max_layers": 3,
            "trailing_take_profit_enabled": False,
        },
    )
    response = client.post(
        f"{BASE}/{bot['id']}/simulate",
        json={"owner_user_id": OWNER, "bars": bars([(90.0, 110.0, 100.0)])},
        headers=headers(),
    )
    assert response.status_code == 422
    assert "no replay engine" in response.json()["error"]["message"]


def test_bars_must_be_strictly_ascending(client: TestClient) -> None:
    bot = create_bot(client)
    duplicated = bars([(100.0, 110.0, 105.0)]) * 2
    response = client.post(
        f"{BASE}/{bot['id']}/simulate",
        json={"owner_user_id": OWNER, "bars": duplicated},
        headers=headers(),
    )
    assert response.status_code == 422


def test_owner_user_id_is_required_and_must_be_positive(client: TestClient) -> None:
    assert client.get(BASE, headers=headers()).status_code == 422
    assert client.get(BASE, params={"owner_user_id": 0}, headers=headers()).status_code == 422
