from __future__ import annotations

import asyncio
import hashlib
import os
import re
import tempfile
from pathlib import Path

from app.core.ids import opaque_id
from app.errors import ServiceError
from app.models.jobs import ArtifactReference, utc_now

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
_CONTENT_TYPES = {"text": "text/plain", "json": "application/json", "csv": "text/csv"}


class ArtifactStore:
    def __init__(
        self,
        root: Path,
        max_bytes: int,
        *,
        max_artifacts_per_job: int = 32,
        max_total_bytes_per_job: int | None = None,
    ) -> None:
        self.root = root.resolve()
        self.max_bytes = max_bytes
        self.max_artifacts_per_job = max_artifacts_per_job
        self.max_total_bytes_per_job = max_total_bytes_per_job or max_bytes * 32
        self._artifacts: dict[str, ArtifactReference] = {}
        self._job_artifact_names: dict[tuple[int, str], set[str]] = {}
        self._job_total_bytes: dict[tuple[int, str], int] = {}
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        probe = self.root / ".write-probe"
        probe.write_bytes(b"ok")
        probe.unlink()

    def _safe_name(self, name: str) -> str:
        candidate = Path(name)
        if candidate.is_absolute() or ".." in candidate.parts or len(candidate.parts) != 1:
            raise ServiceError("ARTIFACT_INVALID_PATH", "invalid artifact name", 400)
        cleaned = _SAFE_NAME.sub("-", name).strip(".-")
        if not cleaned:
            raise ServiceError("ARTIFACT_INVALID_PATH", "invalid artifact name", 400)
        return cleaned[:100]

    def _scoped_dir(self, user_id: int, job_id: str) -> Path:
        directory = (self.root / f"u-{user_id}" / job_id).resolve()
        if self.root not in directory.parents:
            raise ServiceError("ARTIFACT_INVALID_PATH", "artifact path escaped root", 400)
        directory.mkdir(parents=True, exist_ok=True)
        scoped_parts = [directory, *directory.parents]
        if any(part.is_symlink() for part in scoped_parts if part != self.root.parent):
            raise ServiceError("ARTIFACT_INVALID_PATH", "symlink artifact path rejected", 400)
        return directory

    async def write(
        self, user_id: int, job_id: str, artifact_type: str, name: str, content: bytes
    ) -> ArtifactReference:
        if artifact_type not in _CONTENT_TYPES:
            raise ServiceError("ARTIFACT_INVALID_PATH", "unsupported artifact type", 400)
        if len(content) > self.max_bytes:
            raise ServiceError("ARTIFACT_TOO_LARGE", "artifact exceeds size limit", 413)
        safe_name = self._safe_name(name)
        directory = self._scoped_dir(user_id, job_id)
        target = (directory / safe_name).resolve()
        if directory not in target.parents:
            raise ServiceError("ARTIFACT_INVALID_PATH", "artifact path escaped job root", 400)
        key = (user_id, job_id)
        async with self._lock:
            names = self._job_artifact_names.setdefault(key, set())
            if safe_name in names or target.exists():
                raise ServiceError("ARTIFACT_CONFLICT", "artifact name already exists", 409)
            if len(names) >= self.max_artifacts_per_job:
                raise ServiceError("ARTIFACT_LIMIT", "artifact count limit exceeded", 413)
            total = self._job_total_bytes.get(key, 0)
            if total + len(content) > self.max_total_bytes_per_job:
                raise ServiceError("ARTIFACT_LIMIT", "artifact total size limit exceeded", 413)
            fd, temporary = tempfile.mkstemp(prefix=".tmp-", dir=directory)
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            reference = ArtifactReference(
                artifact_id=opaque_id("ra"),
                job_id=job_id,
                user_id=user_id,
                artifact_type=artifact_type,
                name=safe_name,
                relative_path=target.relative_to(self.root).as_posix(),
                content_type=_CONTENT_TYPES[artifact_type],
                size_bytes=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
                created_at=utc_now(),
            )
            names.add(safe_name)
            self._job_total_bytes[key] = total + len(content)
            self._artifacts[reference.artifact_id] = reference
            return reference

    async def get_for_user(
        self, artifact_id: str, job_id: str, user_id: int
    ) -> ArtifactReference | None:
        async with self._lock:
            item = self._artifacts.get(artifact_id)
            if not item or item.user_id != user_id or item.job_id != job_id:
                return None
            return item.model_copy(deep=True)

    async def usage_for_job(self, user_id: int, job_id: str) -> tuple[int, int]:
        key = (user_id, job_id)
        async with self._lock:
            return (
                len(self._job_artifact_names.get(key, set())),
                self._job_total_bytes.get(key, 0),
            )

    async def available(self) -> bool:
        return self.root.is_dir() and os.access(self.root, os.W_OK)
