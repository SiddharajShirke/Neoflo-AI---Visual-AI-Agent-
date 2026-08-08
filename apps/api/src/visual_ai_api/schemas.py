"""Strict transport contracts. Browser data fields are deliberately absent."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime
from hashlib import sha256
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DeviceRegisterRequest(StrictModel):
    installation_id: str = Field(min_length=16, max_length=255)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    client_version: str | None = Field(default=None, min_length=1, max_length=64)


class ConsentCreateRequest(StrictModel):
    device_id: UUID
    scope: Literal["monitoring", "screenshots", "privacy_notice", "retention"]
    policy_version: str = Field(min_length=1, max_length=64)
    granted: bool


class MonitoringSessionCreateRequest(StrictModel):
    device_id: UUID
    monitoring_consent_id: UUID
    screenshot_consent_id: UUID | None = None
    capture_policy_version: str = Field(min_length=1, max_length=64)
    started_at: datetime


class BrowserEventV1(StrictModel):
    client_event_id: str = Field(min_length=1, max_length=128)
    sequence_number: int = Field(ge=0)
    event_kind: Literal["navigation", "meaningful_action", "visibility_change"]
    occurred_at: datetime
    page_origin: str | None = Field(default=None, max_length=255, pattern=r"^https?://[^/?#]+$")
    page_path_hash: str | None = Field(
        default=None, min_length=64, max_length=64, pattern=r"^[A-Fa-f0-9]{64}$"
    )
    page_title_redacted: str | None = Field(default=None, max_length=512)
    accessibility_context_redacted: str | None = Field(default=None, max_length=12000)
    context_sha256: str | None = Field(
        default=None, min_length=64, max_length=64, pattern=r"^[A-Fa-f0-9]{64}$"
    )
    capture_policy_version: str = Field(min_length=1, max_length=64)


class EventBatchV1(StrictModel):
    device_id: UUID
    session_id: UUID
    events: list[BrowserEventV1] = Field(min_length=1, max_length=100)


TOP_LEVEL_TRANSITION_TYPES = (
    "link",
    "typed",
    "auto_bookmark",
    "generated",
    "start_page",
    "form_submit",
    "reload",
    "keyword",
    "keyword_generated",
)


class BrowserEventV2(StrictModel):
    client_event_id: UUID
    sequence_number: int = Field(ge=1)
    event_kind: Literal["navigation"]
    occurred_at: datetime
    page_domain: str = Field(
        min_length=3,
        max_length=253,
        pattern=r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
    )
    transition_type: Literal[
        "link",
        "typed",
        "auto_bookmark",
        "generated",
        "start_page",
        "form_submit",
        "reload",
        "keyword",
        "keyword_generated",
    ]
    capture_policy_version: str = Field(min_length=1, max_length=64)

    @field_validator("page_domain")
    @classmethod
    def page_domain_is_normalized(cls, value: str) -> str:
        if value != value.lower():
            raise ValueError("page_domain must be lowercase")
        return value


class EventBatchV2(StrictModel):
    device_id: UUID
    session_id: UUID
    events: list[BrowserEventV2] = Field(min_length=1, max_length=100)


# Historical aliases are intentionally retained for v1 fixtures and direct repository tests.
BrowserEvent = BrowserEventV1
EventBatch = EventBatchV1


class EventIngestionResponse(StrictModel):
    accepted_count: int = Field(ge=0)
    duplicate_count: int = Field(ge=0)


class DeviceRegisterResponse(StrictModel):
    id: UUID
    status: Literal["active", "revoked"]


class DeviceListItem(StrictModel):
    id: UUID
    status: Literal["active", "revoked"]
    label: str | None


class DeviceListResponse(StrictModel):
    devices: list[DeviceListItem]


class ConsentCreateResponse(StrictModel):
    id: UUID
    scope: Literal["monitoring", "screenshots", "privacy_notice", "retention"]
    granted: Literal["true", "false"]


class ConsentListItem(StrictModel):
    id: UUID
    device_id: UUID
    scope: Literal["monitoring", "screenshots", "privacy_notice", "retention"]
    granted: bool


class ConsentListResponse(StrictModel):
    consents: list[ConsentListItem]


class MonitoringSessionResponse(StrictModel):
    id: UUID
    status: Literal["recording", "paused", "completed", "cancelled"]


class MonitoringSessionCreateResponse(MonitoringSessionResponse):
    screenshot_capture: Literal["not_implemented"]


class MonitoringSessionListItem(MonitoringSessionResponse):
    device_id: UUID


class MonitoringSessionListResponse(StrictModel):
    sessions: list[MonitoringSessionListItem]


class SessionTransitionResponse(MonitoringSessionResponse):
    pass


class DeletionRequestResponse(StrictModel):
    deletion_request_id: UUID
    status: Literal["requested"]


class ApiErrorDetails(StrictModel):
    code: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=256)
    request_id: str = Field(min_length=1, max_length=128)


class ApiErrorResponse(StrictModel):
    error: ApiErrorDetails


# Backwards-compatible Python names while FastAPI publishes the canonical
# schema-derived request model names in OpenAPI.
DeviceRegister = DeviceRegisterRequest
ConsentCreate = ConsentCreateRequest
SessionCreate = MonitoringSessionCreateRequest


def event_batch_request_hash(payload: EventBatchV1) -> str:
    """Hash the persistence-relevant request deterministically, never retaining it."""
    return canonical_request_hash(payload)


def event_batch_v2_request_hash(payload: EventBatchV2) -> str:
    """Hash the v2 request deterministically without retaining its body."""
    return canonical_request_hash(payload)


def canonical_request_hash(payload: BaseModel | Mapping[str, object]) -> str:
    """Hash a strict request deterministically without retaining its body."""
    canonical = json.dumps(
        payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return sha256(canonical.encode("utf-8")).hexdigest()
