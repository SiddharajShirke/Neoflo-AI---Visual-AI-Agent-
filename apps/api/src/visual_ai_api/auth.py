"""Cryptographic Supabase JWT verification behind a test-replaceable dependency."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Protocol
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings
from .errors import ApiError


@dataclass(frozen=True)
class CurrentUser:
    id: UUID


class TokenVerifier(Protocol):
    async def verify(self, token: str, settings: Settings) -> CurrentUser: ...


class JwtVerifier:
    """Verifier boundary. Production wiring must use Supabase JWKS, never a service key."""

    async def verify(self, token: str, settings: Settings) -> CurrentUser:
        try:
            import jwt
            from jwt import PyJWKClient
        except ImportError as error:  # pragma: no cover - depends on deployment extras
            raise ApiError(
                503, "authentication_unavailable", "Authentication is unavailable."
            ) from error
        if not settings.supabase_url or not settings.jwt_issuer:
            raise ApiError(503, "authentication_unavailable", "Authentication is unavailable.")
        try:
            jwks = PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")
            key = jwks.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256", "ES256"],
                audience=settings.jwt_audience,
                issuer=settings.jwt_issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
            return CurrentUser(UUID(str(claims["sub"])))
        except Exception as error:  # JWT library errors must not leak to clients.
            raise ApiError(401, "invalid_token", "The access token is invalid.") from error


_bearer_scheme = HTTPBearer(auto_error=False)


def bearer_token(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ] = None,
) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(401, "authentication_required", "Authentication is required.")
    token = credentials.credentials.strip()
    if not token:
        raise ApiError(401, "authentication_required", "Authentication is required.")
    return token
