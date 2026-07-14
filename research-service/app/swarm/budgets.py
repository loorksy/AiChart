from __future__ import annotations

from app.config import Settings
from app.errors import ServiceError
from app.swarm.models import RequestedSwarmBudgets, SwarmBudgets, SwarmUsage


def resolve_budgets(settings: Settings, requested: RequestedSwarmBudgets) -> SwarmBudgets:
    maxima: dict[str, int | float] = {
        "token_budget": settings.swarm_token_budget,
        "cost_budget": settings.swarm_cost_budget,
        "tool_call_budget": settings.swarm_tool_call_budget,
        "max_workers": settings.swarm_max_workers,
        "max_tasks": settings.swarm_max_tasks,
        "max_depth": settings.swarm_max_depth,
        "run_timeout_seconds": settings.swarm_run_timeout_seconds,
        "task_timeout_seconds": settings.swarm_task_timeout_seconds,
        "artifact_count": settings.swarm_artifact_count,
        "artifact_bytes": settings.swarm_artifact_bytes,
        "progress_event_count": settings.swarm_progress_event_count,
    }
    values: dict[str, int | float] = {}
    for field, maximum in maxima.items():
        value = getattr(requested, field)
        if value is not None and value > maximum:
            raise ServiceError("SWARM_BUDGET_INVALID", f"{field} exceeds server maximum", 422)
        values[field] = maximum if value is None else value
    return SwarmBudgets.model_validate(values)


def usage_fits(run_tokens: int, run_cost: float, run_tools: int, usage: SwarmUsage) -> bool:
    return (
        usage.token_count <= run_tokens
        and usage.cost <= run_cost + 1e-12
        and usage.tool_calls <= run_tools
    )
