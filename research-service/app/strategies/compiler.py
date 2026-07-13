from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import Field

from .canonical import canonical_strategy_dict
from .errors import StrategyCompileError, StrategyValidationError
from .hashing import strategy_spec_hash
from .models import SYMBOL_REGISTRY, Direction, FrozenStrictModel, SymbolMetadata, Timeframe
from .schema import (
    AtrMultipleStop,
    AtrMultipleTarget,
    AtrThresholdCondition,
    ConditionLeaf,
    EmaRelationCondition,
    RangeBreakoutCondition,
    RsiThresholdCondition,
    SmaRelationCondition,
    StrategySpecification,
    _condition_leaves,
)
from .validation import parse_strategy_specification

IndicatorName = Literal["ema", "sma", "rsi", "atr", "rolling_range"]


class IndicatorRequirement(FrozenStrictModel):
    indicator: IndicatorName
    timeframe: Timeframe
    period: int = Field(ge=1, le=10_000)


class CompiledStrategy(FrozenStrictModel):
    strategy_id: str
    version_id: str
    spec_version: str
    spec_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    canonical_spec: dict[str, Any]
    direction: Direction
    symbols: tuple[str, ...]
    symbol_metadata: tuple[SymbolMetadata, ...]
    timeframes: tuple[Timeframe, ...]
    condition_types: tuple[str, ...]
    indicator_requirements: tuple[IndicatorRequirement, ...]
    warmup_bars: dict[str, int]
    signal_timing: Literal["bar_close"] = "bar_close"
    order_activation_timing: Literal["next_bar"] = "next_bar"
    source_generated: Literal[False] = False


def compile_strategy(
    value: StrategySpecification | Mapping[str, Any],
) -> CompiledStrategy:
    try:
        spec = parse_strategy_specification(value)
    except StrategyValidationError as exc:
        raise StrategyCompileError(str(exc)) from exc

    leaves = tuple(leaf for tree in spec.condition_trees() for leaf in _condition_leaves(tree))
    requirements = _requirements(spec, leaves)
    warmup: dict[str, int] = {
        str(timeframe): 1 for timeframe in (spec.timeframes.entry, *spec.timeframes.higher)
    }
    for requirement in requirements:
        warmup[str(requirement.timeframe)] = max(
            warmup.get(str(requirement.timeframe), 1), requirement.period
        )
    return CompiledStrategy(
        strategy_id=spec.strategy_id,
        version_id=spec.version_id,
        spec_version=spec.spec_version,
        spec_hash=strategy_spec_hash(spec),
        canonical_spec=canonical_strategy_dict(spec),
        direction=spec.direction,
        symbols=spec.symbols,
        symbol_metadata=tuple(SYMBOL_REGISTRY[symbol] for symbol in spec.symbols),
        timeframes=(spec.timeframes.entry, *spec.timeframes.higher),
        condition_types=tuple(sorted({str(leaf.type) for leaf in leaves})),
        indicator_requirements=requirements,
        warmup_bars=warmup,
    )


def _requirements(
    spec: StrategySpecification, leaves: tuple[ConditionLeaf, ...]
) -> tuple[IndicatorRequirement, ...]:
    raw: set[tuple[IndicatorName, Timeframe, int]] = set()
    for leaf in leaves:
        if isinstance(leaf, EmaRelationCondition):
            raw.add(("ema", leaf.timeframe, leaf.fast_period))
            raw.add(("ema", leaf.timeframe, leaf.slow_period))
        elif isinstance(leaf, SmaRelationCondition):
            raw.add(("sma", leaf.timeframe, leaf.fast_period))
            raw.add(("sma", leaf.timeframe, leaf.slow_period))
        elif isinstance(leaf, RsiThresholdCondition):
            raw.add(("rsi", leaf.timeframe, leaf.period))
        elif isinstance(leaf, AtrThresholdCondition):
            raw.add(("atr", leaf.timeframe, leaf.period))
        elif isinstance(leaf, RangeBreakoutCondition):
            raw.add(("rolling_range", leaf.timeframe, leaf.lookback_bars))

    stop = spec.stop_loss
    if isinstance(stop, AtrMultipleStop):
        raw.add(("atr", stop.timeframe or spec.timeframes.entry, stop.period))
    for target in spec.targets:
        if isinstance(target, AtrMultipleTarget):
            raw.add(("atr", target.timeframe or spec.timeframes.entry, target.period))
    if spec.entry.indicator is not None:
        ref = spec.entry.indicator
        raw.add((ref.indicator, ref.timeframe, ref.period))

    return tuple(
        IndicatorRequirement(indicator=indicator, timeframe=timeframe, period=period)
        for indicator, timeframe, period in sorted(
            raw, key=lambda item: (str(item[1]), item[0], item[2])
        )
    )
