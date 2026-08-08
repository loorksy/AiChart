"""rsi_reversion_v1 — deterministic mean-reversion strategy.

Trigger (plan section 3): RSI14 at an extreme (<=30 oversold, >=70
overbought) together with price touching the corresponding Bollinger(20,2)
band, gated to only fire while the market classifies as "range"
(engine/features.py's regime classifier, itself ADX14<20 in the normal
case — see engine/combine.py for why this keeps the two strategies from
firing on the same bar under ordinary conditions).

Plan type is always "immediate" — the touch has already happened. Stop = 1x
ATR14 beyond the touched band; the first (and only) target is the Bollinger
middle band.
"""

from __future__ import annotations

from typing import ClassVar

from app.engine.features import Features, Regime
from app.engine.strategies.base import Direction, Signal, Strategy

RSI_OVERSOLD = 30.0
RSI_OVERBOUGHT = 70.0
STOP_ATR_MULTIPLE = 1.0
ADX_GATE_LABEL = "ADX14>20"


class RsiReversionV1(Strategy):
    strategy_id: ClassVar[str] = "rsi_reversion_v1"
    version: ClassVar[str] = "1.0.0"
    display_name: ClassVar[str] = "RSI Bollinger Reversion"
    description: ClassVar[str] = (
        "RSI14 extreme plus a Bollinger(20,2) band touch, gated to "
        "regime=='range'. Immediate entry, target at the Bollinger middle "
        "band."
    )
    regime_affinity: ClassVar[Regime] = "range"

    def evaluate(self, features: Features) -> Signal | None:
        if features.regime != "range":
            return None
        i = features.last
        rsi_value = features.rsi14[i]
        lower, middle, upper = features.bb_lower[i], features.bb_middle[i], features.bb_upper[i]
        atr_value = features.atr14[i]
        if (
            rsi_value is None
            or lower is None
            or middle is None
            or upper is None
            or atr_value is None
        ):
            return None

        close = features.closes[i]
        direction: Direction | None = None
        if rsi_value <= RSI_OVERSOLD and close <= lower:
            direction = "buy"
        elif rsi_value >= RSI_OVERBOUGHT and close >= upper:
            direction = "sell"
        if direction is None:
            return None

        rationale = [f"regime=range (ADX14 below the {ADX_GATE_LABEL} gate)"]
        if direction == "buy":
            rationale.append(f"RSI14={rsi_value:.1f} <= {RSI_OVERSOLD:.0f} (oversold)")
            rationale.append("close at/through the lower Bollinger band")
            stop_loss = lower - STOP_ATR_MULTIPLE * atr_value
            confidence = max(0.4, min(0.9, 0.45 + (RSI_OVERSOLD - rsi_value) / 60))
        else:
            rationale.append(f"RSI14={rsi_value:.1f} >= {RSI_OVERBOUGHT:.0f} (overbought)")
            rationale.append("close at/through the upper Bollinger band")
            stop_loss = upper + STOP_ATR_MULTIPLE * atr_value
            confidence = max(0.4, min(0.9, 0.45 + (rsi_value - RSI_OVERBOUGHT) / 60))

        return Signal(
            strategy_id=self.strategy_id,
            strategy_version=self.version,
            direction=direction,
            plan_type="immediate",
            entry=close,
            stop_loss=stop_loss,
            take_profit=middle,
            targets=[middle],
            confidence=confidence,
            regime=self.regime_affinity,
            rationale=rationale,
            evidence={
                "rsi14": rsi_value,
                "bb_lower": lower,
                "bb_middle": middle,
                "bb_upper": upper,
                "atr14": atr_value,
                "close": close,
            },
        )

