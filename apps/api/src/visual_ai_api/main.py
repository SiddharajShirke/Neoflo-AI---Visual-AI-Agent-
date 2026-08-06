"""Milestone 2 authenticated FastAPI boundary."""

from __future__ import annotations

import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from .auth import CurrentUser, JwtVerifier, TokenVerifier, bearer_token
from .config import Settings
from .errors import ApiError, api_error_handler
from .postgres import PostgrestRepository
from .rate_limits import InMemoryRateLimiter, RateLimiter
from .schemas import (
    ConsentCreate,
    DeviceRegister,
    EventBatch,
    EventIngestionResponse,
    SessionCreate,
    event_batch_request_hash,
)
from .store import Repository


class DatabaseConfigurationError(RuntimeError):
    """Raised when the durable Supabase repository cannot be configured."""


def create_app(
    settings: Settings | None = None,
    verifier: TokenVerifier | None = None,
    limiter: RateLimiter | None = None,
    repository: Repository | None = None,
) -> FastAPI:
    settings = settings or Settings.from_environment()
    verifier = verifier or JwtVerifier()
    limiter = limiter or InMemoryRateLimiter()
    repository = repository or _default_repository(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.verifier = verifier
        app.state.limiter = limiter
        app.state.repository = repository
        yield

    app = FastAPI(title="Visual AI Browser Agent API", version="0.2.0", lifespan=lifespan)
    app.add_exception_handler(ApiError, api_error_handler)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_credentials=True,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next: RequestResponseEndpoint) -> Response:
        request.state.request_id = request.headers.get("X-Request-Id") or str(uuid4())
        if request.url.path.startswith("/api/v1/internal/") and request.method == "OPTIONS":
            return JSONResponse(
                status_code=404,
                content={
                    "error": {
                        "code": "resource_not_found",
                        "message": "The resource was not found.",
                        "request_id": request.state.request_id,
                    }
                },
            )
        if request.url.path.startswith("/api/v1/events"):
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > settings.max_request_bytes:
                raise ApiError(413, "request_too_large", "The request exceeds the allowed size.")
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/internal/"):
            for header in (
                "access-control-allow-origin",
                "access-control-allow-credentials",
                "vary",
            ):
                if header in response.headers:
                    del response.headers[header]
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    async def current_user(token: str = Depends(bearer_token)) -> CurrentUser:
        return await verifier.verify(token, settings)

    def idempotency_key(
        value: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> str | None:
        if value is not None and not (1 <= len(value) <= 128):
            raise ApiError(400, "invalid_idempotency_key", "The idempotency key is invalid.")
        return value

    @app.get("/health/live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "ok", "service": "api"}

    @app.get("/health/ready", tags=["health"])
    async def ready() -> dict[str, str]:
        try:
            await repository.ready()
        except ApiError:
            raise
        except Exception as error:
            raise ApiError(503, "database_unavailable", "The service is unavailable.") from error
        return {"status": "ok", "service": "api"}

    @app.get("/api/v1/devices", tags=["devices"])
    async def list_devices(user: CurrentUser = Depends(current_user)) -> dict[str, list[object]]:
        devices = await repository.list_devices(user.id)
        return {
            "devices": [
                {"id": str(device.id), "status": device.status, "label": device.label}
                for device in devices
            ]
        }

    @app.post("/api/v1/devices/register", status_code=201, tags=["devices"])
    async def register_device(
        payload: DeviceRegister,
        user: CurrentUser = Depends(current_user),
        key: str | None = Depends(idempotency_key),
    ) -> dict[str, str]:
        if not limiter.allow(f"device:{user.id}", 20, 60):
            raise ApiError(429, "rate_limited", "Too many requests.")
        device = await repository.register_device(user.id, payload)
        return {"id": str(device.id), "status": device.status}

    @app.post("/api/v1/devices/{device_id}/revoke", tags=["devices"])
    async def revoke_device(
        device_id: UUID, user: CurrentUser = Depends(current_user)
    ) -> dict[str, str]:
        device = await repository.revoke_device(user.id, device_id)
        return {"id": str(device.id), "status": device.status}

    @app.post("/api/v1/consents", status_code=201, tags=["consents"])
    async def create_consent(
        payload: ConsentCreate, user: CurrentUser = Depends(current_user)
    ) -> dict[str, str]:
        consent = await repository.create_consent(user.id, payload)
        return {
            "id": str(consent.id),
            "scope": consent.scope,
            "granted": str(consent.granted).lower(),
        }

    @app.get("/api/v1/consents", tags=["consents"])
    async def list_consents(user: CurrentUser = Depends(current_user)) -> dict[str, list[object]]:
        consents = await repository.list_consents(user.id)
        return {
            "consents": [
                {
                    "id": str(consent.id),
                    "device_id": str(consent.device_id),
                    "scope": consent.scope,
                    "granted": consent.granted,
                }
                for consent in consents
            ]
        }

    @app.post("/api/v1/sessions", status_code=201, tags=["sessions"])
    async def create_session(
        payload: SessionCreate, user: CurrentUser = Depends(current_user)
    ) -> dict[str, str]:
        if not limiter.allow(f"session:{user.id}", 20, 60):
            raise ApiError(429, "rate_limited", "Too many requests.")
        session = await repository.create_session(user.id, payload)
        return {
            "id": str(session.id),
            "status": session.status,
            "screenshot_capture": "not_implemented",
        }

    @app.get("/api/v1/sessions", tags=["sessions"])
    async def list_sessions(user: CurrentUser = Depends(current_user)) -> dict[str, list[object]]:
        sessions = await repository.list_sessions(user.id)
        return {
            "sessions": [
                {
                    "id": str(session.id),
                    "device_id": str(session.device_id),
                    "status": session.status,
                }
                for session in sessions
            ]
        }

    @app.get("/api/v1/sessions/{session_id}", tags=["sessions"])
    async def get_session(
        session_id: UUID, user: CurrentUser = Depends(current_user)
    ) -> dict[str, str]:
        session = await repository.owned_session(user.id, session_id)
        return {"id": str(session.id), "status": session.status}

    @app.post("/api/v1/sessions/{session_id}/{action}", tags=["sessions"])
    async def transition_session(
        session_id: UUID, action: str, user: CurrentUser = Depends(current_user)
    ) -> dict[str, str]:
        if action not in {"pause", "resume", "complete", "cancel"}:
            raise ApiError(404, "resource_not_found", "The resource was not found.")
        session = await repository.transition(user.id, session_id, action)
        return {"id": str(session.id), "status": session.status}

    @app.delete("/api/v1/sessions/{session_id}", status_code=202, tags=["sessions"])
    async def request_session_deletion(
        session_id: UUID, user: CurrentUser = Depends(current_user)
    ) -> dict[str, str]:
        deletion_id = await repository.request_deletion(user.id, session_id)
        return {"deletion_request_id": str(deletion_id), "status": "requested"}

    @app.post("/api/v1/events/batch", status_code=202, tags=["events"])
    async def ingest_events(
        payload: EventBatch,
        request: Request,
        user: CurrentUser = Depends(current_user),
        key: str | None = Depends(idempotency_key),
    ) -> EventIngestionResponse:
        if key is None:
            raise ApiError(400, "idempotency_key_required", "An idempotency key is required.")
        if len(payload.events) > settings.max_events_per_batch:
            raise ApiError(413, "batch_too_large", "The batch exceeds the allowed event count.")
        if not limiter.allow(f"events:{user.id}", 60, 60):
            raise ApiError(429, "rate_limited", "Too many requests.")
        for event in payload.events:
            if (
                event.page_title_redacted
                and len(event.page_title_redacted) > settings.max_title_length
            ):
                raise ApiError(422, "invalid_event_batch", "The event batch is invalid.")
            if (
                event.accessibility_context_redacted
                and len(event.accessibility_context_redacted.encode()) > settings.max_context_bytes
            ):
                raise ApiError(422, "invalid_event_batch", "The event batch is invalid.")
            if event.page_origin and ("?" in event.page_origin or "/" in event.page_origin[8:]):
                raise ApiError(422, "invalid_event_batch", "The event batch is invalid.")
            occurred_at = event.occurred_at
            if occurred_at.tzinfo is None:
                raise ApiError(422, "invalid_event_batch", "The event batch is invalid.")
            delta = (occurred_at - datetime.now(UTC)).total_seconds()
            if delta > settings.max_future_seconds or delta < -settings.max_past_seconds:
                raise ApiError(422, "invalid_event_batch", "The event batch is invalid.")
        result = await repository.ingest(
            user.id,
            "/api/v1/events/batch",
            payload.device_id,
            payload.session_id,
            payload.events,
            key,
            event_batch_request_hash(payload),
        )
        if result.outcome == "conflict":
            raise ApiError(409, "idempotency_key_reused", "The idempotency key was reused.")
        if result.outcome == "in_progress":
            raise ApiError(409, "idempotency_request_in_progress", "Retry the request shortly.")
        if (
            result.response_status != 202
            or result.accepted_count is None
            or result.duplicate_count is None
        ):
            raise ApiError(503, "database_unavailable", "The service is unavailable.")
        return EventIngestionResponse(
            accepted_count=result.accepted_count, duplicate_count=result.duplicate_count
        )

    @app.post("/api/v1/internal/outbox/publish", tags=["internal"], include_in_schema=False)
    async def publish_outbox(
        internal_token: str | None = Header(default=None, alias="X-Internal-Outbox-Token"),
    ) -> dict[str, int]:
        if not settings.internal_outbox_token:
            raise ApiError(404, "resource_not_found", "The resource was not found.")
        if not internal_token or not secrets.compare_digest(
            internal_token, settings.internal_outbox_token
        ):
            raise ApiError(403, "internal_authentication_required", "The resource is unavailable.")
        if not limiter.allow("internal-outbox", 10, 60):
            raise ApiError(429, "rate_limited", "Too many requests.")
        started = time.monotonic()
        claimed, published, pending = await repository.publish_outbox(settings.outbox_max_batch)
        if time.monotonic() - started > settings.outbox_max_seconds:
            raise ApiError(503, "publisher_timeout", "The publisher is temporarily unavailable.")
        return {"claimed_count": claimed, "published_count": published, "pending_count": pending}

    return app


def _default_repository(settings: Settings) -> Repository:
    if settings.supabase_url and settings.supabase_secret_key:
        return PostgrestRepository(settings.supabase_url, settings.supabase_secret_key)
    raise DatabaseConfigurationError("database configuration is required")


def _unconfigured_app() -> FastAPI:
    application = FastAPI(title="Visual AI Browser Agent API", version="0.2.0")
    application.add_exception_handler(ApiError, api_error_handler)

    @application.get("/health/live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "ok", "service": "api"}

    @application.get("/health/ready", tags=["health"])
    async def ready() -> dict[str, str]:
        raise ApiError(503, "database_unavailable", "The service is unavailable.")

    return application


try:
    app = create_app()
except DatabaseConfigurationError:
    app = _unconfigured_app()
