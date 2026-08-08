"""The strategy registry. Adding a third strategy later is exactly: write a
new `Strategy` subclass, add one line here, add one row to
`quant_strategy_defs` (app/storage/sqlite.py `seed_strategy_defs`) — no
change to the API contract, schema, or combine policy (plan section 3).

`STRATEGIES`/`registered_strategies()` below stay byte-for-byte unchanged by
the declarative strategy generator (plan section 5) — every existing test
that exercises them keeps working untouched.
`registered_strategies_with_generated()` is the one new, additive entry
point: it is used only by the recommendation-creation path
(`app/api/recommendations.py`) and layers enabled, successfully-parsed
generated strategies on top of the fixed two."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.engine.strategies.base import Strategy
from app.engine.strategies.ema_trend_v1 import EmaTrendV1
from app.engine.strategies.generated.interpreter import DeclarativeStrategy
from app.engine.strategies.generated.schema import GeneratedStrategySpec
from app.engine.strategies.generated_code.contract import compile_and_discover
from app.engine.strategies.generated_code.interpreter import GeneratedCodeStrategy
from app.engine.strategies.rsi_reversion_v1 import RsiReversionV1
from app.storage.models import StrategyDef

if TYPE_CHECKING:
    from app.storage.sqlite import SqliteQuantStore

STRATEGIES: tuple[Strategy, ...] = (EmaTrendV1(), RsiReversionV1())


def registered_strategies() -> tuple[Strategy, ...]:
    return STRATEGIES


def strategy_by_id(strategy_id: str) -> Strategy | None:
    return next((s for s in STRATEGIES if s.strategy_id == strategy_id), None)


def strategy_from_def(definition: StrategyDef) -> Strategy | None:
    """Build one `Strategy` instance from a stored `StrategyDef`, using the
    same declarative/sandboxed_code branching as
    `registered_strategies_with_generated`'s loop body below (extracted out
    so a caller that wants exactly one named strategy -- the backtest
    endpoint, `app/api/backtests.py` -- doesn't duplicate this branching).

    Deliberately does NOT check `definition.enabled`: that gate stays in
    `registered_strategies_with_generated`'s loop, which only ever wants
    live-eligible strategies. A caller building one strategy by id (on
    purpose, including an `enabled: false` one for backtesting a
    not-yet-enabled candidate) must be able to bypass it.

    Returns `None` on any parse/validation failure -- fail-closed, never
    raises, same contract as the loop this was extracted from."""
    if definition.generation_mode == "sandboxed_code":
        if not definition.source_code:
            return None
        try:
            ok, _err = compile_and_discover(definition.source_code)
        except Exception:  # noqa: BLE001, S112 - fail-closed, see docstring
            return None
        if not ok:
            return None
        return GeneratedCodeStrategy(
            strategy_id=definition.strategy_id,
            version=definition.version,
            display_name=definition.display_name,
            description=definition.description,
            regime_affinity=definition.regime_affinity or "range",  # type: ignore[arg-type]
            source_code=definition.source_code,
        )

    if definition.params_json is None:
        return None
    try:
        spec = GeneratedStrategySpec.model_validate_json(definition.params_json, strict=True)
    except Exception:  # noqa: BLE001, S112 - fail-closed, see docstring
        return None
    return DeclarativeStrategy(spec)


async def registered_strategies_with_generated(store: SqliteQuantStore) -> tuple[Strategy, ...]:
    """`STRATEGIES` plus every enabled, `source_generated` strategy stored
    in `quant_strategy_defs` that still passes its generation mode's
    validation:
      - `generation_mode="declarative"`: `params_json` must still parse as
        a valid `GeneratedStrategySpec`.
      - `generation_mode="sandboxed_code"`: `source_code` must still pass
        `compile_and_discover` (re-checked at load time too, defensively —
        a schema/policy change since generation should retire a row, not
        silently keep running it).
    A row that fails its check is skipped, never raised — a stale or
    corrupted row must never crash recommendation creation."""
    defs = await store.list_strategy_defs()
    generated: list[Strategy] = []
    for definition in defs:
        if not (definition.enabled and definition.source_generated):
            continue
        strategy = strategy_from_def(definition)
        if strategy is not None:
            generated.append(strategy)
    return STRATEGIES + tuple(generated)
