"""Decision-threshold grid search over validated history.

The load-bearing property is the refusal: under `MIN_CALIBRATION_SAMPLES` rows
the live thresholds come back untouched with `applied=false`, so a thin history
can never move a decision boundary.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.engine.analysis.calibration import (
    DEFAULT_THRESHOLDS,
    MIN_CALIBRATION_SAMPLES,
    REASON_TOO_FEW_SAMPLES,
    calibrate_decision_thresholds,
    predict_decision_from_score,
)
from app.engine.analysis.consensus import (
    BUY_THRESHOLD,
    MIN_CONSENSUS_ABS_OVERRIDE,
    QUALITY_HOLD_THRESHOLD,
    SELL_THRESHOLD,
)
from app.engine.analysis.models import CalibrationSample
from tests.conftest import headers

CALIBRATE_PATH = "/internal/quant-agent/analysis/calibrate"


def sample(score: float, return_pct: float, **extra: object) -> CalibrationSample:
    return CalibrationSample.model_validate(
        {"consensus_score": score, "actual_return_pct": return_pct, **extra}
    )


def wire_sample(score: float, return_pct: float, **extra: object) -> dict[str, object]:
    return {"consensus_score": score, "actual_return_pct": return_pct, **extra}


@pytest.mark.parametrize(
    ("score", "threshold", "expected"),
    [
        (20.0, 20.0, "BUY"),
        (19.9, 20.0, "HOLD"),
        (-20.0, 20.0, "SELL"),
        (-19.9, 20.0, "HOLD"),
        (0.0, 10.0, "HOLD"),
    ],
)
def test_prediction_band_is_symmetric_and_inclusive(
    score: float, threshold: float, expected: str
) -> None:
    assert predict_decision_from_score(score, threshold) == expected


def test_defaults_mirror_the_live_consensus_constants() -> None:
    """One source of truth: the report describes the thresholds the engine is
    actually deciding with, not a second copy that can drift from them."""
    assert DEFAULT_THRESHOLDS.buy_threshold == BUY_THRESHOLD
    assert DEFAULT_THRESHOLDS.sell_threshold == SELL_THRESHOLD
    assert DEFAULT_THRESHOLDS.min_consensus_abs_override == MIN_CONSENSUS_ABS_OVERRIDE
    assert DEFAULT_THRESHOLDS.quality_hold_threshold == QUALITY_HOLD_THRESHOLD


def test_too_few_samples_returns_the_defaults_untouched() -> None:
    samples = [sample(30.0, 5.0) for _ in range(MIN_CALIBRATION_SAMPLES - 1)]

    outcome = calibrate_decision_thresholds(samples)

    assert outcome.applied is False
    assert outcome.reason == REASON_TOO_FEW_SAMPLES
    assert outcome.thresholds == DEFAULT_THRESHOLDS
    assert outcome.best_accuracy is None
    assert outcome.sample_count == MIN_CALIBRATION_SAMPLES - 1


def test_an_empty_history_returns_the_defaults_untouched() -> None:
    outcome = calibrate_decision_thresholds([])
    assert outcome.applied is False
    assert outcome.thresholds == DEFAULT_THRESHOLDS
    assert outcome.sample_count == 0


def test_it_finds_the_threshold_that_separates_the_history() -> None:
    """A history where every move above +16 ran up and every move below -16 ran
    down, and the ±10..14 band is noise that a low threshold would misread."""
    samples: list[CalibrationSample] = []
    for _ in range(30):
        samples.append(sample(25.0, 6.0))  # correctly BUY at any threshold <= 25
        samples.append(sample(-25.0, -6.0))  # correctly SELL at any threshold <= 25
        # Middling scores that went nowhere: only a threshold above 14 calls
        # these HOLD, and only HOLD is right about them.
        samples.append(sample(14.0, 0.5))

    outcome = calibrate_decision_thresholds(samples)

    assert outcome.applied is True
    assert outcome.reason is None
    assert outcome.thresholds.buy_threshold == pytest.approx(16.0)
    assert outcome.thresholds.sell_threshold == pytest.approx(-16.0)
    assert outcome.best_accuracy == pytest.approx(100.0)
    assert outcome.coverage == {"BUY": 30, "SELL": 30, "HOLD": 30}


def test_accuracy_wins_before_coverage() -> None:
    """A +2.0% move makes BUY wrong (it needs strictly more than 2) and HOLD
    right, so the wider band is genuinely more accurate. Coverage must not pull
    the answer back down to the call-happy threshold."""
    samples = [sample(11.0, 2.0) for _ in range(MIN_CALIBRATION_SAMPLES)]

    outcome = calibrate_decision_thresholds(samples)

    assert outcome.applied is True
    assert outcome.thresholds.buy_threshold == pytest.approx(12.0)
    assert outcome.coverage == {"BUY": 0, "SELL": 0, "HOLD": MIN_CALIBRATION_SAMPLES}


def test_an_exact_tie_keeps_the_threshold_that_makes_the_most_calls() -> None:
    """A +3.0% move satisfies BUY (>2) AND HOLD (|3| <= 5), so every threshold
    scores 100%. Directional coverage falls as the threshold widens and the
    grid is ascending, so the first — most call-happy — winner is the one kept:
    the engine does not drift towards silence on a tie."""
    samples = [sample(15.0, 3.0) for _ in range(MIN_CALIBRATION_SAMPLES)]

    outcome = calibrate_decision_thresholds(samples)

    assert outcome.best_accuracy == pytest.approx(100.0)
    assert outcome.thresholds.buy_threshold == pytest.approx(10.0)
    assert outcome.coverage == {"BUY": MIN_CALIBRATION_SAMPLES, "SELL": 0, "HOLD": 0}


def test_the_non_searched_thresholds_are_carried_through_unchanged() -> None:
    samples = [sample(25.0, 6.0) for _ in range(MIN_CALIBRATION_SAMPLES)]
    outcome = calibrate_decision_thresholds(samples)
    assert outcome.thresholds.min_consensus_abs_override == MIN_CONSENSUS_ABS_OVERRIDE
    assert outcome.thresholds.quality_hold_threshold == QUALITY_HOLD_THRESHOLD


def test_calibrate_endpoint_reports_a_thin_history_without_tuning(
    client: TestClient,
) -> None:
    response = client.post(
        CALIBRATE_PATH,
        headers=headers(),
        json={"samples": [wire_sample(30.0, 6.0) for _ in range(5)]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["applied"] is False
    assert payload["reason"] == REASON_TOO_FEW_SAMPLES
    assert payload["thresholds"]["buy_threshold"] == pytest.approx(BUY_THRESHOLD)
    assert payload["sample_count"] == 5
    assert payload["confidence_accuracy"] == {}


def test_calibrate_endpoint_reports_confidence_accuracy_alongside_thresholds(
    client: TestClient,
) -> None:
    samples = [
        wire_sample(25.0, 6.0, confidence=75, was_correct=index % 4 != 0) for index in range(80)
    ]

    payload = client.post(CALIBRATE_PATH, headers=headers(), json={"samples": samples}).json()

    assert payload["applied"] is True
    assert payload["confidence_accuracy"]["70_80"] == pytest.approx(0.75)
    assert payload["coverage"]["BUY"] == 80


def test_calibrate_endpoint_cannot_be_talked_into_a_lower_bar(client: TestClient) -> None:
    """`min_samples` may only be raised. A caller asking for 5 still gets the
    engine's own floor, so a decision boundary never tunes on a handful of rows."""
    payload = client.post(
        CALIBRATE_PATH,
        headers=headers(),
        json={"samples": [wire_sample(30.0, 6.0) for _ in range(10)], "min_samples": 5},
    ).json()

    assert payload["applied"] is False
    assert payload["reason"] == REASON_TOO_FEW_SAMPLES


def test_calibrate_endpoint_requires_auth(client: TestClient) -> None:
    assert client.post(CALIBRATE_PATH, json={"samples": []}).status_code == 401


def test_calibrate_endpoint_rejects_unknown_sample_fields(client: TestClient) -> None:
    response = client.post(
        CALIBRATE_PATH,
        headers=headers(),
        json={"samples": [{"consensus_score": 1.0, "actual_return_pct": 1.0, "symbol": "XAUUSD"}]},
    )
    assert response.status_code == 422
