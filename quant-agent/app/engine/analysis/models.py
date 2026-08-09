"""Wire models for the two analysis endpoints (`app/api/analysis.py`).

The request/response field names here are FROZEN — `web/`'s bridge client is
written against them, so a rename is a breaking change on both sides.

Two deliberate departures from the rest of `app/storage/models.py`:

  * The nested indicator/news/macro payloads accept unknown keys instead of
    forbidding them. `web/` owns data collection and will keep enriching what
    it pushes; an indicator field this service does not read yet must not turn
    a whole analysis into a 422. The top-level request envelopes still forbid
    extras, so a structurally wrong body is still rejected loudly.
  * These models live in the engine package rather than in
    `app/storage/models.py` because nothing here is persisted — the analysis
    endpoints are pure functions over pushed data and write no table.

Shapes derived from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0); see
`backend_api_python/app/services/fast_analysis.py` and
`.../fast_analysis_scoring.py`. Changed on port: upstream reads
`indicators["volatility"]["pct"]`, `indicators["bollinger"]["BB_upper"]` and
`price["changePercent"]`; this service takes the flattened
`volatility_pct` / `bollinger.upper` / `change_24h` spellings that AiChart's
bridge contract froze.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Decision = Literal["BUY", "SELL", "HOLD"]

MAX_TIMEFRAMES = 12
MAX_MEMORY_CANDIDATES = 200


class IndicatorRsi(BaseModel):
    value: float | None = None


class IndicatorMacd(BaseModel):
    signal: str | None = Field(default=None, max_length=32)


class IndicatorMovingAverages(BaseModel):
    trend: str | None = Field(default=None, max_length=32)


class IndicatorBollinger(BaseModel):
    upper: float | None = None
    lower: float | None = None


class TimeframeIndicators(BaseModel):
    """One timeframe's indicator snapshot, exactly as `web/` computed it.

    Every field is optional and every consumer supplies upstream's own default
    for a missing value — a missing RSI still contributes its 0.30 weight at a
    neutral 50, which is what QuantDinger's `rsi_data.get("value", 50)` does.
    Absence is never turned into an invented number.
    """

    current_price: float | None = None
    rsi: IndicatorRsi | None = None
    macd: IndicatorMacd | None = None
    moving_averages: IndicatorMovingAverages | None = None
    bollinger: IndicatorBollinger | None = None
    price_position: float | None = None
    volume_ratio: float | None = None
    volatility_pct: float | None = None
    volatility_level: str | None = Field(default=None, max_length=32)
    atr: float | None = None
    change_24h: float | None = None
    # Upstream keeps a separate `indicators["trend"]` alongside
    # `moving_averages.trend`; the volume branch of the technical score reads
    # it first, so the two are not interchangeable.
    trend: str | None = Field(default=None, max_length=32)
    # `indicators["trading_levels"]`, flattened to match the rest of this
    # model. Only `/finalize` reads them (ATR-derived long levels, which it
    # mirrors around price for a short).
    suggested_stop_loss: float | None = None
    suggested_take_profit: float | None = None


class CollectionMeta(BaseModel):
    """`web/`'s report on how well that timeframe's collection went.

    `degraded_inputs` is the port of upstream's `_meta.failed_items`; the
    quality multiplier keys off the literal names "macro" and "news".
    """

    ok: bool = True
    degraded_inputs: list[str] = Field(default_factory=list, max_length=32)


class TimeframePayload(BaseModel):
    indicators: TimeframeIndicators = Field(default_factory=TimeframeIndicators)
    collection_meta: CollectionMeta = Field(default_factory=CollectionMeta)


class MemoryCandidateIndicators(BaseModel):
    rsi: float | None = None
    macd_signal: str | None = Field(default=None, max_length=32)
    ma_trend: str | None = Field(default=None, max_length=32)
    volatility_level: str | None = Field(default=None, max_length=32)
    # Accepted because the bridge contract carries it, but deliberately unused:
    # upstream's similarity score is RSI + MACD + MA trend + volatility only.
    price_position: float | None = None


class MemoryCandidate(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    decision: str = Field(min_length=1, max_length=32)
    was_correct: bool | None = None
    indicators: MemoryCandidateIndicators = Field(default_factory=MemoryCandidateIndicators)


class AnalysisScoreRequest(BaseModel):
    """Body for `POST /internal/quant-agent/analysis/score` (pre-LLM).

    `fundamental` / `news` / `macro` / `crypto_factors` are top-level, not
    per-timeframe, because upstream only collects them for the primary
    timeframe ("technical-only for cost" on every other frame) — so they are
    scored into the primary frame's objective score and nothing else.
    """

    model_config = ConfigDict(extra="forbid")

    market: str = Field(min_length=1, max_length=32)
    symbol: str = Field(min_length=1, max_length=32)
    primary_timeframe: str = Field(min_length=1, max_length=16)
    # Carried for parity with upstream's `_calculate_objective_score(data,
    # current_price)`, whose `current_price` argument is never read. Kept so
    # `web/` can post one envelope shape; not used by any score below.
    current_price: float | None = None
    timeframes: dict[str, TimeframePayload]
    fundamental: dict[str, Any] | None = None
    news: list[dict[str, Any]] | None = None
    macro: dict[str, Any] | None = None
    crypto_factors: dict[str, Any] | None = None
    memory_candidates: list[MemoryCandidate] = Field(default_factory=list)

    @model_validator(mode="after")
    def _bounded_collections(self) -> AnalysisScoreRequest:
        if not self.timeframes:
            raise ValueError("at least one timeframe is required")
        if len(self.timeframes) > MAX_TIMEFRAMES:
            raise ValueError(f"at most {MAX_TIMEFRAMES} timeframes are accepted per request")
        if len(self.memory_candidates) > MAX_MEMORY_CANDIDATES:
            raise ValueError(
                f"at most {MAX_MEMORY_CANDIDATES} memory candidates are accepted per request"
            )
        return self


class TimeframeObjectiveScore(BaseModel):
    """One timeframe's objective score, all components on a -100..+100 scale.

    `sentiment_score` / `macro_score` are `null` when that input was absent —
    never 0, which is a real score meaning "balanced news" / "calm macro".
    `fundamental_score` is different on purpose: upstream's neutral fallback
    for it is the number 50.0, not an absence.
    """

    technical_score: float
    fundamental_score: float
    sentiment_score: float | None
    macro_score: float | None
    overall_score: float
    decision: Decision
    abs_score: float


class ConsensusResult(BaseModel):
    """`score` and `weighted_score` are the same number under two names the
    bridge contract froze: the timeframe-weighted mean objective score."""

    decision: Decision
    score: float
    agreement: float
    timeframe_count: int
    votes: dict[str, int]
    weighted_score: float


class TrendOutlookLeg(BaseModel):
    label: str
    qualifier: str
    score: float


class TrendOutlook(BaseModel):
    h24: TrendOutlookLeg
    d3: TrendOutlookLeg
    w1: TrendOutlookLeg
    m1: TrendOutlookLeg


class SimilarPattern(BaseModel):
    id: str
    similarity_score: float
    decision: str
    was_correct: bool | None


class DataQuality(BaseModel):
    """`confidence_penalty` is upstream's `quality_multiplier` expressed as
    whole percentage points to subtract: multiplier 0.85 -> penalty 15."""

    degraded: bool
    confidence_penalty: int
    missing: list[str]


class AnalysisScoreResponse(BaseModel):
    objective_by_timeframe: dict[str, TimeframeObjectiveScore]
    consensus: ConsensusResult
    trend_outlook: TrendOutlook
    similar_patterns: list[SimilarPattern]
    data_quality: DataQuality


class AnalysisFinalizeRequest(BaseModel):
    """Body for `POST /internal/quant-agent/analysis/finalize` (post-LLM).

    `llm_output` stays a raw dict rather than a schema: the response has to
    echo back every key the model produced, and a typed model would silently
    drop the ones this service does not police.
    """

    model_config = ConfigDict(extra="forbid")

    market: str = Field(min_length=1, max_length=32)
    symbol: str = Field(min_length=1, max_length=32)
    current_price: float
    indicators: TimeframeIndicators = Field(default_factory=TimeframeIndicators)
    llm_output: dict[str, Any]
    has_major_news: bool = False
    has_macro_event: bool = False
    consensus: ConsensusResult
    # Optional so a caller that only wants the price/indicator constraints can
    # omit it; when absent the engine assumes undegraded inputs (multiplier
    # 1.0) rather than inventing a penalty.
    data_quality: DataQuality | None = None


class AppliedAdjustments(BaseModel):
    """What the engine changed, so `web/` can explain it in the user's own
    language rather than receiving pre-rendered prose from here.

    `indicator_conflicts` is additive to the frozen contract: upstream embeds
    the conflict list in a Chinese sentence appended to `summary`. This service
    emits machine-readable codes instead and leaves `summary` untouched — see
    the module header of `app/engine/analysis/constrain.py`.
    """

    entry_clamped: bool
    stop_defaulted: bool
    take_profit_defaulted: bool
    decision_overridden_by: Literal["indicators", "consensus"] | None
    confidence_adjusted_by: float
    indicator_conflicts: list[str]


class AnalysisFinalizeResponse(BaseModel):
    """`llm_output`'s own keys, constrained and vetoed, plus `applied`.

    `extra="allow"` is what carries the echoed LLM keys through; every field
    the engine actually governs (decision, confidence, the three prices, the
    three scores) is written by `constrain.validate_and_constrain`.
    """

    model_config = ConfigDict(extra="allow")

    applied: AppliedAdjustments
