"""The strategy registry. Adding a third strategy later is exactly: write a
new `Strategy` subclass, add one line here, add one row to
`quant_strategy_defs` (app/storage/sqlite.py `seed_strategy_defs`) — no
change to the API contract, schema, or combine policy (plan section 3)."""

from __future__ import annotations

from app.engine.strategies.base import Strategy
from app.engine.strategies.ema_trend_v1 import EmaTrendV1
from app.engine.strategies.rsi_reversion_v1 import RsiReversionV1

STRATEGIES: tuple[Strategy, ...] = (EmaTrendV1(), RsiReversionV1())


def registered_strategies() -> tuple[Strategy, ...]:
    return STRATEGIES


def strategy_by_id(strategy_id: str) -> Strategy | None:
    return next((s for s in STRATEGIES if s.strategy_id == strategy_id), None)
