"""Selection policy for arbitrating between strategy signals (plan section
3). Transparent by design — no hidden scoring, every branch below is
explained in `rationale`:

  * No strategy fires            -> no signal.
  * Exactly one strategy fires   -> it is used as-is.
  * Two+ strategies fire and agree on direction
                                  -> the one whose `regime_affinity` matches
                                     the current regime wins; the other(s)
                                     are recorded as corroborating evidence.
  * Two+ strategies fire and disagree on direction
                                  -> the one whose `regime_affinity` matches
                                     the current regime wins; the conflict is
                                     recorded explicitly in `rationale`
                                     rather than silently dropped.

Note on the current two-strategy universe: ema_trend_v1's gate is a raw
ADX14>20 check and rsi_reversion_v1's gate is regime=="range" (which is
ADX14<=20 in the ordinary case — see engine/features.py's classifier). That
makes simultaneous firing rare in practice today, but this function is
written generically against a list of signals so it keeps working unchanged
once a third strategy is registered (registry.py's own docstring)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.engine.features import Regime
from app.engine.strategies.base import Signal


class CombineResult(BaseModel):
    signal: Signal | None
    rationale: list[str] = Field(default_factory=list)
    corroborating: list[Signal] = Field(default_factory=list)
    conflicting: list[Signal] = Field(default_factory=list)


def combine_signals(signals: list[Signal | None], regime: Regime) -> CombineResult:
    fired = [signal for signal in signals if signal is not None]
    if not fired:
        return CombineResult(
            signal=None,
            rationale=["no strategy produced a signal on the latest bar"],
        )

    if len(fired) == 1:
        chosen = fired[0]
        return CombineResult(
            signal=chosen,
            rationale=[f"single strategy fired: {chosen.strategy_id}"],
        )

    directions = {signal.direction for signal in fired}
    regime_matched = [signal for signal in fired if signal.regime == regime]
    chosen = regime_matched[0] if regime_matched else fired[0]
    others = [signal for signal in fired if signal is not chosen]
    match_note = (
        f"regime={regime} matches {chosen.strategy_id}"
        if regime_matched
        else (
            f"regime={regime} matches none of the firing strategies; "
            f"defaulting to {chosen.strategy_id}"
        )
    )

    if len(directions) == 1:
        rationale = [
            "strategies agree on "
            + chosen.direction
            + ": "
            + ", ".join(signal.strategy_id for signal in fired),
            match_note,
        ]
        return CombineResult(signal=chosen, rationale=rationale, corroborating=others)

    opposing_summary = ", ".join(f"{signal.strategy_id} ({signal.direction})" for signal in others)
    rationale = [
        f"conflict: {chosen.strategy_id} ({chosen.direction}) vs {opposing_summary}",
        match_note,
    ]
    return CombineResult(signal=chosen, rationale=rationale, conflicting=others)
