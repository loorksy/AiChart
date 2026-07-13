from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from app.core.redaction import redact, redact_text


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "service": "aichart-research",
            "message": redact_text(record.getMessage()),
        }
        context = getattr(record, "context", None)
        if isinstance(context, dict):
            fields.update(redact(context))
        return json.dumps(fields, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())


def log_event(level: int, message: str, **context: Any) -> None:
    logging.getLogger("research").log(level, message, extra={"context": context})
