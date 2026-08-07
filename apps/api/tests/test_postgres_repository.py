from __future__ import annotations

import json
from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

import httpx
import pytest
from pydantic_core import PydanticSerializationError
from visual_ai_api.errors import ApiError
from visual_ai_api.postgres import PostgrestRepository, serialize_postgrest_json
from visual_ai_api.schemas import BrowserEvent, ConsentCreate, SessionCreate

USER_ID = UUID("00000000-0000-0000-0000-0000000000a1")
DEVICE_ID = UUID("00000000-0000-0000-0000-0000000000b1")
SESSION_ID = UUID("00000000-0000-0000-0000-0000000000c1")
EVENT_BATCH_ROUTE = "/api/v1/events/batch"


class PayloadStatus(Enum):
    ACTIVE = "active"


def test_json_boundary_serializes_consent_uuid_as_canonical_string() -> None:
    payload = serialize_postgrest_json(
        ConsentCreate(
            device_id=DEVICE_ID,
            scope="monitoring",
            policy_version="v1",
            granted=True,
        ).model_dump(mode="json")
    )

    assert payload == {
        "device_id": "00000000-0000-0000-0000-0000000000b1",
        "scope": "monitoring",
        "policy_version": "v1",
        "granted": True,
    }


def test_json_boundary_serializes_session_uuid_and_datetime() -> None:
    payload = serialize_postgrest_json(
        {
            "user_id": USER_ID,
            **SessionCreate(
                device_id=DEVICE_ID,
                monitoring_consent_id=UUID("00000000-0000-0000-0000-0000000000d1"),
                capture_policy_version="v1",
                started_at=datetime(2026, 8, 6, 10, 30, tzinfo=UTC),
            ).model_dump(mode="json"),
        }
    )

    assert payload == {
        "user_id": "00000000-0000-0000-0000-0000000000a1",
        "device_id": "00000000-0000-0000-0000-0000000000b1",
        "monitoring_consent_id": "00000000-0000-0000-0000-0000000000d1",
        "screenshot_consent_id": None,
        "capture_policy_version": "v1",
        "started_at": "2026-08-06T10:30:00Z",
    }


def test_json_boundary_serializes_event_rpc_payload_uuid_and_datetime() -> None:
    payload = serialize_postgrest_json(
        {
            "p_user_id": USER_ID,
            "p_device_id": DEVICE_ID,
            "p_session_id": SESSION_ID,
            "p_events": [
                BrowserEvent(
                    client_event_id="event-1",
                    sequence_number=0,
                    event_kind="navigation",
                    occurred_at=datetime(2026, 8, 6, 10, 30, tzinfo=UTC),
                    capture_policy_version="v1",
                ).model_dump(mode="json")
            ],
        }
    )

    assert payload == {
        "p_user_id": "00000000-0000-0000-0000-0000000000a1",
        "p_device_id": "00000000-0000-0000-0000-0000000000b1",
        "p_session_id": "00000000-0000-0000-0000-0000000000c1",
        "p_events": [
            {
                "client_event_id": "event-1",
                "sequence_number": 0,
                "event_kind": "navigation",
                "occurred_at": "2026-08-06T10:30:00Z",
                "page_origin": None,
                "page_path_hash": None,
                "page_title_redacted": None,
                "accessibility_context_redacted": None,
                "context_sha256": None,
                "capture_policy_version": "v1",
            }
        ],
    }


def test_json_boundary_serializes_deletion_request_uuids_and_enums() -> None:
    payload = serialize_postgrest_json(
        {"p_user_id": USER_ID, "p_session_id": SESSION_ID, "status": PayloadStatus.ACTIVE}
    )

    assert payload == {
        "p_user_id": "00000000-0000-0000-0000-0000000000a1",
        "p_session_id": "00000000-0000-0000-0000-0000000000c1",
        "status": "active",
    }
    json.dumps(payload)


