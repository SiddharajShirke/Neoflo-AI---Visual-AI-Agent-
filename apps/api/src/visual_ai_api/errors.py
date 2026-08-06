"""Sanitized API failures and one response shape."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse


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
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "request_id": getattr(request.state, "request_id", "unavailable"),
            }
        },
    )
