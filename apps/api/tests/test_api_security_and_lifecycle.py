from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from visual_ai_api.auth import CurrentUser
from visual_ai_api.config import Settings
from visual_ai_api.main import create_app
from visual_ai_api.store import IngestResult, MemoryRepository

USER_A = UUID("00000000-0000-0000-0000-0000000000a1")
USER_B = UUID("00000000-0000-0000-0000-0000000000b2")


class Verifier:
    async def verify(self, token: str, settings: Settings) -> CurrentUser:
        return CurrentUser(USER_A if token == "user-a" else USER_B)


class RecordingRepository(MemoryRepository):
    def __init__(self) -> None:
        super().__init__()
        self.ingest_route: object | None = None

    async def ingest(self, *args: object, **kwargs: object) -> IngestResult:
        self.ingest_route = args[1] if len(args) > 1 else kwargs.get("route")
        return await super().ingest(*args, **kwargs)  # type: ignore[arg-type]


def client(
    repository: MemoryRepository | None = None, *, raise_server_exceptions: bool = True
) -> TestClient:
    value = "internal-" + "placeholder"
    settings = Settings(
        cors_origins=("http://localhost:3000",),
        supabase_url="http://supabase.test",
        supabase_secret_key=None,
        jwt_issuer="http://supabase.test/auth/v1",
        jwt_audience="authenticated",
        internal_outbox_token=value,
        max_request_bytes=262144,
        max_events_per_batch=2,
        max_title_length=8,
        max_context_bytes=12,
        max_future_seconds=300,
        max_past_seconds=86400,
        outbox_max_batch=1,
        outbox_max_seconds=2.0,
    )
    return TestClient(
        create_app(
            settings=settings,
            verifier=Verifier(),
            repository=repository or MemoryRepository(),
        ),
        raise_server_exceptions=raise_server_exceptions,
    )


