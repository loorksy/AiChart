"""`DeclarativeStrategy` — interprets a validated `GeneratedStrategySpec`
against `Features` and produces a `Signal`, exactly like the two hardcoded
`Strategy` subclasses do. Pure interpretation of already-validated data:
no `eval`/`exec`, and `evaluate()` never raises (the ABC's hard contract,
`app/engine/strategies/base.py`) — any missing feature value, out-of-range
index, or unexpected error just means the condition (or the whole strategy)
does not fire.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from app.engine.features import Features, Regime
from app.engine.strategies.base import Direction, Signal, Strategy
from app.engine.strategies.generated.schema import (
    AdxThresholdCondition,
    BollingerTouchCondition,
    ConditionLeaf,
    ConditionTree,
    EmaRelationCondition,
    GeneratedStrategySpec,
    MacdCondition,
    RegimeCondition,
    RsiThresholdCondition,
)

# A fixed, simple confidence for v1 generated strategies (plan section 5:
# "a reasonable fixed ... confidence ... keep it simple, this is v1").
_CONFIDENCE = 0.5


def _at(series: Sequence[float | None], index: int) -> float | None:
    """Safe positional lookup that never wraps around on a negative index
    (plain Python `series[-1]` would silently return the *last* element,
    which is wrong here — a negative index always means "no such bar")."""
    if index < 0 or index >= len(series):
        return None
    return series[index]


class DeclarativeStrategy(Strategy):
    """Wraps one validated `GeneratedStrategySpec` as a `Strategy`. Built
    fresh from the spec on every registry read
    (`registry.registered_strategies_with_generated`) — this class holds no
    state beyond the spec itself."""

    def __init__(self, spec: GeneratedStrategySpec) -> None:
        self._spec = spec
        # `Strategy.strategy_id`/`version`/`display_name`/`description`/
        # `regime_affinity` are declared `ClassVar` on the ABC because the
        # two hardcoded strategies are singletons with fixed identity, but a
        # `DeclarativeStrategy` is instantiated fresh per spec (per registry
        # read) and genuinely needs per-instance values here — hence the
        # `type: ignore[misc]`s, one per assignment.
        self.strategy_id = spec.strategy_id  # type: ignore[misc]
        self.version = spec.version  # type: ignore[misc]
        self.display_name = spec.display_name  # type: ignore[misc]
        self.description = spec.description  # type: ignore[misc]
        self.regime_affinity: Regime = spec.regime_affinity  # type: ignore[misc]

    def evaluate(self, features: Features) -> Signal | None:
        try:
            return self._evaluate(features)
        except Exception:  # noqa: BLE001 - the ABC's hard "never raise" contract
            return None

    # ------------------------------------------------------------------
    # internal
    # ------------------------------------------------------------------

    def _evaluate(self, features: Features) -> Signal | None:
        index = features.last
        if index < 0:
            return None

        satisfied, rationale, conditions_evidence = self._eval_tree(
            self._spec.entry_conditions, features, index
        )
        if not satisfied:
            return None

        atr_value = _at(features.atr14, index)
        close = _at(features.closes, index)
        if atr_value is None or close is None:
            return None

        direction: Direction = self._spec.direction
        sign = 1.0 if direction == "buy" else -1.0
        entry = close
        stop_loss = entry - sign * self._spec.stop_loss_atr_multiple * atr_value
        risk = abs(entry - stop_loss)
        targets = [
            entry + sign * risk * multiple for multiple in self._spec.take_profit_r_multiples
        ]
        if not targets:
            return None

        full_rationale = [
            f"declarative strategy '{self.strategy_id}': all entry conditions satisfied",
            *rationale,
        ]
        evidence: dict[str, Any] = {
            "close": close,
            "atr14": atr_value,
            "regime": features.regime,
            "conditions": conditions_evidence,
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
            rationale=full_rationale,
            evidence=evidence,
        )

    # -- condition tree walk --------------------------------------------

    def _eval_tree(
        self, node: ConditionLeaf | ConditionTree, features: Features, index: int
    ) -> tuple[bool, list[str], list[dict[str, Any]]]:
        if isinstance(node, ConditionTree):
            return self._eval_combinator(node, features, index)
        return self._eval_leaf(node, features, index)

    def _eval_combinator(
        self, node: ConditionTree, features: Features, index: int
    ) -> tuple[bool, list[str], list[dict[str, Any]]]:
        if node.all is not None:
            results = [self._eval_tree(child, features, index) for child in node.all]
            overall = all(result[0] for result in results)
            rationale = [line for result in results for line in result[1]]
            evidence = [item for result in results for item in result[2]]
            return overall, rationale, evidence

        if node.any is not None:
            results = [self._eval_tree(child, features, index) for child in node.any]
            overall = any(result[0] for result in results)
            rationale = [line for result in results for line in result[1]]
            evidence = [item for result in results for item in result[2]]
            return overall, rationale, evidence

        assert node.not_condition is not None
        child_ok, _, _ = self._eval_tree(node.not_condition, features, index)
        overall = not child_ok
        if overall:
            return True, [f"not ({_describe(node.not_condition)})"], []
        return False, [], []

    def _eval_leaf(
        self, leaf: ConditionLeaf, features: Features, index: int
    ) -> tuple[bool, list[str], list[dict[str, Any]]]:
        try:
            ok, condition_evidence = _EVALUATORS[type(leaf)](leaf, features, index)
        except Exception:  # noqa: BLE001 - a single bad leaf must not sink evaluation
            return False, [], []
        if not ok:
            return False, [], []
        description = _describe(leaf)
        return True, [description], [{"description": description, **condition_evidence}]


# ---------------------------------------------------------------------------
# leaf evaluators — pure functions of (leaf, features, index)
# ---------------------------------------------------------------------------

_EMA_SERIES_BY_PERIOD: dict[int, Callable[[Features], list[float | None]]] = {
    20: lambda features: features.ema20,
    50: lambda features: features.ema50,
    200: lambda features: features.ema200,
}


def _compare(
    operator: str,
    cur_left: float,
    cur_right: float,
    prev_left: float | None,
    prev_right: float | None,
) -> bool:
    if operator == "above":
        return cur_left > cur_right
    if operator == "below":
        return cur_left < cur_right
    if prev_left is None or prev_right is None:
        return False
    if operator == "crosses_above":
        return prev_left <= prev_right and cur_left > cur_right
    if operator == "crosses_below":
        return prev_left >= prev_right and cur_left < cur_right
    return False


def _eval_ema_relation(
    leaf: EmaRelationCondition, features: Features, index: int
) -> tuple[bool, dict[str, Any]]:
    fast_series = _EMA_SERIES_BY_PERIOD[leaf.fast_period](features)
    slow_series = _EMA_SERIES_BY_PERIOD[leaf.slow_period](features)
    cur_fast, cur_slow = _at(fast_series, index), _at(slow_series, index)
    if cur_fast is None or cur_slow is None:
        return False, {}
    prev_fast, prev_slow = _at(fast_series, index - 1), _at(slow_series, index - 1)
    ok = _compare(leaf.operator, cur_fast, cur_slow, prev_fast, prev_slow)
    return ok, {f"ema{leaf.fast_period}": cur_fast, f"ema{leaf.slow_period}": cur_slow}


def _eval_rsi_threshold(
    leaf: RsiThresholdCondition, features: Features, index: int
) -> tuple[bool, dict[str, Any]]:
    value = _at(features.rsi14, index)
    if value is None:
        return False, {}
    ok = value > leaf.value if leaf.operator == "above" else value < leaf.value
    return ok, {"rsi14": value}


def _macd_series(leaf: MacdCondition, features: Features) -> list[float | None]:
    return {
        "line": features.macd_line,
        "signal": features.macd_signal,
        "histogram": features.macd_hist,
    }[leaf.series]


def _macd_reference_at(leaf: MacdCondition, features: Features, index: int) -> float | None:
    if leaf.reference == "signal":
        return _at(features.macd_signal, index)
    if leaf.reference == "zero":
        return 0.0
    return leaf.value


def _eval_macd(leaf: MacdCondition, features: Features, index: int) -> tuple[bool, dict[str, Any]]:
    series = _macd_series(leaf, features)
    cur = _at(series, index)
    reference = _macd_reference_at(leaf, features, index)
    if cur is None or reference is None:
        return False, {}
    prev = _at(series, index - 1)
    prev_reference = (
        reference if leaf.reference == "value" else _macd_reference_at(leaf, features, index - 1)
    )
    ok = _compare(leaf.operator, cur, reference, prev, prev_reference)
    return ok, {f"macd_{leaf.series}": cur, "macd_reference": reference}


_BAND_BY_NAME: dict[str, Callable[[Features], list[float | None]]] = {
    "upper": lambda features: features.bb_upper,
    "middle": lambda features: features.bb_middle,
    "lower": lambda features: features.bb_lower,
}


def _eval_bollinger_touch(
    leaf: BollingerTouchCondition, features: Features, index: int
) -> tuple[bool, dict[str, Any]]:
    band_series = _BAND_BY_NAME[leaf.band](features)
    cur_band, cur_close = _at(band_series, index), _at(features.closes, index)
    if cur_band is None or cur_close is None:
        return False, {}
    prev_band, prev_close = _at(band_series, index - 1), _at(features.closes, index - 1)
    ok = _compare(leaf.operator, cur_close, cur_band, prev_close, prev_band)
    return ok, {"close": cur_close, f"bb_{leaf.band}": cur_band}


def _eval_adx_threshold(
    leaf: AdxThresholdCondition, features: Features, index: int
) -> tuple[bool, dict[str, Any]]:
    value = _at(features.adx14, index)
    if value is None:
        return False, {}
    ok = value > leaf.value if leaf.operator == "above" else value < leaf.value
    return ok, {"adx14": value}


def _eval_regime(
    leaf: RegimeCondition, features: Features, index: int
) -> tuple[bool, dict[str, Any]]:
    return features.regime == leaf.regime, {"regime": features.regime}


_EVALUATORS: dict[type, Any] = {
    EmaRelationCondition: _eval_ema_relation,
    RsiThresholdCondition: _eval_rsi_threshold,
    MacdCondition: _eval_macd,
    BollingerTouchCondition: _eval_bollinger_touch,
    AdxThresholdCondition: _eval_adx_threshold,
    RegimeCondition: _eval_regime,
}


def _describe(node: ConditionLeaf | ConditionTree) -> str:
    if isinstance(node, ConditionTree):
        if node.all is not None:
            return "(" + " and ".join(_describe(child) for child in node.all) + ")"
        if node.any is not None:
            return "(" + " or ".join(_describe(child) for child in node.any) + ")"
        assert node.not_condition is not None
        return f"not ({_describe(node.not_condition)})"
    return _describe_leaf(node)


def _describe_leaf(leaf: ConditionLeaf) -> str:
    if isinstance(leaf, EmaRelationCondition):
        return f"EMA{leaf.fast_period} {leaf.operator} EMA{leaf.slow_period}"
    if isinstance(leaf, RsiThresholdCondition):
        return f"RSI14 {leaf.operator} {leaf.value}"
    if isinstance(leaf, MacdCondition):
        if leaf.reference == "zero":
            reference: object = "0"
        elif leaf.reference == "value":
            reference = leaf.value
        else:
            reference = "signal"
        return f"MACD {leaf.series} {leaf.operator} {reference}"
    if isinstance(leaf, BollingerTouchCondition):
        return f"close {leaf.operator} Bollinger {leaf.band} band"
    if isinstance(leaf, AdxThresholdCondition):
        return f"ADX14 {leaf.operator} {leaf.value}"
    return f"regime == {leaf.regime}"
