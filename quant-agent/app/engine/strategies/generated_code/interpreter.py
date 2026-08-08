"""`GeneratedCodeStrategy` -- wraps AI-generated, sandbox-validated Python
source as a `Strategy`. Every live `evaluate()` call re-runs the same
isolated-subprocess mechanism used at generation time
(`contract.run_evaluate_in_sandbox`) -- there is exactly one place user
code is ever actually executed, at discovery time and at live-evaluation
time alike.

Mirrors `app.engine.strategies.generated.interpreter.DeclarativeStrategy`'s
shape and its stop/target math (ATR-multiple stop, R-multiple ladder) so a
sandboxed-code strategy's `Signal` is structurally identical to a
declarative one and to the two hardcoded strategies.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.engine.features import Features, Regime
from app.engine.strategies.base import Direction, Signal, Strategy
from app.engine.strategies.generated_code.contract import (
    GeneratedCodeOutput,
    _features_view,
    run_evaluate_in_sandbox,
)

_CONFIDENCE = 0.5


def _at(series: Sequence[float | None], index: int) -> float | None:
    if index < 0 or index >= len(series):
        return None
    return series[index]


class GeneratedCodeStrategy(Strategy):
    """Wraps one sandbox-validated `source_code` string as a `Strategy`.
    Built fresh from the stored row on every registry read
    (`registry.registered_strategies_with_generated`), exactly like
    `DeclarativeStrategy` -- holds no state beyond the source itself."""

    def __init__(
        self,
        *,
        strategy_id: str,
        version: str,
        display_name: str,
        description: str,
        regime_affinity: Regime,
        source_code: str,
    ) -> None:
        # See DeclarativeStrategy for why these are per-instance despite
        # being declared ClassVar on the ABC: `Strategy.strategy_id`/etc.
        self.strategy_id = strategy_id  # type: ignore[misc]
        self.version = version  # type: ignore[misc]
        self.display_name = display_name  # type: ignore[misc]
        self.description = description  # type: ignore[misc]
        self.regime_affinity: Regime = regime_affinity  # type: ignore[misc]
        self._source_code = source_code

    def evaluate(self, features: Features) -> Signal | None:
        try:
            return self._evaluate(features)
        except Exception:  # noqa: BLE001 - the ABC's hard "never raise" contract
            return None

    def _evaluate(self, features: Features) -> Signal | None:
        index = features.last
        if index < 0:
            return None

        success, output, _error = run_evaluate_in_sandbox(
            self._source_code, _features_view(features)
        )
        if not success or output is None:
            return None

        try:
            validated = GeneratedCodeOutput.model_validate(output, strict=True)
        except Exception:  # noqa: BLE001 - a spec that fails output validation just doesn't fire
            return None

        atr_value = _at(features.atr14, index)
        close = _at(features.closes, index)
        if atr_value is None or close is None:
            return None

        direction: Direction = validated.direction
        sign = 1.0 if direction == "buy" else -1.0
        entry = close
        stop_loss = entry - sign * validated.stop_loss_atr_multiple * atr_value
        risk = abs(entry - stop_loss)
        targets = [entry + sign * risk * multiple for multiple in validated.take_profit_r_multiples]
        if not targets:
            return None

        rationale = [
            f"sandboxed-code strategy '{self.strategy_id}': evaluate() fired",
        ]
        if validated.rationale:
            rationale.append(validated.rationale)

        evidence: dict[str, Any] = {
            "close": close,
            "atr14": atr_value,
            "regime": features.regime,
        }

        return Signal(
            strategy_id=self.strategy_id,
            strategy_version=self.version,
            direction=direction,
            plan_type="immediate",
            entry=entry,
            stop_loss=stop_loss,
            take_profit=targets[0],
            targets=targets,
            confidence=_CONFIDENCE,
            regime=self.regime_affinity,
            rationale=rationale,
            evidence=evidence,
        )
