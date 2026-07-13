from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Settings(BaseModel):
    host: str = "127.0.0.1"
    port: int = Field(default=8090, ge=1, le=65535)
    internal_token: str
    environment: Literal["development", "test", "production"] = "development"
    work_dir: Path = Path(".research/work")
    artifact_dir: Path = Path(".research/artifacts")
    max_concurrent_jobs: int = Field(default=1, ge=1, le=16)
    max_queued_jobs: int = Field(default=32, ge=1, le=1000)
    default_timeout_seconds: int = Field(default=30, ge=1, le=3600)
    max_timeout_seconds: int = Field(default=300, ge=1, le=3600)
    max_retries: int = Field(default=2, ge=0, le=5)
    max_request_bytes: int = Field(default=8 * 1024 * 1024, ge=1024, le=16 * 1024 * 1024)
    max_artifact_bytes: int = Field(default=8 * 1024 * 1024, ge=1024, le=64 * 1024 * 1024)
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    network_mode: Literal["disabled", "isolated"] = "disabled"
    durable_storage: bool = False

    @model_validator(mode="after")
    def validate_security(self) -> Settings:
        if self.environment == "production" and len(self.internal_token) < 32:
            raise ValueError("production internal token must contain at least 32 characters")
        if len(self.internal_token) < 16:
            raise ValueError("internal token must contain at least 16 characters")
        if self.default_timeout_seconds > self.max_timeout_seconds:
            raise ValueError("default timeout cannot exceed maximum timeout")
        self.work_dir = self._safe_root(self.work_dir, "work")
        self.artifact_dir = self._safe_root(self.artifact_dir, "artifact")
        if self.work_dir == self.artifact_dir:
            raise ValueError("work and artifact directories must be different")
        return self

    @staticmethod
    def _safe_root(value: Path, label: str) -> Path:
        resolved = value.expanduser().resolve()
        if resolved == Path(resolved.anchor):
            raise ValueError(f"{label} directory cannot be a filesystem root")
        return resolved


_ENV_MAP: dict[str, tuple[str, Callable[[str], object]]] = {
    "RESEARCH_SERVICE_HOST": ("host", str),
    "RESEARCH_SERVICE_PORT": ("port", int),
    "RESEARCH_SERVICE_INTERNAL_TOKEN": ("internal_token", str),
    "RESEARCH_SERVICE_ENV": ("environment", str),
    "RESEARCH_SERVICE_WORK_DIR": ("work_dir", Path),
    "RESEARCH_SERVICE_ARTIFACT_DIR": ("artifact_dir", Path),
    "RESEARCH_SERVICE_MAX_CONCURRENT_JOBS": ("max_concurrent_jobs", int),
    "RESEARCH_SERVICE_MAX_QUEUED_JOBS": ("max_queued_jobs", int),
    "RESEARCH_SERVICE_DEFAULT_TIMEOUT_SECONDS": ("default_timeout_seconds", int),
    "RESEARCH_SERVICE_MAX_TIMEOUT_SECONDS": ("max_timeout_seconds", int),
    "RESEARCH_SERVICE_MAX_RETRIES": ("max_retries", int),
    "RESEARCH_SERVICE_MAX_REQUEST_BYTES": ("max_request_bytes", int),
    "RESEARCH_SERVICE_MAX_ARTIFACT_BYTES": ("max_artifact_bytes", int),
    "RESEARCH_SERVICE_LOG_LEVEL": ("log_level", str),
    "RESEARCH_SERVICE_NETWORK_MODE": ("network_mode", str),
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
            raise ValueError("RESEARCH_SERVICE_INTERNAL_TOKEN is required in production")
        values["internal_token"] = "dev-only-research-token-change-me"  # noqa: S105
    return Settings.model_validate(values)
