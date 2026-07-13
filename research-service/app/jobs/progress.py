from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.storage.base import JobStore


class ProgressReporter:
    def __init__(self, store: JobStore, job_id: str) -> None:
        self.store = store
        self.job_id = job_id

    async def emit(
        self,
        percent: int,
        stage: str,
        message: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        await self.store.append_progress(self.job_id, percent, stage, message, metadata)
