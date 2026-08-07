import type {
  BrowserEvent,
  BrowserEventBatch,
  EventIngestionResponse
} from './generated/browser-event.js';

export type {
  BrowserEvent,
  BrowserEventBatch,
  BrowserEventKind,
  EventIngestionResponse
} from './generated/browser-event.js';
export type {
  ConsentCreateRequest,
  ConsentCreateResponse,
  ConsentListResponse,
  DeletionRequestResponse,
  DeviceListResponse,
  DeviceRegisterRequest,
  DeviceRegisterResponse,
  ApiErrorResponse,
  MonitoringSessionCreateRequest,
  MonitoringSessionCreateResponse,
  MonitoringSessionListResponse,
  MonitoringSessionResponse,
  SessionTransitionResponse
} from './generated/control-plane.js';
export {
  isConsentCreateRequest,
  isConsentCreateResponse,
  isConsentListResponse,
  isApiErrorResponse,
  isDeletionRequestResponse,
  isDeviceListResponse,
  isDeviceRegisterRequest,
  isDeviceRegisterResponse,
  isMonitoringSessionCreateRequest,
  isMonitoringSessionCreateResponse,
  isMonitoringSessionListResponse,
  isMonitoringSessionResponse,
  isSessionTransitionResponse
} from './generated/control-plane.js';

/** Stable names and strict TypeScript validators for canonical JSON schemas. */
export const schemaVersions = {
  healthResponse: 'v1',
  browserEvent: 'v1',
  browserEventBatch: 'v1',
  controlPlane: 'v1'
} as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[A-Fa-f0-9]{64}$/;
const originPattern = /^https?:\/\/[^/?#]+$/;
const eventKeys = new Set([
  'client_event_id',
  'sequence_number',
  'event_kind',
  'occurred_at',
  'page_origin',
  'page_path_hash',
  'page_title_redacted',
  'accessibility_context_redacted',
  'context_sha256',
  'capture_policy_version'
]);
const batchKeys = new Set(['device_id', 'session_id', 'events']);
const responseKeys = new Set(['accepted_count', 'duplicate_count']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNullableString(value: unknown, maximum: number): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.length <= maximum)
  );
}

export function isBrowserEvent(value: unknown): value is BrowserEvent {
  if (!isRecord(value) || !hasOnlyKeys(value, eventKeys)) return false;
  if (
    typeof value.client_event_id !== 'string' ||
    value.client_event_id.length < 1 ||
    value.client_event_id.length > 128
  )
    return false;
  if (!Number.isInteger(value.sequence_number) || (value.sequence_number as number) < 0)
    return false;
  if (
    !['navigation', 'meaningful_action', 'visibility_change'].includes(value.event_kind as string)
  )
    return false;
  if (typeof value.occurred_at !== 'string' || Number.isNaN(Date.parse(value.occurred_at)))
    return false;
  if (
    typeof value.capture_policy_version !== 'string' ||
    value.capture_policy_version.length < 1 ||
    value.capture_policy_version.length > 64
  )
    return false;
  if (
    !isNullableString(value.page_origin, 255) ||
    (typeof value.page_origin === 'string' && !originPattern.test(value.page_origin))
  )
    return false;
  if (
    value.page_path_hash !== undefined &&
    value.page_path_hash !== null &&
    (typeof value.page_path_hash !== 'string' || !sha256Pattern.test(value.page_path_hash))
  )
    return false;
  if (
    !isNullableString(value.page_title_redacted, 512) ||
    !isNullableString(value.accessibility_context_redacted, 12000)
  )
    return false;
  return (
    value.context_sha256 === undefined ||
    value.context_sha256 === null ||
    (typeof value.context_sha256 === 'string' && sha256Pattern.test(value.context_sha256))
  );
}

export function isBrowserEventBatch(value: unknown): value is BrowserEventBatch {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, batchKeys) &&
    typeof value.device_id === 'string' &&
    uuidPattern.test(value.device_id) &&
    typeof value.session_id === 'string' &&
    uuidPattern.test(value.session_id) &&
    Array.isArray(value.events) &&
    value.events.length >= 1 &&
    value.events.length <= 100 &&
    value.events.every(isBrowserEvent)
  );
}

export function isEventIngestionResponse(value: unknown): value is EventIngestionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, responseKeys) &&
    Number.isInteger(value.accepted_count) &&
    (value.accepted_count as number) >= 0 &&
    Number.isInteger(value.duplicate_count) &&
    (value.duplicate_count as number) >= 0
  );
}
