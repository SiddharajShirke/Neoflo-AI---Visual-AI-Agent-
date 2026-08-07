from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from visual_ai_api.config import Settings
from visual_ai_api.errors import ApiError
from visual_ai_api.main import create_app
from visual_ai_api.postgres import PostgrestRepository
from visual_ai_api.store import MemoryRepository


def settings(*, configured: bool) -> Settings:
    return Settings(
        cors_origins=(),
        supabase_url="https://project.example" if configured else None,
        supabase_secret_key="server-key" if configured else None,
        jwt_issuer="https://project.example/auth/v1" if configured else None,
        jwt_audience="authenticated",
        internal_outbox_token=None,
        max_request_bytes=262144,
        max_events_per_batch=100,
        max_title_length=512,
        max_context_bytes=12000,
        max_future_seconds=300,
        max_past_seconds=86400,
        outbox_max_batch=50,
        outbox_max_seconds=2.0,
    )


def test_memory_repository_requires_explicit_injection() -> None:
    repository = MemoryRepository()
    application = create_app(settings=settings(configured=False), repository=repository)

    with TestClient(application) as client:
        assert application.state.repository is repository
        assert client.get("/health/ready").status_code == 200


def test_configured_application_selects_postgrest_repository() -> None:
    application = create_app(settings=settings(configured=True))

    with TestClient(application):
        assert isinstance(application.state.repository, PostgrestRepository)


def test_missing_database_configuration_fails_without_fallback() -> None:
    with pytest.raises(RuntimeError, match="database configuration is required"):
        create_app(settings=settings(configured=False))


def test_readiness_returns_sanitized_503_when_database_is_unavailable() -> None:
    class UnavailableRepository(MemoryRepository):
        async def ready(self) -> bool:
            raise ApiError(503, "database_unavailable", "The service is unavailable.")

    with TestClient(
        create_app(settings=settings(configured=False), repository=UnavailableRepository())
    ) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
    assert "project.example" not in response.text
    assert "server-key" not in response.text
