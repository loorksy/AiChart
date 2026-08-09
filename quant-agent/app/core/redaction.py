from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

_SECRET_KEYS = re.compile(
    r"(authorization|token|secret|password|api[_-]?key|private[_-]?key)", re.I
)
_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")
_PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")


def redact_text(value: str, limit: int = 1000) -> str:
    text = _BEARER.sub("Bearer [REDACTED]", value)
    if _PRIVATE_KEY.search(text):
        return "[REJECTED_PRIVATE_KEY]"
    return text[:limit]


def redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if _SECRET_KEYS.search(str(key)) else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value[:50]]
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, int | float | bool) or value is None:
        return value
    return redact_text(str(value))
