from __future__ import annotations

from pathlib import Path

from app.storage.models import Recommendation, StrategyDef, utc_now_iso
from app.storage.sqlite import SqliteQuantStore


def _recommendation(**overrides: object) -> Recommendation:
    now = utc_now_iso()
    base = dict(
        id="qrec_1",
        owner_user_id=7,
        symbol="EURUSD",
        market="forex",
        interval="M15",
        direction="buy",
        plan_type="immediate",
        entry=1.1000,
        stop_loss=1.0950,
        take_profit=1.1100,
        targets=[1.1050, 1.1100, 1.1150],
        confidence=0.7,
        strategy_id="ema_trend_v1",
        strategy_version="1.0.0",
        regime="trend",
        rationale="single strategy fired: ema_trend_v1",
        evidence={"close": 1.1000},
        validity_expires_at="2026-01-01T12:00:00+00:00",
        lifecycle_state="active",
        source_bar_close_time="2026-01-01T09:00:00+00:00",
        idempotency_key="key-0001",
        created_at=now,
        updated_at=now,
    )
    base.update(overrides)
    return Recommendation.model_validate(base)


async def test_create_get_list_round_trip(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()

    recommendation = _recommendation()
    stored, created = await store.create_recommendation(recommendation)
    assert created is True
    assert stored.id == "qrec_1"

    fetched = await store.get("qrec_1")
    assert fetched is not None
    assert fetched.symbol == "EURUSD"
    assert fetched.targets == [1.1050, 1.1100, 1.1150]
    assert fetched.evidence == {"close": 1.1000}

    assert await store.get("qrec_missing") is None

    listed = await store.list_recommendations(symbol="EURUSD")
    assert [item.id for item in listed] == ["qrec_1"]
    assert await store.list_recommendations(symbol="GBPUSD") == []
    active = await store.list_recommendations(lifecycle_state="active")
    assert [item.id for item in active] == ["qrec_1"]
    assert await store.list_recommendations(lifecycle_state="expired") == []


async def test_idempotency_key_deduplicates_within_owner(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()

    first = _recommendation(id="qrec_1")
    second = _recommendation(id="qrec_2")  # same owner_user_id + idempotency_key

    stored_first, created_first = await store.create_recommendation(first)
    stored_second, created_second = await store.create_recommendation(second)

    assert created_first is True
    assert created_second is False
    assert stored_second.id == stored_first.id == "qrec_1"
    assert len(await store.list_recommendations()) == 1


async def test_idempotency_key_is_scoped_per_owner(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()

    owner_a = _recommendation(id="qrec_a", owner_user_id=1)
    owner_b = _recommendation(id="qrec_b", owner_user_id=2)

    _, created_a = await store.create_recommendation(owner_a)
    _, created_b = await store.create_recommendation(owner_b)
    assert created_a is True
    assert created_b is True
    assert len(await store.list_recommendations()) == 2


async def test_lifecycle_state_update_and_events(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()
    await store.create_recommendation(_recommendation())

    updated = await store.update_lifecycle_state(
        "qrec_1", "expired", {"reason": "validity elapsed"}
    )
    assert updated is not None
    assert updated.lifecycle_state == "expired"

    events = await store.events("qrec_1")
    assert [event.event_type for event in events] == ["created", "expired"]
    assert events[0].sequence == 1 and events[1].sequence == 2
    assert events[1].detail == {"reason": "validity elapsed"}

    assert await store.update_lifecycle_state("qrec_missing", "expired") is None


async def test_recommendation_survives_reopening_the_store(tmp_path: Path) -> None:
    path = tmp_path / "work" / "quant-agent.sqlite3"
    first = SqliteQuantStore(path)
    await first.initialize()
    await first.create_recommendation(_recommendation())

    reopened = SqliteQuantStore(path)
    await reopened.initialize()
    fetched = await reopened.get("qrec_1")
    assert fetched is not None
    assert fetched.symbol == "EURUSD"


async def test_strategy_defs_seed_and_list(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()
    now = utc_now_iso()
    await store.seed_strategy_defs(
        [
            StrategyDef(
                strategy_id="ema_trend_v1",
                version="1.0.0",
                display_name="EMA Trend Crossover",
                description="desc",
                enabled=True,
                regime_affinity="trend",
                created_at=now,
                updated_at=now,
            )
        ]
    )
    defs = await store.list_strategy_defs()
    assert [item.strategy_id for item in defs] == ["ema_trend_v1"]

    # Re-seeding (as happens on every app startup) must update, not duplicate.
    await store.seed_strategy_defs(
        [
            StrategyDef(
                strategy_id="ema_trend_v1",
                version="1.0.1",
                display_name="EMA Trend Crossover",
                description="updated desc",
                enabled=True,
                regime_affinity="trend",
                created_at=now,
                updated_at=now,
            )
        ]
    )
    defs = await store.list_strategy_defs()
    assert len(defs) == 1
    assert defs[0].version == "1.0.1"
    assert defs[0].description == "updated desc"


async def test_available_reports_true_for_a_working_database(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()
    assert await store.available() is True
