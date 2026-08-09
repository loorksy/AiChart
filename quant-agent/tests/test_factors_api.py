"""The three factor endpoints, end to end through the app."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.engine.factors.models import MAX_COMPUTE_BARS
from tests.conftest import headers

BASE = "/internal/quant-agent/factors"

EXPECTED_FACTOR_COUNT = 61


def bar(index: int, close: float) -> dict[str, Any]:
    return {
        "time": f"2026-04-01T{index // 60:02d}:{index % 60:02d}:00+00:00",
        "open": close - 0.25,
        "high": close + 0.75,
        "low": close - 0.9,
        "close": close,
        "volume": 900.0 + index,
    }


def bars(count: int) -> list[dict[str, Any]]:
    return [bar(index, 100.0 + (index % 7) * 0.5 + index * 0.05) for index in range(count)]


def test_catalogue_requires_auth(client: TestClient) -> None:
    assert client.get(BASE).status_code == 401
    assert client.get(f"{BASE}/rsi").status_code == 401
    assert client.post(f"{BASE}/compute", json={"factor_id": "sma"}).status_code == 401


def test_catalogue_lists_every_factor(client: TestClient) -> None:
    response = client.get(BASE, headers=headers())
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == EXPECTED_FACTOR_COUNT
    assert body["meta"] == {
        "builtin_count": EXPECTED_FACTOR_COUNT,
        "returned_count": EXPECTED_FACTOR_COUNT,
        "available_count": EXPECTED_FACTOR_COUNT,
        "unavailable_count": 0,
        "talib_available": False,
        "talib_count": 0,
    }
    first = body["items"][0]
    assert first["factor_type"] == "fundamental"
    assert set(first) == {
        "factor_id",
        "version",
        "name",
        "name_i18n_key",
        "description_i18n_key",
        "category",
        "factor_type",
        "required_fields",
        "default_params",
        "parameter_schema",
        "direction_hint",
        "supported_contexts",
        "default_warmup_bars",
        "availability",
        "unavailable_reason",
    }


def test_catalogue_filters(client: TestClient) -> None:
    technical = client.get(BASE, params={"factor_type": "technical"}, headers=headers())
    assert technical.status_code == 200
    assert technical.json()["meta"]["returned_count"] == 54
    assert technical.json()["meta"]["builtin_count"] == EXPECTED_FACTOR_COUNT

    trend = client.get(BASE, params={"category": "trend"}, headers=headers())
    assert trend.json()["meta"]["returned_count"] == 18

    unknown = client.get(BASE, params={"category": "nope"}, headers=headers())
    assert unknown.status_code == 200
    assert unknown.json()["items"] == []


def test_catalogue_omits_absent_schema_keys(client: TestClient) -> None:
    """Upstream's enum entries carry no `minimum`/`maximum`/`step`; emitting
    them as nulls would change the shape the factor-library UI renders."""
    response = client.get(f"{BASE}/macd", headers=headers())
    schema = response.json()["parameter_schema"]
    assert schema["output"] == {"type": "enum", "options": ["line", "signal", "histogram"]}
    assert schema["fast_period"] == {
        "type": "integer",
        "minimum": 1,
        "maximum": 5000,
        "step": 1,
    }
    # Integer bounds must stay integers on the wire, not widen to 1.0.
    for key in ("minimum", "maximum", "step"):
        assert isinstance(schema["fast_period"][key], int)

    stddev = client.get(f"{BASE}/bollinger_bands", headers=headers()).json()
    assert stddev["parameter_schema"]["stddev"] == {
        "type": "number",
        "minimum": 0.000001,
        "step": 0.1,
    }


def test_get_one_factor(client: TestClient) -> None:
    response = client.get(f"{BASE}/bollinger_bands", headers=headers())
    assert response.status_code == 200
    body = response.json()
    assert body["factor_id"] == "bollinger_bands"
    assert body["name"] == "Bollinger Bands"
    assert body["category"] == "volatility"
    assert body["version"] == "1.0.0"
    assert body["availability"] == "available"
    assert body["required_fields"] == ["close"]
    assert body["supported_contexts"] == ["cta", "portfolio"]


def test_unknown_factor_is_404(client: TestClient) -> None:
    response = client.get(f"{BASE}/not_a_factor", headers=headers())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "QUANT_AGENT_NOT_FOUND"
    assert "factor.notFound" in response.json()["error"]["message"]


def test_talib_factor_reports_the_missing_extension(client: TestClient) -> None:
    response = client.get(f"{BASE}/talib:CDLDOJI", headers=headers())
    assert response.status_code == 404
    assert "factor.talibUnavailable" in response.json()["error"]["message"]


def test_compute_over_pushed_in_bars(client: TestClient) -> None:
    payload = {"factor_id": "sma", "params": {"period": 5}, "bars": bars(40)}
    response = client.post(f"{BASE}/compute", json=payload, headers=headers())
    assert response.status_code == 200
    body = response.json()
    assert body["factor_id"] == "sma"
    assert body["version"] == "1.0.0"
    assert body["is_nan"] is False
    assert body["row_count"] == 40
    assert body["params_used"] == {"period": 5}
    closes = [row["close"] for row in payload["bars"]]  # type: ignore[union-attr]
    assert body["value"] == sum(closes[-5:]) / 5.0


def test_compute_reports_the_merged_parameters(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "macd", "params": {"output": "line"}, "bars": bars(80)},
        headers=headers(),
    )
    assert response.status_code == 200
    assert response.json()["params_used"] == {
        "fast_period": 12,
        "slow_period": 26,
        "signal_period": 9,
        "output": "line",
    }


def test_compute_reports_nan_as_null(client: TestClient) -> None:
    """A NaN must arrive as JSON `null` with a flag, not as the non-standard
    `NaN` literal and not as a zero."""
    candles = bars(40)
    candles[-3]["volume"] = 0.0
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "amihud_illiquidity", "params": {"period": 20}, "bars": candles},
        headers=headers(),
    )
    assert response.status_code == 200
    assert "NaN" not in response.text
    assert response.json()["value"] is None
    assert response.json()["is_nan"] is True


def test_compute_short_history_is_422_with_the_upstream_code(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "sma", "params": {"period": 50}, "bars": bars(10)},
        headers=headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "QUANT_AGENT_INPUT_INVALID"
    assert "factor.insufficientHistory" in response.json()["error"]["message"]


def test_compute_bad_parameter_is_422(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "sma", "params": {"period": 1}, "bars": bars(30)},
        headers=headers(),
    )
    assert response.status_code == 422
    assert "factor.invalidParameter" in response.json()["error"]["message"]


def test_compute_missing_column_is_422(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "market_cap", "bars": bars(30)},
        headers=headers(),
    )
    assert response.status_code == 422
    assert "factor.missingFields" in response.json()["error"]["message"]


def test_compute_unknown_factor_is_404(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "not_a_factor", "bars": bars(30)},
        headers=headers(),
    )
    assert response.status_code == 404


def test_compute_fundamentals(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={
            "factor_id": "earnings_yield",
            "fundamentals": [
                {"net_income": 5.0e7, "market_cap": 1.0e9},
                {"net_income": 6.0e7, "market_cap": 1.2e9},
            ],
        },
        headers=headers(),
    )
    assert response.status_code == 200
    assert response.json()["value"] == 6.0e7 / 1.2e9
    assert response.json()["row_count"] == 2


def test_compute_rejects_an_empty_request(client: TestClient) -> None:
    response = client.post(f"{BASE}/compute", json={"factor_id": "sma"}, headers=headers())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "QUANT_AGENT_INPUT_INVALID"


def test_compute_rejects_misaligned_fundamentals(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={
            "factor_id": "market_cap",
            "bars": bars(4),
            "fundamentals": [{"market_cap": 1.0}, {"market_cap": 2.0}],
        },
        headers=headers(),
    )
    assert response.status_code == 422


def test_compute_rejects_a_fundamental_column_that_shadows_a_price_series(
    client: TestClient,
) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={
            "factor_id": "sma",
            "bars": bars(4),
            "fundamentals": [{"close": 1.0}] * 4,
        },
        headers=headers(),
    )
    assert response.status_code == 422


def test_compute_rejects_non_finite_fundamentals(client: TestClient) -> None:
    """`1e400` parses to infinity. It must be rejected rather than propagate
    into a factor and come back out as a plausible-looking NaN."""
    response = client.post(
        f"{BASE}/compute",
        content='{"factor_id": "market_cap", "fundamentals": [{"market_cap": 1e400}]}',
        headers={**headers(), "Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_compute_rejects_unknown_body_fields(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "sma", "bars": bars(30), "symbol": "EURUSD"},
        headers=headers(),
    )
    assert response.status_code == 422


def test_compute_bar_ceiling_is_declared(client: TestClient) -> None:
    """A period may legitimately reach 5000, so the ceiling has to leave room
    for the factors that need three times that."""
    assert MAX_COMPUTE_BARS >= 3 * 5000


def test_compute_route_is_not_shadowed_by_the_by_id_route(client: TestClient) -> None:
    """`/compute` must be matched before `/{factor_id}` or POSTing a factor
    would 405 against the detail route."""
    response = client.post(
        f"{BASE}/compute",
        json={"factor_id": "rsi", "bars": bars(40)},
        headers=headers(),
    )
    assert response.status_code == 200
    assert client.get(f"{BASE}/compute", headers=headers()).status_code == 404
