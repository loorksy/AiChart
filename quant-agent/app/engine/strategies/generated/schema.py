"""`GeneratedStrategySpec` — a closed, strictly-validated declarative
strategy specification.

Structurally similar in spirit to `research-service/app/strategies/schema.py`
(discriminated-union condition leaves, `all`/`any`/`not` combinators, a
depth/leaf-count-limited tree, `extra="forbid"`, `strict=True`) but this is a
**new, independent module** sized to quant-agent's own, much smaller
`Features` shape (`app/engine/features.py`) — not a shared import. Each
service stays independently deployable (plan section 5).

No `eval`/`exec` anywhere in this file or its interpreter: a spec is pure
data, and every leaf is one of a fixed, enumerated set of condition types.
Any parse failure (unknown `type` discriminator, out-of-range value, wrong
primitive type under `strict=True`, tree too deep/wide, ...) is a pydantic
`ValidationError` — fail-closed, never silently accepted.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.engine.features import Regime

# Mirrors research-service's `_tree_shape` limits, sized down for
# quant-agent's simpler six-leaf-type universe (plan section 5).
MAX_TREE_DEPTH = 8
MAX_TREE_LEAVES = 32

_STRATEGY_ID_PATTERN = r"^[a-z][a-z0-9_]{2,63}$"
_VERSION_PATTERN = r"^[A-Za-z0-9._-]{1,32}$"

ComparisonOperator = Literal["above", "below", "crosses_above", "crosses_below"]
TwoSidedOperator = Literal["above", "below"]
EmaPeriod = Literal[20, 50, 200]


class _StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
        allow_inf_nan=False,
        str_strip_whitespace=True,
        # `ConditionTree.not_condition`'s alias is "not" (a reserved word,
        # so the field itself is named differently). `populate_by_name=True`
        # means validation accepts either the alias (what the public JSON
        # contract uses) or the field name (what `model_dump_json()`
        # produces by default, e.g. when the persisted `params_json` is
        # round-tripped by `registry.registered_strategies_with_generated`)
        # — the alias-vs-field-name choice never has to be threaded through
        # every call site.
        populate_by_name=True,
    )


# ---------------------------------------------------------------------------
# Condition leaves — one per feature the interpreter knows how to read off
# `Features` (app/engine/features.py).
# ---------------------------------------------------------------------------


class EmaRelationCondition(_StrictModel):
    type: Literal["ema_relation"]
    fast_period: EmaPeriod
    slow_period: EmaPeriod
    operator: ComparisonOperator

    @model_validator(mode="after")
    def _ordered_periods(self) -> EmaRelationCondition:
        if self.fast_period >= self.slow_period:
            raise ValueError("fast_period must be smaller than slow_period")
        return self


class RsiThresholdCondition(_StrictModel):
    type: Literal["rsi_threshold"]
    operator: TwoSidedOperator
    value: float = Field(ge=0, le=100)


class MacdCondition(_StrictModel):
    type: Literal["macd"]
    series: Literal["line", "signal", "histogram"]
    reference: Literal["signal", "zero", "value"]
    operator: ComparisonOperator
    value: float | None = None

    @model_validator(mode="after")
    def _consistent_reference(self) -> MacdCondition:
        if self.reference == "value" and self.value is None:
            raise ValueError("macd reference 'value' requires an explicit value")
        if self.reference != "value" and self.value is not None:
            raise ValueError("macd value is only allowed with reference 'value'")
        if self.series == "signal" and self.reference == "signal":
            raise ValueError("comparing the signal line to itself is not a condition")
        return self


class BollingerTouchCondition(_StrictModel):
    type: Literal["bollinger_touch"]
    band: Literal["upper", "middle", "lower"]
    operator: ComparisonOperator


class AdxThresholdCondition(_StrictModel):
    type: Literal["adx_threshold"]
    operator: TwoSidedOperator
    value: float = Field(ge=0, le=100)


class RegimeCondition(_StrictModel):
    type: Literal["regime"]
    regime: Regime


ConditionLeaf = Annotated[
    EmaRelationCondition
    | RsiThresholdCondition
    | MacdCondition
    | BollingerTouchCondition
    | AdxThresholdCondition
    | RegimeCondition,
    Field(discriminator="type"),
]


class ConditionTree(_StrictModel):
    # `list`, not `tuple`: the API endpoint validates a plain
    # `dict[str, Any]` decoded from a JSON body (`GenerateValidateRequest`)
    # with `model_validate(..., strict=True)` — under strict *Python-object*
    # validation (as opposed to `model_validate_json`) a `tuple`-typed field
    # rejects a `list` outright, and JSON never round-trips as a tuple
    # anyway. `list` is the natural strict-mode match for JSON arrays.
    all: list[ConditionLeaf | ConditionTree] | None = Field(
        default=None, min_length=1, max_length=MAX_TREE_LEAVES
    )
    any: list[ConditionLeaf | ConditionTree] | None = Field(
        default=None, min_length=1, max_length=MAX_TREE_LEAVES
    )
    not_condition: ConditionLeaf | ConditionTree | None = Field(default=None, alias="not")

    @model_validator(mode="after")
    def _exactly_one_operator(self) -> ConditionTree:
        if sum(value is not None for value in (self.all, self.any, self.not_condition)) != 1:
            raise ValueError("condition tree requires exactly one of all, any, or not")
        return self


ConditionTree.model_rebuild()


def _tree_shape(tree: ConditionTree) -> tuple[int, int]:
    """(max depth, total leaf count) — mirrors research-service's own
    `_tree_shape` helper (schema.py), independently implemented here."""
    children: Sequence[ConditionLeaf | ConditionTree]
    if tree.all is not None:
        children = tree.all
    elif tree.any is not None:
        children = tree.any
    elif tree.not_condition is not None:
        children = (tree.not_condition,)
    else:
        children = ()
    depth = 1
    leaves = 0
    for child in children:
        if isinstance(child, ConditionTree):
            child_depth, child_leaves = _tree_shape(child)
            depth = max(depth, child_depth + 1)
            leaves += child_leaves
        else:
            leaves += 1
    return depth, leaves


class GeneratedStrategySpec(_StrictModel):
    """The whole declarative contract for a generated strategy (plan section
    5). `web/` obtains this from an LLM and posts it to
    `POST /internal/quant-agent/strategies/generate-validate`, which does
    nothing but validate-and-persist — no network call, no LLM call, no code
    execution happens in this service."""

    strategy_id: str = Field(pattern=_STRATEGY_ID_PATTERN)
    version: str = Field(pattern=_VERSION_PATTERN)
    display_name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2_000)
    regime_affinity: Regime
    direction: Literal["buy", "sell"]
    entry_conditions: ConditionTree
    # v1 target mechanism only: a fixed ATR-multiple stop plus an R-multiple
    # ladder, same math as ema_trend_v1.py. Band-referenced targets (like
    # rsi_reversion_v1's) are explicitly deferred.
    stop_loss_atr_multiple: float = Field(ge=0.1, le=10)
    take_profit_r_multiples: list[float] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def _validate_targets(self) -> GeneratedStrategySpec:
        multiples = self.take_profit_r_multiples
        if any(value <= 0 for value in multiples):
            raise ValueError("take_profit_r_multiples must all be positive")
        if list(multiples) != sorted(multiples) or len(set(multiples)) != len(multiples):
            raise ValueError("take_profit_r_multiples must be strictly ascending")
        return self

    @model_validator(mode="after")
    def _validate_tree_shape(self) -> GeneratedStrategySpec:
        depth, leaves = _tree_shape(self.entry_conditions)
        if depth > MAX_TREE_DEPTH:
            raise ValueError(f"entry_conditions exceeds max depth {MAX_TREE_DEPTH}")
        if leaves > MAX_TREE_LEAVES:
            raise ValueError(f"entry_conditions exceeds max leaf count {MAX_TREE_LEAVES}")
        return self
