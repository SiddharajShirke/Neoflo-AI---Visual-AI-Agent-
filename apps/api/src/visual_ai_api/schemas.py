"""Strict transport contracts. Browser data fields are deliberately absent."""

from __future__ import annotations

import json
from datetime import datetime
from hashlib import sha256
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DeviceRegister(StrictModel):
    installation_id: str = Field(min_length=16, max_length=255)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    client_version: str | None = Field(default=None, min_length=1, max_length=64)


class ConsentCreate(StrictModel):
    device_id: UUID
    scope: Literal["monitoring", "screenshots", "privacy_notice", "retention"]
    policy_version: str = Field(min_length=1, max_length=64)
    granted: bool


class SessionCreate(StrictModel):
    device_id: UUID
    monitoring_consent_id: UUID
    screenshot_consent_id: UUID | None = None
    capture_policy_version: str = Field(min_length=1, max_length=64)
    started_at: datetime


class BrowserEvent(StrictModel):
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


class EventBatch(StrictModel):
    device_id: UUID
    session_id: UUID
    events: list[BrowserEvent] = Field(min_length=1, max_length=100)


class EventIngestionResponse(StrictModel):
    accepted_count: int = Field(ge=0)
    duplicate_count: int = Field(ge=0)


def event_batch_request_hash(payload: EventBatch) -> str:
    """Hash the persistence-relevant request deterministically, never retaining it."""
    canonical = json.dumps(
        payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return sha256(canonical.encode("utf-8")).hexdigest()
