from __future__ import annotations

from dataclasses import dataclass

from app.errors import ServiceError

RESEARCH_TOOLS = frozenset(
    {
        "market_snapshot",
        "multi_timeframe_snapshot",
        "active_recommendation_read",
        "trade_lessons_read",
        "trading_dna_read",
        "shadow_recommendation_read",
        "run_forex_backtest",
        "run_backtest_validation",
        "get_research_artifacts",
        "recommendation_analytics_read",
    }
)
FORBIDDEN_CAPABILITIES = frozenset(
    {
        "trade.execute",
        "trade.manage",
        "chart.write",
        "shell",
        "bash",
        "subprocess",
        "arbitrary_http",
        "arbitrary_file",
        "database.query",
        "mt5",
        "broker",
    }
)


@dataclass(frozen=True, slots=True)
class RolePolicy:
    name: str
    purpose: str
    allowed_skills: tuple[str, ...]
    allowed_tools: tuple[str, ...]
    output_schema: str
    timeout_seconds: int
    token_budget: int
    tool_call_budget: int
    required_by_default: bool


ROLE_POLICIES: dict[str, RolePolicy] = {
    "market_researcher": RolePolicy(
        "market_researcher",
        "Review bounded market evidence.",
        ("trading-lexicon", "gold-analysis"),
        ("market_snapshot", "multi_timeframe_snapshot"),
        "grounded-task-output-v1",
        120,
        5_000,
        8,
        True,
    ),
    "strategy_analyst": RolePolicy(
        "strategy_analyst",
        "Assess reviewed strategy evidence.",
        ("trading-strategies",),
        ("active_recommendation_read", "trade_lessons_read"),
        "grounded-task-output-v1",
        180,
        7_000,
        10,
        True,
    ),
    "backtest_analyst": RolePolicy(
        "backtest_analyst",
        "Review deterministic backtest outputs.",
        ("trading-strategies",),
        ("run_forex_backtest", "get_research_artifacts"),
        "grounded-task-output-v1",
        300,
        8_000,
        8,
        False,
    ),
    "validation_analyst": RolePolicy(
        "validation_analyst",
        "Review deterministic validation outputs.",
        ("risk-management",),
        ("run_backtest_validation", "get_research_artifacts"),
        "grounded-task-output-v1",
        300,
        8_000,
        8,
        False,
    ),
    "risk_reviewer": RolePolicy(
        "risk_reviewer",
        "Identify evidence-linked research risks.",
        ("risk-management",),
        ("active_recommendation_read", "trade_lessons_read"),
        "grounded-task-output-v1",
        120,
        5_000,
        6,
        True,
    ),
    "performance_attribution_analyst": RolePolicy(
        "performance_attribution_analyst",
        "Attribute supported performance evidence.",
        ("trading-strategies",),
        ("recommendation_analytics_read", "get_research_artifacts"),
        "grounded-task-output-v1",
        180,
        7_000,
        8,
        True,
    ),
    "trading_dna_analyst": RolePolicy(
        "trading_dna_analyst",
        "Review Trading DNA snapshots without execution authority.",
        ("trading-strategies", "risk-management"),
        ("trading_dna_read", "trade_lessons_read"),
        "grounded-task-output-v1",
        120,
        5_000,
        6,
        False,
    ),
    "shadow_trader_analyst": RolePolicy(
        "shadow_trader_analyst",
        "Review research-only shadow recommendations.",
        ("recommendation-management", "risk-management"),
        ("shadow_recommendation_read", "active_recommendation_read"),
        "grounded-task-output-v1",
        120,
        5_000,
        6,
        False,
    ),
    "synthesis_agent": RolePolicy(
        "synthesis_agent",
        "Organize grounded outputs without recalculation or execution approval.",
        ("trading-lexicon", "risk-management"),
        (),
        "research-swarm-synthesis-v1",
        120,
        6_000,
        0,
        True,
    ),
}


def validate_role_policy(policy: RolePolicy) -> None:
    unknown = set(policy.allowed_tools) - RESEARCH_TOOLS
    forbidden = set(policy.allowed_tools) & FORBIDDEN_CAPABILITIES
    joined = " ".join((*policy.allowed_tools, *policy.allowed_skills)).lower()
    if unknown or forbidden or any(capability in joined for capability in FORBIDDEN_CAPABILITIES):
        raise ServiceError("SWARM_POLICY_INVALID", "role contains a forbidden capability", 500)
    if policy.timeout_seconds <= 0 or policy.token_budget <= 0 or policy.tool_call_budget < 0:
        raise ServiceError("SWARM_POLICY_INVALID", "role budget is invalid", 500)


def validate_all_roles() -> None:
    for policy in ROLE_POLICIES.values():
        validate_role_policy(policy)
