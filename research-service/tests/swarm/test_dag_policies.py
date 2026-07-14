from __future__ import annotations

import pytest

from app.errors import ServiceError
from app.swarm.dag import deterministic_order, validate_dag
from app.swarm.models import SwarmTask, SwarmTaskStatus
from app.swarm.policies import FORBIDDEN_CAPABILITIES, ROLE_POLICIES, validate_all_roles
from app.swarm.presets import PRESETS, build_tasks, validate_all_presets


def _task(task_id: str, dependencies: list[str] | None = None) -> SwarmTask:
    return SwarmTask(
        task_id=task_id,
        swarm_run_id="swr_test",
        agent_role="market_researcher",
        title=task_id,
        objective="bounded test",
        dependencies=dependencies or [],
        status=SwarmTaskStatus.PENDING,
        timeout_seconds=10,
    )


def test_valid_graph_has_deterministic_order() -> None:
    tasks = [_task("z"), _task("a"), _task("final", ["z", "a"])]
    assert validate_dag(tasks, max_tasks=5, max_depth=3) == [["a", "z"], ["final"]]
    assert deterministic_order(tasks) == ["a", "z", "final"]


@pytest.mark.parametrize(
    "tasks,message",
    [
        ([_task("a", ["b"]), _task("b", ["a"])], "cycle"),
        ([_task("a", ["missing"])], "missing"),
        ([_task("a"), _task("a")], "duplicate"),
    ],
)
def test_invalid_graphs_are_rejected(tasks: list[SwarmTask], message: str) -> None:
    with pytest.raises(ServiceError, match=message):
        validate_dag(tasks, max_tasks=5, max_depth=3)


def test_depth_and_task_limits_are_enforced() -> None:
    chain = [_task("a"), _task("b", ["a"]), _task("c", ["b"])]
    with pytest.raises(ServiceError, match="depth"):
        validate_dag(chain, max_tasks=3, max_depth=2)
    with pytest.raises(ServiceError, match="size"):
        validate_dag(chain, max_tasks=2, max_depth=3)


def test_all_roles_and_presets_are_bounded_and_execution_free() -> None:
    validate_all_roles()
    validate_all_presets()
    assert len(ROLE_POLICIES) == 9
    assert set(PRESETS) == {
        "gold_strategy_lab",
        "forex_research_committee",
        "strategy_validation_team",
        "risk_review_committee",
        "performance_attribution_team",
        "shadow_trader_review",
        "weekly_market_research",
    }
    for preset in PRESETS.values():
        tasks = build_tasks(preset, "swr_test", max_attempts=2, task_timeout=300)
        assert tasks[-1].agent_role == "synthesis_agent"
        assert len(tasks) <= 16
        joined = " ".join(
            tool for task in tasks for tool in [*task.allowed_tools, *task.required_skills]
        ).lower()
        assert all(capability not in joined for capability in FORBIDDEN_CAPABILITIES)


def test_skill_names_are_data_and_cannot_expand_tool_policy() -> None:
    role = ROLE_POLICIES["risk_reviewer"]
    assert "risk-management" in role.allowed_skills
    assert "trade.execute" not in role.allowed_tools
    assert not set(role.allowed_skills) & set(role.allowed_tools)
