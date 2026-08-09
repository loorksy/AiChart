"""Similar-pattern ranking, outcome validation and confidence-bucket accuracy.

The two DELIBERATE deviations from QuantDinger get their own tests, because a
deviation nobody pinned is indistinguishable from a regression:
  * the volatility ladder scoring medium-vs-low as a neighbour (0.08) where
    upstream's two-set membership scored it 0;
  * one `CONFIDENCE_BUCKETS` table behind both the accuracy map and the
    lookup, so the 90+ bucket can no longer be written under one key and read
    under another.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.engine.analysis.memory import (
    CORRECT_OUTCOME_BONUS,
    MIN_CONFIDENCE_BUCKET_SAMPLES,
    PatternFingerprint,
    adjusted_confidence,
    bucket_key_for_confidence,
    confidence_accuracy_by_bucket,
    decision_was_correct,
    realised_return_pct,
    score_similar_patterns,
    similarity,
    validate_outcome,
    volatility_bands_similar,
)
from app.engine.analysis.models import MemoryCandidate, MemoryCandidateIndicators
from tests.conftest import headers

VALIDATE_PATH = "/internal/quant-agent/analysis/validate"


def fingerprint(**overrides: object) -> PatternFingerprint:
    base: dict[str, object] = {
        "rsi": 60.0,
        "macd_signal": "bearish",
        "ma_trend": "downtrend",
        "volatility_level": "medium",
    }
    base.update(overrides)
    return PatternFingerprint(**base)  # type: ignore[arg-type]


def candidate(
    candidate_id: str, *, was_correct: bool | None = None, **indicators: object
) -> MemoryCandidate:
    snapshot: dict[str, object] = {
        "rsi": 60.0,
        "macd_signal": "bearish",
        "ma_trend": "downtrend",
        "volatility_level": "medium",
    }
    snapshot.update(indicators)
    return MemoryCandidate(
        id=candidate_id,
        decision="SELL",
        was_correct=was_correct,
        indicators=MemoryCandidateIndicators.model_validate(snapshot),
    )


# --- volatility bands: the fixed medium hole ---------------------------------


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        # Upstream's own low band — unchanged.
        ("low", "normal", True),
        ("normal_low", "low", True),
        # Upstream's own high band — unchanged.
        ("high", "elevated", True),
        ("volatile", "very_high", True),
        # Two steps apart: still no credit, as upstream.
        ("low", "high", False),
        ("normal", "very_high", False),
        # THE FIX: medium neighbours both ends. Upstream scored these 0 because
        # "medium" belonged to neither hardcoded set.
        ("medium", "low", True),
        ("low", "medium", True),
        ("medium", "high", True),
        ("medium", "elevated", True),
        # An unrecognised level is similar to nothing, including itself.
        ("unknown", "low", False),
        ("unknown", "unknown", False),
    ],
)
def test_volatility_band_neighbourhood(left: str, right: str, expected: bool) -> None:
    assert volatility_bands_similar(left, right) is expected


def test_medium_vs_low_now_earns_the_partial_band_weight() -> None:
    """The whole point of the fix, expressed as a similarity delta.

    Everything but volatility matches, so the two scores differ by exactly the
    partial-band weight: 0.85 under upstream's set membership, 0.93 here.
    """
    current = fingerprint(volatility_level="medium")
    neighbour = similarity(current, fingerprint(volatility_level="low"))
    far = similarity(current, fingerprint(volatility_level="high"))
    exact = similarity(current, fingerprint(volatility_level="medium"))

    assert neighbour == pytest.approx(0.93)
    assert exact == pytest.approx(1.0)
    # low↔high is two steps: no partial credit, same as upstream.
    assert far == pytest.approx(0.93)
    assert similarity(
        fingerprint(volatility_level="low"), fingerprint(volatility_level="high")
    ) == pytest.approx(0.85)


# --- ranking ------------------------------------------------------------------


def test_pool_is_capped_at_limit_times_five() -> None:
    """A caller sending more than `limit * 5` candidates does not widen the pool.

    The 16th candidate is a perfect match and would win outright if it were
    scored at all; with limit=3 the pool stops at 15.
    """
    pool = [candidate(f"c{index}", rsi=59.0) for index in range(15)]
    pool.append(candidate("sixteenth-perfect", was_correct=True))

    ranked = score_similar_patterns(fingerprint(), pool, limit=3)

    assert [pattern.id for pattern in ranked] == ["c0", "c1", "c2"]


def test_correct_bonus_applies_after_the_floor_and_is_reported() -> None:
    """A candidate below the 0.25 floor is dropped BEFORE the +0.1 bonus could
    lift it over — upstream tests the floor on the raw score."""
    # Nothing agrees and RSI is a full tolerance away, so the raw score is 0.0.
    # With the bonus it would be 0.1 — still under the floor, but the ordering
    # of the two steps is what this pins.
    below_floor = candidate(
        "below",
        was_correct=True,
        rsi=90.0,
        macd_signal="bullish",
        ma_trend="uptrend",
        volatility_level="unknown",
    )
    above_floor = candidate("above", was_correct=True, rsi=60.0)

    ranked = score_similar_patterns(fingerprint(), [below_floor, above_floor], limit=3)

    assert [pattern.id for pattern in ranked] == ["above"]
    assert ranked[0].similarity_score == pytest.approx(round(1.0 + CORRECT_OUTCOME_BONUS, 3))


def test_a_correct_outcome_outranks_a_marginally_closer_wrong_one() -> None:
    closer_but_wrong = candidate("wrong", was_correct=False, rsi=60.0)
    slightly_further_but_right = candidate("right", was_correct=True, rsi=58.0)

    ranked = score_similar_patterns(
        fingerprint(), [closer_but_wrong, slightly_further_but_right], limit=2
    )

    assert [pattern.id for pattern in ranked] == ["right", "wrong"]


def test_unvalidated_candidates_get_no_bonus() -> None:
    """`was_correct=None` is "not scored yet", not "wrong" — and not a bonus."""
    ranked = score_similar_patterns(fingerprint(), [candidate("pending")], limit=1)
    assert ranked[0].was_correct is None
    assert ranked[0].similarity_score == pytest.approx(1.0)


# --- outcome validation --------------------------------------------------------


def test_realised_return_is_the_signed_percentage_move() -> None:
    assert realised_return_pct(100.0, 104.0) == pytest.approx(4.0)
    assert realised_return_pct(100.0, 97.5) == pytest.approx(-2.5)


@pytest.mark.parametrize(
    ("decision", "return_pct", "expected"),
    [
        # BUY: strictly greater than +2%.
        ("BUY", 2.01, True),
        ("BUY", 2.0, False),
        ("BUY", -4.0, False),
        # SELL: strictly less than -2%.
        ("SELL", -2.01, True),
        ("SELL", -2.0, False),
        ("SELL", 3.0, False),
        # HOLD: within ±5% inclusive.
        ("HOLD", 5.0, True),
        ("HOLD", -5.0, True),
        ("HOLD", 5.01, False),
        # Case and unknown decisions: judged as HOLD, matching upstream's
        # coercion of a missing decision to "HOLD".
        ("buy", 3.0, True),
        ("WATCH", 1.0, True),
    ],
)
def test_correctness_rule(decision: str, return_pct: float, expected: bool) -> None:
    assert decision_was_correct(decision, return_pct) is expected


def test_validate_outcome_refuses_a_non_positive_price() -> None:
    assert validate_outcome("BUY", 0.0, 100.0) is None
    assert validate_outcome("BUY", 100.0, 0.0) is None
    assert validate_outcome("BUY", -1.0, 100.0) is None


def test_validate_endpoint_scores_a_batch_and_reports_skips(client: TestClient) -> None:
    response = client.post(
        VALIDATE_PATH,
        headers=headers(),
        json={
            "analyses": [
                {"id": "a", "decision": "BUY", "price_at_analysis": 100.0, "current_price": 105.0},
                {"id": "b", "decision": "SELL", "price_at_analysis": 100.0, "current_price": 105.0},
                {"id": "c", "decision": "HOLD", "price_at_analysis": 100.0, "current_price": 101.0},
                {"id": "d", "decision": "BUY", "price_at_analysis": 0.0, "current_price": 105.0},
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["stats"] == {"validated": 3, "correct": 2, "incorrect": 1, "skipped": 1}
    assert payload["skipped"] == [{"id": "d", "reason": "non_positive_price"}]
    by_id = {row["id"]: row for row in payload["results"]}
    assert by_id["a"]["was_correct"] is True
    assert by_id["a"]["return_pct"] == pytest.approx(5.0)
    assert by_id["b"]["was_correct"] is False
    assert by_id["c"]["was_correct"] is True


def test_validate_endpoint_requires_auth(client: TestClient) -> None:
    response = client.post(
        VALIDATE_PATH,
        json={
            "analyses": [
                {"id": "a", "decision": "BUY", "price_at_analysis": 100.0, "current_price": 105.0}
            ]
        },
    )
    assert response.status_code == 401


def test_validate_endpoint_rejects_an_empty_batch(client: TestClient) -> None:
    response = client.post(VALIDATE_PATH, headers=headers(), json={"analyses": []})
    assert response.status_code == 422


# --- confidence buckets: the fixed key ------------------------------------------


@pytest.mark.parametrize(
    ("confidence", "expected"),
    [(49, None), (50, "50_60"), (69, "60_70"), (80, "80_90"), (90, "90_100"), (100, "90_100")],
)
def test_bucket_key_covers_the_whole_range_including_100(
    confidence: int, expected: str | None
) -> None:
    assert bucket_key_for_confidence(confidence) == expected


def test_top_bucket_key_matches_between_producer_and_consumer() -> None:
    """THE FIX. Upstream emitted "90_101" and looked up "90_100", so a 90+
    confidence never calibrated however much history existed."""
    rows = [(95, index % 2 == 0) for index in range(10)]
    accuracy = confidence_accuracy_by_bucket(rows)

    key = bucket_key_for_confidence(95)
    assert key == "90_100"
    assert key in accuracy
    assert accuracy[key] == pytest.approx(0.5)
    # And the lookup actually bites: 0.5 measured against an expected 0.95.
    assert adjusted_confidence(95, accuracy) == 50


def test_a_bucket_below_the_sample_floor_is_absent_not_zero() -> None:
    rows = [(75, True)] * (MIN_CONFIDENCE_BUCKET_SAMPLES - 1)
    accuracy = confidence_accuracy_by_bucket(rows)
    assert "70_80" not in accuracy
    # Unmeasured means untouched, never "corrected" downwards on no evidence.
    assert adjusted_confidence(75, accuracy) == 75


def test_adjusted_confidence_leaves_sub_50_and_zero_accuracy_alone() -> None:
    assert adjusted_confidence(40, {"50_60": 0.9}) == 40
    assert adjusted_confidence(65, {"60_70": 0.0}) == 65


def test_adjusted_confidence_boosts_an_underconfident_bucket() -> None:
    # expected = 0.5 + (60 - 50) / 100 = 0.6; measured 0.9 -> factor 1.5.
    assert adjusted_confidence(60, {"60_70": 0.9}) == 90
