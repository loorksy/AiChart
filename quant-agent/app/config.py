from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Settings(BaseModel):
    host: str = "127.0.0.1"
    port: int = Field(default=8091, ge=1, le=65535)
    internal_token: str
    environment: Literal["development", "test", "production"] = "development"
    work_dir: Path = Path(".quant-agent/work")
    max_request_bytes: int = Field(default=2 * 1024 * 1024, ge=1024, le=16 * 1024 * 1024)
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    # This service never makes an outbound HTTP call: market bars only ever
    # arrive by being POSTed in. "isolated" is accepted for parity with
    # research-service's Settings shape but is not treated any differently.
    network_mode: Literal["disabled", "isolated"] = "disabled"
    # Unlike research-service, this service ships exactly one storage
    # backend: recommendations must be retrievable by id after creation, so
    # an ephemeral in-memory store was never an option. The field is kept
    # (accepting only "sqlite") for env-var parity with research-service's
    # shape and so a future backend has an obvious place to plug in.
    storage: Literal["sqlite"] = "sqlite"
    db_path: Path | None = None
    # Bars required before indicators (EMA200 in particular) are considered
    # reliable enough to evaluate strategies against.
    min_bars: int = Field(default=210, ge=30, le=5000)
    max_bars: int = Field(default=2000, ge=30, le=20_000)
    # A recommendation's validity window is this many bars of the source
    # interval, measured from the bar that produced the signal.
    validity_bars: int = Field(default=6, ge=1, le=200)
    # Backtest-only bounds (app/api/backtests.py, app/engine/backtest/) --
    # deliberately separate from `max_bars` above, which governs the live
    # recommendation endpoint's tighter default. A backtest replays much
    # further back (5000 bars is the plan's own default window) than a
    # single live decision ever needs to see.
    backtest_max_bars: int = Field(default=5000, ge=200, le=20_000)
    # Should match `run_evaluate_batch_in_sandbox`'s own defaults
    # (`BACKTEST_BATCH_TIMEOUT_SECONDS`/`BACKTEST_PER_BAR_TIMEOUT_SECONDS` in
    # app/engine/strategies/generated_code/contract.py) -- exposed here as a
    # configurable setting the API route passes through, not a second
    # independently-invented set of numbers.
    backtest_batch_timeout_seconds: int = Field(default=90, ge=10, le=300)
    backtest_per_bar_timeout_seconds: int = Field(default=1, ge=1, le=5)

    @model_validator(mode="after")
    def validate_security(self) -> Settings:
        if self.environment == "production" and len(self.internal_token) < 32:
            raise ValueError("production internal token must contain at least 32 characters")
        if len(self.internal_token) < 16:
            raise ValueError("internal token must contain at least 16 characters")
        self.work_dir = self._safe_root(self.work_dir)
        default_db = self.work_dir / "quant-agent.sqlite3"
        self.db_path = (self.db_path or default_db).expanduser().resolve()
        if self.db_path == Path(self.db_path.anchor):
            raise ValueError("database cannot be a filesystem root")
        if self.work_dir not in self.db_path.parents:
            raise ValueError("database must remain inside the work directory")
        if self.min_bars > self.max_bars:
            raise ValueError("min_bars cannot exceed max_bars")
        return self

    @property
    def durable_storage(self) -> bool:
        return self.storage == "sqlite"

    @staticmethod
    def _safe_root(value: Path) -> Path:
        resolved = value.expanduser().resolve()
        if resolved == Path(resolved.anchor):
            raise ValueError("work directory cannot be a filesystem root")
        return resolved


_ENV_MAP: dict[str, tuple[str, Callable[[str], object]]] = {
    "QUANT_AGENT_HOST": ("host", str),
    "QUANT_AGENT_PORT": ("port", int),
    "QUANT_AGENT_INTERNAL_TOKEN": ("internal_token", str),
    "QUANT_AGENT_ENV": ("environment", str),
    "QUANT_AGENT_WORK_DIR": ("work_dir", Path),
    "QUANT_AGENT_MAX_REQUEST_BYTES": ("max_request_bytes", int),
    "QUANT_AGENT_LOG_LEVEL": ("log_level", str),
    "QUANT_AGENT_NETWORK_MODE": ("network_mode", str),
    "QUANT_AGENT_STORAGE": ("storage", str),
    "QUANT_AGENT_DB_PATH": ("db_path", Path),
    "QUANT_AGENT_MIN_BARS": ("min_bars", int),
    "QUANT_AGENT_MAX_BARS": ("max_bars", int),
    "QUANT_AGENT_VALIDITY_BARS": ("validity_bars", int),
    "QUANT_AGENT_BACKTEST_MAX_BARS": ("backtest_max_bars", int),
    "QUANT_AGENT_BACKTEST_BATCH_TIMEOUT_SECONDS": ("backtest_batch_timeout_seconds", int),
    "QUANT_AGENT_BACKTEST_PER_BAR_TIMEOUT_SECONDS": ("backtest_per_bar_timeout_seconds", int),
}


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if environ is None else environ
    values: dict[str, object] = {}
    for env_name, (field_name, converter) in _ENV_MAP.items():
        raw = source.get(env_name)
        if raw is not None and raw != "":
            values[field_name] = converter(raw)
    environment = str(values.get("environment", "development"))
    if "internal_token" not in values:
        if environment == "production":
            raise ValueError("QUANT_AGENT_INTERNAL_TOKEN is required in production")
        values["internal_token"] = "dev-only-quant-agent-token-change-me"  # noqa: S105
    return Settings.model_validate(values)
