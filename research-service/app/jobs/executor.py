from __future__ import annotations

import asyncio

from app.jobs.tasks import execute_task
from app.models.jobs import JobRecord
from app.storage.artifacts import ArtifactStore
from app.storage.base import JobStore


async def execute_with_timeout(
    job: JobRecord,
    store: JobStore,
    artifacts: ArtifactStore,
    cancelled: asyncio.Event,
) -> str:
    async with asyncio.timeout(job.timeout_seconds):
        return await execute_task(job, store, artifacts, cancelled)
