from __future__ import annotations

import math
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import TOKEN, headers
from tests.fixtures import bars_triggering_ema_trend_buy, make_bars

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


def _backtest_body(bars: list[dict], **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "bars": bars,
        "symbol": "EURUSD",
        "market": "forex",
        "interval": "M15",
        "owner_user_id": 1,
        "request_id": "req-backtest-0001",
    }
    body.update(overrides)
    return body


def _flat_bars(count: int = 230) -> list[dict]:
    """A perfectly flat price series -- EMA20/EMA50/EMA200 stay exactly
    equal at every bar, so ema_trend_v1's crossover condition can never fire
    across the ENTIRE replay window (not just the final bar, unlike
    `tests.fixtures.bars_no_signal`, which is only tuned for a single live
    evaluation on its last bar)."""
    return make_bars([1.1000] * count)


def test_backtest_endpoint_completed_with_zero_trades_when_strategy_never_fires(
    client: TestClient,
) -> None:
    response = client.post(
        "/internal/quant-agent/strategies/ema_trend_v1/backtest",
        headers=headers(),
        json=_backtest_body(_flat_bars()),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["error"] is None
    assert payload["metrics"]["trade_count"] == 0
    assert payload["metrics"]["win_rate"] is None
    assert payload["metrics"]["metric_reasons"]["win_rate"] == "no resolved trades"


def test_backtest_endpoint_unknown_strategy_id_is_invalid_not_a_500(client: TestClient) -> None:
    response = client.post(
        "/internal/quant-agent/strategies/does_not_exist/backtest",
        headers=headers(),
        json=_backtest_body(bars_triggering_ema_trend_buy()),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["metrics"] is None
    assert payload["error"] is not None


def test_backtest_endpoint_insufficient_bars_is_invalid(client: TestClient) -> None:
    response = client.post(
        "/internal/quant-agent/strategies/ema_trend_v1/backtest",
        headers=headers(),
        json=_backtest_body(bars_triggering_ema_trend_buy()[:5]),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["metrics"] is None
    assert "bars are required" in (payload["error"] or "")


def test_backtest_endpoint_rejects_more_bars_than_backtest_max_bars(tmp_path: Path) -> None:
    settings = Settings(
        internal_token=TOKEN,
        environment="test",
        work_dir=tmp_path / "work",
        min_bars=210,
        max_bars=2000,
        validity_bars=6,
        backtest_max_bars=250,
    )
    prices = [1.1000 + 0.0008 * math.sin(2 * math.pi * i / 22) for i in range(300)]
    bars = make_bars(prices)

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/internal/quant-agent/strategies/ema_trend_v1/backtest",
            headers=headers(),
            json=_backtest_body(bars),
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "invalid"
    assert "at most 250 bars" in (payload["error"] or "")


def test_backtest_endpoint_backtests_a_disabled_generated_strategy(client: TestClient) -> None:
    """The whole point of the endpoint: an `enabled: false` sandboxed-code
    strategy must still be backtestable, and the backtest must never flip
    `enabled` itself."""
    generate_response = client.post(
        "/internal/quant-agent/strategies/generate-validate-code",
        headers=headers(),
        json={
            "strategy_id": "sandboxed_backtest_v1",
            "version": "1.0.0",
            "display_name": "Sandboxed Backtest Candidate",
            "description": "test-only",
            "regime_affinity": "trend",
            "code": _VALID_CODE,
        },
    )
    assert generate_response.status_code == 200
    generated = generate_response.json()["strategy"]
    assert generated["enabled"] is False

    response = client.post(
        "/internal/quant-agent/strategies/sandboxed_backtest_v1/backtest",
        headers=headers(),
        json=_backtest_body(bars_triggering_ema_trend_buy()),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["metrics"] is not None
    assert payload["error"] is None

    # `enabled` must remain untouched by the backtest, in both directions.
    listed = client.get("/internal/quant-agent/strategies", headers=headers())
    row = next(
        item
        for item in listed.json()["strategies"]
        if item["strategy_id"] == "sandboxed_backtest_v1"
    )
    assert row["enabled"] is False


def test_backtest_endpoint_requires_auth(client: TestClient) -> None:
    response = client.post(
        "/internal/quant-agent/strategies/ema_trend_v1/backtest",
        json=_backtest_body(bars_triggering_ema_trend_buy()),
    )
    assert response.status_code == 401


def test_backtest_endpoint_rejects_extra_unknown_top_level_field(client: TestClient) -> None:
    body = _backtest_body(bars_triggering_ema_trend_buy())
    body["unexpected"] = True
    response = client.post(
        "/internal/quant-agent/strategies/ema_trend_v1/backtest",
        headers=headers(),
        json=body,
    )
    assert response.status_code == 422
