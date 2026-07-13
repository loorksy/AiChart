from __future__ import annotations

import json
import re
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.backtest.models import RunConfig
from app.data.models import DatasetLimits
from app.validation.models import (
    BootstrapMethod,
    MonteCarloMethod,
    SensitivityConfig,
)

MAX_STRATEGY_SPEC_BYTES = 48 * 1024
MAX_INLINE_DATASET_BYTES = 8 * 1024 * 1024
MAX_COLUMN_MAPPINGS = 24
_REFERENCE_PATTERN = r"^[A-Za-z0-9._:-]{3,160}$"
_URL = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")
_FORBIDDEN_KEYS = {
    "code",
    "compile",
    "expression",
    "file_path",
    "javascript",
    "mql",
    "path",
    "python",
    "script",
    "shell",
    "source_code",
    "uri",
    "url",
}


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class DatasetArtifactFormat(StrEnum):
    CSV = "csv"
    PARQUET = "parquet"
    AICHART_CANDLE_WAREHOUSE = "aichart_candle_warehouse"


class DatasetArtifactReference(StrictPayload):
    source: Literal["artifact"]
    artifact_id: str = Field(pattern=_REFERENCE_PATTERN)
    job_id: str = Field(pattern=_REFERENCE_PATTERN)
    format: DatasetArtifactFormat
    column_mapping: dict[str, str] | None = Field(default=None, max_length=MAX_COLUMN_MAPPINGS)

    @field_validator("column_mapping")
    @classmethod
    def valid_column_mapping(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return value
        if any(
            not key or len(key) > 64 or not source or len(source) > 128 or "\x00" in source
            for key, source in value.items()
        ):
            raise ValueError("column mapping names are invalid")
        if len(set(value.values())) != len(value):
            raise ValueError("column mapping source columns must be unique")
        return value


class WarehouseDatasetInput(StrictPayload):
    source: Literal["aichart_candle_warehouse"]
    payload: dict[str, Any]

    @field_validator("payload")
    @classmethod
    def safe_warehouse_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        _validate_non_executable_payload(value)
        return value


DatasetInput = Annotated[
    DatasetArtifactReference | WarehouseDatasetInput,
    Field(discriminator="source"),
]


class ValidateStrategySpecPayload(StrictPayload):
    strategy_spec: dict[str, Any]

    @field_validator("strategy_spec")
    @classmethod
    def bounded_strategy(cls, value: dict[str, Any]) -> dict[str, Any]:
        _validate_non_executable_payload(value)
        encoded = json.dumps(
            value, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        if len(encoded) > MAX_STRATEGY_SPEC_BYTES:
            raise ValueError("strategy specification exceeds its size limit")
        return value


class ValidateDatasetPayload(StrictPayload):
    dataset: DatasetInput
    limits: DatasetLimits = Field(default_factory=DatasetLimits)

    @model_validator(mode="after")
    def bounded_inline_dataset(self) -> ValidateDatasetPayload:
        _validate_dataset_size(self.dataset, self.limits)
        return self


class RunForexBacktestPayload(ValidateStrategySpecPayload):
    dataset: DatasetInput
    limits: DatasetLimits = Field(default_factory=DatasetLimits)
    run_config: RunConfig

    @field_validator("run_config", mode="before")
    @classmethod
    def parse_json_run_config(cls, value: object) -> RunConfig:
        if isinstance(value, RunConfig):
            return value
        try:
            encoded = json.dumps(value, allow_nan=False, ensure_ascii=False)
            return RunConfig.model_validate_json(encoded, strict=True)
        except (TypeError, ValueError) as exc:
            raise ValueError("run_config is invalid") from exc

    @model_validator(mode="after")
    def validate_backtest_inputs(self) -> RunForexBacktestPayload:
        _validate_dataset_size(self.dataset, self.limits)
        for timestamp in (self.run_config.start_time, self.run_config.end_time):
            if timestamp is not None and (
                timestamp.tzinfo is None or timestamp.utcoffset() is None
            ):
                raise ValueError("run configuration timestamps must be timezone-aware")
        return self


class BacktestRunArtifactReference(StrictPayload):
    job_id: str = Field(pattern=_REFERENCE_PATTERN)
    metrics_artifact_id: str = Field(pattern=_REFERENCE_PATTERN)
    trades_artifact_id: str = Field(pattern=_REFERENCE_PATTERN)
    equity_artifact_id: str = Field(pattern=_REFERENCE_PATTERN)
    run_config_artifact_id: str = Field(pattern=_REFERENCE_PATTERN)


class BacktestValidationConfig(StrictPayload):
    seed: int = Field(default=42, ge=0, le=(1 << 63) - 1)
    simulation_count: int = Field(default=1_000, ge=100, le=10_000)
    methods: list[MonteCarloMethod] = Field(min_length=1, max_length=3)
    bootstrap_samples: int | None = Field(default=None, ge=100, le=10_000)
    bootstrap_method: BootstrapMethod = BootstrapMethod.IID
    bootstrap_block_size: int | None = Field(default=None, ge=2, le=10_000)
    walk_forward_windows: int | None = Field(default=None, ge=1, le=100)
    cost_sensitivity_points: int | None = Field(default=None, ge=2, le=7)
    strategy_sensitivity: SensitivityConfig | None = None

    @field_validator("methods")
    @classmethod
    def unique_methods(cls, value: list[MonteCarloMethod]) -> list[MonteCarloMethod]:
        if len(value) != len(set(value)):
            raise ValueError("validation methods must be unique")
        return value

    @model_validator(mode="after")
    def validate_bootstrap_method(self) -> BacktestValidationConfig:
        if self.bootstrap_method is BootstrapMethod.MOVING_BLOCK:
            if self.bootstrap_samples is None or self.bootstrap_block_size is None:
                raise ValueError(
                    "moving-block bootstrap requires samples and an explicit block size"
                )
        elif self.bootstrap_block_size is not None:
            raise ValueError("bootstrap_block_size is only valid for moving_block")
        if self.strategy_sensitivity is not None:
            if len(self.strategy_sensitivity.parameters) > 3:
                raise ValueError("strategy sensitivity supports at most three parameters per job")
            if self.strategy_sensitivity.maximum_combinations > 25:
                raise ValueError("strategy sensitivity is limited to 25 combinations per job")
            for parameter in self.strategy_sensitivity.parameters:
                if not _is_allowed_strategy_parameter(parameter.name):
                    raise ValueError("strategy sensitivity parameter path is not allowed")
        return self


class RunBacktestValidationPayload(StrictPayload):
    backtest_run: BacktestRunArtifactReference
    validation_config: BacktestValidationConfig


PHASE3_JOB_TYPES = frozenset(
    {
        "validate_strategy_spec",
        "validate_dataset",
        "run_forex_backtest",
        "run_backtest_validation",
    }
)


def _validate_non_executable_payload(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).strip().lower()
            if normalized in _FORBIDDEN_KEYS:
                raise ValueError("executable, path, and URL fields are not allowed")
            _validate_non_executable_payload(item)
        return
    if isinstance(value, list | tuple):
        for item in value:
            _validate_non_executable_payload(item)
        return
    if isinstance(value, str) and (
        _URL.match(value.strip()) or value.strip().lower().startswith("file:")
    ):
        raise ValueError("URLs are not allowed in Phase 3 job payloads")


def _validate_dataset_size(dataset: DatasetInput, limits: DatasetLimits) -> None:
    if not isinstance(dataset, WarehouseDatasetInput):
        return
    try:
        encoded = json.dumps(
            dataset.payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("warehouse payload must be JSON-compatible") from exc
    maximum = min(limits.max_file_bytes, MAX_INLINE_DATASET_BYTES)
    if len(encoded) > maximum:
        raise ValueError("inline warehouse dataset exceeds its size limit")
    bars = dataset.payload.get("bars")
    if isinstance(bars, list | tuple) and len(bars) > limits.max_rows:
        raise ValueError("inline warehouse dataset exceeds its row limit")


def _is_allowed_strategy_parameter(path: str) -> bool:
    if path in {
        "entry.offset_value",
        "stop_loss.value",
        "position_sizing.lots",
        "position_sizing.notional",
        "position_sizing.risk_percent",
        "management.trailing_stop.value",
        "management.trailing_stop.activation_r",
        "management.move_to_break_even.trigger_value",
        "risk_controls.minimum_reward_risk",
    }:
        return True
    return re.fullmatch(r"targets\.[0-9]\.value", path) is not None
