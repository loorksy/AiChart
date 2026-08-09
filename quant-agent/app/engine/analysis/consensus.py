"""Multi-timeframe consensus: expansion, weighting, votes, agreement, override.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/fast_analysis.py` — the timeframe-selection
block, the per-timeframe consensus loop, the aggregation that follows it, the
consensus-confidence ladder, and the consensus-over-LLM override rule; plus
`_score_to_decision` from the same file.

Changed on port:
  * Upstream FETCHES each timeframe. This service is fetch-free: `web/` posts
    the timeframes it already collected, so `consensus_timeframes()` decides
    which of the POSTed frames carry weight rather than which to go and get.
    A frame in the expansion that `web/` did not send is simply absent — it is
    never substituted with a neighbour's score.
  * Upstream's extra outlook horizons are exactly 1W and 1H (collected only to
    feed the trend outlook, counted toward `tf_count`/agreement but given no
    consensus weight). Here that generalises to "every posted frame outside
    the consensus set", which is byte-identical for the canonical inputs and
    means no frame `web/` sent is silently dropped from the report.
  * `_score_to_decision`'s thresholds come from a DB calibration table
    upstream. There is no such table here, so its own documented defaults
    (+20 / -20) are constants — same numbers, one fewer moving part.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.engine.analysis.models import (
    CollectionMeta,
    ConsensusResult,
    DataQuality,
    Decision,
    TimeframeIndicators,
)
from app.engine.analysis.scoring import ObjectiveScore, RiskContext, indicators_present

# Upstream's `_get_ai_calibration` defaults, applied here as constants.
BUY_THRESHOLD = 20.0
SELL_THRESHOLD = -20.0
MIN_CONSENSUS_ABS_OVERRIDE = 15.0
QUALITY_HOLD_THRESHOLD = 0.7

# Longer frames anchor regime direction: a short-frame oversold bounce must
# not outvote a 1D/1W downtrend.
TIMEFRAME_BASE_WEIGHTS: dict[str, float] = {
    "1M": 0.75,
    "3M": 0.75,
    "5M": 0.80,
    "15M": 0.85,
    "30M": 0.90,
    "1H": 0.95,
    "4H": 1.10,
    "1D": 1.30,
    "1W": 1.35,
}
DEFAULT_TIMEFRAME_WEIGHT = 1.0

# A ranging market needs a stronger consensus before it may overrule the LLM.
RANGING_OVERRIDE_MULTIPLIER = 1.2
# ...and buying into a breakdown needs more still.
BEARISH_BUY_OVERRIDE_FLOOR = 40.0
PANIC_BUY_OVERRIDE_FLOOR = 55.0

# Quality degradation, read from the PRIMARY timeframe's collection meta only.
MACRO_FAILURE_MULTIPLIER = 0.85
NEWS_FAILURE_MULTIPLIER = 0.8
INDICATOR_GAP_MULTIPLIER = 0.65

_ONE_HOUR_ALIASES = ("1H", "1HOUR", "60M")
_FOUR_HOUR_ALIASES = ("4H",)
_ONE_DAY_ALIASES = ("1D", "1DAY", "D")


@dataclass(frozen=True)
class ConsensusOutcome:
    """`ordered_timeframes` is the report order for `objective_by_timeframe`:
    the weighted consensus frames first, then the outlook-only extras."""

    consensus: ConsensusResult
    ordered_timeframes: list[str]


def score_to_decision(score: float) -> Decision:
    """Port of `_score_to_decision`. The HOLD band is deliberately narrow
    (-20..+20) so a clear reading produces a direction, not a shrug."""
    if score >= BUY_THRESHOLD:
        return "BUY"
    if score <= SELL_THRESHOLD:
        return "SELL"
    return "HOLD"


def normalize_timeframe(timeframe: str) -> str:
    return timeframe.strip().upper()


def consensus_timeframes(primary_timeframe: str) -> list[str]:
    """Port of upstream's timeframe-selection block.

    1H -> +4H,1D; 4H -> +1D; 1D -> +4H; anything else -> +1D,4H. The primary
    frame is always first, and duplicates are dropped keeping first position.
    """
    primary = normalize_timeframe(primary_timeframe)
    frames: list[str] = [primary] if primary else []
    if primary in _ONE_HOUR_ALIASES:
        frames += ["4H", "1D"]
    elif primary in _FOUR_HOUR_ALIASES:
        frames += ["1D"]
    elif primary in _ONE_DAY_ALIASES:
        frames += ["4H"]
    else:
        frames += ["1D", "4H"]

    effective_primary = primary or "1D"
    if effective_primary not in frames:
        frames = [effective_primary, *frames]

    seen: set[str] = set()
    deduped: list[str] = []
    for frame in frames:
        if frame and frame not in seen:
            seen.add(frame)
            deduped.append(frame)
    return deduped


def timeframe_weight(timeframe: str, abs_score: float) -> float:
    """Base weight for the frame, doubled at most by the strength of its own
    reading: `base * (1 + min(1, abs_score / 100))`."""
    base = TIMEFRAME_BASE_WEIGHTS.get(normalize_timeframe(timeframe), DEFAULT_TIMEFRAME_WEIGHT)
    return base * (1.0 + min(1.0, abs_score / 100.0))


def build_consensus(
    *, primary_timeframe: str, overall_by_timeframe: Mapping[str, float]
) -> ConsensusOutcome:
    """Weighted mean over the consensus frames; agreement over ALL frames.

    Votes and weight come only from the consensus set. Agreement is measured
    across every frame that was scored, including the outlook-only ones —
    upstream's `tf_count` counts them too, which dilutes agreement on purpose.
    """
    wanted = consensus_timeframes(primary_timeframe)
    weighted = [frame for frame in wanted if frame in overall_by_timeframe]
    extras = [frame for frame in overall_by_timeframe if frame not in set(weighted)]
    ordered = [*weighted, *extras]

    votes: dict[str, int] = {"BUY": 0, "SELL": 0, "HOLD": 0}
    weighted_score_sum = 0.0
    weighted_weight_sum = 0.0
    for frame in weighted:
        overall = overall_by_timeframe[frame]
        votes[score_to_decision(overall)] += 1
        weight = timeframe_weight(frame, abs(overall))
        weighted_score_sum += overall * weight
        weighted_weight_sum += weight

    consensus_score = (
        weighted_score_sum / weighted_weight_sum if weighted_weight_sum > 0 else 0.0
    )
    consensus_decision = score_to_decision(consensus_score)

    timeframe_count = max(1, len(ordered))
    agreement_count = sum(
        1
        for frame in ordered
        if score_to_decision(overall_by_timeframe[frame]) == consensus_decision
    )
    return ConsensusOutcome(
        consensus=ConsensusResult(
            decision=consensus_decision,
            score=consensus_score,
            agreement=agreement_count / timeframe_count,
            timeframe_count=timeframe_count,
            votes=votes,
            weighted_score=consensus_score,
        ),
        ordered_timeframes=ordered,
    )


def quality_multiplier(
    *, primary_meta: CollectionMeta, primary_indicators: TimeframeIndicators
) -> float:
    """Port of the `failed_items`-driven degradation, primary frame only."""
    degraded = set(primary_meta.degraded_inputs)
    multiplier = 1.0
    if "macro" in degraded:
        multiplier *= MACRO_FAILURE_MULTIPLIER
    if "news" in degraded:
        multiplier *= NEWS_FAILURE_MULTIPLIER
    # Upstream tests `not ind.get("rsi")`, which is falsy for both a missing
    # key and an empty one. The typed equivalent is "no object, or an object
    # with nothing in it".
    rsi_missing = primary_indicators.rsi is None or primary_indicators.rsi.value is None
    trend_missing = (
        primary_indicators.moving_averages is None
        or primary_indicators.moving_averages.trend is None
    )
    if not indicators_present(primary_indicators) or rsi_missing or trend_missing:
        multiplier *= INDICATOR_GAP_MULTIPLIER
    return multiplier


def build_data_quality(
    *,
    multiplier: float,
    primary_meta: CollectionMeta,
    primary_objective: ObjectiveScore,
) -> DataQuality:
    """What was missing, and how much confidence that costs.

    `missing` names the objective components that carried no weight, then any
    input `web/` flagged as degraded — so the UI can say "no macro data" out
    loud instead of the number quietly being a zero.
    """
    missing: list[str] = []
    if not primary_objective.technical_present:
        missing.append("technical")
    if not primary_objective.fundamental_present:
        missing.append("fundamental")
    if not primary_objective.sentiment_present:
        missing.append("sentiment")
    if not primary_objective.macro_present:
        missing.append("macro")
    for name in primary_meta.degraded_inputs:
        if name not in missing:
            missing.append(name)

    return DataQuality(
        degraded=multiplier < 1.0 or not primary_meta.ok,
        confidence_penalty=int(round((1.0 - multiplier) * 100)),
        missing=missing,
    )


def multiplier_from_data_quality(data_quality: DataQuality | None) -> float:
    """Inverse of `build_data_quality`'s penalty. Absent quality info means
    undegraded inputs — the engine will not invent a penalty it was not told
    about."""
    if data_quality is None:
        return 1.0
    return 1.0 - data_quality.confidence_penalty / 100.0


def consensus_confidence(*, consensus_abs: float, agreement: float, multiplier: float) -> int:
    """Port of the three-step consensus-confidence ladder: strength, then
    agreement, then data quality — each `int()`-truncated as upstream does."""
    confidence = int(max(40.0, min(98.0, 50 + consensus_abs * 0.35)))
    confidence = int(max(35.0, min(98.0, confidence * (0.85 + 0.3 * agreement))))
    return int(max(0.0, min(100.0, confidence * multiplier)))


def minimum_override_abs(
    *, consensus_decision: str, llm_decision: str, regime: str, risk: RiskContext
) -> float:
    """How strong the consensus must be before it may overrule the model."""
    minimum = MIN_CONSENSUS_ABS_OVERRIDE
    if regime == "ranging":
        minimum *= RANGING_OVERRIDE_MULTIPLIER
    # Buying against a model that is not bullish, inside a bearish tape, is
    # the one direction that needs an unusually strong consensus.
    if (
        consensus_decision == "BUY"
        and llm_decision in ("SELL", "HOLD")
        and (risk.panic_breakdown or risk.bearish_context)
    ):
        floor = PANIC_BUY_OVERRIDE_FLOOR if risk.panic_breakdown else BEARISH_BUY_OVERRIDE_FLOOR
        minimum = max(minimum, floor)
    return minimum
