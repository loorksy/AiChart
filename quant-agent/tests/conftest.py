from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-internal-token-with-32-characters"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        internal_token=TOKEN,
        environment="test",
        work_dir=tmp_path / "work",
        min_bars=210,
        max_bars=2000,
        validity_bars=6,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as active:
        yield active


def headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-AiChart-Caller": "aichart-web-tests",
    }
