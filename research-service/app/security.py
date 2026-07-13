from __future__ import annotations

import hmac
import re
from dataclasses import dataclass

from fastapi import Header, Request

from app.errors import ServiceError

_ID = re.compile(r"^[A-Za-z0-9._:-]{3,128}$")


@dataclass(frozen=True)
class CallerContext:
    user_id: int
    request_id: str
    caller: str


def _bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip() or None


def require_internal_auth(
    request: Request, authorization: str | None = Header(default=None)
) -> str:
    token = _bearer(authorization)
    if token is None:
        raise ServiceError("INTERNAL_AUTH_REQUIRED", "internal authentication required", 401)
    expected = request.app.state.settings.internal_token
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise ServiceError("INTERNAL_AUTH_INVALID", "internal authentication invalid", 401)
    return request.headers.get("x-aichart-caller", "aichart-web")[:64]


def require_caller(
    request: Request,
    authorization: str | None = Header(default=None),
    user_id: str | None = Header(default=None, alias="X-AiChart-User-Id"),
    request_id: str | None = Header(default=None, alias="X-AiChart-Request-Id"),
) -> CallerContext:
    caller = require_internal_auth(request, authorization)
    try:
        parsed_user = int(user_id or "")
    except ValueError as exc:
        raise ServiceError("JOB_INPUT_INVALID", "valid tenant user header required", 400) from exc
    if parsed_user <= 0 or not request_id or not _ID.fullmatch(request_id):
        raise ServiceError("JOB_INPUT_INVALID", "valid tenant and request identity required", 400)
    return CallerContext(parsed_user, request_id, caller)
