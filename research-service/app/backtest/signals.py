from __future__ import annotations

from .compiler import CompiledStrategy
from .conditions import ConditionContext, evaluate_condition
from .models import Side


def signals_at(strategy: CompiledStrategy, context: ConditionContext) -> tuple[Side, ...]:
    signals: list[Side] = []
    if strategy.long_conditions and evaluate_condition(strategy.long_conditions, context):
        signals.append(Side.LONG)
    if strategy.short_conditions and evaluate_condition(strategy.short_conditions, context):
        signals.append(Side.SHORT)
    return tuple(signals)
