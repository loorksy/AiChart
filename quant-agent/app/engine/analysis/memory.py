"""Similar-pattern scoring over past analyses `web/` supplies as candidates.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/analysis_memory.py`
(`AnalysisMemory.get_similar_patterns` and `_vol_bands_similar`).

Changed on port:
  * Upstream runs the SQL query itself against `qd_analysis_memory`. This
    service owns no analysis history — `web/` keeps it and posts the already
    filtered candidates (validated rows with a known outcome, newest first),
    so only the similarity arithmetic lives here. The `limit * 5` prefetch and
    the `ORDER BY validated_at DESC` are `web/`'s side of that split.
  * The candidate's indicator snapshot is flat (`rsi`, `macd_signal`,
    `ma_trend`, `volatility_level`) rather than upstream's nested
    `indicators_snapshot` JSON. `price_position` rides along in the contract
    but is not scored — upstream does not score it either.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from app.engine.analysis.models import (
    MemoryCandidate,
    MemoryCandidateIndicators,
    SimilarPattern,
    TimeframeIndicators,
)

DEFAULT_SIMILAR_PATTERN_LIMIT = 3

# Weights: RSI proximity 0.30, MACD agreement 0.30, MA trend 0.25,
# volatility band 0.15 (halved to 0.08 for a same-band-but-different label).
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

VOLATILITY_LOW_BAND = frozenset({"low", "normal", "normal_low"})
VOLATILITY_HIGH_BAND = frozenset({"high", "elevated", "volatile", "very_high"})


@dataclass(frozen=True)
class PatternFingerprint:
    rsi: float
    macd_signal: str
    ma_trend: str
    volatility_level: str


def volatility_bands_similar(first: str, second: str) -> bool:
    """Port of `_vol_bands_similar`: "low" and "normal" are the same story."""
    left = first.lower()
    right = second.lower()
    if left in VOLATILITY_LOW_BAND and right in VOLATILITY_LOW_BAND:
        return True
    return left in VOLATILITY_HIGH_BAND and right in VOLATILITY_HIGH_BAND


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

    Ranking uses the unrounded score so ties break on candidate order (which
    is `web/`'s recency order), while the reported `similarity_score` is
    rounded to 3 decimals as upstream reports it.
    """
    scored: list[tuple[float, SimilarPattern]] = []
    for candidate in candidates:
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
