from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from visual_ai_api.auth import CurrentUser
from visual_ai_api.main import create_app
from visual_ai_api.schemas import ApiErrorResponse, EventBatch, EventIngestionResponse
from visual_ai_api.store import MemoryRepository

ROOT = Path(__file__).resolve().parents[3]
EVENT_SCHEMA = ROOT / "schemas" / "events" / "browser-event.v1.schema.json"
VALID_FIXTURE = ROOT / "schemas" / "events" / "fixtures" / "browser-event-batch.v1.valid.json"
INVALID_FIXTURE = (
    ROOT / "schemas" / "events" / "fixtures" / "browser-event-batch.v1.invalid-sensitive-field.json"
)


class FixedVerifier:
    async def verify(self, token: str, settings: object) -> CurrentUser:
        return CurrentUser(UUID("00000000-0000-0000-0000-0000000000a1"))


def test_shared_minimized_fixture_matches_python_and_canonical_event_schema() -> None:
    payload = json.loads(VALID_FIXTURE.read_text(encoding="utf-8"))
    schema = json.loads(EVENT_SCHEMA.read_text(encoding="utf-8"))

    assert EventBatch.model_validate(payload).events[0].client_event_id == "event-1"
    assert schema["additionalProperties"] is False
    assert schema["required"] == [
        "client_event_id",
        "sequence_number",
        "event_kind",
        "occurred_at",
        "capture_policy_version",
    ]


def test_sensitive_unknown_fixture_is_rejected_by_python_and_openapi() -> None:
    payload = json.loads(INVALID_FIXTURE.read_text(encoding="utf-8"))

    with pytest.raises(ValidationError, match="raw_url"):
        EventBatch.model_validate(payload)

    openapi = create_app(repository=MemoryRepository()).openapi()
    event_schema = openapi["components"]["schemas"]["BrowserEventV2"]
    assert event_schema["additionalProperties"] is False
    assert "raw_url" not in event_schema["properties"]
    assert event_schema["properties"]["client_event_id"]["format"] == "uuid"
    assert event_schema["properties"]["sequence_number"]["minimum"] == 1


def test_openapi_marks_browser_routes_with_bearer_jwt_security() -> None:
    schema = create_app(repository=MemoryRepository()).openapi()

    assert schema["components"]["securitySchemes"] == {
        "HTTPBearer": {"type": "http", "scheme": "bearer"}
    }
    assert schema["paths"]["/api/v1/events/batch"]["post"]["security"] == [{"HTTPBearer": []}]


def test_event_ingestion_response_is_strict_and_represented_in_openapi() -> None:
    response = EventIngestionResponse(accepted_count=1, duplicate_count=0)
    assert response.model_dump(mode="json") == {"accepted_count": 1, "duplicate_count": 0}

    with pytest.raises(ValidationError, match="unexpected"):
        EventIngestionResponse.model_validate(
            {"accepted_count": 1, "duplicate_count": 0, "unexpected": "raw_url"}
        )

    schema = create_app(repository=MemoryRepository()).openapi()
    response_schema = schema["components"]["schemas"]["EventIngestionResponse"]
    assert response_schema["additionalProperties"] is False
    assert (
        schema["paths"]["/api/v1/events/batch"]["post"]["responses"]["202"]["content"][
            "application/json"
        ]["schema"]["$ref"]
        == "#/components/schemas/EventIngestionResponse"
    )


def test_control_plane_openapi_uses_strict_typed_request_and_response_models() -> None:
    schema = create_app(repository=MemoryRepository()).openapi()

    consent_create = schema["paths"]["/api/v1/consents"]["post"]
    assert consent_create["requestBody"]["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/ConsentCreateRequest"
    )
    assert consent_create["responses"]["201"]["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/ConsentCreateResponse"
    )
    assert schema["components"]["schemas"]["ConsentCreateResponse"]["additionalProperties"] is False
    for action in ("pause", "resume", "complete", "cancel"):
        response_schema = schema["paths"][f"/api/v1/sessions/{{session_id}}/{action}"]["post"][
            "responses"
        ]["200"]["content"]["application/json"]["schema"]
        assert response_schema["$ref"] == "#/components/schemas/SessionTransitionResponse"
    assert "/api/v1/sessions/{session_id}/{action}" not in schema["paths"]


def test_api_errors_use_the_canonical_strict_response_model() -> None:
    response = ApiErrorResponse.model_validate(
        {
            "error": {
                "code": "authentication_required",
                "message": "Authentication is required.",
                "request_id": "request-1",
            }
        }
    )

    assert response.error.code == "authentication_required"


def test_invalid_control_plane_requests_return_the_canonical_error_envelope() -> None:
    response = TestClient(create_app(repository=MemoryRepository(), verifier=FixedVerifier())).post(
        "/api/v1/consents",
        headers={"Authorization": "Bearer user-a", "Idempotency-Key": "invalid-request"},
        json={"scope": "monitoring"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert "detail" not in response.json()
