"""Deterministic repository substitute for unit tests.

Production deployment replaces this provider with the SQL functions introduced
by the Milestone 2 migrations; no browser data is logged or retained here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from typing import Literal, Protocol
from uuid import UUID, uuid4

from .errors import ApiError
from .schemas import BrowserEventV2, ConsentCreate, DeviceRegister, SessionCreate


def now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Device:
    id: UUID
    user_id: UUID
    installation_id: str
    label: str | None
    client_version: str | None
    status: str = "active"


@dataclass
class Consent:
    id: UUID
    user_id: UUID
    device_id: UUID
    scope: str
    policy_version: str
    granted: bool
    revoked_at: datetime | None = None


@dataclass
class Session:
    id: UUID
    user_id: UUID
    device_id: UUID
    monitoring_consent_id: UUID
    screenshot_consent_id: UUID | None
    status: str
    started_at: datetime
    ended_at: datetime | None
    capture_policy_version: str


@dataclass(frozen=True)
class IngestResult:
    outcome: Literal[
        "created",
        "completed",
        "conflict",
        "in_progress",
        "device_inactive",
        "consent_inactive",
        "session_not_recording",
        "policy_mismatch",
    ]
    response_status: int | None
    accepted_count: int | None
    duplicate_count: int | None


@dataclass(frozen=True)
class ControlMutationResult:
    outcome: Literal["created", "completed", "conflict", "in_progress"]
    response_status: int | None
    response_metadata: dict[str, str] | None


class Repository(Protocol):
    async def ready(self) -> bool: ...
    async def register_device(self, user_id: UUID, data: DeviceRegister) -> Device: ...
    async def list_devices(self, user_id: UUID) -> list[Device]: ...
    async def revoke_device(self, user_id: UUID, device_id: UUID) -> Device: ...
    async def create_consent(self, user_id: UUID, data: ConsentCreate) -> Consent: ...
    async def create_consent_idempotent(
        self,
        user_id: UUID,
        route: str,
        data: ConsentCreate,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult: ...
    async def list_consents(self, user_id: UUID) -> list[Consent]: ...
    async def create_session(self, user_id: UUID, data: SessionCreate) -> Session: ...
    async def create_session_idempotent(
        self,
        user_id: UUID,
        route: str,
        data: SessionCreate,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult: ...
    async def list_sessions(self, user_id: UUID) -> list[Session]: ...
    async def owned_session(self, user_id: UUID, session_id: UUID) -> Session: ...
    async def transition(self, user_id: UUID, session_id: UUID, action: str) -> Session: ...
    async def transition_idempotent(
        self,
        user_id: UUID,
        route: str,
        session_id: UUID,
        action: str,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult: ...
    async def request_deletion(self, user_id: UUID, session_id: UUID) -> UUID: ...
    async def ingest(
        self,
        user_id: UUID,
        route: str,
        device_id: UUID,
        session_id: UUID,
        events: list[BrowserEventV2],
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ) -> IngestResult: ...
    async def publish_outbox(self, limit: int) -> tuple[int, int, int]: ...


class MemoryRepository:
    def __init__(self) -> None:
        self.devices: dict[UUID, Device] = {}
        self.consents: dict[UUID, Consent] = {}
        self.sessions: dict[UUID, Session] = {}
        self.events: dict[tuple[UUID, UUID], tuple[UUID, str]] = {}
        self.deletion_requests: dict[UUID, UUID] = {}
        self.idempotency: dict[tuple[UUID, str], tuple[str, str, dict[str, int]]] = {}
        self.control_idempotency: dict[tuple[UUID, str], tuple[str, str, int, dict[str, str]]] = {}

    async def ready(self) -> bool:
        return True

    async def register_device(self, user_id: UUID, data: DeviceRegister) -> Device:
        for device in self.devices.values():
            if device.user_id == user_id and device.installation_id == data.installation_id:
                device.label, device.client_version = data.label, data.client_version
                return device
        device = Device(uuid4(), user_id, data.installation_id, data.label, data.client_version)
        self.devices[device.id] = device
        return device

    async def list_devices(self, user_id: UUID) -> list[Device]:
        return [device for device in self.devices.values() if device.user_id == user_id]

    async def owned_device(self, user_id: UUID, device_id: UUID, active: bool = False) -> Device:
        device = self.devices.get(device_id)
        if device is None or device.user_id != user_id:
            raise ApiError(404, "resource_not_found", "The resource was not found.")
        if active and device.status != "active":
            raise ApiError(409, "device_revoked", "The device is unavailable.")
        return device

    async def revoke_device(self, user_id: UUID, device_id: UUID) -> Device:
        device = await self.owned_device(user_id, device_id)
        device.status = "revoked"
        return device

    async def create_consent(self, user_id: UUID, data: ConsentCreate) -> Consent:
        await self.owned_device(user_id, data.device_id, active=True)
        consent = Consent(
            uuid4(), user_id, data.device_id, data.scope, data.policy_version, data.granted
        )
        self.consents[consent.id] = consent
        return consent

    async def create_consent_idempotent(
        self,
        user_id: UUID,
        route: str,
        data: ConsentCreate,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult:
        existing = self.control_idempotency.get((user_id, idempotency_key))
        if existing is not None:
            saved_route, saved_hash, status, metadata = existing
            if saved_route != route or saved_hash != request_hash:
                return ControlMutationResult("conflict", None, None)
            return ControlMutationResult("completed", status, metadata)
        for consent in self.consents.values():
            if (
                consent.user_id == user_id
                and consent.device_id == data.device_id
                and consent.scope == data.scope
                and consent.granted
                and consent.revoked_at is None
            ):
                consent.revoked_at = now()
        consent = await self.create_consent(user_id, data)
        metadata = {
            "id": str(consent.id),
            "scope": consent.scope,
            "granted": str(consent.granted).lower(),
        }
        self.control_idempotency[(user_id, idempotency_key)] = (
            route,
            request_hash,
            201,
            metadata,
        )
        return ControlMutationResult("created", 201, metadata)

    async def list_consents(self, user_id: UUID) -> list[Consent]:
        return [consent for consent in self.consents.values() if consent.user_id == user_id]

    async def owned_consent(
        self, user_id: UUID, consent_id: UUID, device_id: UUID, scope: str
    ) -> Consent:
        consent = self.consents.get(consent_id)
        if (
            consent is None
            or consent.user_id != user_id
            or consent.device_id != device_id
            or consent.scope != scope
            or not consent.granted
            or consent.revoked_at is not None
        ):
            raise ApiError(409, "invalid_consent", "The consent is unavailable.")
        return consent

    async def create_session(self, user_id: UUID, data: SessionCreate) -> Session:
        await self.owned_device(user_id, data.device_id, active=True)
        await self.owned_consent(user_id, data.monitoring_consent_id, data.device_id, "monitoring")
        if data.screenshot_consent_id:
            await self.owned_consent(
                user_id, data.screenshot_consent_id, data.device_id, "screenshots"
            )
        session = Session(
            uuid4(),
            user_id,
            data.device_id,
            data.monitoring_consent_id,
            data.screenshot_consent_id,
            "recording",
            data.started_at,
            None,
            data.capture_policy_version,
        )
        self.sessions[session.id] = session
        return session

    async def create_session_idempotent(
        self,
        user_id: UUID,
        route: str,
        data: SessionCreate,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult:
        existing = self.control_idempotency.get((user_id, idempotency_key))
        if existing is not None:
            saved_route, saved_hash, status, metadata = existing
            if saved_route != route or saved_hash != request_hash:
                return ControlMutationResult("conflict", None, None)
            return ControlMutationResult("completed", status, metadata)
        session = await self.create_session(user_id, data)
        metadata = {"id": str(session.id), "status": session.status}
        self.control_idempotency[(user_id, idempotency_key)] = (
            route,
            request_hash,
            201,
            metadata,
        )
        return ControlMutationResult("created", 201, metadata)

    async def list_sessions(self, user_id: UUID) -> list[Session]:
        return [session for session in self.sessions.values() if session.user_id == user_id]

    async def owned_session(self, user_id: UUID, session_id: UUID) -> Session:
        session = self.sessions.get(session_id)
        if session is None or session.user_id != user_id:
            raise ApiError(404, "resource_not_found", "The resource was not found.")
        return session

    async def transition(self, user_id: UUID, session_id: UUID, action: str) -> Session:
        session = await self.owned_session(user_id, session_id)
        target = {
            "pause": "paused",
            "resume": "recording",
            "complete": "completed",
            "cancel": "cancelled",
        }[action]
        allowed = {
            ("recording", "paused"),
            ("recording", "completed"),
            ("recording", "cancelled"),
            ("paused", "recording"),
            ("paused", "completed"),
            ("paused", "cancelled"),
        }
        if (session.status, target) not in allowed:
            raise ApiError(
                409, "invalid_session_transition", "The session cannot make that transition."
            )
        session.status = target
        session.ended_at = now() if target in {"completed", "cancelled"} else None
        return session

    async def transition_idempotent(
        self,
        user_id: UUID,
        route: str,
        session_id: UUID,
        action: str,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult:
        existing = self.control_idempotency.get((user_id, idempotency_key))
        if existing is not None:
            saved_route, saved_hash, status, metadata = existing
            if saved_route != route or saved_hash != request_hash:
                return ControlMutationResult("conflict", None, None)
            return ControlMutationResult("completed", status, metadata)
        session = await self.transition(user_id, session_id, action)
        metadata = {"id": str(session.id), "status": session.status}
        self.control_idempotency[(user_id, idempotency_key)] = (
            route,
            request_hash,
            200,
            metadata,
        )
        return ControlMutationResult("created", 200, metadata)

    async def request_deletion(self, user_id: UUID, session_id: UUID) -> UUID:
        session = await self.owned_session(user_id, session_id)
        if session.status not in {"completed", "cancelled"}:
            raise ApiError(409, "session_not_terminal", "The session must be terminal.")
        if session_id not in self.deletion_requests:
            self.deletion_requests[session_id] = uuid4()
        return self.deletion_requests[session_id]

    async def ingest(
        self,
        user_id: UUID,
        route: str,
        device_id: UUID,
        session_id: UUID,
        events: list[BrowserEventV2],
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ) -> IngestResult:
        if idempotency_key and request_hash:
            record = self.idempotency.get((user_id, idempotency_key))
            if record:
                if record[0] != route or record[1] != request_hash:
                    return IngestResult("conflict", None, None, None)
                metadata = record[2]
                return IngestResult(
                    "completed",
                    202,
                    int(metadata["accepted_count"]),
                    int(metadata["duplicate_count"]),
                )
        await self.owned_device(user_id, device_id, active=True)
        session = await self.owned_session(user_id, session_id)
        if session.device_id != device_id:
            raise ApiError(409, "resource_relationship_mismatch", "The resources do not match.")
        if session.status != "recording":
            raise ApiError(409, "session_not_recording", "The session is not recording.")
        try:
            await self.owned_consent(
                user_id, session.monitoring_consent_id, device_id, "monitoring"
            )
        except ApiError as error:
            raise ApiError(409, "consent_inactive", "Monitoring consent is unavailable.") from error
        if any(event.capture_policy_version != session.capture_policy_version for event in events):
            raise ApiError(
                409,
                "capture_policy_mismatch",
                "The capture policy does not match the session.",
            )
        accepted = duplicates = 0
        sequences: set[int] = set()
        for event in events:
            if event.sequence_number in sequences:
                raise ApiError(422, "invalid_event_batch", "The event batch is invalid.")
            sequences.add(event.sequence_number)
            fingerprint = sha256(event.model_dump_json().encode()).hexdigest()
            key = (device_id, event.client_event_id)
            existing = self.events.get(key)
            if existing is not None:
                if existing[1] != fingerprint:
                    raise ApiError(409, "event_id_conflict", "The event identifier was reused.")
                duplicates += 1
            else:
                self.events[key] = (uuid4(), fingerprint)
                accepted += 1
        if idempotency_key and request_hash:
            self.idempotency[(user_id, idempotency_key)] = (
                route,
                request_hash,
                {"accepted_count": accepted, "duplicate_count": duplicates},
            )
        return IngestResult("created", 202, accepted, duplicates)

    async def publish_outbox(self, limit: int) -> tuple[int, int, int]:
        return 0, 0, 0
