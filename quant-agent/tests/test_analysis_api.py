"""End-to-end coverage for the two analysis endpoints.

The arithmetic itself is pinned by `test_analysis_scoring.py`,
`test_analysis_consensus.py` and `test_analysis_constrain.py`; these tests
prove the wiring — auth, request validation, which frame gets the
non-technical inputs, and that `/finalize` echoes the model's own keys back.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import headers

SCORE_PATH = "/internal/quant-agent/analysis/score"
FINALIZE_PATH = "/internal/quant-agent/analysis/finalize"


def score_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "market": "Forex",
        "symbol": "XAUUSD",
        "primary_timeframe": "1D",
        "current_price": 4342.23,
        "timeframes": {
            "1D": {
                "indicators": {
                    "current_price": 4342.23,
                    "rsi": {"value": 75.0},
                    "macd": {"signal": "neutral"},
                    "moving_averages": {"trend": "sideways"},
                },
                "collection_meta": {"ok": True, "degraded_inputs": []},
            },
            "4H": {
                "indicators": {
                    "rsi": {"value": 25.0},
                    "macd": {"signal": "neutral"},
                    "moving_averages": {"trend": "sideways"},
                }
            },
        },
    }
    body.update(overrides)
    return body


def finalize_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "market": "Forex",
        "symbol": "XAUUSD",
        "current_price": 100.0,
        "indicators": {
            "rsi": {"value": 45.0},
            "macd": {"signal": "neutral"},
            "moving_averages": {"trend": "sideways"},
        },
        "llm_output": {
            "decision": "BUY",
            "confidence": 80,
            "summary": "an executive summary",
            "entry_price": 100.0,
            "stop_loss": 96.0,
            "take_profit": 104.0,
            "position_size_pct": 10,
            "timeframe": "short",
            "key_reasons": ["first", "second"],
            "risks": ["a risk"],
            "technical_score": 55,
            "fundamental_score": 50,
            "sentiment_score": 45,
            "analysis": {"technical": "t", "fundamental": "f", "sentiment": "s"},
        },
        "has_major_news": False,
        "has_macro_event": False,
        "consensus": {
            "decision": "HOLD",
            "score": 5.0,
            "agreement": 1.0,
            "timeframe_count": 2,
            "votes": {"BUY": 0, "SELL": 0, "HOLD": 2},
            "weighted_score": 5.0,
        },
    }
    body.update(overrides)
    return body


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", [SCORE_PATH, FINALIZE_PATH])
def test_both_endpoints_require_the_internal_bearer_token(
    client: TestClient, path: str
) -> None:
    assert client.post(path, json={}).status_code == 401


def test_a_wrong_token_is_rejected(client: TestClient) -> None:
    response = client.post(
        SCORE_PATH, headers={"Authorization": "Bearer nope"}, json=score_body()
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INTERNAL_AUTH_INVALID"


# --------------------------------------------------------------------------
# /score
# --------------------------------------------------------------------------


def test_score_returns_every_contract_section(client: TestClient) -> None:
    response = client.post(SCORE_PATH, headers=headers(), json=score_body())
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "objective_by_timeframe",
        "consensus",
        "trend_outlook",
        "similar_patterns",
        "data_quality",
    }
    assert set(payload["trend_outlook"]) == {"h24", "d3", "w1", "m1"}
    assert set(payload["trend_outlook"]["h24"]) == {"label", "qualifier", "score"}


def test_score_reports_the_consensus_frames_in_expansion_order(client: TestClient) -> None:
    """Primary 1D expands to [1D, 4H]; both were posted, so both are weighed."""
    payload = client.post(SCORE_PATH, headers=headers(), json=score_body()).json()
    assert list(payload["objective_by_timeframe"]) == ["1D", "4H"]
    assert payload["consensus"]["timeframe_count"] == 2
    assert payload["consensus"]["votes"] == {"BUY": 0, "SELL": 0, "HOLD": 2}
    assert payload["consensus"]["agreement"] == 1.0


def test_score_marks_absent_sentiment_and_macro_as_null_not_zero(client: TestClient) -> None:
    payload = client.post(SCORE_PATH, headers=headers(), json=score_body()).json()
    daily = payload["objective_by_timeframe"]["1D"]
    assert daily["sentiment_score"] is None
    assert daily["macro_score"] is None
    # Fundamental is different: 50.0 is its neutral value, not an absence.
    assert daily["fundamental_score"] == 50.0
    assert payload["data_quality"]["missing"] == ["fundamental", "sentiment", "macro"]


def test_score_technical_only_frame_matches_the_hand_computed_value(
    client: TestClient,
) -> None:
    """RSI 75 with everything else neutral: -50 * 0.30 / 1.15."""
    payload = client.post(SCORE_PATH, headers=headers(), json=score_body()).json()
    daily = payload["objective_by_timeframe"]["1D"]
    assert daily["technical_score"] == pytest.approx(-50.0 * 0.30 / 1.15, rel=1e-12)
    assert daily["overall_score"] == pytest.approx(daily["technical_score"], rel=1e-12)
    assert daily["abs_score"] == pytest.approx(abs(daily["overall_score"]), rel=1e-12)
    assert daily["decision"] == "HOLD"


def test_score_normalises_timeframe_labels_to_upper_case(client: TestClient) -> None:
    body = score_body(primary_timeframe="1d")
    body["timeframes"] = {"1d": body["timeframes"]["1D"], "4h": body["timeframes"]["4H"]}
    payload = client.post(SCORE_PATH, headers=headers(), json=body).json()
    assert list(payload["objective_by_timeframe"]) == ["1D", "4H"]


def test_score_only_weighs_news_and_macro_into_the_primary_frame(
    client: TestClient,
) -> None:
    """The non-technical inputs are collected once, for the primary frame —
    weighing them into every frame would count the same evidence twice."""
    body = score_body(
        news=[{"sentiment": "positive"}, {"sentiment": "neutral"}],
        macro={"VIX": {"price": 40.0}},
    )
    payload = client.post(SCORE_PATH, headers=headers(), json=body).json()

    primary = payload["objective_by_timeframe"]["1D"]
    assert primary["sentiment_score"] == pytest.approx(30.0, rel=1e-12)
    assert primary["macro_score"] == pytest.approx(-40.0, rel=1e-12)

    secondary = payload["objective_by_timeframe"]["4H"]
    assert secondary["sentiment_score"] is None
    assert secondary["macro_score"] is None
    assert payload["data_quality"]["missing"] == ["fundamental"]


def test_score_counts_an_extra_frame_toward_agreement_but_not_the_score(
    client: TestClient,
) -> None:
    body = score_body()
    body["timeframes"]["1W"] = {
        "indicators": {
            "rsi": {"value": 25.0},
            "macd": {"signal": "bullish"},
            "moving_averages": {"trend": "strong_uptrend"},
        }
    }
    payload = client.post(SCORE_PATH, headers=headers(), json=body).json()
    assert list(payload["objective_by_timeframe"]) == ["1D", "4H", "1W"]
    assert payload["consensus"]["timeframe_count"] == 3
    # The 1W frame scores BUY, so it disagrees with the HOLD consensus.
    assert payload["objective_by_timeframe"]["1W"]["decision"] == "BUY"
    assert sum(payload["consensus"]["votes"].values()) == 2
    assert payload["consensus"]["agreement"] == pytest.approx(2 / 3)


def test_score_ranks_similar_patterns_and_reports_the_contract_fields(
    client: TestClient,
) -> None:
    body = score_body(
        memory_candidates=[
            {
                "id": "far",
                "decision": "SELL",
                "was_correct": False,
                "indicators": {
                    "rsi": 75.0,
                    "macd_signal": "neutral",
                    "ma_trend": "sideways",
                    "volatility_level": "normal",
                },
            },
            {
                "id": "unrelated",
                "decision": "BUY",
                "was_correct": True,
                "indicators": {
                    "rsi": 10.0,
                    "macd_signal": "bullish",
                    "ma_trend": "strong_uptrend",
                    "volatility_level": "high",
                },
            },
            {
                "id": "near",
                "decision": "SELL",
                "was_correct": True,
                "indicators": {
                    "rsi": 74.0,
                    "macd_signal": "neutral",
                    "ma_trend": "sideways",
                    "volatility_level": "normal",
                },
            },
        ]
    )
    patterns = client.post(SCORE_PATH, headers=headers(), json=body).json()["similar_patterns"]

    # "unrelated" scores 0 on every axis except a mismatched RSI, so it falls
    # under the 0.25 floor and is dropped entirely.
    assert [pattern["id"] for pattern in patterns] == ["near", "far"]
    assert set(patterns[0]) == {"id", "similarity_score", "decision", "was_correct"}
    # near: rsi (1 - 1/30)*0.3 + 0.3 + 0.25 + 0.15 = 0.99, +0.1 for being right
    assert patterns[0]["similarity_score"] == pytest.approx(round(0.99 + 0.1, 3))
    assert patterns[1]["similarity_score"] == pytest.approx(1.0)


def test_score_reports_degraded_collection_as_a_confidence_penalty(
    client: TestClient,
) -> None:
    body = score_body()
    body["timeframes"]["1D"]["collection_meta"] = {
        "ok": False,
        "degraded_inputs": ["macro", "news"],
    }
    quality = client.post(SCORE_PATH, headers=headers(), json=body).json()["data_quality"]
    assert quality["degraded"] is True
    # 0.85 * 0.8 = 0.68 -> 32 points off.
    assert quality["confidence_penalty"] == 32
    assert quality["missing"] == ["fundamental", "sentiment", "macro", "news"]


def test_score_rejects_a_primary_timeframe_that_was_not_posted(client: TestClient) -> None:
    response = client.post(
        SCORE_PATH, headers=headers(), json=score_body(primary_timeframe="30M")
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "QUANT_AGENT_INPUT_INVALID"


def test_score_rejects_an_empty_timeframe_map(client: TestClient) -> None:
    response = client.post(SCORE_PATH, headers=headers(), json=score_body(timeframes={}))
    assert response.status_code == 422


def test_score_rejects_an_unknown_top_level_field(client: TestClient) -> None:
    response = client.post(SCORE_PATH, headers=headers(), json=score_body(nonsense=1))
    assert response.status_code == 422


def test_score_tolerates_unknown_indicator_fields(client: TestClient) -> None:
    """`web/` owns collection and keeps enriching what it sends; an indicator
    this service does not read yet must not fail the whole analysis."""
    body = score_body()
    body["timeframes"]["1D"]["indicators"]["ichimoku_cloud"] = {"a": 1}
    assert client.post(SCORE_PATH, headers=headers(), json=body).status_code == 200


# --------------------------------------------------------------------------
# /finalize
# --------------------------------------------------------------------------


def test_finalize_echoes_the_model_keys_and_appends_what_it_changed(
    client: TestClient,
) -> None:
    response = client.post(FINALIZE_PATH, headers=headers(), json=finalize_body())
    assert response.status_code == 200
    payload = response.json()

    assert payload["summary"] == "an executive summary"
    assert payload["key_reasons"] == ["first", "second"]
    assert payload["analysis"] == {"technical": "t", "fundamental": "f", "sentiment": "s"}
    assert payload["timeframe"] == "short"
    assert set(payload["applied"]) == {
        "entry_clamped",
        "stop_defaulted",
        "take_profit_defaulted",
        "decision_overridden_by",
        "confidence_adjusted_by",
        "indicator_conflicts",
    }


def test_finalize_leaves_a_clean_analysis_untouched(client: TestClient) -> None:
    payload = client.post(FINALIZE_PATH, headers=headers(), json=finalize_body()).json()
    assert payload["decision"] == "BUY"
    assert payload["confidence"] == 80
    assert (payload["stop_loss"], payload["take_profit"]) == (96.0, 104.0)
    assert payload["applied"]["decision_overridden_by"] is None
    assert payload["applied"]["confidence_adjusted_by"] == 0.0


def test_finalize_never_rewrites_the_summary(client: TestClient) -> None:
    """Upstream appends a Chinese note to `summary` on a veto; this service
    reports the conflict structurally and leaves the prose to `web/`."""
    body = finalize_body()
    body["indicators"]["rsi"] = {"value": 75.0}
    payload = client.post(FINALIZE_PATH, headers=headers(), json=body).json()

    assert payload["summary"] == "an executive summary"
    assert payload["decision"] == "HOLD"
    assert payload["applied"]["indicator_conflicts"] == ["rsi_overbought"]
    assert payload["applied"]["decision_overridden_by"] == "indicators"


def test_finalize_lets_a_strong_consensus_overrule_the_model(client: TestClient) -> None:
    body = finalize_body(
        consensus={
            "decision": "SELL",
            "score": -30.0,
            "agreement": 1.0,
            "timeframe_count": 3,
            "votes": {"BUY": 0, "SELL": 3, "HOLD": 0},
            "weighted_score": -30.0,
        }
    )
    payload = client.post(FINALIZE_PATH, headers=headers(), json=body).json()

    assert payload["decision"] == "SELL"
    assert payload["confidence"] == 69  # the consensus-confidence ladder
    assert payload["applied"]["decision_overridden_by"] == "consensus"
    assert payload["applied"]["confidence_adjusted_by"] == pytest.approx(69 - 80)
    # The plan flips to short geometry around the current price.
    assert payload["stop_loss"] == 105.0
    assert payload["take_profit"] == 95.0


def test_finalize_holds_a_borderline_consensus_when_the_data_is_poor(
    client: TestClient,
) -> None:
    body = finalize_body(
        data_quality={"degraded": True, "confidence_penalty": 35, "missing": ["macro"]}
    )
    payload = client.post(FINALIZE_PATH, headers=headers(), json=body).json()

    assert payload["decision"] == "HOLD"
    # 80 * 0.65 = 52, already under the 55 cap.
    assert payload["confidence"] == 52
    assert payload["applied"]["decision_overridden_by"] == "consensus"


def test_finalize_clamps_an_out_of_band_entry(client: TestClient) -> None:
    body = finalize_body()
    body["llm_output"]["entry_price"] = 130.0
    payload = client.post(FINALIZE_PATH, headers=headers(), json=body).json()
    assert payload["entry_price"] == 100.0
    assert payload["applied"]["entry_clamped"] is True


def test_finalize_ignores_an_applied_block_echoed_back_by_the_caller(
    client: TestClient,
) -> None:
    body = finalize_body()
    body["llm_output"]["applied"] = {"entry_clamped": True, "indicator_conflicts": ["bogus"]}
    payload = client.post(FINALIZE_PATH, headers=headers(), json=body).json()
    assert payload["applied"]["entry_clamped"] is False
    assert payload["applied"]["indicator_conflicts"] == []


def test_finalize_rejects_a_non_positive_current_price(client: TestClient) -> None:
    response = client.post(FINALIZE_PATH, headers=headers(), json=finalize_body(current_price=0))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "QUANT_AGENT_INPUT_INVALID"


def test_finalize_survives_a_model_that_returned_nonsense(client: TestClient) -> None:
    """A null confidence and an unknown decision must not 500 the endpoint."""
    body = finalize_body()
    body["llm_output"] = {"decision": "MAYBE", "confidence": None, "summary": "?"}
    payload = client.post(FINALIZE_PATH, headers=headers(), json=body).json()

    assert payload["decision"] == "HOLD"
    assert payload["confidence"] == 50
    # Missing levels were filled in from the current price, not invented.
    assert payload["stop_loss"] == 95.0
    assert payload["take_profit"] == 105.0
