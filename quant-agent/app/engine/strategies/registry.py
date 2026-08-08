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
from app.engine.strategies.rsi_reversion_v1 import RsiReversionV1

if TYPE_CHECKING:
    from app.storage.sqlite import SqliteQuantStore

STRATEGIES: tuple[Strategy, ...] = (EmaTrendV1(), RsiReversionV1())


def registered_strategies() -> tuple[Strategy, ...]:
    return STRATEGIES


def strategy_by_id(strategy_id: str) -> Strategy | None:
    return next((s for s in STRATEGIES if s.strategy_id == strategy_id), None)


async def registered_strategies_with_generated(store: SqliteQuantStore) -> tuple[Strategy, ...]:
    """`STRATEGIES` plus every enabled, `source_generated` strategy stored
    in `quant_strategy_defs` whose `params_json` still parses as a valid
    `GeneratedStrategySpec`. A row that fails to parse (corrupted or from an
    older/incompatible schema version) is skipped, never raised — a stale
    row must never crash recommendation creation."""
    defs = await store.list_strategy_defs()
    generated: list[Strategy] = []
    for definition in defs:
        eligible = (
            definition.enabled
            and definition.source_generated
            and definition.params_json is not None
        )
        if not eligible:
            continue
        assert definition.params_json is not None
        try:
            spec = GeneratedStrategySpec.model_validate_json(definition.params_json, strict=True)
        except Exception:  # noqa: BLE001, S112 - fail-closed: a corrupted/stale row must be
            # skipped, never raised or logged as an error here (this runs on every
            # recommendation request; the row itself is inert until parseable again).
            continue
        generated.append(DeclarativeStrategy(spec))
    return STRATEGIES + tuple(generated)
