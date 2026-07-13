from __future__ import annotations

from pydantic import BaseModel

from .jobs import JobRecord, ProgressEvent


class JobCreateResponse(BaseModel):
    job: JobRecord
    created: bool


class EventsResponse(BaseModel):
    events: list[ProgressEvent]


class HealthResponse(BaseModel):
    status: str
    service: str = "aichart-research"
    version: str = "0.1.0"
