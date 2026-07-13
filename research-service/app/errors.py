from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ServiceError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def error_body(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.message), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, __: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            error_body("JOB_INPUT_INVALID", "request validation failed"), status_code=422
        )

    @app.exception_handler(Exception)
    async def internal_error_handler(_: Request, __: Exception) -> JSONResponse:
        return JSONResponse(error_body("JOB_FAILED", "internal service error"), status_code=500)


def require(condition: bool, code: str, message: str, status: int = 400) -> None:
    if not condition:
        raise ServiceError(code, message, status)


JsonObject = dict[str, Any]