def test_json_boundary_rejects_unsupported_custom_objects() -> None:
    with pytest.raises(PydanticSerializationError, match="Unable to serialize unknown type"):
        serialize_postgrest_json({"unknown": object()})


@pytest.mark.asyncio
async def test_create_consent_serializes_uuid_for_postgrest_json_payload() -> None:
    """A UUID-bearing consent must reach PostgREST as canonical JSON."""

    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": str(DEVICE_ID),
                        "user_id": str(USER_ID),
                        "installation_id": "test-installation",
                        "label": None,
                        "client_version": None,
                        "status": "active",
                    }
                ],
            )
        return httpx.Response(
            201,
            json=[
                {
                    "id": "00000000-0000-0000-0000-0000000000d1",
                    "user_id": str(USER_ID),
                    "device_id": str(DEVICE_ID),
                    "scope": "monitoring",
                    "policy_version": "v1",
                    "granted": True,
                }
            ],
        )

    repository = PostgrestRepository(
        "https://project.supabase.co",
        "server-only-key",
        transport=httpx.MockTransport(handler),
    )

    await repository.create_consent(
        USER_ID,
        ConsentCreate(
            device_id=DEVICE_ID,
            scope="monitoring",
            policy_version="v1",
            granted=True,
        ),
    )

    payload = json.loads(requests[1].content)
    assert payload["device_id"] == "00000000-0000-0000-0000-0000000000b1"


@pytest.mark.asyncio
async def test_create_consent_idempotent_uses_the_transactional_rpc() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json=[
                {
                    "outcome": "created",
                    "response_status": 201,
                    "consent_id": "00000000-0000-0000-0000-0000000000d1",
                    "consent_scope": "monitoring",
                    "consent_granted": True,
                }
            ],
        )

    repository = PostgrestRepository(
        "https://project.supabase.co",
        "server-only-key",
        transport=httpx.MockTransport(handler),
    )

    result = await repository.create_consent_idempotent(
        USER_ID,
        "/api/v1/consents",
        ConsentCreate(
            device_id=DEVICE_ID,
            scope="monitoring",
            policy_version="v1",
            granted=True,
        ),
        "consent-idempotency-key",
        "a" * 64,
    )

    assert result.response_metadata == {
        "id": "00000000-0000-0000-0000-0000000000d1",
        "scope": "monitoring",
        "granted": "true",
    }
    assert requests[0].url.path == "/rest/v1/rpc/create_consent_idempotent"
    payload = json.loads(requests[0].content)
    assert payload["p_user_id"] == str(USER_ID)
    assert payload["p_device_id"] == str(DEVICE_ID)
    assert payload["p_request_sha256"] == "a" * 64


@pytest.mark.asyncio
async def test_session_control_mutations_use_transactional_rpcs() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json=[
                {
                    "outcome": "created",
                    "response_status": 201 if "create_monitoring" in request.url.path else 200,
                    "session_id": str(SESSION_ID),
                    "session_status": "recording",
                }
            ],
        )

    repository = PostgrestRepository(
        "https://project.supabase.co",
        "server-only-key",
        transport=httpx.MockTransport(handler),
    )
    session = await repository.create_session_idempotent(
        USER_ID,
        "/api/v1/sessions",
        SessionCreate(
            device_id=DEVICE_ID,
            monitoring_consent_id=UUID("00000000-0000-0000-0000-0000000000d1"),
            capture_policy_version="v1",
            started_at=datetime(2026, 8, 6, 10, 30, tzinfo=UTC),
        ),
        "session-idempotency-key",
        "b" * 64,
    )
    transition = await repository.transition_idempotent(
        USER_ID,
        f"/api/v1/sessions/{SESSION_ID}/resume",
        SESSION_ID,
        "resume",
        "resume-idempotency-key",
        "c" * 64,
    )

    assert session.response_metadata == {"id": str(SESSION_ID), "status": "recording"}
    assert transition.response_metadata == {"id": str(SESSION_ID), "status": "recording"}
    assert [request.url.path for request in requests] == [
        "/rest/v1/rpc/create_monitoring_session_idempotent",
        "/rest/v1/rpc/transition_monitoring_session_idempotent",
    ]
    transition_payload = json.loads(requests[1].content)
    assert transition_payload["p_route"] == f"/api/v1/sessions/{SESSION_ID}/resume"
    assert transition_payload["p_target"] == "recording"


