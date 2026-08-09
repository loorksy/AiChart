"""The analysis endpoints: `POST /internal/quant-agent/analysis/score`
(pre-LLM), `POST .../finalize` (post-LLM), `POST .../validate` (score a past
analysis against the price it actually reached) and `POST .../calibrate`
(what the decision thresholds would be if tuned on that validated history).

All four are pure functions over data `web/` pushes in — no store, no network,
no LLM. `web/` collects prices/indicators/news/macro, calls `/score`, builds
its prompt from the result, calls the model itself, then posts the raw model
output back to `/finalize` to have it constrained and vetoed. Weeks later its
validation cron fetches the realised price for each aged analysis and posts
`/validate`, then feeds the accumulated outcomes to `/calibrate` for a
read-only tuning report.

Error convention follows `app/api/recommendations.py` rather than
`app/api/strategies.py`: this is a data endpoint, so a request that cannot be
scored is a 422 with a code, not a 200 carrying `status="invalid"`.

The arithmetic behind all four endpoints is a port of QuantDinger
(https://github.com/OpenByteInc/QuantDinger), Copyright Open Byte Inc.,
licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0) — see the per-module headers
under `app/engine/analysis/`. Changed here: upstream runs collection, prompt
assembly, the LLM call, the scoring and persistence inside one `analyze()`
method, and its reflection/calibration workers own their own database
sessions; this service keeps only the deterministic middle and exposes it as
four stateless calls.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends

from app.engine.analysis.calibration import (
    MIN_CALIBRATION_SAMPLES,
    calibrate_decision_thresholds,
)
from app.engine.analysis.consensus import (
    QUALITY_HOLD_THRESHOLD,
    build_consensus,
    build_data_quality,
    consensus_confidence,
    minimum_override_abs,
    multiplier_from_data_quality,
    normalize_timeframe,
    quality_multiplier,
    score_to_decision,
)
from app.engine.analysis.constrain import (
    AppliedAdjustments,
    adjust_position_size,
    safe_float_price,
    validate_and_constrain,
)
from app.engine.analysis.memory import (
    confidence_accuracy_by_bucket,
    fingerprint_from_indicators,
    score_similar_patterns,
    validate_outcome,
)
from app.engine.analysis.models import (
    AnalysisCalibrateRequest,
    AnalysisCalibrateResponse,
    AnalysisFinalizeRequest,
    AnalysisFinalizeResponse,
    AnalysisScoreRequest,
    AnalysisScoreResponse,
    AnalysisValidateRequest,
    AnalysisValidateResponse,
    AnalysisValidationOutcome,
    AnalysisValidationSkip,
    AnalysisValidationStats,
    CalibrationThresholds,
    TimeframeObjectiveScore,
    TimeframePayload,
)
from app.engine.analysis.models import (
    AppliedAdjustments as AppliedAdjustmentsWire,
)
from app.engine.analysis.outlook import build_trend_outlook
from app.engine.analysis.scoring import (
    ObjectiveScore,
    calculate_objective_score,
    detect_market_regime,
    technical_risk_context,
)
from app.errors import require
from app.security import require_internal_auth

router = APIRouter(prefix="/internal/quant-agent/analysis", tags=["quant-agent-analysis"])

_AUTH = Depends(require_internal_auth)

DEFAULT_CONFIDENCE = 50.0


def _to_wire_score(objective: ObjectiveScore) -> TimeframeObjectiveScore:
    """An absent sentiment/macro input is reported as `null`, never as the
    0.0 the scorer used internally — 0.0 is a real reading ("balanced news",
    "calm macro"), and the UI has to be able to tell the two apart."""
    return TimeframeObjectiveScore(
        technical_score=objective.technical_score,
        fundamental_score=objective.fundamental_score,
        sentiment_score=objective.sentiment_score if objective.sentiment_present else None,
        macro_score=objective.macro_score if objective.macro_present else None,
        overall_score=objective.overall_score,
        decision=score_to_decision(objective.overall_score),
        abs_score=abs(objective.overall_score),
    )


def _confidence(analysis: dict[str, Any], *, zero_is_missing: bool = False) -> float:
    """Read the model's confidence.

    `zero_is_missing` reproduces upstream's `analysis.get("confidence", 50)
    or 50` in the two places that spell it that way — a reported 0 there is
    treated as no answer, not as no confidence.
    """
    value = safe_float_price(analysis.get("confidence", DEFAULT_CONFIDENCE), DEFAULT_CONFIDENCE)
    if value is None:
        return DEFAULT_CONFIDENCE
    if zero_is_missing and value == 0:
        return DEFAULT_CONFIDENCE
    return value


@router.post("/score", response_model=AnalysisScoreResponse, dependencies=[_AUTH])
async def score_analysis(body: AnalysisScoreRequest) -> AnalysisScoreResponse:
    frames: dict[str, TimeframePayload] = {}
    for label, payload in body.timeframes.items():
        normalized = normalize_timeframe(label)
        if normalized:
            frames[normalized] = payload

    primary = normalize_timeframe(body.primary_timeframe)
    require(
        primary in frames,
        "QUANT_AGENT_INPUT_INVALID",
        f"timeframes must include the primary timeframe '{primary}'",
        422,
    )

    # Only the primary frame carries macro/news/fundamentals: upstream
    # collects every other frame technical-only, and weighting them with the
    # primary's non-technical evidence would count that evidence twice.
    scored: dict[str, ObjectiveScore] = {}
    for label, payload in frames.items():
        is_primary = label == primary
        scored[label] = calculate_objective_score(
            market=body.market,
            indicators=payload.indicators,
            fundamental=body.fundamental if is_primary else None,
            news=body.news if is_primary else None,
            macro=body.macro if is_primary else None,
            crypto_factors=body.crypto_factors if is_primary else None,
        )

    overall_by_timeframe = {label: value.overall_score for label, value in scored.items()}
    outcome = build_consensus(
        primary_timeframe=primary, overall_by_timeframe=overall_by_timeframe
    )

    primary_payload = frames[primary]
    primary_objective = scored[primary]
    risk = technical_risk_context(primary_payload.indicators)
    trend_outlook = build_trend_outlook(
        overall_by_timeframe=overall_by_timeframe,
        primary_overall=primary_objective.overall_score,
        primary_fundamental_score=primary_objective.fundamental_score,
        primary_macro_score=primary_objective.macro_score,
        risk=risk,
    )

    similar_patterns = score_similar_patterns(
        fingerprint_from_indicators(primary_payload.indicators), body.memory_candidates
    )

    multiplier = quality_multiplier(
        primary_meta=primary_payload.collection_meta,
        primary_indicators=primary_payload.indicators,
    )
    data_quality = build_data_quality(
        multiplier=multiplier,
        primary_meta=primary_payload.collection_meta,
        primary_objective=primary_objective,
    )

    return AnalysisScoreResponse(
        objective_by_timeframe={
            label: _to_wire_score(scored[label]) for label in outcome.ordered_timeframes
        },
        consensus=outcome.consensus,
        trend_outlook=trend_outlook,
        similar_patterns=similar_patterns,
        data_quality=data_quality,
    )


@router.post("/finalize", response_model=AnalysisFinalizeResponse, dependencies=[_AUTH])
async def finalize_analysis(body: AnalysisFinalizeRequest) -> AnalysisFinalizeResponse:
    require(
        body.current_price > 0,
        "QUANT_AGENT_INPUT_INVALID",
        "current_price must be greater than zero",
        422,
    )

    analysis: dict[str, Any] = dict(body.llm_output)
    # A caller echoing a previous response back at us must not seed the report
    # of what this run changed.
    analysis.pop("applied", None)
    applied = AppliedAdjustments()

    original_confidence = _confidence(analysis)
    llm_decision = str(analysis.get("decision", "HOLD") or "HOLD").upper()

    multiplier = multiplier_from_data_quality(body.data_quality)
    consensus = body.consensus
    consensus_abs = abs(consensus.score)
    risk = technical_risk_context(body.indicators)
    minimum_abs = minimum_override_abs(
        consensus_decision=consensus.decision,
        llm_decision=llm_decision,
        regime=detect_market_regime(body.indicators),
        risk=risk,
    )

    if consensus_abs >= minimum_abs:
        # A consensus this strong outranks the model outright.
        analysis["decision"] = consensus.decision
        analysis["confidence"] = consensus_confidence(
            consensus_abs=consensus_abs, agreement=consensus.agreement, multiplier=multiplier
        )
        applied.decision_overridden_by = "consensus"
    else:
        analysis["confidence"] = int(
            max(0.0, min(100.0, _confidence(analysis, zero_is_missing=True) * multiplier))
        )
        if multiplier < QUALITY_HOLD_THRESHOLD:
            # Too little evidence to act on, whatever the model concluded.
            analysis["decision"] = "HOLD"
            analysis["confidence"] = min(int(_confidence(analysis, zero_is_missing=True)), 55)
            applied.decision_overridden_by = "consensus"

    analysis = validate_and_constrain(
        analysis,
        body.current_price,
        body.indicators,
        has_major_news=body.has_major_news,
        has_macro_event=body.has_macro_event,
        applied=applied,
    )
    analysis = adjust_position_size(
        analysis, agreement=consensus.agreement, multiplier=multiplier
    )

    applied.confidence_adjusted_by = _confidence(analysis) - original_confidence
    payload: dict[str, Any] = {
        **analysis,
        "applied": AppliedAdjustmentsWire.model_validate(asdict(applied)),
    }
    return AnalysisFinalizeResponse.model_validate(payload)


@router.post("/validate", response_model=AnalysisValidateResponse, dependencies=[_AUTH])
async def validate_analyses(body: AnalysisValidateRequest) -> AnalysisValidateResponse:
    """Score aged analyses against the price they actually reached.

    Upstream does the price lookup itself inside
    `validate_unvalidated_older_than`; this service has no egress, so `web/`
    reads the realised price and posts it alongside the stored one. A row whose
    either price is non-positive is reported in `skipped` — upstream `continue`s
    past it, and scoring it as a 0% move would silently record a correct HOLD.
    """
    results: list[AnalysisValidationOutcome] = []
    skipped: list[AnalysisValidationSkip] = []
    for candidate in body.analyses:
        verdict = validate_outcome(
            candidate.decision, candidate.price_at_analysis, candidate.current_price
        )
        if verdict is None:
            skipped.append(AnalysisValidationSkip(id=candidate.id, reason="non_positive_price"))
            continue
        results.append(
            AnalysisValidationOutcome(
                id=candidate.id,
                was_correct=verdict.was_correct,
                return_pct=verdict.return_pct,
            )
        )

    correct = sum(1 for outcome in results if outcome.was_correct)
    return AnalysisValidateResponse(
        results=results,
        skipped=skipped,
        stats=AnalysisValidationStats(
            validated=len(results),
            correct=correct,
            incorrect=len(results) - correct,
            skipped=len(skipped),
        ),
    )


@router.post("/calibrate", response_model=AnalysisCalibrateResponse, dependencies=[_AUTH])
async def calibrate_analysis_thresholds(
    body: AnalysisCalibrateRequest,
) -> AnalysisCalibrateResponse:
    """Report what the decision thresholds would be if tuned on validated history.

    Read-only by design: nothing in this service starts deciding differently
    because of the answer — see the module header of
    `app/engine/analysis/calibration.py`. Under the minimum sample count the
    live defaults come back untouched with `applied=false` and a reason code.

    `min_samples` can only be raised above `MIN_CALIBRATION_SAMPLES`, never
    lowered: a caller must not be able to talk the engine into tuning a
    decision boundary on twelve rows.
    """
    min_samples = max(MIN_CALIBRATION_SAMPLES, body.min_samples or MIN_CALIBRATION_SAMPLES)
    outcome = calibrate_decision_thresholds(body.samples, min_samples=min_samples)

    graded = [
        (sample.confidence, sample.was_correct)
        for sample in body.samples
        if sample.confidence is not None and sample.was_correct is not None
    ]
    return AnalysisCalibrateResponse(
        thresholds=CalibrationThresholds(
            buy_threshold=outcome.thresholds.buy_threshold,
            sell_threshold=outcome.thresholds.sell_threshold,
            min_consensus_abs_override=outcome.thresholds.min_consensus_abs_override,
            quality_hold_threshold=outcome.thresholds.quality_hold_threshold,
        ),
        applied=outcome.applied,
        reason=outcome.reason,
        best_accuracy=outcome.best_accuracy,
        coverage=outcome.coverage,
        sample_count=outcome.sample_count,
        confidence_accuracy=confidence_accuracy_by_bucket(graded),
    )
