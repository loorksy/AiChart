from __future__ import annotations

import math
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_SEED = (1 << 63) - 1
MAX_OBSERVATIONS = 1_000_000
MAX_SIMULATIONS = 10_000
MAX_SENSITIVITY_COMBINATIONS = 1_000


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class MonteCarloMethod(StrEnum):
    TRADE_ORDER_PERMUTATION = "trade_order_permutation"
    TRADE_RETURN_BOOTSTRAP = "trade_return_bootstrap"
    EXECUTION_COST_STRESS = "execution_cost_stress"


class BootstrapMethod(StrEnum):
    IID = "iid"
    MOVING_BLOCK = "moving_block"


class BootstrapMetric(StrEnum):
    MEAN_TRADE_RETURN = "mean_trade_return"
    EXPECTANCY = "expectancy"
    WIN_RATE = "win_rate"
    PROFIT_FACTOR = "profit_factor"
    SHARPE = "sharpe"
    MAXIMUM_DRAWDOWN = "maximum_drawdown"


class ReadinessStatus(StrEnum):
    REJECTED = "rejected"
    EXPERIMENTAL = "experimental"
    NEEDS_MORE_DATA = "needs_more_data"
    PAPER_READY = "paper_ready"
    DEMO_READY = "demo_ready"
    LIVE_CANDIDATE = "live_candidate"


class QuantileInterval(StrictModel):
    confidence: float = Field(ge=0.5, lt=1.0, allow_inf_nan=False)
    lower: float = Field(allow_inf_nan=False)
    upper: float = Field(allow_inf_nan=False)


class DistributionSummary(StrictModel):
    count: int = Field(ge=1)
    mean: float = Field(allow_inf_nan=False)
    median: float = Field(allow_inf_nan=False)
    standard_deviation: float = Field(ge=0.0, allow_inf_nan=False)
    minimum: float = Field(allow_inf_nan=False)
    maximum: float = Field(allow_inf_nan=False)
    interval: QuantileInterval