def auth(token: str = "user-a") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_device(api: TestClient, installation_id: str = "a" * 16) -> str:
    response = api.post(
        "/api/v1/devices/register", headers=auth(), json={"installation_id": installation_id}
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    identifier = body.get("id")
    assert isinstance(identifier, str)
    return identifier


def create_monitoring_consent(api: TestClient, device_id: str, scope: str = "monitoring") -> str:
    response = api.post(
        "/api/v1/consents",
        headers={**auth(), "Idempotency-Key": f"consent-{device_id}-{scope}"},
        json={
            "device_id": device_id,
            "scope": scope,
            "policy_version": "v1",
            "granted": True,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    identifier = body.get("id")
    assert isinstance(identifier, str)
    return identifier


def session_payload(device_id: str, consent_id: str) -> dict[str, str]:
    return {
        "device_id": device_id,
        "monitoring_consent_id": consent_id,
        "capture_policy_version": "v1",
        "started_at": datetime.now(UTC).isoformat(),
    }


def test_terminal_session_deletion_is_asynchronous_and_idempotent() -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)
    response = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-for-deletion"},
        json={
            "device_id": device_id,
            "monitoring_consent_id": consent_id,
            "capture_policy_version": "v1",
            "started_at": datetime.now(UTC).isoformat(),
        },
    )
    session_id = response.json()["id"]
    assert (
        api.post(
            f"/api/v1/sessions/{session_id}/complete",
            headers={**auth(), "Idempotency-Key": "complete-for-deletion"},
        ).status_code
        == 200
    )
    first = api.delete(f"/api/v1/sessions/{session_id}", headers=auth())
    second = api.delete(f"/api/v1/sessions/{session_id}", headers=auth())
    assert first.status_code == second.status_code == 202
    assert first.json()["deletion_request_id"] == second.json()["deletion_request_id"]
    assert api.get(f"/api/v1/sessions/{session_id}", headers=auth()).status_code == 200


def test_consent_creation_requires_an_idempotency_key() -> None:
    api = client()
    device_id = create_device(api)

    response = api.post(
        "/api/v1/consents",
        headers=auth(),
        json={
            "device_id": device_id,
            "scope": "monitoring",
            "policy_version": "v1",
            "granted": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "idempotency_key_required"


def test_consent_timeout_after_commit_replays_the_original_response() -> None:
    api = client()
    device_id = create_device(api)
    payload = {
        "device_id": device_id,
        "scope": "monitoring",
        "policy_version": "v1",
        "granted": True,
    }
    headers = {**auth(), "Idempotency-Key": "consent-timeout-replay"}

    committed = api.post("/api/v1/consents", headers=headers, json=payload)
    replay = api.post("/api/v1/consents", headers=headers, json=payload)

    assert committed.status_code == replay.status_code == 201
    assert replay.json() == committed.json()


def test_changed_consent_request_with_the_same_key_is_rejected() -> None:
    api = client()
    device_id = create_device(api)
    headers = {**auth(), "Idempotency-Key": "consent-request-conflict"}
    granted = {
        "device_id": device_id,
        "scope": "monitoring",
        "policy_version": "v1",
        "granted": True,
    }
    withdrawn = {**granted, "granted": False}

    assert api.post("/api/v1/consents", headers=headers, json=granted).status_code == 201
    conflict = api.post("/api/v1/consents", headers=headers, json=withdrawn)

    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_key_reused"


def test_session_creation_requires_an_idempotency_key() -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)

    response = api.post(
        "/api/v1/sessions", headers=auth(), json=session_payload(device_id, consent_id)
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "idempotency_key_required"


def test_withdrawal_revokes_the_active_grant_before_a_session_can_start() -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)

    withdrawal = api.post(
        "/api/v1/consents",
        headers={**auth(), "Idempotency-Key": "withdraw-monitoring-consent"},
        json={
            "device_id": device_id,
            "scope": "monitoring",
            "policy_version": "v1",
            "granted": False,
        },
    )
    session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-after-withdrawal"},
        json=session_payload(device_id, consent_id),
    )

    assert withdrawal.status_code == 201
    assert session.status_code == 409
    assert session.json()["error"]["code"] == "invalid_consent"


def test_repeated_withdrawal_replays_its_original_audit_response() -> None:
    api = client()
    device_id = create_device(api)
    create_monitoring_consent(api, device_id)
    headers = {**auth(), "Idempotency-Key": "withdrawal-timeout-replay"}
    payload = {
        "device_id": device_id,
        "scope": "monitoring",
        "policy_version": "v1",
        "granted": False,
    }

    committed = api.post("/api/v1/consents", headers=headers, json=payload)
    replay = api.post("/api/v1/consents", headers=headers, json=payload)

    assert committed.status_code == replay.status_code == 201
    assert replay.json() == committed.json()


def test_new_grant_replaces_the_previous_active_grant_for_its_device_and_scope() -> None:
    api = client()
    device_id = create_device(api)
    first = api.post(
        "/api/v1/consents",
        headers={**auth(), "Idempotency-Key": "initial-monitoring-grant"},
        json={
            "device_id": device_id,
            "scope": "monitoring",
            "policy_version": "v1",
            "granted": True,
        },
    )
    second = api.post(
        "/api/v1/consents",
        headers={**auth(), "Idempotency-Key": "replacement-monitoring-grant"},
        json={
            "device_id": device_id,
            "scope": "monitoring",
            "policy_version": "v2",
            "granted": True,
        },
    )

    old_session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-with-replaced-consent"},
        json=session_payload(device_id, first.json()["id"]),
    )
    current_session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-with-current-consent"},
        json=session_payload(device_id, second.json()["id"]),
    )

    assert first.status_code == second.status_code == 201
    assert old_session.status_code == 409
    assert current_session.status_code == 201


