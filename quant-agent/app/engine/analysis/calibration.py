"""Decision-threshold self-tuning over validated analysis outcomes.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/ai_calibration.py`
(`AICalibrationService._candidate_abs_thresholds`,
`._predict_decision_from_score`, `.calibrate_market`).

The idea is upstream's, unchanged: replay every validated analysis through a
candidate absolute threshold `thr` (`score >= +thr` ⇒ BUY, `score <= -thr` ⇒
SELL, else HOLD), score the replay against what the price actually did, and
keep the threshold with the best accuracy — tie-broken towards the one that
issues more directional calls, because a threshold that always says HOLD is
accurate and useless.

Changed on port:
  * NO DATABASE, NO PERSISTENCE. Upstream reads `qd_analysis_memory` and writes
    the winner into `qd_ai_calibration`, so the next analysis silently runs on
    tuned thresholds. This service has neither table and no store of its own:
    `web/` pushes the validated rows in and gets the search result back as a
    REPORT. Nothing here mutates `consensus.py`'s live thresholds — a
    self-modifying decision boundary that no operator approved is not a
    behaviour this port adopts, and the accuracy figure is only as trustworthy
    as the ±2%/±5% proxy it is measured against.
  * The correctness rule is imported from `app/engine/analysis/memory.py`
    instead of being re-declared. Upstream has two copies of the same ±2%/±5%
    thresholds (`analysis_memory.validate_unvalidated_older_than` and
    `ai_calibration._correctness_for_return`), which is exactly the shape of
    drift this port is trying not to inherit.
  * The candidate grid is a module constant. Upstream reads
    `AI_CALIBRATION_CANDIDATE_ABS_THRESHOLDS` from the environment and falls
    back to this same list; this service's settings are a closed model
    (`app/config.py`), and a grid nobody has tuned is not worth an env var.
  * Upstream pre-validates rows inside `calibrate_market` (it calls the market
    data collector). That step needs the network, so it lives in `web/`'s cron
    and has already happened by the time these samples arrive.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from app.engine.analysis.consensus import (
    BUY_THRESHOLD,
    MIN_CONSENSUS_ABS_OVERRIDE,
    QUALITY_HOLD_THRESHOLD,
    SELL_THRESHOLD,
)
from app.engine.analysis.memory import decision_was_correct
from app.engine.analysis.models import CalibrationSample, Decision

# Upstream's default grid, values unchanged.
DEFAULT_CANDIDATE_ABS_THRESHOLDS: tuple[float, ...] = (
    10.0,
    12.0,
    14.0,
    16.0,
    18.0,
    20.0,
    22.0,
    25.0,
    30.0,
)

# `AI_CALIBRATION_MIN_SAMPLES` upstream. Below this the search is fitting
# noise, and upstream returns None rather than a tuned threshold.
MIN_CALIBRATION_SAMPLES = 80

DECISIONS: tuple[Decision, ...] = ("BUY", "SELL", "HOLD")

# Machine-readable reasons for a search that did not run, so `web/` renders the
# explanation in the reader's own language instead of echoing English prose.
REASON_TOO_FEW_SAMPLES = "too_few_samples"
REASON_NO_USABLE_SAMPLES = "no_usable_samples"


@dataclass(frozen=True)
class DecisionThresholds:
    """The four numbers `consensus.py` decides with. `min_consensus_abs_override`
    and `quality_hold_threshold` are carried but never searched — upstream
    reads them straight back off the previous row too, so the report always
    describes a complete configuration rather than a fragment of one."""

    buy_threshold: float
    sell_threshold: float
    min_consensus_abs_override: float
    quality_hold_threshold: float


DEFAULT_THRESHOLDS = DecisionThresholds(
    buy_threshold=BUY_THRESHOLD,
    sell_threshold=SELL_THRESHOLD,
    min_consensus_abs_override=MIN_CONSENSUS_ABS_OVERRIDE,
    quality_hold_threshold=QUALITY_HOLD_THRESHOLD,
)


@dataclass(frozen=True)
class CalibrationOutcome:
    """`applied=False` means the live thresholds are being reported back
    untouched, and `reason` says why the search did not produce a winner."""

    thresholds: DecisionThresholds
    applied: bool
    reason: str | None
    best_accuracy: float | None
    coverage: dict[str, int] = field(default_factory=dict)
    sample_count: int = 0


def predict_decision_from_score(score: float, abs_threshold: float) -> Decision:
    """`_predict_decision_from_score`, verbatim: a symmetric band around zero."""
    if score >= abs_threshold:
        return "BUY"
    if score <= -abs_threshold:
        return "SELL"
    return "HOLD"


def _score_threshold(
    samples: Sequence[CalibrationSample], abs_threshold: float
) -> tuple[float, dict[str, int]] | None:
    """Accuracy (0..100) and per-decision coverage for one candidate threshold."""
    coverage: dict[str, int] = dict.fromkeys(DECISIONS, 0)
    correct = 0
    for sample in samples:
        predicted = predict_decision_from_score(sample.consensus_score, abs_threshold)
        coverage[predicted] += 1
        if decision_was_correct(predicted, sample.actual_return_pct):
            correct += 1
    if not samples:
        return None
    return correct / len(samples) * 100.0, coverage


def calibrate_decision_thresholds(
    samples: Iterable[CalibrationSample],
    *,
    min_samples: int = MIN_CALIBRATION_SAMPLES,
    candidate_thresholds: Sequence[float] = DEFAULT_CANDIDATE_ABS_THRESHOLDS,
) -> CalibrationOutcome:
    """Grid-search the absolute decision threshold over validated history.

    Returns the live defaults untouched, with `applied=False`, whenever there
    is not enough validated history to justify moving them — upstream's
    `if sample_count < min_samples: return None`, expressed as a reported
    non-result rather than a silence the caller has to interpret.
    """
    rows = list(samples)
    if len(rows) < min_samples:
        return CalibrationOutcome(
            thresholds=DEFAULT_THRESHOLDS,
            applied=False,
            reason=REASON_TOO_FEW_SAMPLES,
            best_accuracy=None,
            coverage={},
            sample_count=len(rows),
        )

    best_threshold: float | None = None
    best_accuracy = -1.0
    best_coverage: dict[str, int] = dict.fromkeys(DECISIONS, 0)

    for threshold in candidate_thresholds:
        scored = _score_threshold(rows, threshold)
        if scored is None:
            continue
        accuracy, coverage = scored
        directional = coverage["BUY"] + coverage["SELL"]
        best_directional = best_coverage["BUY"] + best_coverage["SELL"]
        if accuracy > best_accuracy:
            best_accuracy = accuracy
            best_threshold = threshold
            best_coverage = coverage
        elif accuracy == best_accuracy and directional > best_directional:
            # Upstream's tie-break: same hit rate, more calls actually made —
            # prefer the threshold that does not hide behind HOLD. Kept for
            # fidelity, but note it cannot fire with an ASCENDING grid:
            # directional coverage is non-increasing in the threshold, so a
            # later candidate never makes more calls than an earlier one. What
            # the grid order therefore guarantees is the same intent — on a
            # tie the WIDEST-calling threshold already won and is kept.
            best_threshold = threshold
            best_coverage = coverage

    if best_threshold is None:
        return CalibrationOutcome(
            thresholds=DEFAULT_THRESHOLDS,
            applied=False,
            reason=REASON_NO_USABLE_SAMPLES,
            best_accuracy=None,
            coverage={},
            sample_count=len(rows),
        )

    return CalibrationOutcome(
        thresholds=DecisionThresholds(
            buy_threshold=float(best_threshold),
            sell_threshold=float(-best_threshold),
            min_consensus_abs_override=DEFAULT_THRESHOLDS.min_consensus_abs_override,
            quality_hold_threshold=DEFAULT_THRESHOLDS.quality_hold_threshold,
        ),
        applied=True,
        reason=None,
        best_accuracy=best_accuracy,
        coverage=best_coverage,
        sample_count=len(rows),
    )
