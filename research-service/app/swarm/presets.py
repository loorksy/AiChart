from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.errors import ServiceError
from app.swarm.dag import validate_dag
from app.swarm.models import SwarmTask, SwarmTaskStatus
from app.swarm.policies import RESEARCH_TOOLS, ROLE_POLICIES, validate_role_policy


@dataclass(frozen=True, slots=True)
class PresetTask:
    task_id: str
    role: str
    title: str
    objective: str
    dependencies: tuple[str, ...] = ()
    required: bool = True
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class SwarmPreset:
    name: str
    objective_template: str
    tasks: tuple[PresetTask, ...]
    fail_fast: bool
    expected_artifacts: tuple[str, ...]
    allowed_parameters: tuple[str, ...] = (
        "symbol",
        "timeframe",
        "task_delay_ms",
        "fail_optional_roles",
        "retry_once_roles",
    )


def _task(
    task_id: str,
    role: str,
    dependencies: tuple[str, ...] = (),
    *,
    required: bool = True,
    retryable: bool = False,
) -> PresetTask:
    return PresetTask(
        task_id,
        role,
        task_id.replace("_", " ").title(),
        ROLE_POLICIES[role].purpose,
        dependencies,
        required,
        retryable,
    )


PRESETS: dict[str, SwarmPreset] = {
    "gold_strategy_lab": SwarmPreset(
        "gold_strategy_lab",
        "Research a bounded gold strategy objective: {objective}",
        (
            _task("market_context", "market_researcher"),
            _task("strategy_review", "strategy_analyst", ("market_context",)),
            _task(
                "backtest_review",
                "backtest_analyst",
                ("strategy_review",),
                required=False,
                retryable=True,
            ),
            _task(
                "validation_review",
                "validation_analyst",
                ("backtest_review",),
                required=False,
                retryable=True,
            ),
            _task("risk_review", "risk_reviewer", ("strategy_review",)),
            _task("synthesis", "synthesis_agent", ("strategy_review", "risk_review")),
        ),
        False,
        (
            "swarm_plan.json",
            "task_graph.json",
            "final_synthesis.json",
            "evidence_index.json",
            "limitations.json",
        ),
    ),
    "forex_research_committee": SwarmPreset(
        "forex_research_committee",
        "Research a bounded forex objective: {objective}",
        (
            _task("market_context", "market_researcher"),
            _task("strategy_review", "strategy_analyst", ("market_context",)),
            _task("risk_review", "risk_reviewer", ("market_context",)),
            _task("synthesis", "synthesis_agent", ("strategy_review", "risk_review")),
        ),
        True,
        ("swarm_plan.json", "task_graph.json", "final_synthesis.json"),
    ),
    "strategy_validation_team": SwarmPreset(
        "strategy_validation_team",
        "Validate a reviewed strategy: {objective}",
        (
            _task("strategy_review", "strategy_analyst"),
            _task("backtest_review", "backtest_analyst", ("strategy_review",), retryable=True),
            _task("validation_review", "validation_analyst", ("backtest_review",), retryable=True),
            _task("risk_review", "risk_reviewer", ("validation_review",)),
            _task("synthesis", "synthesis_agent", ("validation_review", "risk_review")),
        ),
        True,
        ("task_graph.json", "task_results.json", "final_synthesis.json"),
    ),
    "risk_review_committee": SwarmPreset(
        "risk_review_committee",
        "Review research risks: {objective}",
        (
            _task("strategy_review", "strategy_analyst"),
            _task("risk_review", "risk_reviewer", ("strategy_review",)),
            _task("dna_review", "trading_dna_analyst", required=False),
            _task("synthesis", "synthesis_agent", ("risk_review",)),
        ),
        False,
        ("task_results.json", "limitations.json", "final_synthesis.json"),
    ),
    "performance_attribution_team": SwarmPreset(
        "performance_attribution_team",
        "Attribute supported performance evidence: {objective}",
        (
            _task("attribution", "performance_attribution_analyst"),
            _task("dna_review", "trading_dna_analyst", required=False),
            _task("risk_review", "risk_reviewer", ("attribution",)),
            _task("synthesis", "synthesis_agent", ("attribution", "risk_review")),
        ),
        False,
        ("task_results.json", "evidence_index.json", "final_synthesis.json"),
    ),
    "shadow_trader_review": SwarmPreset(
        "shadow_trader_review",
        "Review research-only shadow observations: {objective}",
        (
            _task("shadow_review", "shadow_trader_analyst"),
            _task("dna_review", "trading_dna_analyst", required=False),
            _task("risk_review", "risk_reviewer", ("shadow_review",)),
            _task("synthesis", "synthesis_agent", ("shadow_review", "risk_review")),
        ),
        False,
        ("task_results.json", "conflicts.json", "final_synthesis.json"),
    ),
    "weekly_market_research": SwarmPreset(
        "weekly_market_research",
        "Produce bounded weekly market research: {objective}",
        (
            _task("market_context", "market_researcher"),
            _task("strategy_review", "strategy_analyst", ("market_context",)),
            _task("risk_review", "risk_reviewer", ("market_context",)),
            _task("attribution", "performance_attribution_analyst", required=False),
            _task("synthesis", "synthesis_agent", ("strategy_review", "risk_review")),
        ),
        False,
        ("swarm_plan.json", "task_results.json", "final_synthesis.json", "progress_timeline.json"),
    ),
}