def test_withdrawal_cannot_revoke_a_grant_from_another_device() -> None:
    api = client()
    first_device_id = create_device(api)
    second_device_id = create_device(api, "b" * 16)
    first_consent_id = create_monitoring_consent(api, first_device_id)

    withdrawal = api.post(
        "/api/v1/consents",
        headers={**auth(), "Idempotency-Key": "withdraw-second-device"},
        json={
            "device_id": second_device_id,
            "scope": "monitoring",
            "policy_version": "v1",
            "granted": False,
        },
    )
    session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-for-first-device"},
        json=session_payload(first_device_id, first_consent_id),
    )

    assert withdrawal.status_code == 201
    assert session.status_code == 201


def test_session_timeout_after_commit_replays_the_original_response() -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)
    headers = {**auth(), "Idempotency-Key": "session-timeout-replay"}
    payload = session_payload(device_id, consent_id)

    committed = api.post("/api/v1/sessions", headers=headers, json=payload)
    replay = api.post("/api/v1/sessions", headers=headers, json=payload)

    assert committed.status_code == replay.status_code == 201
    assert replay.json() == committed.json()


def test_session_transition_requires_an_idempotency_key() -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)
    session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-for-transition"},
        json=session_payload(device_id, consent_id),
    )

    response = api.post(f"/api/v1/sessions/{session.json()['id']}/pause", headers=auth())

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "idempotency_key_required"


@pytest.mark.parametrize("action", ["pause", "resume", "complete", "cancel"])
def test_session_transition_timeout_after_commit_replays_the_original_response(action: str) -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)
    session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": f"session-for-{action}"},
        json=session_payload(device_id, consent_id),
    )
    session_id = session.json()["id"]
    if action == "resume":
        paused = api.post(
            f"/api/v1/sessions/{session_id}/pause",
            headers={**auth(), "Idempotency-Key": "pause-before-resume"},
        )
        assert paused.status_code == 200
    headers = {**auth(), "Idempotency-Key": f"{action}-timeout-replay"}

    committed = api.post(f"/api/v1/sessions/{session_id}/{action}", headers=headers)
    replay = api.post(f"/api/v1/sessions/{session_id}/{action}", headers=headers)

    assert committed.status_code == replay.status_code == 200
    assert replay.json() == committed.json()


def test_transition_key_is_bound_to_its_exact_session_operation() -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)
    session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-for-operation-binding"},
        json=session_payload(device_id, consent_id),
    )
    session_id = session.json()["id"]
    shared_key = {**auth(), "Idempotency-Key": "transition-operation-binding"}

    pause = api.post(f"/api/v1/sessions/{session_id}/pause", headers=shared_key)
    resume = api.post(f"/api/v1/sessions/{session_id}/resume", headers=shared_key)

    assert pause.status_code == 200
    assert resume.status_code == 409
    assert resume.json()["error"]["code"] == "idempotency_key_reused"


def test_valid_screenshot_consent_is_linked_but_capture_is_disabled() -> None:
    api = client()
    device_id = create_device(api)
    monitoring = create_monitoring_consent(api, device_id)
    screenshots = create_monitoring_consent(api, device_id, "screenshots")
    response = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-with-screenshot-consent"},
        json={
            "device_id": device_id,
            "monitoring_consent_id": monitoring,
            "screenshot_consent_id": screenshots,
            "capture_policy_version": "v1",
            "started_at": datetime.now(UTC).isoformat(),
        },
    )
    assert response.status_code == 201
    assert response.json()["screenshot_capture"] == "not_implemented"


def test_cross_user_session_access_returns_safe_not_found() -> None:
    api = client()
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)
    session = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-for-cross-user-test"},
        json={
            "device_id": device_id,
            "monitoring_consent_id": consent_id,
            "capture_policy_version": "v1",
            "started_at": datetime.now(UTC).isoformat(),
        },
    ).json()["id"]
    response = api.get(f"/api/v1/sessions/{session}", headers=auth("user-b"))
    assert response.status_code == 404