class MonteCarloConfig(StrictModel):
    method: MonteCarloMethod
    simulations: int = Field(default=1_000, ge=100, le=MAX_SIMULATIONS)
    seed: int = Field(default=42, ge=0, le=MAX_SEED)
    minimum_observations: int = Field(default=20, ge=3, le=10_000)
    confidence: float = Field(default=0.95, ge=0.5, lt=1.0, allow_inf_nan=False)
    cost_stress_min_multiplier: float = Field(default=1.0, ge=0.0, le=10.0, allow_inf_nan=False)
    cost_stress_max_multiplier: float = Field(default=3.0, gt=0.0, le=10.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_cost_range(self) -> MonteCarloConfig:
        if self.cost_stress_max_multiplier < self.cost_stress_min_multiplier:
            raise ValueError("cost stress maximum multiplier must be >= minimum multiplier")
        return self


class MonteCarloResult(StrictModel):
    method: MonteCarloMethod
    null_hypothesis: str = Field(min_length=1, max_length=500)
    seed: int = Field(ge=0, le=MAX_SEED)
    simulations: int = Field(ge=1, le=MAX_SIMULATIONS)
    observations: int = Field(ge=1, le=MAX_OBSERVATIONS)
    observed_terminal_return: float = Field(allow_inf_nan=False)
    observed_maximum_drawdown: float = Field(ge=0.0, allow_inf_nan=False)
    terminal_return_distribution: DistributionSummary
    maximum_drawdown_distribution: DistributionSummary
    probability_of_loss: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    p_value: float | None = Field(default=None, ge=0.0, le=1.0, allow_inf_nan=False)
    assumptions: list[str] = Field(default_factory=list, max_length=20)


class BootstrapConfig(StrictModel):
    simulations: int = Field(default=1_000, ge=100, le=MAX_SIMULATIONS)
    seed: int = Field(default=42, ge=0, le=MAX_SEED)
    confidence: float = Field(default=0.95, ge=0.5, lt=1.0, allow_inf_nan=False)
    minimum_observations: int = Field(default=20, ge=5, le=10_000)
    method: BootstrapMethod = BootstrapMethod.IID
    block_size: int | None = Field(default=None, ge=2, le=10_000)
    periods_per_year: int | None = Field(default=None, ge=1, le=1_000_000)
    metrics: list[BootstrapMetric] = Field(
        default_factory=lambda: list(BootstrapMetric), min_length=1, max_length=6
    )

    @field_validator("metrics")
    @classmethod
    def unique_metrics(cls, value: list[BootstrapMetric]) -> list[BootstrapMetric]:
        if len(value) != len(set(value)):
            raise ValueError("bootstrap metrics must be unique")
        return value

    @model_validator(mode="after")
    def validate_block_configuration(self) -> BootstrapConfig:
        if self.method is BootstrapMethod.MOVING_BLOCK and self.block_size is None:
            raise ValueError("moving_block bootstrap requires block_size")
        if self.method is BootstrapMethod.IID and self.block_size is not None:
            raise ValueError("block_size is only valid for moving_block bootstrap")
        return self


class MetricConfidenceInterval(StrictModel):
    metric: BootstrapMetric
    observed: float | None = Field(default=None, allow_inf_nan=False)
    lower: float | None = Field(default=None, allow_inf_nan=False)
    upper: float | None = Field(default=None, allow_inf_nan=False)
    valid_simulations: int = Field(ge=0, le=MAX_SIMULATIONS)
    reason: str | None = Field(default=None, max_length=300)


class BootstrapResult(StrictModel):
    method: BootstrapMethod
    seed: int = Field(ge=0, le=MAX_SEED)
    simulations: int = Field(ge=1, le=MAX_SIMULATIONS)
    observations: int = Field(ge=1, le=MAX_OBSERVATIONS)
    confidence: float = Field(ge=0.5, lt=1.0, allow_inf_nan=False)
    block_size: int | None = Field(default=None, ge=2, le=10_000)
    null_hypothesis: str = Field(min_length=1, max_length=500)
    intervals: list[MetricConfidenceInterval] = Field(min_length=1, max_length=6)
    assumptions: list[str] = Field(default_factory=list, max_length=20)


class WalkForwardConfig(StrictModel):
    training_observations: int = Field(ge=2, le=100_000)
    validation_observations: int = Field(ge=2, le=100_000)
    out_of_sample_observations: int = Field(ge=2, le=100_000)
    minimum_windows: int = Field(default=1, ge=1, le=100)
    maximum_windows: int = Field(default=20, ge=1, le=100)
    periods_per_year: int | None = Field(default=None, ge=1, le=1_000_000)

    @model_validator(mode="after")
    def validate_window_bounds(self) -> WalkForwardConfig:
        if self.maximum_windows < self.minimum_windows:
            raise ValueError("maximum_windows must be >= minimum_windows")
        return self


class WindowSegmentSummary(StrictModel):
    start_index: int = Field(ge=0)
    end_index: int = Field(gt=0)
    observations: int = Field(ge=2)
    total_return: float = Field(allow_inf_nan=False)
    mean_period_return: float = Field(allow_inf_nan=False)
    sharpe: float | None = Field(default=None, allow_inf_nan=False)
    maximum_drawdown: float = Field(ge=0.0, allow_inf_nan=False)
    # Optional trade-level metrics for the segment (exit bar in [start, end)).
    trade_count: int | None = Field(default=None, ge=0)
    win_rate: float | None = Field(default=None, ge=0.0, le=1.0, allow_inf_nan=False)
    expectancy: float | None = Field(default=None, allow_inf_nan=False)


class WalkForwardWindow(StrictModel):
    window_number: int = Field(ge=1, le=100)
    training: WindowSegmentSummary
    validation: WindowSegmentSummary
    out_of_sample: WindowSegmentSummary


class WalkForwardResult(StrictModel):
    windows: list[WalkForwardWindow] = Field(min_length=1, max_length=100)
    observations_used: int = Field(ge=6, le=MAX_OBSERVATIONS)
    unused_observations: int = Field(ge=0, le=MAX_OBSERVATIONS)
    non_overlapping: bool
    fixed_strategy_only: bool
    out_of_sample_profitable_fraction: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    out_of_sample_mean_return: float = Field(allow_inf_nan=False)
    training_mean_return: float = Field(default=0.0, allow_inf_nan=False)
    training_profitable_fraction: float = Field(default=0.0, ge=0.0, le=1.0, allow_inf_nan=False)
    likely_overfit: bool = False
    assumptions: list[str] = Field(default_factory=list, max_length=20)


class SensitivityParameter(StrictModel):
    name: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$",
    )
    base_value: float = Field(allow_inf_nan=False)
    lower_bound: float = Field(allow_inf_nan=False)
    upper_bound: float = Field(allow_inf_nan=False)
    step_count: int = Field(default=3, ge=2, le=7)

    @model_validator(mode="after")
    def validate_numeric_range(self) -> SensitivityParameter:
        if not self.lower_bound < self.base_value < self.upper_bound:
            raise ValueError("lower_bound < base_value < upper_bound is required")
        return self


