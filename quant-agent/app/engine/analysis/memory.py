"""Similar-pattern scoring, outcome correctness and confidence-bucket accuracy
over past analyses `web/` supplies as candidates.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/analysis_memory.py`
(`AnalysisMemory.get_similar_patterns`, `_vol_bands_similar`,
`validate_unvalidated_older_than`, `get_confidence_accuracy_by_bucket`,
`get_adjusted_confidence`).

Changed on port:
  * Upstream runs the SQL query itself against `qd_analysis_memory`. This
    service owns no analysis history — `web/` keeps it and posts the already
    filtered candidates (validated rows with a known outcome, newest first),
    so only the arithmetic lives here. `web/` fetches `limit * 5` rows ordered
    by `validated_at DESC`; `score_similar_patterns` re-applies that pool cap
    itself so the ranking is `limit * 5`-bounded whatever a caller sends.
  * The candidate's indicator snapshot is flat (`rsi`, `macd_signal`,
    `ma_trend`, `volatility_level`) rather than upstream's nested
    `indicators_snapshot` JSON. `price_position` rides along in the contract
    but is not scored — upstream does not score it either, and giving it a
    weight would change every similarity number this port is meant to
    reproduce.
  * Upstream reads the current price itself to validate an outcome. This
    service has no network, so `web/` fetches the realised price and pushes
    `(price_at_analysis, current_price)` in; only the return arithmetic and
    the ±2%/±5% correctness rule live here.

TWO UPSTREAM BUGS ARE DELIBERATELY FIXED HERE — these are the only places this
module's numbers differ from QuantDinger's:

  1. VOLATILITY BANDS. `_vol_bands_similar` tests membership of two hardcoded
     sets, `{low, normal, normal_low}` and `{high, elevated, volatile,
     very_high}`. `"medium"` is in NEITHER, so a medium-vs-low comparison
     scored 0 — the same as medium-vs-high — even though `medium` is the
     middle of the only three levels the indicator pipeline actually emits
     (`high | medium | low | unknown`). The partial-credit band is replaced by
     an ordinal ladder (low 0, medium 1, high 2) scoring 0.08 when the two
     levels are at most one step apart. Every pair upstream already handled
     keeps its old score (`low`/`normal` are both rank 0; `high`/`elevated`
     are both rank 2; `low` vs `high` is still two steps and still 0); only
     the medium hole closes.

  2. CONFIDENCE-BUCKET KEY. `get_confidence_accuracy_by_bucket` writes the top
     bucket as `f"{lo}_{hi}"` = `"90_101"`, while `get_adjusted_confidence`
     looks it up as `"90_100"`. The top bucket therefore never calibrated at
     all. Both sides now read `CONFIDENCE_BUCKETS`, one table with the key
     spelled once, so the two can no longer disagree.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from app.engine.analysis.models import (
    MemoryCandidate,
    MemoryCandidateIndicators,
    SimilarPattern,
    TimeframeIndicators,
)

DEFAULT_SIMILAR_PATTERN_LIMIT = 3

# Upstream pulls `limit * 5` rows and ranks within them. `web/` runs that query,
# but the cap is re-applied here so the pool is bounded by the contract rather
# than by the caller's good behaviour.
CANDIDATE_POOL_MULTIPLIER = 5

# Weights: RSI proximity 0.30, MACD agreement 0.30, MA trend 0.25,
# volatility band 0.15 (halved to 0.08 for a neighbouring band).
RSI_TOLERANCE = 30.0
RSI_WEIGHT = 0.3
MACD_WEIGHT = 0.3
MA_TREND_WEIGHT = 0.25
VOLATILITY_WEIGHT = 0.15
VOLATILITY_BAND_WEIGHT = 0.08

# Below this the past case is not "similar" in any useful sense.
SIMILARITY_FLOOR = 0.25
# A case that turned out right is worth surfacing ahead of a marginally
# closer one that did not.
CORRECT_OUTCOME_BONUS = 0.1

# The ordinal replacement for upstream's two band sets — see bug 1 in the
# module header. Rank distance, not set membership, decides partial credit.
VOLATILITY_BAND_RANKS: dict[str, int] = {
    "low": 0,
    "normal": 0,
    "normal_low": 0,
    "medium": 1,
    "high": 2,
    "elevated": 2,
    "volatile": 2,
    "very_high": 2,
}
# One step apart earns partial credit; two steps (low vs high) earn nothing.
VOLATILITY_NEIGHBOUR_DISTANCE = 1

# Outcome rules, verbatim from `validate_unvalidated_older_than`. Shared with
# `app/engine/analysis/calibration.py`, which upstream duplicated into
# `ai_calibration._correctness_for_return` — the duplicate is exactly how two
# copies of one rule drift apart.
OUTCOME_BUY_THRESHOLD_PCT = 2.0
OUTCOME_SELL_THRESHOLD_PCT = -2.0
OUTCOME_HOLD_TOLERANCE_PCT = 5.0

# (low, high_exclusive, key). One table, read by both the producer and the
# consumer — see bug 2 in the module header.
CONFIDENCE_BUCKETS: tuple[tuple[int, int, str], ...] = (
    (50, 60, "50_60"),
    (60, 70, "60_70"),
    (70, 80, "70_80"),
    (80, 90, "80_90"),
    (90, 101, "90_100"),
)
# Fewer than this in a bucket and its hit rate is noise, not a measurement.
MIN_CONFIDENCE_BUCKET_SAMPLES = 5


@dataclass(frozen=True)
class PatternFingerprint:
    rsi: float
    macd_signal: str
    ma_trend: str
    volatility_level: str


@dataclass(frozen=True)
class OutcomeVerdict:
    """One validated analysis: what the price actually did, and whether the
    decision was right about it."""

    return_pct: float
    was_correct: bool


def volatility_bands_similar(first: str, second: str) -> bool:
    """Are two volatility levels close enough to earn partial credit?

    Replaces `_vol_bands_similar` — see bug 1 in the module header. An
    unrecognised level (upstream's `"unknown"`) is never similar to anything,
    which is what upstream's set membership did for it too.
    """
    left = VOLATILITY_BAND_RANKS.get(first.lower())
    right = VOLATILITY_BAND_RANKS.get(second.lower())
    if left is None or right is None:
        return False
    return abs(left - right) <= VOLATILITY_NEIGHBOUR_DISTANCE


def fingerprint_from_indicators(indicators: TimeframeIndicators) -> PatternFingerprint:
    """The current reading, with upstream's own defaults for missing parts."""
    return PatternFingerprint(
        rsi=(indicators.rsi.value if indicators.rsi else None) or 50.0,
        macd_signal=str((indicators.macd.signal if indicators.macd else None) or "neutral").lower(),
        ma_trend=str(
            (indicators.moving_averages.trend if indicators.moving_averages else None)
            or "sideways"
        ).lower(),
        volatility_level=str(indicators.volatility_level or "normal").lower(),
    )


def fingerprint_from_candidate(indicators: MemoryCandidateIndicators) -> PatternFingerprint:
    return PatternFingerprint(
        rsi=indicators.rsi or 50.0,
        macd_signal=str(indicators.macd_signal or "neutral").lower(),
        ma_trend=str(indicators.ma_trend or "sideways").lower(),
        volatility_level=str(indicators.volatility_level or "normal").lower(),
    )


def similarity(current: PatternFingerprint, historical: PatternFingerprint) -> float:
    """Raw similarity, before the was-correct bonus. 0.0 .. 1.0."""
    rsi_score = max(0.0, 1 - abs(historical.rsi - current.rsi) / RSI_TOLERANCE) * RSI_WEIGHT
    macd_score = MACD_WEIGHT if historical.macd_signal == current.macd_signal else 0.0
    ma_score = MA_TREND_WEIGHT if historical.ma_trend == current.ma_trend else 0.0
    if historical.volatility_level == current.volatility_level:
        volatility_score = VOLATILITY_WEIGHT
    elif volatility_bands_similar(current.volatility_level, historical.volatility_level):
        volatility_score = VOLATILITY_BAND_WEIGHT
    else:
        volatility_score = 0.0
    return rsi_score + macd_score + ma_score + volatility_score


def score_similar_patterns(
    current: PatternFingerprint,
    candidates: Iterable[MemoryCandidate],
    limit: int = DEFAULT_SIMILAR_PATTERN_LIMIT,
) -> list[SimilarPattern]:
    """Score, drop anything under the floor, rank, and take the top `limit`.

    Only the first `limit * CANDIDATE_POOL_MULTIPLIER` candidates are
    considered — upstream's `LIMIT limit * 5` on the candidate pull, enforced
    on this side of the split as well so the pool cannot silently widen.

    Ranking uses the unrounded score so ties break on candidate order (which
    is `web/`'s recency order), while the reported `similarity_score` is
    rounded to 3 decimals as upstream reports it.
    """
    pool_size = max(0, limit) * CANDIDATE_POOL_MULTIPLIER
    scored: list[tuple[float, SimilarPattern]] = []
    for candidate in list(candidates)[:pool_size]:
        raw = similarity(current, fingerprint_from_candidate(candidate.indicators))
        if raw < SIMILARITY_FLOOR:
            continue
        total = raw + (CORRECT_OUTCOME_BONUS if candidate.was_correct else 0.0)
        scored.append(
            (
                total,
                SimilarPattern(
                    id=candidate.id,
                    similarity_score=round(total, 3),
                    decision=candidate.decision,
                    was_correct=candidate.was_correct,
                ),
            )
        )
    scored.sort(key=lambda entry: -entry[0])
    return [pattern for _, pattern in scored[:limit]]


def realised_return_pct(price_at_analysis: float, current_price: float) -> float:
    """`((current - analysis) / analysis) * 100`, verbatim.

    The caller is responsible for rejecting a non-positive `price_at_analysis`
    (upstream `continue`s on one); dividing by it here would invent a number.
    """
    return ((current_price - price_at_analysis) / price_at_analysis) * 100.0


def decision_was_correct(decision: str, return_pct: float) -> bool:
    """Upstream's correctness rule, thresholds unchanged.

    Anything that is not BUY or SELL is judged as HOLD — upstream coerces a
    missing decision to `"HOLD"` before this test, and a decision string this
    service does not recognise is no more directional than a HOLD.
    """
    normalized = decision.strip().upper()
    if normalized == "BUY":
        return return_pct > OUTCOME_BUY_THRESHOLD_PCT
    if normalized == "SELL":
        return return_pct < OUTCOME_SELL_THRESHOLD_PCT
    return abs(return_pct) <= OUTCOME_HOLD_TOLERANCE_PCT


def validate_outcome(
    decision: str, price_at_analysis: float, current_price: float
) -> OutcomeVerdict | None:
    """Score one stored analysis against the price it actually reached.

    Returns `None` when either price is non-positive — upstream skips that row
    rather than marking it validated, and a fabricated 0% return would be
    counted as a correct HOLD.
    """
    if price_at_analysis <= 0 or current_price <= 0:
        return None
    return_pct = realised_return_pct(price_at_analysis, current_price)
    return OutcomeVerdict(
        return_pct=return_pct, was_correct=decision_was_correct(decision, return_pct)
    )


def bucket_key_for_confidence(confidence: int) -> str | None:
    """The `CONFIDENCE_BUCKETS` key a confidence falls in, or None below 50."""
    for low, high, key in CONFIDENCE_BUCKETS:
        if low <= confidence < high:
            return key
    return None


def confidence_accuracy_by_bucket(
    rows: Sequence[tuple[int, bool]],
) -> dict[str, float]:
    """Hit rate per confidence bucket over validated rows.

    `rows` are `(confidence, was_correct)` pairs; `web/` applies upstream's
    `validated_at IS NOT NULL AND was_correct IS NOT NULL AND confidence IS NOT
    NULL` filter and its 90-day window before pushing them. A bucket with fewer
    than `MIN_CONFIDENCE_BUCKET_SAMPLES` rows is OMITTED, not reported as zero.
    """
    accuracy: dict[str, float] = {}
    for low, high, key in CONFIDENCE_BUCKETS:
        subset = [correct for confidence, correct in rows if low <= confidence < high]
        if len(subset) < MIN_CONFIDENCE_BUCKET_SAMPLES:
            continue
        accuracy[key] = sum(1 for correct in subset if correct) / len(subset)
    return accuracy


def adjusted_confidence(raw_confidence: int, accuracy_by_bucket: Mapping[str, float]) -> int:
    """Upstream's `get_adjusted_confidence`, formula unchanged.

    `expected = 0.5 + (raw - 50) / 100` is what a well-calibrated model of that
    stated confidence should hit; the measured hit rate over that bucket scales
    it. Result clamped to 1..99. A bucket with no measurement (too few samples,
    or a confidence below 50) leaves the raw value alone — the whole point is
    that an unmeasured bucket must not be "corrected" on a guess.
    """
    bucket_key = bucket_key_for_confidence(raw_confidence)
    if bucket_key is None:
        return max(1, min(99, int(raw_confidence)))
    accuracy = accuracy_by_bucket.get(bucket_key)
    if accuracy is None or accuracy <= 0:
        return max(1, min(99, int(raw_confidence)))
    expected = 0.5 + (raw_confidence - 50) / 100
    if expected <= 0:
        return raw_confidence
    return max(1, min(99, int(raw_confidence * (accuracy / expected))))