def test_event_batch_requires_recording_session_and_idempotency_key() -> None:
    repository = RecordingRepository()
    api = client(repository)
    device_id = create_device(api)
    consent_id = create_monitoring_consent(api, device_id)
    session_id = api.post(
        "/api/v1/sessions",
        headers={**auth(), "Idempotency-Key": "session-for-event-test"},
        json={
            "device_id": device_id,
            "monitoring_consent_id": consent_id,
            "capture_policy_version": "v1",
            "started_at": datetime.now(UTC).isoformat(),
        },
    ).json()["id"]
    body = {
        "device_id": device_id,
        "session_id": session_id,
        "events": [
            {
                "client_event_id": "11111111-1111-4111-8111-111111111111",
                "sequence_number": 1,
                "event_kind": "navigation",
                "occurred_at": datetime.now(UTC).isoformat(),
                "page_domain": "example.test",
                "transition_type": "link",
                "capture_policy_version": "v1",
            }
        ],
    }
    missing_key = api.post("/api/v1/events/batch", headers=auth(), json=body)
    assert (missing_key.status_code, missing_key.json()["error"]["code"]) == (
        400,
        "idempotency_key_required",
    )
    response = api.post(
        "/api/v1/events/batch", headers={**auth(), "Idempotency-Key": "batch-1"}, json=body
    )
    assert response.status_code == 202
    assert response.json() == {"accepted_count": 1, "duplicate_count": 0}
    retry = api.post(
        "/api/v1/events/batch", headers={**auth(), "Idempotency-Key": "batch-1"}, json=body
    )
    assert retry.status_code == 202
    assert retry.json() == response.json()
    body["events"][0]["client_event_id"] = "22222222-2222-4222-8222-222222222222"
    conflict = api.post(
        "/api/v1/events/batch", headers={**auth(), "Idempotency-Key": "batch-1"}, json=body
    )
    assert (conflict.status_code, conflict.json()["error"]["code"]) == (
        409,
        "idempotency_key_reused",
    )
    assert repository.ingest_route == "/api/v1/events/batch"


def test_event_batch_rejects_idempotency_keys_longer_than_128_characters() -> None:
    response = client().post(
        "/api/v1/events/batch",
        headers={**auth(), "Idempotency-Key": "x" * 129},
        json={
            "device_id": "00000000-0000-0000-0000-0000000000a1",
            "session_id": "00000000-0000-0000-0000-0000000000b2",
            "events": [
                {
                    "client_event_id": "11111111-1111-4111-8111-111111111111",
                    "sequence_number": 1,
                    "event_kind": "navigation",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "page_domain": "example.test",
                    "transition_type": "link",
                    "capture_policy_version": "v1",
                }
            ],
        },
    )

    assert (response.status_code, response.json()["error"]["code"]) == (
        400,
        "invalid_idempotency_key",
    )


def test_event_batch_maps_repository_conflict_to_409() -> None:
    class ConflictRepository(MemoryRepository):
        async def ingest(self, *args: object, **kwargs: object) -> IngestResult:
            return IngestResult("conflict", None, None, None)

    api = client(ConflictRepository(), raise_server_exceptions=False)
    response = api.post(
        "/api/v1/events/batch",
        headers={**auth(), "Idempotency-Key": "key-1"},
        json={
            "device_id": "00000000-0000-0000-0000-0000000000a1",
            "session_id": "00000000-0000-0000-0000-0000000000b2",
            "events": [
                {
                    "client_event_id": "11111111-1111-4111-8111-111111111111",
                    "sequence_number": 1,
                    "event_kind": "navigation",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "page_domain": "example.test",
                    "transition_type": "link",
                    "capture_policy_version": "v1",
                }
            ],
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "idempotency_key_reused"


def test_internal_endpoint_requires_constant_time_separate_credential() -> None:
    api = client()
    assert api.post("/api/v1/internal/outbox/publish").status_code == 403
    response = api.post(
        "/api/v1/internal/outbox/publish",
        headers={"X-Internal-Outbox-Token": "internal-" + "placeholder"},
    )
    assert response.status_code == 200
    assert response.json() == {"claimed_count": 0, "published_count": 0, "pending_count": 0}
