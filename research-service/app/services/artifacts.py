from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from dataclasses import asdict, dataclass, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.errors import ServiceError
from app.models.jobs import ArtifactReference, JobRecord
from app.storage.artifacts import ArtifactStore
from app.storage.base import JobStore


@dataclass(frozen=True, slots=True)
class ResolvedInputArtifact:
    reference: ArtifactReference
    path: Path


class JobArtifactService:
    """Tenant-safe artifact reads and bounded research artifact serialization."""

    def __init__(self, artifacts: ArtifactStore, jobs: JobStore) -> None:
        self.artifacts = artifacts
        self.jobs = jobs

    async def resolve_input(
        self,
        *,
        user_id: int,
        source_job_id: str,
        artifact_id: str,
        expected_suffix: str,
        max_bytes: int,
    ) -> ResolvedInputArtifact:
        reference = await self.jobs.get_artifact_for_user(artifact_id, source_job_id, user_id)
        if reference is None:
            reference = await self.artifacts.get_for_user(artifact_id, source_job_id, user_id)
        if reference is None:
            raise ServiceError("JOB_NOT_FOUND", "research input artifact not found", 404)
        if Path(reference.name).suffix.lower() != expected_suffix.lower():
            raise ServiceError("JOB_INPUT_INVALID", "input artifact format mismatch", 422)
        candidate = (self.artifacts.root / reference.relative_path).resolve()
        root = self.artifacts.root
        if root not in candidate.parents or candidate == root:
            raise ServiceError("ARTIFACT_INVALID_PATH", "input artifact escaped root", 400)
        if not candidate.is_file() or candidate.is_symlink():
            raise ServiceError("JOB_NOT_FOUND", "research input artifact not found", 404)
        if any(parent.is_symlink() for parent in candidate.parents if parent != root.parent):
            raise ServiceError("ARTIFACT_INVALID_PATH", "symlink input artifact rejected", 400)
        stat = candidate.stat()
        if stat.st_size > max_bytes or stat.st_size != reference.size_bytes:
            raise ServiceError("ARTIFACT_TOO_LARGE", "input artifact size is invalid", 413)
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        if digest != reference.sha256:
            raise ServiceError("JOB_INPUT_INVALID", "input artifact integrity check failed", 422)
        return ResolvedInputArtifact(reference=reference, path=candidate)

    async def read_json_object(
        self,
        *,
        user_id: int,
        source_job_id: str,
        artifact_id: str,
        max_bytes: int,
    ) -> dict[str, Any]:
        resolved = await self.resolve_input(
            user_id=user_id,
            source_job_id=source_job_id,
            artifact_id=artifact_id,
            expected_suffix=".json",
            max_bytes=max_bytes,
        )
        try:
            value = json.loads(resolved.path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ServiceError("JOB_INPUT_INVALID", "JSON artifact is invalid", 422) from exc
        if not isinstance(value, dict):
            raise ServiceError("JOB_INPUT_INVALID", "JSON artifact must contain an object", 422)
        return value

    async def read_csv_rows(
        self,
        *,
        user_id: int,
        source_job_id: str,
        artifact_id: str,
        required_fields: frozenset[str],
        max_bytes: int,
        max_rows: int,
    ) -> list[dict[str, str]]:
        resolved = await self.resolve_input(
            user_id=user_id,
            source_job_id=source_job_id,
            artifact_id=artifact_id,
            expected_suffix=".csv",
            max_bytes=max_bytes,
        )
        try:
            with resolved.path.open(
                "r", encoding="utf-8-sig", errors="strict", newline=""
            ) as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames or required_fields - set(reader.fieldnames):
                    raise ServiceError(
                        "JOB_INPUT_INVALID", "CSV artifact is missing required fields", 422
                    )
                if len(reader.fieldnames) != len(set(reader.fieldnames)):
                    raise ServiceError(
                        "JOB_INPUT_INVALID", "CSV artifact has duplicate fields", 422
                    )
                rows: list[dict[str, str]] = []
                for row in reader:
                    if len(rows) >= max_rows:
                        raise ServiceError(
                            "JOB_INPUT_INVALID", "CSV artifact row limit exceeded", 422
                        )
                    if None in row or any(value is None for value in row.values()):
                        raise ServiceError("JOB_INPUT_INVALID", "CSV artifact is malformed", 422)
                    rows.append({key: str(value) for key, value in row.items()})
                return rows
        except UnicodeDecodeError as exc:
            raise ServiceError("JOB_INPUT_INVALID", "CSV artifact must use UTF-8", 422) from exc

    async def write_json(self, job: JobRecord, name: str, value: Any) -> ArtifactReference:
        content = json.dumps(
            value,
            default=_json_default,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return await self._write(job, "json", name, content)

    async def write_csv(
        self,
        job: JobRecord,
        name: str,
        fieldnames: tuple[str, ...],
        rows: list[dict[str, Any]],
    ) -> ArtifactReference:
        output = io.StringIO(newline="")
        writer = csv.DictWriter(
            output,
            fieldnames=list(fieldnames),
            extrasaction="raise",
            lineterminator="\n",
        )
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _csv_value(row.get(key)) for key in fieldnames})
        return await self._write(job, "csv", name, output.getvalue().encode("utf-8"))

    async def _write(
        self,
        job: JobRecord,
        artifact_type: str,
        name: str,
        content: bytes,
    ) -> ArtifactReference:
        reference = await self.artifacts.write(
            job.user_id, job.job_id, artifact_type, name, content
        )
        await self.jobs.attach_artifact(job.job_id, reference)
        return reference


def _json_default(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    raise TypeError(f"unsupported artifact value type: {type(value).__name__}")


def _csv_value(value: Any) -> str | int | float | bool:
    if value is None:
        return ""
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("CSV artifacts cannot contain non-finite numbers")
        return value
    if isinstance(value, int | bool | str):
        return value
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return str(value.value)
    return json.dumps(
        value,
        default=_json_default,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
