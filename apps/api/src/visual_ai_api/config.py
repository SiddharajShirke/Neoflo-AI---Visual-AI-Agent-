"""Server-only configuration for the API boundary."""

from __future__ import annotations

from dataclasses import dataclass
from os import environ


def _csv(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(value.strip() for value in environ.get(name, default).split(",") if value.strip())


@dataclass(frozen=True)
class Settings:
    cors_origins: tuple[str, ...]
    supabase_url: str | None
    supabase_secret_key: str | None
    jwt_issuer: str | None
    jwt_audience: str
    internal_outbox_token: str | None
    max_request_bytes: int
    max_events_per_batch: int
    max_title_length: int
    max_context_bytes: int
    max_future_seconds: int
    max_past_seconds: int
    outbox_max_batch: int
    outbox_max_seconds: float

    @classmethod
    def from_environment(cls) -> Settings:
        url = environ.get("SUPABASE_URL")
        return cls(
            cors_origins=_csv("API_CORS_ORIGINS"),
            supabase_url=url,
            supabase_secret_key=environ.get("SUPABASE_SECRET_KEY"),
            jwt_issuer=environ.get("SUPABASE_JWT_ISSUER") or (f"{url}/auth/v1" if url else None),
            jwt_audience=environ.get("SUPABASE_JWT_AUDIENCE", "authenticated"),
            internal_outbox_token=environ.get("INTERNAL_OUTBOX_PUBLISH_TOKEN"),
            max_request_bytes=int(environ.get("API_MAX_REQUEST_BYTES", "262144")),
            max_events_per_batch=int(environ.get("API_MAX_EVENTS_PER_BATCH", "100")),
            max_title_length=int(environ.get("API_MAX_TITLE_LENGTH", "512")),
            max_context_bytes=int(environ.get("API_MAX_REDACTED_CONTEXT_BYTES", "12000")),
            max_future_seconds=int(environ.get("API_MAX_FUTURE_TIMESTAMP_SECONDS", "300")),
            max_past_seconds=int(environ.get("API_MAX_PAST_TIMESTAMP_SECONDS", "86400")),
            outbox_max_batch=int(environ.get("OUTBOX_PUBLISH_MAX_BATCH", "50")),
            outbox_max_seconds=float(environ.get("OUTBOX_PUBLISH_MAX_SECONDS", "2.0")),
        )
