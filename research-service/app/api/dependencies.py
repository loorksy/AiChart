from typing import cast

from fastapi import Request

from app.jobs.manager import JobManager


def get_manager(request: Request) -> JobManager:
    return cast(JobManager, request.app.state.manager)