class SensitivityConfig(StrictModel):
    parameters: list[SensitivityParameter] = Field(min_length=1, max_length=6)
    maximum_combinations: int = Field(default=243, ge=2, le=MAX_SENSITIVITY_COMBINATIONS)
    maximum_relative_degradation: float = Field(default=0.25, ge=0.0, le=1.0, allow_inf_nan=False)
    minimum_positive_fraction: float = Field(default=0.6, ge=0.0, le=1.0, allow_inf_nan=False)

    @field_validator("parameters")
    @classmethod
    def unique_parameter_names(
        cls, value: list[SensitivityParameter]
    ) -> list[SensitivityParameter]:
        names = [parameter.name for parameter in value]
        if len(names) != len(set(names)):
            raise ValueError("sensitivity parameter names must be unique")
        return value


class SensitivityCombination(StrictModel):
    combination_number: int = Field(ge=1, le=MAX_SENSITIVITY_COMBINATIONS)
    parameters: dict[str, float] = Field(min_length=1, max_length=6)
    is_baseline: bool = False

    @field_validator("parameters")
    @classmethod
    def finite_parameters(cls, value: dict[str, float]) -> dict[str, float]:
        if any(not math.isfinite(parameter) for parameter in value.values()):
            raise ValueError("sensitivity parameters must be finite")
        return value


class SensitivityOutcome(SensitivityCombination):
    score: float = Field(allow_inf_nan=False)


class SensitivityResult(StrictModel):
    combinations: list[SensitivityOutcome] = Field(
        min_length=2, max_length=MAX_SENSITIVITY_COMBINATIONS
    )
    baseline_score: float = Field(allow_inf_nan=False)
    minimum_score: float = Field(allow_inf_nan=False)
    median_score: float = Field(allow_inf_nan=False)
    maximum_score: float = Field(allow_inf_nan=False)
    positive_fraction: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    worst_relative_degradation: float | None = Field(default=None, ge=0.0, allow_inf_nan=False)
    stable: bool
    warnings: list[str] = Field(default_factory=list, max_length=20)


class ReadinessEvidence(StrictModel):
    strategy_valid: bool
    data_quality_valid: bool
    trade_count: int = Field(ge=0, le=MAX_OBSERVATIONS)
    out_of_sample_windows: int = Field(default=0, ge=0, le=100)
    maximum_drawdown: float | None = Field(default=None, ge=0.0, le=1.0, allow_inf_nan=False)
    profit_factor: float | None = Field(default=None, ge=0.0, allow_inf_nan=False)
    expectancy: float | None = Field(default=None, allow_inf_nan=False)
    cost_stress_profitable_probability: float | None = Field(
        default=None, ge=0.0, le=1.0, allow_inf_nan=False
    )
    walk_forward_profitable_fraction: float | None = Field(
        default=None, ge=0.0, le=1.0, allow_inf_nan=False
    )
    walk_forward_likely_overfit: bool | None = None
    bootstrap_expectancy_lower_bound: float | None = Field(default=None, allow_inf_nan=False)
    monte_carlo_probability_of_loss: float | None = Field(
        default=None, ge=0.0, le=1.0, allow_inf_nan=False
    )
    intrabar_ambiguity_rate: float | None = Field(default=None, ge=0.0, le=1.0, allow_inf_nan=False)
    sensitivity_stable: bool | None = None


