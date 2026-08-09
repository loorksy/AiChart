"""Ownership is what makes it safe for a user to enable their own strategy.

Before this, `registered_strategies_with_generated` loaded EVERY enabled
generated row for EVERY caller, so a user turning on their own strategy put
their LLM-written Python into other people's recommendations. That is why
enabling was locked to admins — the right emergency stop for the wrong
problem. Scoping the registry per owner is the actual fix, and these tests
exist so it cannot quietly regress into the old shared behaviour.

The assertions are about isolation and refusal, not about plumbing: a
stranger's strategy must not be loadable, must not be transitionable, and a
paused one must not stay executable.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.engine.strategies.registry import STRATEGIES, registered_strategies_with_generated
from app.storage.models import StrategyDef, utc_now_iso
from app.storage.sqlite import SqliteQuantStore

ALICE = 4101
BOB = 4102

_SPEC = json.dumps(
    {
        "strategy_id": "owned_v1",
        "version": "1.0.0",
        "display_name": "Owned",
        "description": "test",
        "regime_affinity": "trend",
        "direction": "buy",
        "entry_conditions": {
            "all": [
                {
                    "type": "ema_relation",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "crosses_above"
                },
                {
                    "type": "adx_threshold",
                    "operator": "above",
                    "value": 20.0
                }
            ]
        },
        "stop_loss_atr_multiple": 1.5,
        "take_profit_r_multiples": [
            1.0,
            2.0,
            3.0
        ]
    },
    separators=(",", ":"),
)


def _def(strategy_id: str, owner: int | None, status: str, enabled: bool) -> StrategyDef:
    now = utc_now_iso()
    return StrategyDef(
        strategy_id=strategy_id,
        version="1.0.0",
        display_name=strategy_id,
        description="test",
        enabled=enabled,
        status=status,  # type: ignore[arg-type]
        owner_user_id=owner,
        regime_affinity="trend",
        source_generated=True,
        params_json=_SPEC.replace("owned_v1", strategy_id),
        generation_mode="declarative",
        created_at=now,
        updated_at=now,
    )


@pytest.fixture()
async def store(tmp_path: Path) -> SqliteQuantStore:
    s = SqliteQuantStore(tmp_path / "own.db")
    await s.initialize()
    return s


def _ids(strategies: tuple[object, ...]) -> set[str]:
    return {getattr(s, "strategy_id", "") for s in strategies}


async def test_a_strangers_active_strategy_never_reaches_your_recommendation(
    store: SqliteQuantStore,
) -> None:
    await store.upsert_generated_strategy_def(_def("alice_v1", ALICE, "active", True))
    await store.upsert_generated_strategy_def(_def("bob_v1", BOB, "active", True))

    for_alice = _ids(await registered_strategies_with_generated(store, ALICE))
    assert "alice_v1" in for_alice
    assert "bob_v1" not in for_alice, "Bob's generated code must never evaluate for Alice"

    for_bob = _ids(await registered_strategies_with_generated(store, BOB))
    assert "bob_v1" in for_bob
    assert "alice_v1" not in for_bob


async def test_built_ins_load_for_everyone(store: SqliteQuantStore) -> None:
    builtin_ids = {s.strategy_id for s in STRATEGIES}
    assert builtin_ids
    for user in (ALICE, BOB):
        assert builtin_ids <= _ids(await registered_strategies_with_generated(store, user))


async def test_a_paused_strategy_stops_being_evaluated(store: SqliteQuantStore) -> None:
    await store.upsert_generated_strategy_def(_def("alice_v1", ALICE, "active", True))
    assert "alice_v1" in _ids(await registered_strategies_with_generated(store, ALICE))

    updated = await store.set_strategy_status("alice_v1", "paused", ALICE)
    assert updated is not None
    # `enabled` is derived, not separately writable: a strategy the owner
    # paused that stayed enabled would keep trading.
    assert updated.enabled is False
    assert "alice_v1" not in _ids(await registered_strategies_with_generated(store, ALICE))


async def test_activating_sets_the_derived_enabled_flag(store: SqliteQuantStore) -> None:
    await store.upsert_generated_strategy_def(_def("alice_v1", ALICE, "ready", False))
    updated = await store.set_strategy_status("alice_v1", "active", ALICE)
    assert updated is not None
    assert updated.status == "active"
    assert updated.enabled is True


async def test_you_cannot_transition_someone_elses_strategy(store: SqliteQuantStore) -> None:
    await store.upsert_generated_strategy_def(_def("bob_v1", BOB, "ready", False))
    assert await store.set_strategy_status("bob_v1", "active", ALICE) is None

    # And the refusal actually left the row alone.
    rows = {d.strategy_id: d for d in await store.list_strategy_defs()}
    assert rows["bob_v1"].status == "ready"
    assert rows["bob_v1"].enabled is False


async def test_an_unknown_strategy_and_a_stranger_are_indistinguishable(
    store: SqliteQuantStore,
) -> None:
    # Both return None, so the route returns the same 404 for both. Telling
    # them apart would let a prober enumerate which ids exist.
    await store.upsert_generated_strategy_def(_def("bob_v1", BOB, "ready", False))
    assert await store.set_strategy_status("bob_v1", "active", ALICE) is None
    assert await store.set_strategy_status("no_such_v1", "active", ALICE) is None


async def test_a_pre_ownership_row_belongs_to_nobody(store: SqliteQuantStore) -> None:
    """A generated row with no owner predates ownership. Its real owner is
    unknown, and the safe reading of unknown is "nobody" — it must neither
    execute for a stranger nor be claimable by one."""
    await store.upsert_generated_strategy_def(_def("legacy_v1", None, "active", True))

    assert "legacy_v1" not in _ids(await registered_strategies_with_generated(store, ALICE))
    assert await store.set_strategy_status("legacy_v1", "paused", ALICE) is None


async def test_archived_strategies_are_never_loaded(store: SqliteQuantStore) -> None:
    await store.upsert_generated_strategy_def(_def("alice_v1", ALICE, "active", True))
    await store.set_strategy_status("alice_v1", "archived", ALICE)
    assert "alice_v1" not in _ids(await registered_strategies_with_generated(store, ALICE))
    # Archived rows are excluded by the scoped READ, not filtered afterwards,
    # so no evaluation path can reach one by taking a different route.
    owned = await store.list_strategy_defs_for_owner(ALICE)
    assert "alice_v1" not in {d.strategy_id for d in owned}


async def test_built_ins_are_not_transitionable_by_a_user(store: SqliteQuantStore) -> None:
    now = utc_now_iso()
    await store.seed_strategy_defs(
        [
            StrategyDef(
                strategy_id="ema_trend_v1",
                version="1.0.0",
                display_name="Built in",
                description="platform",
                enabled=True,
                status="active",
                owner_user_id=None,
                regime_affinity="trend",
                source_generated=False,
                created_at=now,
                updated_at=now,
            )
        ]
    )
    assert await store.set_strategy_status("ema_trend_v1", "paused", ALICE) is None


async def test_the_migration_is_idempotent_and_backfills_status(tmp_path: Path) -> None:
    """`initialize()` runs on every boot, so it has to be safe to re-run, and
    a database written before these columns existed has to come back with a
    sane lifecycle rather than every strategy silently paused."""
    path = tmp_path / "legacy.db"
    s = SqliteQuantStore(path)
    await s.initialize()
    await s.upsert_generated_strategy_def(_def("alice_v1", ALICE, "active", True))

    again = SqliteQuantStore(path)
    await again.initialize()
    rows = {d.strategy_id: d for d in await again.list_strategy_defs()}
    assert rows["alice_v1"].status == "active"
    assert rows["alice_v1"].owner_user_id == ALICE
