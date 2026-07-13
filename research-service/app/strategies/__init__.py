"""Strict, declarative and non-executable strategy specification boundary."""

from .canonical import canonical_strategy_dict, canonical_strategy_json
from .compiler import CompiledStrategy, IndicatorRequirement, compile_strategy
from .errors import (
    StrategyCompileError,
    StrategyError,
    StrategyStoreConflictError,
    StrategyValidationError,
)
from .hashing import strategy_spec_hash
from .models import (
    SYMBOL_REGISTRY,
    BacktestRunReference,
    Direction,
    Market,
    StrategyDefinition,
    StrategyValidationResult,
    StrategyVersion,
    StrategyVersionStatus,
    SymbolMetadata,
    Timeframe,
)
from .schema import SPEC_VERSION, StrategySpecification
from .store import InMemoryStrategyStore, StrategyStore
from .validation import parse_strategy_specification, validate_strategy_specification

__all__ = [
    "SPEC_VERSION",
    "SYMBOL_REGISTRY",
    "BacktestRunReference",
    "CompiledStrategy",
    "Direction",
    "InMemoryStrategyStore",
    "IndicatorRequirement",
    "Market",
    "StrategyCompileError",
    "StrategyDefinition",
    "StrategyError",
    "StrategySpecification",
    "StrategyStore",
    "StrategyStoreConflictError",
    "StrategyValidationError",
    "StrategyValidationResult",
    "StrategyVersion",
    "StrategyVersionStatus",
    "SymbolMetadata",
    "Timeframe",
    "canonical_strategy_dict",
    "canonical_strategy_json",
    "compile_strategy",
    "parse_strategy_specification",
    "strategy_spec_hash",
    "validate_strategy_specification",
]
