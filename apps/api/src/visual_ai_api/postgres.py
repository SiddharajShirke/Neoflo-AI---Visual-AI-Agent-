"""Server-only Supabase PostgREST repository adapter.

PostgreSQL mutations that need transactionality use the RPC functions created
by the forward-only Supabase migrations.  No browser client receives this key.
"""

from __future__ import annotations

from hashlib import sha256
from typing import Any
from uuid import UUID

import httpx
from pydantic import TypeAdapter

from .errors import ApiError
from .schemas import BrowserEvent, ConsentCreate, DeviceRegister, SessionCreate
from .store import Consent, ControlMutationResult, Device, IngestResult, Session

_JSON_SERIALIZER = TypeAdapter(object)


def serialize_postgrest_json(payload: object) -> object:
    """Convert only supported values to JSON-mode data before HTTPX encoding."""
    return _JSON_SERIALIZER.dump_python(payload, mode="json", warnings="error")


class PostgrestRepository:
    def __init__(
        self,
        supabase_url: str,
        service_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = f"{supabase_url.rstrip('/')}/rest/v1"
        self._service_key = service_key
        self._transport = transport

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: object | None = None,
        params: dict[str, str] | None = None,
        prefer: str | None = None,
    ) -> Any:
        headers = {
            "apikey": self._service_key,
            "Authorization": f"Bearer {self._service_key}",
        }
        if prefer:
            headers["Prefer"] = prefer
        async with httpx.AsyncClient(
            base_url=self._base_url,
            transport=self._transport,
            timeout=5.0,
        ) as client:
            response = await client.request(
                method,
                path,
                headers=headers,
                json=serialize_postgrest_json(json) if json is not None else None,
                params=params,
            )
        if response.is_error:
            raise ApiError(503, "database_unavailable", "The service is unavailable.")
        if not response.content:
            return None
        return response.json()

    @staticmethod
    def _device(data: dict[str, Any]) -> Device:
        return Device(
            UUID(data["id"]),
            UUID(data["user_id"]),
            data["installation_id"],
            data.get("label"),
            data.get("client_version"),
            data["status"],
        )

    @staticmethod
    def _consent(data: dict[str, Any]) -> Consent:
        return Consent(
            UUID(data["id"]),
            UUID(data["user_id"]),
            UUID(data["device_id"]),
            data["scope"],
            data["policy_version"],
            data["granted"],
        )

    @staticmethod
    def _session(data: dict[str, Any]) -> Session:
        return Session(
            UUID(data["id"]),
            UUID(data["user_id"]),
            UUID(data["device_id"]),
            UUID(data["monitoring_consent_id"]),
            UUID(data["screenshot_consent_id"]) if data.get("screenshot_consent_id") else None,
            data["status"],
            data["started_at"],
            data.get("ended_at"),
            data["capture_policy_version"],
        )

    async def ready(self) -> bool:
        await self._request("GET", "/devices", params={"select": "id", "limit": "1"})
        return True

    async def register_device(self, user_id: UUID, data: DeviceRegister) -> Device:
        rows = await self._request(
            "POST",
            "/devices",
            params={"on_conflict": "user_id,installation_id"},
            json={"user_id": str(user_id), **data.model_dump(mode="json", exclude_none=True)},
            prefer="resolution=merge-duplicates,return=representation",
        )
        return self._device(rows[0])

    async def list_devices(self, user_id: UUID) -> list[Device]:
        rows = await self._request("GET", "/devices", params={"user_id": f"eq.{user_id}"})
        return [self._device(row) for row in rows]

    async def owned_device(self, user_id: UUID, device_id: UUID, active: bool = False) -> Device:
        rows = await self._request(
            "GET",
            "/devices",
            params={"id": f"eq.{device_id}", "user_id": f"eq.{user_id}"},
        )
        if not rows:
            raise ApiError(404, "resource_not_found", "The resource was not found.")
        device = self._device(rows[0])
        if active and device.status != "active":
            raise ApiError(409, "device_revoked", "The device is unavailable.")
        return device

    async def revoke_device(self, user_id: UUID, device_id: UUID) -> Device:
        await self.owned_device(user_id, device_id)
        rows = await self._request(
            "PATCH",
            "/devices",
            params={"id": f"eq.{device_id}", "user_id": f"eq.{user_id}"},
            json={"status": "revoked"},
            prefer="return=representation",
        )
        return self._device(rows[0])

    async def create_consent(self, user_id: UUID, data: ConsentCreate) -> Consent:
        await self.owned_device(user_id, data.device_id, active=True)
        rows = await self._request(
            "POST",
            "/consent_records",
            json={"user_id": str(user_id), **data.model_dump(mode="json")},
            prefer="return=representation",
        )
        return self._consent(rows[0])

    async def create_consent_idempotent(
        self,
        user_id: UUID,
        route: str,
        data: ConsentCreate,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult:
        rows = await self._request(
            "POST",
            "/rpc/create_consent_idempotent",
            json={
                "p_user_id": str(user_id),
                "p_route": route,
                "p_device_id": str(data.device_id),
                "p_scope": data.scope,
                "p_policy_version": data.policy_version,
                "p_granted": data.granted,
                "p_idempotency_key": idempotency_key,
                "p_request_sha256": request_hash,
            },
        )
        result = rows[0]
        outcome = result.get("outcome")
        if outcome not in {"created", "completed", "conflict", "in_progress"}:
            raise ApiError(503, "database_unavailable", "The service is unavailable.")
        metadata = None
        if result.get("consent_id") is not None:
            metadata = {
                "id": str(result["consent_id"]),
                "scope": str(result["consent_scope"]),
                "granted": str(bool(result["consent_granted"])).lower(),
            }
        return ControlMutationResult(
            outcome,
            int(result["response_status"]) if result.get("response_status") is not None else None,
            metadata,
        )

    async def list_consents(self, user_id: UUID) -> list[Consent]:
        rows = await self._request("GET", "/consent_records", params={"user_id": f"eq.{user_id}"})
        return [self._consent(row) for row in rows]

    async def _active_consent(
        self, user_id: UUID, consent_id: UUID, device_id: UUID, scope: str
    ) -> None:
        rows = await self._request(
            "GET",
            "/consent_records",
            params={
                "id": f"eq.{consent_id}",
                "user_id": f"eq.{user_id}",
                "device_id": f"eq.{device_id}",
                "scope": f"eq.{scope}",
                "granted": "is.true",
                "revoked_at": "is.null",
                "select": "id",
            },
        )
        if not rows:
            raise ApiError(409, "invalid_consent", "The consent is unavailable.")

    async def create_session(self, user_id: UUID, data: SessionCreate) -> Session:
        await self.owned_device(user_id, data.device_id, active=True)
        await self._active_consent(
            user_id, data.monitoring_consent_id, data.device_id, "monitoring"
        )
        if data.screenshot_consent_id is not None:
            await self._active_consent(
                user_id, data.screenshot_consent_id, data.device_id, "screenshots"
            )
        rows = await self._request(
            "POST",
            "/monitoring_sessions",
            json={"user_id": str(user_id), **data.model_dump(mode="json")},
            prefer="return=representation",
        )
        return self._session(rows[0])

    async def create_session_idempotent(
        self,
        user_id: UUID,
        route: str,
        data: SessionCreate,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult:
        rows = await self._request(
            "POST",
            "/rpc/create_monitoring_session_idempotent",
            json={
                "p_user_id": str(user_id),
                "p_route": route,
                "p_device_id": str(data.device_id),
                "p_monitoring_consent_id": str(data.monitoring_consent_id),
                "p_screenshot_consent_id": (
                    str(data.screenshot_consent_id) if data.screenshot_consent_id else None
                ),
                "p_capture_policy_version": data.capture_policy_version,
                "p_started_at": data.started_at,
                "p_idempotency_key": idempotency_key,
                "p_request_sha256": request_hash,
            },
        )
        return self._session_control_result(rows[0])

    async def list_sessions(self, user_id: UUID) -> list[Session]:
        rows = await self._request(
            "GET", "/monitoring_sessions", params={"user_id": f"eq.{user_id}"}
        )
        return [self._session(row) for row in rows]

    async def owned_session(self, user_id: UUID, session_id: UUID) -> Session:
        rows = await self._request(
            "GET",
            "/monitoring_sessions",
            params={"id": f"eq.{session_id}", "user_id": f"eq.{user_id}"},
        )
        if not rows:
            raise ApiError(404, "resource_not_found", "The resource was not found.")
        return self._session(rows[0])

    async def transition(self, user_id: UUID, session_id: UUID, action: str) -> Session:
        target = {
            "pause": "paused",
            "resume": "recording",
            "complete": "completed",
            "cancel": "cancelled",
        }[action]
        await self._request(
            "POST",
            "/rpc/transition_monitoring_session",
            json={"p_session_id": str(session_id), "p_user_id": str(user_id), "p_target": target},
        )
        return await self.owned_session(user_id, session_id)

    async def transition_idempotent(
        self,
        user_id: UUID,
        route: str,
        session_id: UUID,
        action: str,
        idempotency_key: str,
        request_hash: str,
    ) -> ControlMutationResult:
        target = {
            "pause": "paused",
            "resume": "recording",
            "complete": "completed",
            "cancel": "cancelled",
        }[action]
        rows = await self._request(
            "POST",
            "/rpc/transition_monitoring_session_idempotent",
            json={
                "p_user_id": str(user_id),
                "p_route": route,
                "p_session_id": str(session_id),
                "p_target": target,
                "p_idempotency_key": idempotency_key,
                "p_request_sha256": request_hash,
            },
        )
        return self._session_control_result(rows[0])

    @staticmethod
    def _session_control_result(result: dict[str, Any]) -> ControlMutationResult:
        outcome = result.get("outcome")
        if outcome not in {"created", "completed", "conflict", "in_progress"}:
            raise ApiError(503, "database_unavailable", "The service is unavailable.")
        metadata = None
        if result.get("session_id") is not None:
            metadata = {"id": str(result["session_id"]), "status": str(result["session_status"])}
        return ControlMutationResult(
            outcome,
            int(result["response_status"]) if result.get("response_status") is not None else None,
            metadata,
        )

    async def request_deletion(self, user_id: UUID, session_id: UUID) -> UUID:
        rows = await self._request(
            "POST",
            "/rpc/prepare_session_deletion_request",
            json={"p_session_id": str(session_id), "p_user_id": str(user_id)},
        )
        return UUID(str(rows[0]["prepare_session_deletion_request"]))

    async def ingest(
        self,
        user_id: UUID,
        route: str,
        device_id: UUID,
        session_id: UUID,
        events: list[BrowserEvent],
        key: str | None = None,
        request_hash: str | None = None,
    ) -> IngestResult:
        serialized_events = []
        for event in events:
            row = event.model_dump(mode="json")
            row["event_fingerprint"] = sha256(event.model_dump_json().encode()).hexdigest()
            serialized_events.append(row)
        rows = await self._request(
            "POST",
            "/rpc/ingest_browser_event_batch",
            json={
                "p_user_id": str(user_id),
                "p_route": route,
                "p_device_id": str(device_id),
                "p_session_id": str(session_id),
                "p_events": serialized_events,
                "p_idempotency_key": key,
                "p_request_sha256": request_hash,
            },
        )
        result = rows[0]
        outcome = result.get("outcome")
        if outcome not in {"created", "completed", "conflict", "in_progress"}:
            raise ApiError(503, "database_unavailable", "The service is unavailable.")
        return IngestResult(
            outcome,
            int(result["response_status"]) if result.get("response_status") is not None else None,
            int(result["accepted_count"]) if result.get("accepted_count") is not None else None,
            int(result["duplicate_count"]) if result.get("duplicate_count") is not None else None,
        )

    async def publish_outbox(self, limit: int) -> tuple[int, int, int]:
        rows = await self._request("POST", "/rpc/publish_event_outbox", json={"p_limit": limit})
        result = rows[0]
        return (
            int(result["claimed_count"]),
            int(result["published_count"]),
            int(result["pending_count"]),
        )