class ReadinessPolicy(StrictModel):
    minimum_experimental_trades: int = Field(default=20, ge=1, le=100_000)
    minimum_paper_trades: int = Field(default=50, ge=1, le=100_000)
    minimum_demo_trades: int = Field(default=100, ge=1, le=100_000)
    minimum_live_candidate_trades: int = Field(default=200, ge=1, le=100_000)
    minimum_demo_oos_windows: int = Field(default=2, ge=1, le=100)
    minimum_live_candidate_oos_windows: int = Field(default=3, ge=1, le=100)
    maximum_paper_drawdown: float = Field(default=0.35, ge=0.0, le=1.0)
    maximum_demo_drawdown: float = Field(default=0.25, ge=0.0, le=1.0)
    maximum_live_candidate_drawdown: float = Field(default=0.20, ge=0.0, le=1.0)
    minimum_paper_profit_factor: float = Field(default=1.0, ge=0.0)
    minimum_demo_profit_factor: float = Field(default=1.15, ge=0.0)
    minimum_live_candidate_profit_factor: float = Field(default=1.25, ge=0.0)
    minimum_cost_stress_probability: float = Field(default=0.70, ge=0.0, le=1.0)
    minimum_walk_forward_profitable_fraction: float = Field(default=0.60, ge=0.0, le=1.0)
    maximum_monte_carlo_loss_probability: float = Field(default=0.20, ge=0.0, le=1.0)
    maximum_intrabar_ambiguity_rate: float = Field(default=0.05, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_monotonic_thresholds(self) -> ReadinessPolicy:
        trade_thresholds = (
            self.minimum_experimental_trades,
            self.minimum_paper_trades,
            self.minimum_demo_trades,
            self.minimum_live_candidate_trades,
        )
        if tuple(sorted(trade_thresholds)) != trade_thresholds:
            raise ValueError("readiness trade thresholds must be non-decreasing")
        if self.minimum_live_candidate_oos_windows < self.minimum_demo_oos_windows:
            raise ValueError("live-candidate OOS windows must be >= demo OOS windows")
        drawdown_thresholds = (
            self.maximum_paper_drawdown,
            self.maximum_demo_drawdown,
            self.maximum_live_candidate_drawdown,
        )
        if tuple(sorted(drawdown_thresholds, reverse=True)) != drawdown_thresholds:
            raise ValueError("drawdown thresholds must tighten at higher readiness levels")
        profit_thresholds = (
            self.minimum_paper_profit_factor,
            self.minimum_demo_profit_factor,
            self.minimum_live_candidate_profit_factor,
        )
        if tuple(sorted(profit_thresholds)) != profit_thresholds:
            raise ValueError("profit-factor thresholds must rise at higher readiness levels")
        return self


class ReadinessResult(StrictModel):
    readiness_status: ReadinessStatus
    readiness_reasons: list[str] = Field(min_length=1, max_length=30)
    failed_gates: list[str] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=30)
    live_trading_authorized: bool = False


class ValidationSuiteRequest(StrictModel):
    trade_returns: list[float] = Field(default_factory=list, max_length=MAX_OBSERVATIONS)
    gross_trade_returns: list[float] | None = Field(default=None, max_length=MAX_OBSERVATIONS)
    trade_cost_returns: list[float] | None = Field(default=None, max_length=MAX_OBSERVATIONS)
    equity_values: list[float] = Field(default_factory=list, max_length=MAX_OBSERVATIONS)
    # Exit bar indexes aligned with trade_returns for walk-forward trade metrics.
    trade_exit_indices: list[int] | None = Field(default=None, max_length=MAX_OBSERVATIONS)
    monte_carlo: list[MonteCarloConfig] = Field(default_factory=list, max_length=3)
    bootstrap: BootstrapConfig | None = None
    walk_forward: WalkForwardConfig | None = None
    readiness_evidence: ReadinessEvidence | None = None
    readiness_policy: ReadinessPolicy = Field(default_factory=ReadinessPolicy)

    @field_validator("trade_returns", "gross_trade_returns", "trade_cost_returns")
    @classmethod
    def finite_return_values(cls, value: list[float] | None) -> list[float] | None:
        if value is None:
            return value
        if any(not math.isfinite(item) for item in value):
            raise ValueError("return values must be finite")
        return value

    @field_validator("equity_values")
    @classmethod
    def valid_equity_values(cls, value: list[float]) -> list[float]:
        if any(not math.isfinite(item) or item <= 0.0 for item in value):
            raise ValueError("equity values must be finite and positive")
        return value

    @field_validator("monte_carlo")
    @classmethod
    def unique_monte_carlo_methods(cls, value: list[MonteCarloConfig]) -> list[MonteCarloConfig]:
        methods = [configuration.method for configuration in value]
        if len(methods) != len(set(methods)):
            raise ValueError("monte_carlo methods must be unique")
        return value


class ValidationSuiteResult(StrictModel):
    monte_carlo: list[MonteCarloResult] = Field(default_factory=list, max_length=3)
    bootstrap: BootstrapResult | None = None
    walk_forward: WalkForwardResult | None = None
    readiness: ReadinessResult | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, max_length=20)
