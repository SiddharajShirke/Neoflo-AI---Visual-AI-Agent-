"""Sanitized API failures and one response shape."""

from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .schemas import ApiErrorDetails, ApiErrorResponse


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message


async def api_error_handler(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, ApiError):
        raise error
    return JSONResponse(
        status_code=error.status_code,
        content=_error_body(request, error.code, error.message),
    )


async def request_validation_error_handler(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, RequestValidationError):
        raise error
    return JSONResponse(
        status_code=422,
        content=_error_body(request, "invalid_request", "The request is invalid."),
    )


def _error_body(request: Request, code: str, message: str) -> dict[str, object]:
    return ApiErrorResponse(
        error=ApiErrorDetails(
            code=code,
            message=message,
            request_id=getattr(request.state, "request_id", "unavailable"),
        )
    ).model_dump(mode="json")
