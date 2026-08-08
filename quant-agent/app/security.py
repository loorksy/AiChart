from __future__ import annotations

import hmac

from fastapi import Header, Request

from app.errors import ServiceError


def _bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip() or None


def require_internal_auth(
    request: Request, authorization: str | None = Header(default=None)
) -> str:
    """The only auth this service has: a shared internal bearer token.

    quant-agent recommendations are symbol-based, not account-based (see
    engineering plan section 4) — there is no per-tenant visibility isolation
    to enforce here, unlike research-service's `require_caller`. Callers may
    still identify themselves for audit logging via `X-AiChart-Caller`.
    """
    token = _bearer(authorization)
    if token is None:
        raise ServiceError("INTERNAL_AUTH_REQUIRED", "internal authentication required", 401)
    expected = request.app.state.settings.internal_token
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise ServiceError("INTERNAL_AUTH_INVALID", "internal authentication invalid", 401)
    return request.headers.get("x-aichart-caller", "aichart-web")[:64]
