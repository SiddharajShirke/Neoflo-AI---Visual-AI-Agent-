from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from visual_ai_api.auth import CurrentUser
from visual_ai_api.config import Settings
from visual_ai_api.main import create_app
from visual_ai_api.schemas import BrowserEventV1, BrowserEventV2, EventBatchV2
from visual_ai_api.store import IngestResult, MemoryRepository

USER_ID = UUID("00000000-0000-4000-8000-000000000001")


class Verifier:
    async def verify(self, token: str, settings: Settings) -> CurrentUser:
        return CurrentUser(USER_ID)


def api(repository: MemoryRepository | None = None) -> TestClient:
    return TestClient(
        create_app(
            verifier=Verifier(),
            repository=repository or MemoryRepository(),
            settings=Settings(
                cors_origins=(),
                supabase_url="http://supabase.test",
                supabase_secret_key=None,
                jwt_issuer="http://supabase.test/auth/v1",
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
            ),
        )
    )


def headers() -> dict[str, str]:
    return {"Authorization": "Bearer test", "Idempotency-Key": "m4a-batch-1"}


def event(**overrides: object) -> dict[str, object]:
    return {
        "client_event_id": "11111111-1111-4111-8111-111111111111",
        "sequence_number": 1,
        "event_kind": "navigation",
        "occurred_at": datetime.now(UTC).isoformat(),
        "page_domain": "example.test",
        "transition_type": "link",
        "capture_policy_version": "m4-navigation-v1",
        **overrides,
    }


def test_v1_remains_historical_while_v2_requires_uuid_and_positive_sequence() -> None:
    v1 = BrowserEventV1(
        client_event_id="legacy-event-id",
        sequence_number=0,
        event_kind="navigation",
        occurred_at=datetime.now(UTC),
        capture_policy_version="v1",
    )
    assert v1.sequence_number == 0
    assert BrowserEventV2.model_validate(event()).client_event_id == UUID(
        "11111111-1111-4111-8111-111111111111"
    )
    for value in (0, -1):
        with pytest.raises(ValidationError):
            BrowserEventV2.model_validate(event(sequence_number=value))
    with pytest.raises(ValidationError):
        BrowserEventV2.model_validate(event(client_event_id="not-a-uuid"))


@pytest.mark.parametrize("field", ["page_origin", "url", "page_title_redacted", "dom", "tab_id"])
def test_v2_rejects_prohibited_browser_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        BrowserEventV2.model_validate(event(**{field: "synthetic"}))


def test_v2_rejects_subframe_transition_types() -> None:
    for transition_type in ("auto_subframe", "manual_subframe"):
        with pytest.raises(ValidationError):
            BrowserEventV2.model_validate(event(transition_type=transition_type))


def test_event_endpoint_accepts_a_recording_v2_batch() -> None:
    repository = MemoryRepository()
    client = api(repository)
    device = client.post(
        "/api/v1/devices/register",
        headers=headers(),
        json={"installation_id": "a" * 16},
    )
    device_id = device.json()["id"]
    consent = client.post(
        "/api/v1/consents",
        headers={**headers(), "Idempotency-Key": "m4a-consent-1"},
        json={
            "device_id": device_id,
            "scope": "monitoring",
            "policy_version": "v1",
            "granted": True,
        },
    )
    session = client.post(
        "/api/v1/sessions",
        headers={**headers(), "Idempotency-Key": "m4a-session-1"},
        json={
            "device_id": device_id,
            "monitoring_consent_id": consent.json()["id"],
            "capture_policy_version": "m4-navigation-v1",
            "started_at": datetime.now(UTC).isoformat(),
        },
    )
    body = {"device_id": device_id, "session_id": session.json()["id"], "events": [event()]}
    response = client.post("/api/v1/events/batch", headers=headers(), json=body)
    assert response.status_code == 202
    assert response.json() == {"accepted_count": 1, "duplicate_count": 0}
    duplicate = client.post(
        "/api/v1/events/batch",
        headers={**headers(), "Idempotency-Key": "m4a-batch-2"},
        json=body,
    )
    assert duplicate.status_code == 202
    assert duplicate.json() == {"accepted_count": 0, "duplicate_count": 1}


@pytest.mark.parametrize(
    "overrides", [{"sequence_number": 0}, {"sequence_number": -1}, {"client_event_id": "bad"}]
)
def test_event_endpoint_rejects_noncanonical_v2_event_identity(
    overrides: dict[str, object],
) -> None:
    client = api()
    response = client.post(
        "/api/v1/events/batch",
        headers=headers(),
        json={
            "device_id": "22222222-2222-4222-8222-222222222222",
            "session_id": "33333333-3333-4333-8333-333333333333",
            "events": [event(**overrides)],
        },
    )
    assert response.status_code == 422


def test_v2_batch_contract_has_only_ownership_and_session_metadata() -> None:
    payload = EventBatchV2.model_validate(
        {
            "device_id": "22222222-2222-4222-8222-222222222222",
            "session_id": "33333333-3333-4333-8333-333333333333",
            "events": [event()],
        }
    )
    assert payload.device_id == UUID("22222222-2222-4222-8222-222222222222")


class StateOutcomeRepository(MemoryRepository):
    def __init__(self, outcome: str) -> None:
        super().__init__()
        self.outcome = outcome

    async def ingest(self, *args: object, **kwargs: object) -> IngestResult:
        return IngestResult(self.outcome, None, None, None)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("outcome", "status_code", "error_code"),
    [
        ("device_inactive", 409, "device_revoked"),
        ("consent_inactive", 409, "consent_inactive"),
        ("session_not_recording", 409, "session_not_recording"),
        ("policy_mismatch", 409, "capture_policy_mismatch"),
    ],
)
def test_event_endpoint_returns_typed_safe_state_errors(
    outcome: str, status_code: int, error_code: str
) -> None:
    client = api(StateOutcomeRepository(outcome))
    response = client.post(
        "/api/v1/events/batch",
        headers=headers(),
        json={
            "device_id": "22222222-2222-4222-8222-222222222222",
            "session_id": "33333333-3333-4333-8333-333333333333",
            "events": [event()],
        },
    )
    assert response.status_code == status_code
    assert response.json()["error"]["code"] == error_code
