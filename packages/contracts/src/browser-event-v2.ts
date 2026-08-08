import type { BrowserEventBatchV2, BrowserEventV2 } from './generated/browser-event-v2.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifierUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const eventKeys = new Set([
  'client_event_id',
  'sequence_number',
  'event_kind',
  'occurred_at',
  'page_domain',
  'transition_type',
  'capture_policy_version'
]);
const batchKeys = new Set(['device_id', 'session_id', 'events']);
const transitionTypes = new Set([
  'link',
  'typed',
  'auto_bookmark',
  'generated',
  'start_page',
  'form_submit',
  'reload',
  'keyword',
  'keyword_generated'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function isIdentifierUuid(value: unknown): value is string {
  return typeof value === 'string' && identifierUuidPattern.test(value);
}

export function isBrowserEventV2(value: unknown): value is BrowserEventV2 {
  if (!isRecord(value) || !hasOnlyKeys(value, eventKeys)) return false;
  return (
    isUuid(value.client_event_id) &&
    Number.isInteger(value.sequence_number) &&
    (value.sequence_number as number) >= 1 &&
    value.event_kind === 'navigation' &&
    typeof value.occurred_at === 'string' &&
    !Number.isNaN(Date.parse(value.occurred_at)) &&
    typeof value.page_domain === 'string' &&
    value.page_domain.length >= 3 &&
    value.page_domain.length <= 253 &&
    domainPattern.test(value.page_domain) &&
    value.page_domain === value.page_domain.toLowerCase() &&
    typeof value.transition_type === 'string' &&
    transitionTypes.has(value.transition_type) &&
    typeof value.capture_policy_version === 'string' &&
    value.capture_policy_version.length >= 1 &&
    value.capture_policy_version.length <= 64
  );
}

export function isBrowserEventBatchV2(value: unknown): value is BrowserEventBatchV2 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, batchKeys) &&
    isIdentifierUuid(value.device_id) &&
    isIdentifierUuid(value.session_id) &&
    Array.isArray(value.events) &&
    value.events.length >= 1 &&
    value.events.length <= 100 &&
    value.events.every(isBrowserEventV2)
  );
}