@pytest.mark.asyncio
async def test_create_session_rejects_a_consent_from_another_device() -> None:
    """A service-role write must not bind a session to another device's consent."""

    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/rest/v1/devices":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": str(DEVICE_ID),
                        "user_id": str(USER_ID),
                        "installation_id": "test-installation",
                        "label": None,
                        "client_version": None,
                        "status": "active",
                    }
                ],
            )
        if request.url.path == "/rest/v1/consent_records":
            return httpx.Response(200, json=[])
        return httpx.Response(201, json=[])

    repository = PostgrestRepository(
        "https://project.supabase.co",
        "server-only-key",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(ApiError, match="invalid_consent"):
        await repository.create_session(
            USER_ID,
            SessionCreate(
                device_id=DEVICE_ID,
                monitoring_consent_id=UUID("00000000-0000-0000-0000-0000000000d1"),
                capture_policy_version="v1",
                started_at=datetime(2026, 8, 6, 10, 30, tzinfo=UTC),
            ),
        )

    assert [request.url.path for request in requests] == [
        "/rest/v1/devices",
        "/rest/v1/consent_records",
    ]


@pytest.mark.asyncio
async def test_ingest_uses_server_only_rpc_with_owner_and_event_fingerprint() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json=[
                {
                    "outcome": "created",
                    "response_status": 202,
                    "accepted_count": 1,
                    "duplicate_count": 0,
                }
            ],
        )

    repository = PostgrestRepository(
        "https://project.supabase.co",
        "server-only-key",
        transport=httpx.MockTransport(handler),
    )
    event = BrowserEvent(
        client_event_id="event-1",
        sequence_number=0,
        event_kind="navigation",
        occurred_at=datetime.now(UTC),
        capture_policy_version="v1",
    )

    result = await repository.ingest(
        USER_ID, EVENT_BATCH_ROUTE, DEVICE_ID, SESSION_ID, [event]
    )

    assert (
        result.outcome,
        result.response_status,
        result.accepted_count,
        result.duplicate_count,
    ) == (
        "created",
        202,
        1,
        0,
    )
    assert len(requests) == 1
    request = requests[0]
    assert request.url.path == "/rest/v1/rpc/ingest_browser_event_batch"
    assert request.headers["apikey"] == "server-only-key"
    assert request.headers["authorization"] == "Bearer server-only-key"
    payload = json.loads(request.content)
    assert payload["p_user_id"] == str(USER_ID)
    assert payload.get("p_route") == EVENT_BATCH_ROUTE
    assert payload["p_device_id"] == str(DEVICE_ID)
    assert payload["p_session_id"] == str(SESSION_ID)
    assert payload["p_events"][0]["event_fingerprint"]


@pytest.mark.asyncio
async def test_ingest_preserves_a_typed_conflict_outcome() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "outcome": "conflict",
                    "response_status": None,
                    "accepted_count": 0,
                    "duplicate_count": 0,
                }
            ],
        )

    repository = PostgrestRepository(
        "https://project.supabase.co",
        "server-only-key",
        transport=httpx.MockTransport(handler),
    )
    result = await repository.ingest(
        USER_ID,
        EVENT_BATCH_ROUTE,
        DEVICE_ID,
        SESSION_ID,
        [
            BrowserEvent(
                client_event_id="event-1",
                sequence_number=0,
                event_kind="navigation",
                occurred_at=datetime.now(UTC),
                capture_policy_version="v1",
            )
        ],
        "key-1",
        "a" * 64,
    )

    assert getattr(result, "outcome", None) == "conflict"
