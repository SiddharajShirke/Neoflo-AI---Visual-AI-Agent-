from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from visual_ai_api.schemas import BrowserEvent, ConsentCreate, DeviceRegister, SessionCreate
from visual_ai_api.store import MemoryRepository

USER_A = UUID("00000000-0000-0000-0000-0000000000a1")
USER_B = UUID("00000000-0000-0000-0000-0000000000b2")
EVENT_ROUTE = "/api/v1/events/batch"
OTHER_ROUTE = "/api/v1/other"


async def prepared_repository(user_id: UUID) -> tuple[MemoryRepository, UUID, UUID]:
    repository = MemoryRepository()
    device = await repository.register_device(
        user_id, DeviceRegister(installation_id=f"device-{user_id.hex}"[:32])
    )
    consent = await repository.create_consent(
        user_id,
        ConsentCreate(
            device_id=device.id, scope="monitoring", policy_version="test-v1", granted=True
        ),
    )
    session = await repository.create_session(
        user_id,
        SessionCreate(
            device_id=device.id,
            monitoring_consent_id=consent.id,
            capture_policy_version="test-v1",
            started_at=datetime.now(UTC),
        ),
    )
    return repository, device.id, session.id


def event(client_event_id: str = "event-1") -> BrowserEvent:
    return BrowserEvent(
        client_event_id=client_event_id,
        sequence_number=1,
        event_kind="navigation",
        occurred_at=datetime.now(UTC),
        capture_policy_version="test-v1",
    )


@pytest.mark.asyncio
async def test_exact_retry_returns_original_response_without_new_event() -> None:
    repository, device_id, session_id = await prepared_repository(USER_A)

    first = await repository.ingest(
        USER_A, EVENT_ROUTE, device_id, session_id, [event()], "key-1", "a" * 64
    )
    retry = await repository.ingest(
        USER_A, EVENT_ROUTE, device_id, session_id, [event()], "key-1", "a" * 64
    )

    assert (first.outcome, first.accepted_count, first.duplicate_count) == ("created", 1, 0)
    assert (retry.outcome, retry.accepted_count, retry.duplicate_count) == ("completed", 1, 0)
    assert len(repository.events) == 1


@pytest.mark.asyncio
async def test_changed_request_with_same_key_is_conflict() -> None:
    repository, device_id, session_id = await prepared_repository(USER_A)
    await repository.ingest(
        USER_A, EVENT_ROUTE, device_id, session_id, [event()], "key-1", "a" * 64
    )

    result = await repository.ingest(
        USER_A, EVENT_ROUTE, device_id, session_id, [event("event-2")], "key-1", "b" * 64
    )
    assert result.outcome == "conflict"


@pytest.mark.asyncio
async def test_same_key_on_another_route_is_conflict() -> None:
    repository, device_id, session_id = await prepared_repository(USER_A)
    await repository.ingest(
        USER_A, EVENT_ROUTE, device_id, session_id, [event()], "key-1", "a" * 64
    )

    result = await repository.ingest(
        USER_A, OTHER_ROUTE, device_id, session_id, [event()], "key-1", "a" * 64
    )
    assert result.outcome == "conflict"


@pytest.mark.asyncio
async def test_different_users_can_reuse_the_same_external_key() -> None:
    first, first_device, first_session = await prepared_repository(USER_A)
    second, second_device, second_session = await prepared_repository(USER_B)

    assert (await first.ingest(
        USER_A, EVENT_ROUTE, first_device, first_session, [event()], "shared-key", "a" * 64
    )).outcome == "created"
    assert (await second.ingest(
        USER_B, EVENT_ROUTE, second_device, second_session, [event()], "shared-key", "a" * 64
    )).outcome == "created"