def get_preset(name: str) -> SwarmPreset:
    preset = PRESETS.get(name)
    if preset is None:
        raise ServiceError("SWARM_PRESET_INVALID", "unknown or disabled swarm preset", 422)
    return preset


def validate_parameters(preset: SwarmPreset, parameters: dict[str, Any]) -> dict[str, Any]:
    unknown = set(parameters) - set(preset.allowed_parameters)
    if unknown:
        raise ServiceError(
            "SWARM_INPUT_INVALID", "preset parameters contain unsupported fields", 422
        )
    result: dict[str, Any] = {}
    if "symbol" in parameters:
        symbol = str(parameters["symbol"])
        if not 1 <= len(symbol) <= 32 or not all(
            char.isalnum() or char in "._-/" for char in symbol
        ):
            raise ServiceError("SWARM_INPUT_INVALID", "symbol parameter is invalid", 422)
        result["symbol"] = symbol
    if "timeframe" in parameters:
        timeframe = str(parameters["timeframe"])
        if timeframe not in {"1m", "5m", "15m", "30m", "1h", "4h", "1d"}:
            raise ServiceError("SWARM_INPUT_INVALID", "timeframe parameter is invalid", 422)
        result["timeframe"] = timeframe
    if "task_delay_ms" in parameters:
        delay = parameters["task_delay_ms"]
        if not isinstance(delay, int) or not 0 <= delay <= 2_000:
            raise ServiceError("SWARM_INPUT_INVALID", "task delay is invalid", 422)
        result["task_delay_ms"] = delay
    for key in ("fail_optional_roles", "retry_once_roles"):
        if key in parameters:
            roles = parameters[key]
            if (
                not isinstance(roles, list)
                or len(roles) > 8
                or any(role not in ROLE_POLICIES for role in roles)
            ):
                raise ServiceError(
                    "SWARM_INPUT_INVALID", "role simulation parameter is invalid", 422
                )
            result[key] = sorted(set(roles))
    return result


def build_tasks(
    preset: SwarmPreset, run_id: str, *, max_attempts: int, task_timeout: int
) -> list[SwarmTask]:
    tasks: list[SwarmTask] = []
    for spec in preset.tasks:
        role = ROLE_POLICIES[spec.role]
        validate_role_policy(role)
        tasks.append(
            SwarmTask(
                task_id=spec.task_id,
                swarm_run_id=run_id,
                agent_role=spec.role,
                title=spec.title,
                objective=spec.objective,
                dependencies=list(spec.dependencies),
                status=SwarmTaskStatus.BLOCKED if spec.dependencies else SwarmTaskStatus.PENDING,
                max_attempts=max_attempts if spec.retryable else 1,
                timeout_seconds=min(task_timeout, role.timeout_seconds),
                required_skills=list(role.allowed_skills),
                allowed_tools=list(role.allowed_tools),
                required=spec.required,
                retryable=spec.retryable,
            )
        )
    return tasks


def validate_preset(preset: SwarmPreset, *, max_tasks: int = 64, max_depth: int = 16) -> None:
    if not preset.tasks or preset.tasks[-1].role != "synthesis_agent":
        raise ServiceError("SWARM_PRESET_INVALID", "preset requires a final synthesis task", 500)
    tasks = build_tasks(preset, "validation-run", max_attempts=2, task_timeout=300)
    validate_dag(tasks, max_tasks=max_tasks, max_depth=max_depth)
    for task in tasks:
        if not set(task.allowed_tools) <= RESEARCH_TOOLS:
            raise ServiceError("SWARM_POLICY_INVALID", "preset contains unknown tools", 500)


def validate_all_presets() -> None:
    for preset in PRESETS.values():
        validate_preset(preset)
