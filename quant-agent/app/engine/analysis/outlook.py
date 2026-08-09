"""Multi-horizon trend outlook: ~24h, ~3d, ~1w, ~1m.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/fast_analysis.py` (the horizon block that
builds `trend_outlook`, and `_trend_strength`) plus the English label map in
`.../fast_analysis_formatters.py::build_trend_outlook_summary`.

The four legs are pure arithmetic over objective scores that already exist —
no extra data is fetched, and no horizon invents a number when its own frame
is missing: it inherits the next-longer frame's score, exactly as upstream.

Changed on port:
  * Wire keys are the bridge contract's `h24`/`d3`/`w1`/`m1` with
    `{label, qualifier, score}`, not upstream's
    `next_24h`/`next_3d`/`next_1w`/`next_1m` with `{trend, strength, score}`.
    `label` is the English outlook word (upstream's summary-string label map);
    `qualifier` is `_trend_strength`. HOLD maps to "neutral" rather than
    upstream's "neutral / range" — the qualifier already carries that nuance.
  * No summary sentence is produced. `build_trend_outlook_summary` renders
    Chinese or English prose; AiChart renders its own bilingual copy from
    these three structured fields.
"""

from __future__ import annotations

from collections.abc import Mapping

from app.engine.analysis.consensus import score_to_decision
from app.engine.analysis.models import TrendOutlook, TrendOutlookLeg
from app.engine.analysis.scoring import RiskContext

OUTLOOK_LABELS: dict[str, str] = {"BUY": "bullish", "SELL": "bearish", "HOLD": "neutral"}

# `_trend_strength` bands.
STRENGTH_STRONG = 70.0
STRENGTH_MODERATE = 40.0
STRENGTH_MILD = 20.0

# A confirmed breakdown caps every horizon; a merely bearish tape after a
# >=3% drop caps only the two nearest ones.
PANIC_CAPS = {"h24": -20.0, "d3": -10.0, "w1": 0.0, "m1": 10.0}
BEARISH_CAPS = {"h24": 5.0, "d3": 10.0}


def trend_strength(score: float) -> str:
    magnitude = abs(score)
    if magnitude >= STRENGTH_STRONG:
        return "strong"
    if magnitude >= STRENGTH_MODERATE:
        return "moderate"
    if magnitude >= STRENGTH_MILD:
        return "mild"
    return "neutral"


def _leg(score: float) -> TrendOutlookLeg:
    decision = score_to_decision(score)
    return TrendOutlookLeg(
        label=OUTLOOK_LABELS[decision],
        qualifier=trend_strength(score),
        score=round(score, 2),
    )


def build_trend_outlook(
    *,
    overall_by_timeframe: Mapping[str, float],
    primary_overall: float,
    primary_fundamental_score: float,
    primary_macro_score: float,
    risk: RiskContext,
) -> TrendOutlook:
    """Port of upstream's horizon block.

    Inheritance chain: 1D falls back to the primary frame's overall score, 4H
    falls back to 1D, 1H falls back to 4H, 1W falls back to 1D. Upstream
    spells each fallback with `or`, so a frame whose score is exactly 0.0 is
    treated as missing and inherits instead — reproduced deliberately, since
    an exact zero and "no reading" score identically either way.
    """
    score_1d = overall_by_timeframe.get("1D", primary_overall)
    score_4h = overall_by_timeframe.get("4H") or score_1d
    score_1h = overall_by_timeframe.get("1H") or score_4h
    score_1w = overall_by_timeframe.get("1W") or score_1d

    # ~24h is the 1H bar's objective score, not the daily close's.
    score_24h = score_1h
    score_3d = score_1d * 0.7 + score_4h * 0.3
    # The one-month leg is the only horizon that leans on non-technical
    # evidence: slow-moving fundamentals and macro outlive a week of bars.
    score_1m = score_1w * 0.55 + primary_fundamental_score * 0.30 + primary_macro_score * 0.15

    if risk.panic_breakdown:
        score_24h = min(score_24h, PANIC_CAPS["h24"])
        score_3d = min(score_3d, PANIC_CAPS["d3"])
        score_1w = min(score_1w, PANIC_CAPS["w1"])
        score_1m = min(score_1m, PANIC_CAPS["m1"])
    elif risk.bearish_context and risk.change_24h <= -3.0:
        score_24h = min(score_24h, BEARISH_CAPS["h24"])
        score_3d = min(score_3d, BEARISH_CAPS["d3"])

    return TrendOutlook(
        h24=_leg(score_24h),
        d3=_leg(score_3d),
        w1=_leg(score_1w),
        m1=_leg(score_1m),
    )
