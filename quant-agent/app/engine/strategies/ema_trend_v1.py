"""ema_trend_v1 — deterministic trend-following strategy.

Trigger (plan section 3): an EMA20/EMA50 crossover on the latest bar, gated
by two filters:
  * EMA200 trend filter — a bullish cross only counts while price trades
    above EMA200 (and symmetrically for a bearish cross below EMA200).
  * ADX14 > 20 strength gate — crosses inside a weak/choppy market are
    ignored.

Plan type: "immediate" when price already sits close to EMA20 (within
0.3x ATR14), otherwise "conditional" on price pulling back to EMA20 first.
Stop = 1.5x ATR14 beyond entry; targets are a 1R/2R/3R ladder.
"""

from __future__ import annotations

from typing import ClassVar

from app.engine.features import ADX_TREND_THRESHOLD, Features, Regime
from app.engine.strategies.base import Direction, Signal, Strategy

PULLBACK_ATR_MULTIPLE = 0.3
STOP_ATR_MULTIPLE = 1.5
TARGET_R_MULTIPLES = (1.0, 2.0, 3.0)


class EmaTrendV1(Strategy):
    strategy_id: ClassVar[str] = "ema_trend_v1"
    version: ClassVar[str] = "1.0.0"
    display_name: ClassVar[str] = "EMA Trend Crossover"
    description: ClassVar[str] = (
        "EMA20/EMA50 crossover, gated by an EMA200 trend filter and an "
        "ADX14>20 strength gate. Immediate near EMA20, otherwise a "
        "conditional pullback plan."
    )
    regime_affinity: ClassVar[Regime] = "trend"

    def evaluate(self, features: Features) -> Signal | None:
        i = features.last
        if i < 1:
            return None
        ema20, ema50, ema200 = features.ema20, features.ema50, features.ema200
        adx14, atr14 = features.adx14, features.atr14
        if (
            ema20[i] is None
            or ema50[i] is None
            or ema20[i - 1] is None
            or ema50[i - 1] is None
            or ema200[i] is None
            or adx14[i] is None
            or atr14[i] is None
        ):
            return None

        adx_value = adx14[i]
        assert adx_value is not None
        if adx_value <= ADX_TREND_THRESHOLD:
            return None

        prev20, prev50 = ema20[i - 1], ema50[i - 1]
        cur20, cur50 = ema20[i], ema50[i]
        assert prev20 is not None and prev50 is not None
        assert cur20 is not None and cur50 is not None
        bullish_cross = prev20 <= prev50 and cur20 > cur50
        bearish_cross = prev20 >= prev50 and cur20 < cur50
        close = features.closes[i]
        ema200_value = ema200[i]
        assert ema200_value is not None

        direction: Direction | None = None
        if bullish_cross and close > ema200_value:
            direction = "buy"
        elif bearish_cross and close < ema200_value:
            direction = "sell"
        if direction is None:
            return None

        atr_value = atr14[i]
        assert atr_value is not None
        rationale = [
            f"EMA20 crossed {'above' if direction == 'buy' else 'below'} EMA50",
            (
                f"price {'above' if direction == 'buy' else 'below'} EMA200 "
                "(trend filter confirms)"
            ),
            f"ADX14={adx_value:.1f} > {ADX_TREND_THRESHOLD:.0f} (trend gate passed)",
        ]

        near_ema20 = abs(close - cur20) <= PULLBACK_ATR_MULTIPLE * atr_value
        sign = 1.0 if direction == "buy" else -1.0
        if near_ema20:
            plan_type = "immediate"
            entry = close
            rationale.append(
                f"price within {PULLBACK_ATR_MULTIPLE}xATR14 of EMA20 (immediate entry)"
            )
        else:
            plan_type = "conditional"
            entry = cur20
            rationale.append("price extended from EMA20 (conditional on pullback to EMA20)")

        stop_loss = entry - sign * STOP_ATR_MULTIPLE * atr_value
        risk = abs(entry - stop_loss)
        targets = [entry + sign * risk * multiple for multiple in TARGET_R_MULTIPLES]
        confidence = max(0.4, min(0.9, 0.45 + (adx_value - ADX_TREND_THRESHOLD) / 80))

        return Signal(
            strategy_id=self.strategy_id,
            strategy_version=self.version,
            direction=direction,
            plan_type=plan_type,
            entry=entry,
            stop_loss=stop_loss,
            take_profit=targets[0],
            targets=targets,
            confidence=confidence,
            regime=self.regime_affinity,
            rationale=rationale,
            evidence={
                "ema20": cur20,
                "ema50": cur50,
                "ema200": ema200_value,
                "adx14": adx_value,
                "atr14": atr_value,
                "close": close,
            },
        )
